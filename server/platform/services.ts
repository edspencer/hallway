// The per-user service manager behind the platform layer (D3, D26): launchd LaunchAgents on macOS (launchd.ts),
// systemd user units on Linux (systemd.ts). Both take a fully resolved ServiceSpec (server/services/spec.ts does the
// resolving: absolute paths, PATH, environment) and turn it into a file plus a handful of lifecycle verbs. Every
// command goes through a Runner, so the lifecycle is tested with the runner mocked, on every OS.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** A job: Hallway's daemon or one managed app. Everything in it is already absolute and resolved. */
export interface ServiceSpec {
  /** `hallway.daemon` or `hallway.app.<slug>` (D19). */
  label: string;
  /** For people: `Hallway: My App (my-app)`. */
  description: string;
  /** The argv, `program[0]` an absolute, real path (never a shim). */
  program: string[];
  cwd: string;
  /** The whole environment the job gets: PATH (and PORT, HOST, HOSTNAME for apps). */
  env: Record<string, string>;
  /** Start it at login (launchd RunAtLoad; systemd `WantedBy=default.target`). */
  runAtLoad: boolean;
  /** Restart it when it exits (launchd KeepAlive; systemd `Restart=always`). */
  keepAlive: boolean;
  /** Log files, appended to. */
  stdout: string;
  stderr: string;
  /** The Node the job's PATH starts with (docs/04, "The PATH trap"), recorded so doctor can tell when it's gone. */
  node: { path: string; version: string } | null;
}

/** What the service manager says about a job. */
export interface ServiceStatus {
  label: string;
  /** The definition file exists. */
  installed: boolean;
  /** The service manager knows it (launchd: bootstrapped; systemd: the unit loads). */
  loaded: boolean;
  running: boolean;
  pid: number | null;
  /** The last exit status, if it has exited. */
  lastExitCode: number | null;
  /** The manager's own word for it (`running`, `waiting`, `active (running)`, `inactive (dead)`, `failed`). */
  state: string | null;
  /** Starts at login. Null where the manager doesn't say. */
  enabled: boolean | null;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command and resolves with its exit code and output (never rejects for a non-zero exit). */
export type Runner = (cmd: string, args: string[]) => Promise<RunResult>;

export const defaultRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      if (e && e.code === 'ENOENT') resolve({ code: 127, stdout: '', stderr: `${cmd}: command not found` });
      else resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });

export class ServiceManagerError extends Error {}

export interface ServiceManager {
  kind: 'launchd' | 'systemd' | 'schtasks';
  /** Set where this OS has no managed services yet (D58): why, so callers refuse before writing anything. */
  unsupported?: string;
  /** Where a label's definition lives. */
  file(label: string): string;
  /** The definition's text. Pure. */
  render(spec: ServiceSpec): string;
  /** The PATH a definition sets, for doctor. */
  readPath(text: string): string | null;
  /** Write the definition (atomically) and tell the manager. True if it changed. Doesn't start anything. */
  write(spec: ServiceSpec): Promise<boolean>;
  /** Make it run now, and at login if `runAtLoad`; a no-op if it's already running. */
  start(spec: ServiceSpec): Promise<void>;
  /** Stop it and keep it stopped, across logins too, until `start`. */
  stop(label: string): Promise<void>;
  /** Restart it. `reload`: the definition changed, so re-read it first. Starts it if it wasn't loaded. */
  restart(spec: ServiceSpec, opts?: { reload?: boolean }): Promise<void>;
  status(label: string): Promise<ServiceStatus>;
  /** Stop it and delete the definition. */
  remove(label: string): Promise<void>;
  /** Labels of every `hallway.*` definition in the service directory. */
  list(): string[];
}

/** Write `text` to `file` via a temp file and rename; false if it already had exactly that text. */
export function writeIfChanged(file: string, text: string): boolean {
  try {
    if (fs.readFileSync(file, 'utf8') === text) return false;
  } catch {
    /* missing: write it */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o644 });
  fs.renameSync(tmp, file);
  return true;
}

export function removeFile(file: string) {
  fs.rmSync(file, { force: true });
}
