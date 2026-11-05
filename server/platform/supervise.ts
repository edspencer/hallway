// `hallway supervise <job.json>`: what a Windows scheduled task runs (D60). Task Scheduler starts a program at logon,
// but it has no log redirection, no environment for the program, and restarts a task only when it fails to *start*,
// not when it exits; so the task runs this, and this does what launchd and systemd do themselves:
//   - runs the job's argv in its directory, with the user's environment plus the job's (PATH first: the PATH trap),
//   - appends its stdout and stderr to the job's log files,
//   - with keepAlive, starts it again RESTART_SEC after it exits (launchd's ThrottleInterval, systemd's RestartSec),
//   - records the supervisor's and the job's PIDs and the last exit code in `<job>.state.json` beside the job file,
//     which is how `hallway service status` knows what's running without parsing localised schtasks output.
// It reads the job file at every start, so a regenerated job takes effect at the next restart. Internal: not in --help.
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ServiceSpec } from './services.js';

export const RESTART_SEC = 10;

/** What the supervisor records for status: written atomically on every start and exit. */
export interface SupervisorState {
  /** The supervisor's own PID (stop kills its process tree). */
  supervisor: number;
  /** The job's PID while it runs. */
  pid: number | null;
  startedAt: string | null;
  lastExitCode: number | null;
  exitedAt: string | null;
}

export const stateFileOf = (jobFile: string) => jobFile.replace(/\.json$/, '.state.json');
/**
 * `<job>.stop`: the service manager's request for a clean stop (D77). Windows has no SIGTERM to send the supervisor,
 * so the manager writes this file; the supervisor sees it, sends an `ipcStop` job the IPC message "stop" (or kills
 * any other job), waits for it to exit and then exits itself.
 */
export const stopFileOf = (jobFile: string) => jobFile.replace(/\.json$/, '.stop');
/** How long the supervisor waits for an `ipcStop` job to stop before killing it: past the daemon's own 10 s drain. */
export const STOP_GRACE_MS = 15_000;

export function readState(file: string): SupervisorState | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SupervisorState;
  } catch {
    return null;
  }
}

function writeState(file: string, s: SupervisorState) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(s) + '\n');
  fs.renameSync(tmp, file);
}

/**
 * The user's environment with the job's on top. Windows' variable names are case-insensitive, and a copy of
 * process.env keeps `Path` as it was spelt; setting `PATH` beside it would leave the child two PATHs and an arbitrary
 * winner, so a job's key replaces any spelling of it.
 */
export function mergeEnv(base: NodeJS.ProcessEnv, over: Record<string, string>, caseInsensitive = true): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  for (const [k, v] of Object.entries(over)) {
    if (caseInsensitive) for (const existing of Object.keys(out)) if (existing.toLowerCase() === k.toLowerCase()) delete out[existing];
    out[k] = v;
  }
  return out;
}

/** Quote one argument for cmd.exe's `/s /c "…"` (a .cmd or .bat program can only be run through cmd). */
export const cmdQuote = (a: string) => (/^[\w\-.:\\/=@+,]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);

/** How to start `program`: directly, or a batch file through cmd.exe (Node refuses to spawn one without a shell). */
export function launchArgs(program: string[], comspec = 'cmd.exe'): { cmd: string; args: string[]; verbatim: boolean } {
  const [first, ...rest] = program;
  if (/\.(cmd|bat)$/i.test(first)) return { cmd: comspec, args: ['/d', '/s', '/c', `"${[first, ...rest].map(cmdQuote).join(' ')}"`], verbatim: true };
  return { cmd: first, args: rest, verbatim: false };
}

export interface SuperviseOptions {
  restartSec?: number;
  log?: (s: string) => void;
  /** How often to look for the stop-request file (default 250 ms). */
  pollMs?: number;
  /** How long an `ipcStop` job gets to stop before it's killed (default STOP_GRACE_MS). */
  graceMs?: number;
}

