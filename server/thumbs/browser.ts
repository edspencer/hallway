// The screenshot tier's browser (D13, D56): installed into the data home by `hallway thumbs enable`, never a dependency
// of the package. `npm install` puts a pinned playwright-core into `cache/browser/`, and its own installer downloads
// Chromium's headless shell next to it (PLAYWRIGHT_BROWSERS_PATH). The daemon loads playwright-core from there by
// path, so a base install neither contains nor resolves it. `hallway thumbs disable` deletes the directory.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The playwright-core release `hallway thumbs enable` installs. */
export const PLAYWRIGHT_VERSION = '1.64.1';

export function browserPaths(home: string) {
  const dir = path.join(home, 'cache', 'browser');
  return {
    dir,
    module: path.join(dir, 'node_modules', 'playwright-core'),
    browsers: path.join(dir, 'ms-playwright'),
    /** Written last, once both steps worked: its presence is what "installed" means. */
    marker: path.join(dir, 'installed.json'),
  };
}

export interface BrowserInstall {
  version: string;
  installedAt: string;
}

/** What's installed, or null. */
export function installedBrowser(home: string): BrowserInstall | null {
  try {
    return JSON.parse(fs.readFileSync(browserPaths(home).marker, 'utf8')) as BrowserInstall;
  } catch {
    return null;
  }
}

/** Runs a command with its output passed through; resolves with its exit code. Mocked in tests. */
export type Exec = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<number>;

export const realExec: Exec = (cmd, args, { cwd, env }) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

/** npm: the one beside this Node (as a global npm install puts it), else whatever is on PATH. */
export function npmCommand(execPath = process.execPath): string {
  const beside = path.join(path.dirname(execPath), 'npm');
  return fs.existsSync(beside) ? beside : 'npm';
}

/**
 * Install playwright-core and Chromium's headless shell into `cache/browser/`. Idempotent: npm and Playwright both skip
 * what's already there. Throws with what failed.
 */
export async function installBrowser(home: string, { exec = realExec, env = process.env, log = (_: string) => {} }: { exec?: Exec; env?: NodeJS.ProcessEnv; log?: (s: string) => void } = {}): Promise<BrowserInstall> {
  const p = browserPaths(home);
  fs.mkdirSync(p.dir, { recursive: true });
  // a package.json of its own, so npm installs here rather than in some project above the data home
  fs.writeFileSync(path.join(p.dir, 'package.json'), JSON.stringify({ name: 'hallway-browser', private: true, description: 'Written by `hallway thumbs enable`; `hallway thumbs disable` deletes this directory.' }, null, 2) + '\n');
  const childEnv: NodeJS.ProcessEnv = { ...env, PLAYWRIGHT_BROWSERS_PATH: p.browsers, NODE_ENV: 'production' };
  delete childEnv.npm_config_global;
  log(`Installing playwright-core ${PLAYWRIGHT_VERSION} into ${p.dir}\n`);
  const npm = await exec(npmCommand(), ['install', '--no-audit', '--no-fund', '--no-package-lock', '--omit=dev', `playwright-core@${PLAYWRIGHT_VERSION}`], { cwd: p.dir, env: childEnv });
  if (npm !== 0) throw new Error(`npm install playwright-core failed (exit ${npm})`);
  log(`Downloading Chromium (headless shell) into ${p.browsers}\n`);
  const cli = path.join(p.module, 'cli.js');
  const pw = await exec(process.execPath, [cli, 'install', '--only-shell', 'chromium'], { cwd: p.dir, env: childEnv });
  if (pw !== 0) throw new Error(`playwright install chromium failed (exit ${pw})`);
  const rec: BrowserInstall = { version: PLAYWRIGHT_VERSION, installedAt: new Date().toISOString() };
  fs.writeFileSync(p.marker, JSON.stringify(rec) + '\n');
  return rec;
}

/** Delete `cache/browser/`. Returns whether there was anything to delete. */
export function removeBrowser(home: string): boolean {
  const p = browserPaths(home);
  if (!fs.existsSync(p.dir)) return false;
  fs.rmSync(p.dir, { recursive: true, force: true });
  return true;
}

/** The bits of playwright-core the shooter uses. */
export interface PlaywrightLike {
  chromium: { launch(opts: { headless: boolean; args?: string[] }): Promise<BrowserLike> };
}
export interface BrowserLike {
  newPage(opts: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<PageLike>;
  close(): Promise<void>;
  isConnected(): boolean;
}
export interface PageLike {
  goto(url: string, opts: { waitUntil: 'load' | 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForLoadState(state: 'networkidle', opts: { timeout: number }): Promise<void>;
  screenshot(opts: { type: 'png' }): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Load the installed playwright-core, pointed at the data home's browsers. Null when it isn't installed. */
export async function loadPlaywright(home: string): Promise<PlaywrightLike | null> {
  if (!installedBrowser(home)) return null;
  const p = browserPaths(home);
  // read when playwright-core first loads; only this process's own Chromium launches see it
  process.env.PLAYWRIGHT_BROWSERS_PATH = p.browsers;
  try {
    const mod = (await import(pathToFileURL(path.join(p.module, 'index.mjs')).href)) as { default?: PlaywrightLike } & PlaywrightLike;
    return mod.chromium ? mod : (mod.default ?? null);
  } catch {
    return null;
  }
}
