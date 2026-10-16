// From an app's YAML (or the daemon itself) to a fully resolved ServiceSpec for the platform's service manager:
// absolute program, a PATH that survives the shell it was made in (resolve.ts), the injected PORT/HOST/HOSTNAME,
// and log files in the data home's logs/ (docs/04-apps-health-services.md, "Managed services").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../../shared/api.js';
import { dataPaths, expandHome } from '../config.js';
import type { ServiceSpec } from '../platform/index.js';
import { ResolveError, type ResolvedNode, resolveCommand, resolveNode, servicePath } from './resolve.js';

export const DAEMON_LABEL = 'hallway.daemon';
export const appLabel = (slug: string) => `hallway.app.${slug}`;
/** `hallway.app.my-app` → `my-app`; null for Hallway's own jobs. */
export const slugOfLabel = (label: string) => (label.startsWith('hallway.app.') ? label.slice('hallway.app.'.length) : null);

/** A job's log files: `logs/<name>.out.log` and `logs/<name>.err.log` (`daemon` for the daemon). */
export function logFiles(home: string, name: string) {
  const dir = dataPaths(home).logs;
  return { out: path.join(dir, `${name}.out.log`), err: path.join(dir, `${name}.err.log`) };
}

/**
 * `$PORT`, `${PORT}`, `$HOST` and `${HOST}` in a command's arguments become the app's values. launchd never expands
 * variables in ProgramArguments, and systemd's rules differ, so Hallway does it itself, the same on both (D42).
 */
export function substitute(argv: string[], vars: Record<string, string>): string[] {
  return argv.map((a) => a.replace(/\$\{([A-Z_]+)\}|\$([A-Z_]+)\b/g, (m, a1, a2) => vars[a1 ?? a2] ?? m));
}

export interface SpecContext {
  /** The environment `hallway` runs in: its PATH is the starting point for the job's. */
  env: NodeJS.ProcessEnv;
  /** The user's home directory, for `~`. */
  userHome?: string;
  /** Injected in tests. */
  node?: ResolvedNode;
}

/** The job for a managed app. Throws ResolveError when the command or directory can't be resolved. */
export function appSpec(slug: string, app: AppConfig, home: string, ctx: SpecContext): ServiceSpec {
  const svc = app.service;
  if (!svc) throw new ResolveError(`apps/${slug}.yaml has no service: block`);
  const userHome = ctx.userHome ?? os.homedir();
  const cwd = path.resolve(expandHome(svc.cwd ?? app.project?.dir ?? '~', userHome));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new ResolveError(`the working directory ${cwd} doesn't exist`);
  const node = ctx.node ?? resolveNode(ctx.env.PATH);
  const port = String(app.port);
  const host = app.host;
  const command = substitute(svc.command, { PORT: port, HOST: host });
  const program = resolveCommand(command, cwd, ctx.env.PATH, node);
  const logs = logFiles(home, slug);
  return {
    label: appLabel(slug),
    description: `Hallway: ${app.name} (${slug})`,
    program,
    cwd,
    // the user's env may change HOST (to listen elsewhere on purpose), but PORT is always the app's port
    env: { PATH: servicePath(path.dirname(node.path), ctx.env.PATH), HOST: host, HOSTNAME: host, ...svc.env, PORT: port },
    runAtLoad: svc.runAtLoad,
    keepAlive: svc.keepAlive,
    stdout: logs.out,
    stderr: logs.err,
    node,
  };
}

/** The daemon's own job: `node <cli.js> serve --quiet`, always running (`hallway service install`). */
export function daemonSpec(home: string, cliScript: string, ctx: SpecContext): ServiceSpec {
  const node = ctx.node ?? { path: fs.realpathSync(process.execPath), version: process.version };
  const logs = logFiles(home, 'daemon');
  return {
    label: DAEMON_LABEL,
    description: 'Hallway: the dashboard daemon',
    program: [node.path, fs.realpathSync(cliScript), 'serve', '--quiet'],
    cwd: home,
    // a data home other than the default has to be passed on: the job's environment is otherwise empty
    env: { PATH: servicePath(path.dirname(node.path), ctx.env.PATH), ...(ctx.env.HALLWAY_HOME ? { HALLWAY_HOME: home } : {}) },
    runAtLoad: true,
    keepAlive: true,
    stdout: logs.out,
    stderr: logs.err,
    node,
  };
}
