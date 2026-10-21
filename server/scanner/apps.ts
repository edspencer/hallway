// Listeners that belong to something installed rather than to a project (D73): a desktop application's internal ports
// (Rancher Desktop's, an authenticator's, an IDE's helpers), and a package run as a tool in someone else's directory
// (`npx local-review` in a repository it reviews). Pure: everything comes from the command line, the launchd label and
// the working directory.
import path from 'node:path';
import type { ListenerApp } from '../../shared/api.js';
import type { Supervisor } from '../platform/listeners.js';

const isUnder = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith('/') ? dir : dir + '/');

/** Reverse-DNS parts that say nothing about the app. */
const BUNDLE_NOISE = new Set(['com', 'io', 'org', 'net', 'dev', 'app', 'co', 'me', 'ai', 'mac', 'macos', 'osx', 'desktop', 'helper', 'agent']);

/** A bundle id as people would say it, when nothing better is known: `com.example.verify` → `Example Verify`. */
export function bundleName(id: string): string {
  const parts = id.split('.').filter((p) => p && !/^\d+$/.test(p));
  const words = parts.filter((p, i) => !(i === 0 && BUNDLE_NOISE.has(p.toLowerCase())) && !(i === parts.length - 1 && parts.length > 2 && BUNDLE_NOISE.has(p.toLowerCase())));
  const pick = (words.length ? words : parts).slice(-2);
  return pick.map((w) => w.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join(' ');
}

/**
 * The desktop application a process belongs to: the outermost `.app` bundle in its command line (macOS: helpers live
 * inside their app's bundle), a launchd `application.<bundle id>.<n>.<n>` label, a sandboxed app's data container as
 * its working directory, or an install directory (`/opt/<App>`, `/snap/<app>`, `C:\Program Files\<Vendor>\<App>`).
 * Null for anything inside the project it runs in (an Electron app under development is the project).
 */
export function desktopApp(command: string | null, supervisor: Supervisor | null | undefined, cwd: string | null, projectRoot: string | null, home: string): ListenerApp | null {
  const cmd = command ?? '';
  const inProject = (p: string) => !!projectRoot && isUnder(p, projectRoot);
  const bundle = /^(.*?\/([^/]+)\.app)\/Contents\//.exec(cmd);
  const label = supervisor?.manager === 'launchd' ? /^application\.(.+?)(?:\.\d+)+$/.exec(supervisor.label)?.[1] ?? null : null;
  const container = cwd ? new RegExp(`^${escape(path.posix.join(home, 'Library'))}/(?:Group )?Containers/([^/]+)`).exec(cwd)?.[1] ?? null : null;
  const bundleId = label ?? (container && /\./.test(container) ? container.replace(/^[A-Z0-9]{10}\./, '') : null);
  if (bundle && !inProject(bundle[1])) return { name: bundle[2], bundleId };
  if (bundleId) return { name: bundleName(bundleId), bundleId };
  // the command, not its first word: install directories have spaces (`/opt/Example Chat/example-chat`)
  const linux = /^\/(?:opt|snap)\/([^/]+)\//.exec(cmd.trim());
  if (linux && !['homebrew', 'local'].includes(linux[1]) && !inProject(cmd.trim())) return { name: linux[1], bundleId: null };
  const win = /^[a-z]:\\(?:program files(?: \(x86\))?\\(?:[^\\]+\\)?|users\\[^\\]+\\appdata\\local\\programs\\)([^\\]+)\\/i.exec(cmd.replace(/^"/, ''));
  if (win) return { name: win[1], bundleId: null };
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where package managers put what they install globally or run once: npx's and pnpm dlx's caches, a global prefix's
 *  `lib/node_modules`, bun's, Volta's and Yarn's globals, pipx's and uv's tool environments. */
const GLOBAL_PACKAGES = /\/(?:_npx|lib\/node_modules|\.bun\/install\/global|\.volta\/tools|\.?yarn\/global|\.config\/yarn\/global|pnpm\/global|pnpm\/dlx|dlx-\d+|pipx\/venvs|uv\/tools)\//;

/**
 * The package a command runs when it's installed globally or run once, not the project's own: `npx local-review` in
 * a repository it reviews is Local Review, not the repository. From the first few arguments: the last package in a
 * `node_modules` path (`…/_npx/<hash>/node_modules/local-review/dist/cli.js` → `local-review`), or pipx's or `uv
 * tool`'s environment (`…/pipx/venvs/<pkg>/bin/…`). A project's own `node_modules/.bin/vite`, hoisted or not, is
 * never a global location, so its dev server stays the project.
 */
export function toolPackage(argv: readonly string[] | null): string | null {
  for (const a of (argv ?? []).slice(0, 4)) {
    const p = a.replace(/\\/g, '/');
    if (!GLOBAL_PACKAGES.test(p)) continue;
    const bin = /\/node_modules\/\.bin\/([^/]+)$/.exec(p);
    if (bin) return bin[1];
    const pkg = [...p.matchAll(/\/node_modules\/(@[^/]+\/[^/]+|[^/@.][^/]*)/g)].at(-1)?.[1];
    if (pkg) return pkg;
    const py = /\/(?:pipx\/venvs|uv\/tools)\/([^/]+)\//.exec(p);
    if (py) return py[1];
  }
  return null;
}
