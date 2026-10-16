// `hallway thumbs enable | disable | refresh [slug] | status`: the opt-in screenshot thumbnails (D13, D55). Enable
// installs a browser into the data home (never into the package) and switches `thumbnails.mode` to `screenshot`;
// disable switches it back and deletes the browser and the screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { UsageError, check, need } from '../args.js';
import { tildify } from '../config.js';
import { type Exec, browserPaths, installBrowser, installedBrowser, realExec, removeBrowser } from '../thumbs/browser.js';
import type { Ctx } from './context.js';

const SUBCOMMANDS = ['enable', 'disable', 'refresh', 'status'];

/** Bytes under a directory (0 if it isn't there). */
function du(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) n += fs.statSync(path.join(e.parentPath, e.name)).size;
  }
  return n;
}
const mb = (b: number) => `${Math.round(b / 1e6)} MB`;

export async function thumbs(ctx: Ctx, args: string[], flags: Record<string, string>, rest: string[] | undefined, { exec = realExec }: { exec?: Exec } = {}): Promise<number> {
  need('thumbs', args, [SUBCOMMANDS.join('|')]);
  const sub = args[0]!;
  if (!SUBCOMMANDS.includes(sub)) throw new UsageError(`unknown thumbs command '${sub}' (${SUBCOMMANDS.join(', ')})`);
  check(`thumbs ${sub}`, flags, [], args, sub === 'refresh' ? 2 : 1, rest);
  const shotsDir = path.join(ctx.home, 'cache', 'thumbs');

  if (sub === 'status') {
    const mode = ctx.store().currentConfig().thumbnails.mode;
    const b = installedBrowser(ctx.home);
    const n = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).filter((f) => f.endsWith('.png')).length : 0;
    ctx.out(`Thumbnails: ${mode}\n`);
    ctx.out(b ? `Browser: installed (playwright-core ${b.version}, ${mb(du(browserPaths(ctx.home).dir))}) in ${tildify(browserPaths(ctx.home).dir)}\n` : 'Browser: not installed (`hallway thumbs enable` installs one)\n');
    ctx.out(`Screenshots: ${n}\n`);
    if (mode === 'screenshot' && !b) ctx.out('thumbnails.mode is screenshot but there is no browser: run `hallway thumbs enable`.\n');
    return 0;
  }

  if (sub === 'enable') {
    const store = ctx.store();
    ctx.out(`Screenshots need a browser: Chromium's headless shell (about 300 MB), installed into ${tildify(browserPaths(ctx.home).dir)}.\nNothing outside the data home changes; \`hallway thumbs disable\` deletes it.\n\n`);
    await installBrowser(ctx.home, { exec, env: ctx.env, log: ctx.out });
    if (store.currentConfig().thumbnails.mode !== 'screenshot') await store.patchConfig({ thumbnails: { mode: 'screenshot' } });
    const daemon = await ctx.daemon();
    ctx.out(`\nScreenshots on (thumbnails.mode: screenshot). ${daemon ? 'Healthy apps get a picture within a minute' : 'Healthy apps get a picture once the daemon is running'}; \`hallway thumbs refresh\` takes them now.\n`);
    return 0;
  }

  if (sub === 'disable') {
    const store = ctx.store();
    if (store.currentConfig().thumbnails.mode === 'screenshot') await store.patchConfig({ thumbnails: { mode: 'favicon' } });
    const dir = browserPaths(ctx.home).dir;
    const size = fs.existsSync(dir) ? du(dir) : 0;
    const removed = removeBrowser(ctx.home);
    fs.rmSync(shotsDir, { recursive: true, force: true });
    ctx.out(`Screenshots off (thumbnails.mode: favicon). ${removed ? `Deleted the browser (${mb(size)}) and the screenshots.` : 'There was no browser to delete.'}\n`);
    return 0;
  }

  // refresh [slug]
  const slug = args[1];
  const daemon = await ctx.daemon();
  if (!daemon) throw new Error('the daemon isn\'t running, and it is what takes screenshots (start it with `hallway serve` or `hallway service install`)');
  const r = await daemon.post<{ taken: number }>('/api/thumbs/refresh', slug ? { slug } : {});
  ctx.out(r.taken ? `Took ${r.taken} screenshot${r.taken === 1 ? '' : 's'}.\n` : `No screenshot taken${slug ? ` of ${slug}` : ''}: only healthy apps are shot (\`hallway status\` shows which are).\n`);
  return 0;
}
