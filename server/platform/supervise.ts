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
}

/** Runs until the job exits for good (no keepAlive), or this process is killed. Resolves with the last exit code. */
export async function supervise(jobFile: string, opts: SuperviseOptions = {}): Promise<number> {
  const stateFile = stateFileOf(jobFile);
  const restartMs = (opts.restartSec ?? RESTART_SEC) * 1000;
  let child: ChildProcess | null = null;
  let lastExitCode: number | null = readState(stateFile)?.lastExitCode ?? null;
  let stopping = false;
  const stop = () => {
    stopping = true;
    child?.kill();
    // the job's own children are the stopper's business (taskkill /T on our PID); give the job a moment, then go
    setTimeout(() => process.exit(0), 2000).unref();
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(sig, stop);

  for (;;) {
    const spec = JSON.parse(fs.readFileSync(jobFile, 'utf8')) as ServiceSpec;
    fs.mkdirSync(path.dirname(spec.stdout), { recursive: true });
    const out = fs.openSync(spec.stdout, 'a');
    const err = fs.openSync(spec.stderr, 'a');
    const { cmd, args, verbatim } = launchArgs(spec.program, process.env.ComSpec);
    const code = await new Promise<number>((resolve) => {
      try {
        child = spawn(cmd, args, { cwd: spec.cwd, env: mergeEnv(process.env, spec.env), stdio: ['ignore', out, err], windowsHide: true, windowsVerbatimArguments: verbatim });
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
    await new Promise((r) => setTimeout(r, restartMs));
    if (stopping) return code;
  }
}
