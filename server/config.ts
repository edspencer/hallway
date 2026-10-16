import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The package root: the directory holding Hallway's own package.json. This file runs from server/ (from source, via
 * tsx: dev and tests) or from dist/server/ (the compiled, installed package), so walk up to it rather than assume a
 * depth.
 */
export function packageRoot(from = path.dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'hallway') return dir;
    } catch {
      /* no package.json here (or not ours): keep going */
    }
    if (path.dirname(dir) === dir) throw new Error(`can't find Hallway's package.json above ${from}`);
  }
}
export const ROOT = packageRoot();
/** The built dashboard (`npm run build`), served by the daemon. */
export const WEB_DIST = path.join(ROOT, 'dist', 'web');
export const VERSION: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export function expandHome(p: string, home = os.homedir()) {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith(`~${path.sep}`)) return path.join(home, p.slice(2));
  return p;
}

/** A path for showing to people: the home directory as `~` (`/Users/x/.hallway` → `~/.hallway`). */
export function tildify(p: string, home = os.homedir()) {
  if (p === home) return '~';
  if (home && p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

/**
 * The data home: `$HALLWAY_HOME`, else `~/.hallway`. The variable is an override, never a requirement: launchd and
 * systemd jobs, and agents' non-login shells, start with an empty environment, so the default has to work alone.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env, home = os.homedir()) {
  return path.resolve(expandHome(env.HALLWAY_HOME || path.join(home, '.hallway'), home));
}
export const HOME = resolveHome();

/**
 * Where everything lives in a data home (docs/02-architecture.md, "Data home"). Human-editable files sit at the top;
 * machine-written data lives under state/, cache/, generated/, logs/ and backups/, and is never YAML.
 */
export function dataPaths(home: string) {
  return {
    home,
    config: path.join(home, 'config.yaml'),
    apps: path.join(home, 'apps'),
    bookmarks: path.join(home, 'bookmarks'),
    ignore: path.join(home, 'ignore.yaml'),
    state: path.join(home, 'state'),
    cache: path.join(home, 'cache'),
    generated: path.join(home, 'generated'),
    logs: path.join(home, 'logs'),
    backups: path.join(home, 'backups'),
  };
}

/** The default port. The one place it's set: the CLI's help, the startup line and `npm run dev` all derive from it. */
export { DEFAULT_PORT } from './port.js';
/** A port number from the command line or $PORT: an integer 0–65535 (0 picks any free port), else null. */
export function parsePort(v: string): number | null {
  return /^[0-9]{1,5}$/.test(v) && Number(v) <= 65535 ? Number(v) : null;
}

/**
 * Development-only escape hatches, for previewing a build behind someone else's reverse proxy (e.g. a dev box whose
 * proxy reaches the daemon over the LAN with its own hostname). Environment variables only, never CLI flags, so they
 * stay out of `--help` and out of anything a user is told to run. Unset, the daemon binds 127.0.0.1 and accepts only
 * loopback Host headers, as the spec requires (docs/02-architecture.md, "Security model"; D31).
 *   HALLWAY_DEV_BIND           the address to bind instead of 127.0.0.1
 *   HALLWAY_DEV_ALLOWED_HOSTS  comma-separated extra hostnames the Host/Origin check accepts
 */
export function devOverrides(env: NodeJS.ProcessEnv = process.env) {
  const bind = env.HALLWAY_DEV_BIND?.trim() || null;
  const allowedHosts = (env.HALLWAY_DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return { bind, allowedHosts };
}
