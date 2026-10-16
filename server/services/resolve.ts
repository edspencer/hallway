// The PATH trap (docs/04-apps-health-services.md, "The PATH trap"). launchd and systemd jobs inherit no shell
// environment, so a job's PATH and program are written into its definition, and copying the current shell's PATH
// naïvely is a latent bug: version managers put per-shell directories on it (fnm's `fnm_multishells/<pid>_<ts>/bin`),
// which outlive nothing reliably. So:
//   - `command[0]` is resolved to an absolute, real path (realpath of `which`), never a shim; a Node script (a
//     `#!/usr/bin/env node` file such as `npx`) is run by an absolute Node, as in docs/04's template;
//   - the resolved Node's own bin directory goes first on PATH, so `node`, `npm` and `npx` in the job resolve to the
//     Node that runs it;
//   - the rest of PATH is the current one minus per-shell directories, relative entries and anything that doesn't
//     exist, then the usual system directories;
//   - the Node's version is recorded, so doctor can tell when it has been uninstalled.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** PATH entries that belong to one shell session or one npm invocation, never to a long-lived job. */
export const PER_SHELL_PATTERNS: readonly RegExp[] = [
  /[/\\]fnm_multishells[/\\]/, // fnm: a symlink per terminal, never cleaned up
  /[/\\]_npx[/\\]/, // npx's per-invocation package cache
  /[/\\]node-gyp-bin$/, // added by `npm run` for the script it's running
];

/** Where the usual tools live, after the current PATH (only those that exist are kept). */
export const SYSTEM_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export const isPerShell = (dir: string) => PER_SHELL_PATTERNS.some((re) => re.test(dir) || re.test(`${dir}/`));

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isExecutableFile = (p: string) => {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Why a PATH entry was dropped, or null if it's kept. */
export function pathProblem(dir: string): string | null {
  if (!dir || !path.isAbsolute(dir)) return 'not an absolute path';
  if (isPerShell(dir)) return 'a per-shell directory (it belongs to one terminal session)';
  if (!isDir(dir)) return "doesn't exist";
  return null;
}

/** The job's PATH: Node's bin first, then the usable part of `inherited`, then the system directories. */
export function servicePath(nodeBin: string | null, inherited: string | undefined): string {
  const out: string[] = [];
  const add = (d: string) => {
    // trailing separators off, but never a root's own (`/`, `C:\`)
    const clean = /^([A-Za-z]:)?[\\/]$/.test(d) ? d : d.replace(/[\\/]+$/, '');
    if (!out.includes(clean) && pathProblem(clean) === null) out.push(clean);
  };
  if (nodeBin) add(nodeBin);
  for (const d of (inherited ?? '').split(path.delimiter)) add(d);
  for (const d of SYSTEM_DIRS) add(d);
  return out.join(path.delimiter);
}

/**
 * The file names `name` can be on PATH. With a PATHEXT (Windows: `.COM;.EXE;.BAT;.CMD;…`) a bare name is looked for
 * only with one of those extensions, as cmd.exe does; that matters because npm puts an extensionless `#!/bin/sh`
 * script beside every `.cmd` shim, and Windows can't run it. A name that already has one of them is taken as it is.
 */
export function candidates(name: string, pathExt?: string): string[] {
  const exts = (pathExt ?? '').split(';').map((e) => e.trim().toLowerCase()).filter((e) => e.startsWith('.'));
  if (!exts.length || exts.includes(path.extname(name).toLowerCase())) return [name];
  return exts.map((e) => name + e);
}

/** `which`: the first executable called `name` on `pathVar` (absolute entries only), or null. Not resolved. */
export function which(name: string, pathVar: string | undefined, pathExt?: string): string | null {
  for (const dir of (pathVar ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const n of candidates(name, pathExt)) {
      const p = path.join(dir, n);
      if (isExecutableFile(p)) return p;
    }
  }
  return null;
}

/**
 * A script's `#!` line, if it runs Node: the extra Node options it passes (`#!/usr/bin/env -S node --no-warnings`
 * gives `['--no-warnings']`). Null if it isn't a Node script.
 */
export function nodeShebang(file: string): string[] | null {
  let head: string;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  }
  if (!head.startsWith('#!')) return null;
  const words = head.slice(2).split('\n')[0].trim().split(/\s+/);
  const i = words.findIndex((w) => /^(node|nodejs)$/.test(path.basename(w)));
  return i < 0 ? null : words.slice(i + 1);
}

export interface ResolvedNode {
  path: string;
  version: string;
}

/** The Node the user's shell would run (`node` on PATH, resolved), else the one running Hallway. */
export function resolveNode(pathVar: string | undefined, pathExt?: string): ResolvedNode {
  const found = which('node', pathVar, pathExt);
  // .native: resolves Windows junctions too (fnm's per-shell links are junctions there)
  const real = fs.realpathSync.native(found ?? process.execPath);
  let version = process.version;
  if (real !== fs.realpathSync.native(process.execPath)) {
    try {
      version = execFileSync(real, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
    } catch {
      version = 'unknown';
    }
  }
  return { path: real, version };
}

export class ResolveError extends Error {}

/**
 * The argv a job runs: `command[0]` made absolute and real (relative to `cwd` if it has a slash, else found on
 * `pathVar`), and Node scripts run by `node` explicitly.
 */
export function resolveCommand(command: string[], cwd: string, pathVar: string | undefined, node: ResolvedNode, pathExt?: string): string[] {
  const [first, ...rest] = command;
  if (!first) throw new ResolveError('the command is empty');
  // a bare `node` is the Node the job's PATH starts with, not whichever one `which` finds first
  if (first === 'node' || first === 'nodejs' || (pathExt && /^node(js)?\.exe$/i.test(first))) return [node.path, ...rest];
  const found = first.includes('/') || first.includes(path.sep) ? path.resolve(cwd, first) : which(first, pathVar, pathExt);
  if (!found) throw new ResolveError(`can't find \`${first}\` on your PATH; give its full path`);
  let real: string;
  try {
    real = fs.realpathSync.native(found);
  } catch {
    throw new ResolveError(`\`${first}\` (${found}) doesn't exist`);
  }
  const nodeArgs = nodeShebang(real);
  if (nodeArgs) return [node.path, ...nodeArgs, real, ...rest];
  if (!isExecutableFile(real)) throw new ResolveError(`\`${first}\` (${real}) isn't an executable file`);
  return [real, ...rest];
}