/** Runs until the job exits for good (no keepAlive), or this process is killed. Resolves with the last exit code. */
export async function supervise(jobFile: string, opts: SuperviseOptions = {}): Promise<number> {
  const stateFile = stateFileOf(jobFile);
  const restartMs = (opts.restartSec ?? RESTART_SEC) * 1000;
  let child: ChildProcess | null = null;
  let lastExitCode: number | null = readState(stateFile)?.lastExitCode ?? null;
  let stopping = false;
  let ipc = false;
  let exitAfter: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;
  const graceMs = opts.graceMs ?? STOP_GRACE_MS;
  /** A clean stop: an `ipcStop` job is asked (and killed after the grace), anything else is killed. */
  const askToStop = () => {
    (wake as (() => void) | null)?.();
    const c = child as ChildProcess | null;
    if (!c) return;
    if (ipc && c.connected) {
      c.send('stop', () => {});
      setTimeout(() => c.kill(), graceMs).unref();
    } else c.kill();
  };
  // a signal (Ctrl-C, Ctrl-Break): the job's own children are the stopper's business (taskkill /T on our PID); give the
  // job its moment, then go
  const stop = () => {
    stopping = true;
    askToStop();
    exitAfter ??= setTimeout(() => process.exit(0), ipc ? graceMs + 1000 : 2000).unref();
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(sig, stop);
  // the service manager's stop request (stopFileOf): the job stops, then the loop below ends, and so does this
  const stopFile = stopFileOf(jobFile);
  fs.rmSync(stopFile, { force: true }); // one left from before isn't for this run
  const watch = setInterval(() => {
    if (stopping || !fs.existsSync(stopFile)) return;
    stopping = true;
    askToStop();
  }, opts.pollMs ?? 250);
  watch.unref();
  try {
    return await run();
  } finally {
    clearInterval(watch);
    if (exitAfter) clearTimeout(exitAfter);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.off(sig, stop);
    fs.rmSync(stopFile, { force: true });
  }

  async function run(): Promise<number> {
    for (;;) {
      const spec = JSON.parse(fs.readFileSync(jobFile, 'utf8')) as ServiceSpec;
      fs.mkdirSync(path.dirname(spec.stdout), { recursive: true });
      const out = fs.openSync(spec.stdout, 'a');
      const err = fs.openSync(spec.stderr, 'a');
      const { cmd, args, verbatim } = launchArgs(spec.program, process.env.ComSpec);
      const code = await new Promise<number>((resolve) => {
        try {
          ipc = !!spec.ipcStop;
          child = spawn(cmd, args, { cwd: spec.cwd, env: mergeEnv(process.env, spec.env), stdio: ipc ? ['ignore', out, err, 'ipc'] : ['ignore', out, err], windowsHide: true, windowsVerbatimArguments: verbatim });
        } catch (e) {
          fs.writeSync(err, `hallway: couldn't start ${spec.program[0]}: ${(e as Error).message}\n`);
          resolve(127);
          return;
        }
        child.once('error', (e) => {
          fs.writeSync(err, `hallway: couldn't start ${spec.program[0]}: ${e.message}\n`);
          resolve(127);
        });
        child.once('spawn', () => writeState(stateFile, { supervisor: process.pid, pid: child!.pid ?? null, startedAt: new Date().toISOString(), lastExitCode, exitedAt: null }));
        child.once('exit', (c, signal) => resolve(c ?? (signal ? 1 : 0)));
      });
      child = null;
      fs.closeSync(out);
      fs.closeSync(err);
      lastExitCode = code;
      writeState(stateFile, { supervisor: process.pid, pid: null, startedAt: null, lastExitCode, exitedAt: new Date().toISOString() });
      // the job file as it is now: a regenerate that turned keepAlive off takes effect before the restart, not after
      let keepAlive = spec.keepAlive;
      try {
        keepAlive = (JSON.parse(fs.readFileSync(jobFile, 'utf8')) as ServiceSpec).keepAlive;
      } catch {
        /* removed or half-written: as it was */
      }
      if (stopping || !keepAlive) return code;
      opts.log?.(`${spec.label} exited (${code}); starting it again in ${restartMs / 1000} s`);
      // a stop request wakes it early
      await new Promise<void>((r) => {
        const t = setTimeout(r, restartMs);
        wake = () => {
          clearTimeout(t);
          r();
        };
      });
      wake = null;
      if (stopping) return code;
    }
  }
}
