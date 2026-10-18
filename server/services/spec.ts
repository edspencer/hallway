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
  const node = ctx.node ?? resolveNode(ctx.env.PATH, ctx.env.PATHEXT);
  const port = String(app.port);
  const host = app.host;
  const command = substitute(svc.command, { PORT: port, HOST: host });
  const program = resolveCommand(command, cwd, ctx.env.PATH, node, ctx.env.PATHEXT);
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
  const node = ctx.node ?? { path: fs.realpathSync.native(process.execPath), version: process.version };
  const logs = logFiles(home, 'daemon');
  return {
    label: DAEMON_LABEL,
    description: 'Hallway: the dashboard daemon',
    program: [node.path, fs.realpathSync.native(cliScript), 'serve', '--quiet'],
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

export const CADDY_LABEL = 'hallway.caddy';
export const DNSMASQ_LABEL = 'hallway.dnsmasq';

/**
 * Fronted mode's two helpers (D47), user-level jobs like any other, always running:
 *   hallway.caddy    `caddy run --config <data home>/generated/caddy.json` (the daemon keeps that file current and
 *                    pushes it over the admin socket; Caddy starts from it after a reboot, before the daemon is up)
 *   hallway.dnsmasq  custom domains only: `dnsmasq` in the foreground on generated/dnsmasq.conf
 * Caddy's own directories ($XDG_CONFIG_HOME, $XDG_DATA_HOME) point into the data home, so a Caddy the user runs for
 * something else is never touched.
 */
export function helperSpec(kind: 'caddy' | 'dnsmasq', program: string, home: string, ctx: { userHome?: string }): ServiceSpec {
  const p = dataPaths(home);
  const logs = logFiles(home, kind);
  const caddyDir = path.join(p.state, 'caddy');
  return {
    label: kind === 'caddy' ? CADDY_LABEL : DNSMASQ_LABEL,
    description: kind === 'caddy' ? "Hallway: Caddy, fronted mode's proxy" : "Hallway: dnsmasq, fronted mode's custom-domain DNS",
    program:
      kind === 'caddy'
        ? [program, 'run', '--config', path.join(p.generated, 'caddy.json')]
        : [program, '--keep-in-foreground', `--conf-file=${path.join(p.generated, 'dnsmasq.conf')}`, '--pid-file=', '--log-facility=-'],
    cwd: home,
    env: {
      PATH: servicePath(null, undefined),
      HOME: ctx.userHome ?? os.homedir(),
      ...(kind === 'caddy' ? { XDG_CONFIG_HOME: path.join(caddyDir, 'config'), XDG_DATA_HOME: path.join(caddyDir, 'xdg-data') } : {}),
    },
    runAtLoad: true,
    keepAlive: true,
    stdout: logs.out,
    stderr: logs.err,
    node: null,
  };
}

/** The forwarders' labels: `hallway.forward.https`, `…https6`, `…http`, `…http6` (D65). */
export const FORWARD_PREFIX = 'hallway.forward.';
export const isForwardLabel = (label: string) => label.startsWith(FORWARD_PREFIX);

/** One loopback socket launchd holds for Caddy, and the port of Caddy's it goes to. */
export interface Forward {
  label: string;
  address: '127.0.0.1' | '::1';
  port: 443 | 80;
  to: number;
}

/**
 * The forwarders fronted mode wants on macOS (D65): loopback 443 and 80, on both families, to Caddy's ports; only 80
 * when it serves plain HTTP (the No HTTPS tier). Each is a socket launchd binds as root for a LaunchAgent: the only
 * way a user's job gets a privileged loopback port on macOS, with no sudo.
 */
export function forwards(proxy: { httpsPort: number; httpPort: number }, scheme: 'https' | 'http'): Forward[] {
  const out: Forward[] = [];
  for (const [name, port, to] of [['https', 443, proxy.httpsPort], ['http', 80, proxy.httpPort]] as const) {
    if (scheme === 'http' && port === 443) continue;
    out.push({ label: `${FORWARD_PREFIX}${name}`, address: '127.0.0.1', port, to });
    out.push({ label: `${FORWARD_PREFIX}${name}6`, address: '::1', port, to });
  }
  return out;
}

/**
 * A forwarder's job: `node <cli.js> forward <to>` (server/forward.ts), given the listening socket by launchd. Like the
 * daemon's job it runs Hallway's own CLI, so it must be an installed one, never npx's cache (D61). Loaded at login;
 * launchd starts it on the first connection and again on the next one if it ever exits.
 */
export function forwardSpec(f: Forward, home: string, cliScript: string, ctx: SpecContext): ServiceSpec {
  const node = ctx.node ?? { path: fs.realpathSync.native(process.execPath), version: process.version };
  const logs = logFiles(home, f.label.slice('hallway.'.length).replace(/\./g, '-'));
  return {
    label: f.label,
    description: `Hallway: loopback ${f.address === '::1' ? '[::1]' : f.address}:${f.port} to Caddy on ${f.to}`,
    program: [node.path, fs.realpathSync.native(cliScript), 'forward', String(f.to)],
    cwd: home,
    env: { PATH: servicePath(path.dirname(node.path), ctx.env.PATH) },
    runAtLoad: false,
    keepAlive: false,
    stdout: logs.out,
    stderr: logs.err,
    node,
    socket: { address: f.address, port: f.port },
  };
}
