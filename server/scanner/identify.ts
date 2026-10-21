// Identification (docs/04-apps-health-services.md, "Observed listeners", step 4). Command lines are often useless
// (`node dist/index.js`), so the working directory is the primary identifier: walk up to the project root, read its
// name and description, ask git where and on which branch it is (and whether it's a worktree), and guess the framework.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Observation } from './types.js';
import { run } from '../platform/listeners.js';

/** Files that mark a project's root, nearest first. */
export const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', '.git'];

/**
 * Directories that say nothing about what runs in them, only these exact ones: services and daemons are started in
 * them (`/` for a launchd job with no WorkingDirectory, the home directory, a temp directory), but a project can live
 * below them.
 */
const PLACES = ['/', '/tmp', '/private/tmp', '/var', '/private/var', '/opt', '/usr', '/usr/local', '/srv', '/Users', '/home', '/Applications', '/Volumes'];

/**
 * Directories that are never a project, nor is anything below them: package-manager prefixes (Homebrew's is a git
 * repository on branch `stable`, so a `brew services` job started in it would be named "Homebrew @ stable") and the
 * system's own directories.
 */
const PREFIXES = [
  '/opt/homebrew', '/usr/local/Homebrew', '/usr/local/Cellar', '/usr/local/opt', '/usr/local/var', '/home/linuxbrew/.linuxbrew',
  '/opt/local', '/nix', '/snap', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/private/etc', '/usr/bin', '/usr/sbin', '/usr/lib',
  '/usr/libexec', '/usr/share', '/var/lib', '/var/run', '/run', '/proc', '/sys', '/dev', '/System', '/Library',
];

const WINDOWS_SYSTEM = /^[a-z]:\\(windows|program files( \(x86\))?|programdata)(\\|$)/i;

/**
 * Whether a working directory is a known non-project location, where git and README identity would mislead: `/`, the
 * home directory (and its ~/Library), a package-manager prefix or a system directory. Windows' own directories too.
 */
export function nonProjectDir(dir: string, home = os.homedir()): boolean {
  const d = path.resolve(dir);
  if (d === home || d === path.dirname(d)) return true;
  if (WINDOWS_SYSTEM.test(dir) || WINDOWS_SYSTEM.test(d)) return true;
  const under = (p: string) => d === p || d.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
  // a home directory can itself be below a system directory (a service account's in /var/lib): what's in it is the
  // user's, so only ~/Library is ruled out there
  if (home !== path.dirname(home) && under(home)) return under(path.join(home, 'Library'));
  return PLACES.includes(d) || [...PREFIXES, path.join(home, 'Library')].some(under);
}

/**
 * The nearest directory at or above `cwd` holding a project marker. Never the home directory, `/` or another
 * non-project location (`nonProjectDir`): a dotfiles repository in `~` would otherwise claim everything under it.
 */
export function projectRoot(cwd: string, home = os.homedir()): string | null {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (nonProjectDir(dir, home)) return null;
    if (PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
  }
}

const readText = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

function readJson(p: string): Record<string, unknown> | null {
  const t = readText(p);
  if (t === null) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** The first `# Heading` of a README, without markdown decoration. */
export function readmeTitle(text: string): string | null {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(text);
  return m ? m[1].replace(/[*_`]/g, '').trim() || null : null;
}

/** Name and description: package.json, else pyproject/Cargo (`name = "…"`), else go.mod's module, else the README. */
export function projectName(root: string): { name: string; description: string | null } {
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg && typeof pkg.name === 'string' && pkg.name)
    return { name: pkg.name, description: typeof pkg.description === 'string' && pkg.description ? pkg.description : null };
  for (const f of ['pyproject.toml', 'Cargo.toml']) {
    const t = readText(path.join(root, f));
    const name = t && /^name\s*=\s*["']([^"']+)["']/m.exec(t)?.[1];
    if (name) return { name, description: (t && /^description\s*=\s*["']([^"']+)["']/m.exec(t)?.[1]) || null };
  }
  const mod = readText(path.join(root, 'go.mod'));
  const modName = mod && /^module\s+(\S+)/m.exec(mod)?.[1];
  if (modName) return { name: path.basename(modName), description: null };
  for (const f of ['README.md', 'readme.md', 'README.markdown', 'README']) {
    const t = readText(path.join(root, f));
    const title = t && readmeTitle(t);
    if (title) return { name: title, description: null };
  }
  return { name: path.basename(root), description: null };
}

const COMMAND_FRAMEWORKS: [RegExp, string][] = [
  [/^next$/, 'next'],
  [/^(nuxt|nuxi)$/, 'nuxt'],
  [/^astro$/, 'astro'],
  [/^remix(-serve)?$/, 'remix'],
  [/^svelte-kit$/, 'sveltekit'],
  [/^vite$/, 'vite'],
  [/^http\.server$/, 'python-http'],
  [/^(flask)$/, 'flask'],
  [/^(uvicorn|fastapi)$/, 'fastapi'],
  [/^(rails|puma)$/, 'rails'],
  [/^jekyll$/, 'jekyll'],
  [/^hugo$/, 'hugo'],
];

const DEPENDENCY_FRAMEWORKS: [string, string][] = [
  ['next', 'next'],
  ['nuxt', 'nuxt'],
  ['astro', 'astro'],
  ['@remix-run/dev', 'remix'],
  ['@react-router/dev', 'react-router'],
  ['@sveltejs/kit', 'sveltekit'],
  ['vite', 'vite'],
  ['@nestjs/core', 'nest'],
  ['fastify', 'fastify'],
  ['hono', 'hono'],
  ['express', 'express'],
  ['koa', 'koa'],
];

/**
 * A guess at the framework, for an icon and for service-command hints: the command first (`vite`, `astro dev`,
 * `python3 -m http.server`, `manage.py runserver`), then the project's dependencies.
 */
export function guessFramework(argv: string[] | null, root: string | null): string | null {
  const words = (argv ?? []).map((a) => path.basename(a));
  if (words.includes('manage.py') && words.includes('runserver')) return 'django';
  for (const w of words) for (const [re, fw] of COMMAND_FRAMEWORKS) if (re.test(w)) return fw;
  if (!root) return null;
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.devDependencies as object), ...(pkg.dependencies as object) };
    for (const [dep, fw] of DEPENDENCY_FRAMEWORKS) if (dep in deps) return fw;
  }
  const py = (readText(path.join(root, 'pyproject.toml')) ?? '') + (readText(path.join(root, 'requirements.txt')) ?? '');
  for (const fw of ['django', 'fastapi', 'flask']) if (new RegExp(`\\b${fw}\\b`, 'i').test(py)) return fw;
  if (/\brails\b/.test(readText(path.join(root, 'Gemfile')) ?? '')) return 'rails';
  return null;
}

const git = (dir: string, args: string[]) =>
  // GIT_OPTIONAL_LOCKS=0: never take the index lock in someone's working tree just to look at it
  run('git', ['-C', dir, ...args], { timeoutMs: 5000, env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });

/** The repository's name: its main checkout's directory, from the common git dir (`…/my-app/.git` → `my-app`). */
export function repoName(commonDir: string): string {
  const base = path.basename(commonDir);
  return base === '.git' ? path.basename(path.dirname(commonDir)) : base.replace(/\.git$/, '');
}

/**
 * Where `dir` sits in git: toplevel, branch, last commit, and whether it's a linked worktree (its git dir differs from
 * the common dir, which points at the parent repository). Null outside a repository or if git isn't installed.
 */
export async function gitInfo(dir: string): Promise<Observation['git']> {
  const paths = await git(dir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']);
  if (!paths.ok) return null;
  // git prints `C:/Users/…` on Windows: path.resolve makes it the OS's own form, as everything else here is
  const [toplevel, gitDir, commonDir] = paths.stdout.trim().split(/\r?\n/).map((p) => p && path.resolve(p));
  if (!toplevel || !gitDir || !commonDir) return null;
  const [branch, log, remote] = await Promise.all([
    git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(dir, ['log', '-1', '--format=%cI']),
    git(dir, ['config', '--get', 'remote.origin.url']),
  ]);
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return {
    toplevel,
    repo: repoName(real(commonDir)),
    // a detached HEAD has no branch: fall back to the short commit
    branch: branch.ok ? branch.stdout.trim() : (await git(dir, ['rev-parse', '--short', 'HEAD'])).stdout.trim() || null,
    lastCommitAt: log.ok ? log.stdout.trim() || null : null,
    worktree: real(gitDir) !== real(commonDir),
    remote: remote.ok ? remote.stdout.trim() || null : null,
    commonDir: real(commonDir),
  };
}

/** Everything identification learns from a working directory and command. */
export async function identify(
  cwd: string | null,
  argv: string[] | null,
  home = os.homedir(),
): Promise<Pick<Observation, 'project' | 'git'>> {
  // no marker anywhere above (`python3 -m http.server` in a folder of files): the directory itself is the project,
  // unless it's somewhere that says nothing (`/`, the home directory, /opt/homebrew): then the executable, the
  // supervisor's label and the page's title name it instead (observations.ts)
  const root = cwd ? (projectRoot(cwd, home) ?? (nonProjectDir(cwd, home) ? null : cwd)) : null;
  const project = root ? { root, ...projectName(root), framework: guessFramework(argv, root) } : null;
  const g = root ? await gitInfo(root) : null;
  return { project, git: g };
}
