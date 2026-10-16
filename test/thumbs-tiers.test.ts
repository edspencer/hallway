// The other two thumbnail tiers (D55, D56): the generated card (deterministic SVG and PNG, its colours kept in step with
// tokens.css), which tier an app gets, screenshots (with a fake Playwright: never a real browser here), the
// `hallway thumbs` commands (with the installer mocked) and POST /api/thumbs/refresh.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { AppHealth, ServerEvent } from '../shared/api.ts';
import { createApp } from '../server/index.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { UNKNOWN_HEALTH } from '../server/views.ts';
import { makeCtx } from '../server/commands/index.ts';
import { thumbs as thumbsCommand } from '../server/commands/thumbs.ts';
import { type Exec, type PlaywrightLike, PLAYWRIGHT_VERSION, browserPaths, installedBrowser } from '../server/thumbs/browser.ts';
import { CARD, FONT_DIR, FONT_FILES, cardFonts, PALETTE, ZOOM, cardEtag, cardSvg, paintIndex, svgToPng, type CardModel } from '../server/thumbs/card.ts';
import { pickThumb, shortAddress, startThumbs } from '../server/thumbs/index.ts';
import { SHOT, Shots, shotDue } from '../server/thumbs/shots.ts';
import { paintIndex as dashboardPaintIndex } from '../src/lib/colour.ts';
import { ROOT, exitWatchdog, tmpDir, tmpStore } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => unknown)[] = [];
after(async () => {
  for (const c of cleanups.reverse()) await c();
});

const MODEL: CardModel = { slug: 'storefront', name: 'Storefront', address: 'localhost:5173', framework: 'vite', repo: 'storefront', branch: 'main' };
const sha = (b: Uint8Array | string) => crypto.createHash('sha256').update(b).digest('hex');

/** RGBA pixels of an SVG drawn at 1×, with the card's fonts (or none). */
function pixels(svg: string, fonts = true) {
  const r = new Resvg(svg, { font: { fontFiles: fonts ? FONT_FILES.map((f) => path.join(FONT_DIR, f)) : [], loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render();
  return { data: r.pixels, width: r.width, height: r.height };
}
/** How many pixels in a box are close to `--hw-text`'s ink (the name's colour). */
function inkIn(p: ReturnType<typeof pixels>, x0: number, y0: number, x1: number, y1: number) {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * p.width + x) * 4;
      if (p.data[i]! > 200 && p.data[i + 1]! > 190 && p.data[i + 2]! > 175) n++;
    }
  return n;
}

describe('the generated card', () => {
  test('the SVG is pure, escapes what it prints, and its ETag follows what it shows', () => {
    assert.equal(cardSvg(MODEL), cardSvg({ ...MODEL }));
    const svg = cardSvg({ ...MODEL, name: 'A <b> & "c"' });
    assert.match(svg, /A &lt;b&gt; &amp; &quot;c&quot;/);
    assert.doesNotMatch(svg, /<b>/);
    assert.equal(cardEtag(MODEL), cardEtag({ ...MODEL }));
    assert.notEqual(cardEtag(MODEL), cardEtag({ ...MODEL, branch: 'dev' }));
    assert.match(cardEtag(MODEL), /^"c[0-9a-f]{15}"$/);
  });

  test('the PNG is the same bytes every time, at the screenshot size', () => {
    const a = svgToPng(cardSvg(MODEL));
    const b = svgToPng(cardSvg(MODEL));
    assert.equal(sha(a), sha(b));
    assert.equal(a.readUInt32BE(16), CARD.width * ZOOM, 'width from the IHDR chunk');
    assert.equal(a.readUInt32BE(20), CARD.height * ZOOM);
    assert.equal([CARD.width * ZOOM, CARD.height * ZOOM].join('×'), '640×400');
  });

  test('the text is drawn with the bundled fonts, and only with them', () => {
    // the name's band: lit with the fonts, empty without (system fonts are never loaded)
    const svg = cardSvg(MODEL);
    const band = [60, 60, 260, 100] as const;
    assert.ok(inkIn(pixels(svg), ...band) > 300, 'the name is drawn');
    assert.equal(inkIn(pixels(svg, false), ...band), 0, 'no font, no text: nothing fell back to a system font');
    for (const f of FONT_FILES) assert.ok(fs.statSync(path.join(FONT_DIR, f)).size > 10_000, f);
    for (const l of ['fraunces', 'inter', 'jetbrains-mono']) assert.match(fs.readFileSync(path.join(FONT_DIR, `OFL-${l}.txt`), 'utf8'), /SIL Open Font License/);
  });

  test('missing fonts are an error, not a card with no text on it', () => {
    assert.equal(cardFonts().length, 3);
    assert.throws(() => cardFonts(tmpDir('hw-no-fonts-')), /the card's fonts are missing .*Fraunces-SemiBold\.ttf/);
  });

  test('the door is painted as the dashboard paints it: same paint for a slug, same colours as tokens.css', () => {
    for (const s of ['storefront', 'docs', 'a', 'billing-service-v2', 'x-1']) assert.equal(paintIndex(s), dashboardPaintIndex(s), s);
    const css = fs.readFileSync(path.join(ROOT, 'src/theme/tokens.css'), 'utf8');
    const dark = css.slice(0, css.indexOf(":root[data-theme='light']"));
    const token = (name: string) => dark.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase();
    PALETTE.paints.forEach((p, i) => assert.equal(p, token(`hw-paint-${i}`), `--hw-paint-${i}`));
    assert.equal(PALETTE.lift, token('hw-paint-lift'));
    assert.equal(PALETTE.shade, token('hw-paint-shade'));
    assert.equal(PALETTE.lamplight, token('hw-lamplight'));
    assert.equal(PALETTE.accent, token('hw-accent'));
    assert.equal(PALETTE.ink, token('hw-text'));
    assert.equal(PALETTE.plateText, token('hw-ink'));
    assert.match(dark, new RegExp(`--hw-plate: linear-gradient\\(180deg, ${PALETTE.plateTop}, ${PALETTE.plateBottom}\\)`));
  });

  test('long names and addresses are cut with an ellipsis rather than overflowing', () => {
    const svg = cardSvg({ ...MODEL, name: 'Billing Service Administration Console For Everyone', address: 'billing-service-administration.myname.internal', branch: 'feature/a-very-long-branch-name-indeed' });
    assert.match(svg, /…<\/text>/);
    const p = pixels(svg);
    // the outer 16 px on each side stay paint: nothing ran off the door
    assert.equal(inkIn(p, 0, 0, 16, CARD.height) + inkIn(p, CARD.width - 16, 0, CARD.width, CARD.height), 0);
  });

  test('a card for an app with nothing but a name', () => {
    const svg = cardSvg({ slug: 'x', name: 'X', address: null, framework: null, repo: null, branch: null });
    assert.doesNotMatch(svg, /JetBrains Mono/);
    assert.ok(svgToPng(svg).length > 1000);
  });

  test('shortAddress drops the scheme and a trailing slash', () => {
    assert.equal(shortAddress('http://localhost:5173'), 'localhost:5173');
    assert.equal(shortAddress('https://my-app.localhost/'), 'my-app.localhost');
  });
});

describe('which tier an app gets', () => {
  const all = { screenshot: true, favicon: true, card: true };
  test('favicon mode: the favicon, else none (a monogram), never a card', () => {
    assert.equal(pickThumb('favicon', all), 'favicon');
    assert.equal(pickThumb('favicon', { ...all, favicon: false }), null);
  });
  test('screenshot mode: the screenshot, else the favicon, else none', () => {
    assert.equal(pickThumb('screenshot', all), 'screenshot');
    assert.equal(pickThumb('screenshot', { ...all, screenshot: false }), 'favicon');
    assert.equal(pickThumb('screenshot', { screenshot: false, favicon: false, card: true }), null);
  });
  test('card mode: the card', () => {
    assert.equal(pickThumb('card', all), 'card');
    assert.equal(pickThumb('card', { ...all, card: false }), null);
  });
});

// ------------------------------------------------------------------------------------------------- screenshots

/** A fake playwright-core: records what it was asked to open; each screenshot is a distinct PNG-ish body. */
function fakePlaywright(opts: { fail?: (url: string) => Error | null; slow?: boolean } = {}) {
  const log: string[] = [];
  let n = 0;
  let open = 0;
  const pw: PlaywrightLike = {
    chromium: {
      async launch() {
        log.push('launch');
        open++;
        let connected = true;
        return {
          isConnected: () => connected,
          async close() {
            connected = false;
            open--;
            log.push('close');
          },
          async newPage(o) {
            log.push(`page ${o.viewport.width}x${o.viewport.height}@${o.deviceScaleFactor}`);
            let url = '';
            return {
              async goto(u: string) {
                url = u;
                const e = opts.fail?.(u);
                if (e) throw e;
              },
              async waitForLoadState(_s: string, { timeout }: { timeout: number }) {
                log.push(`idle ${timeout <= SHOT.waitMs}`);
              },
              async screenshot() {
                log.push(`shot ${url}`);
                return new Uint8Array([0x89, 0x50, 0x4e, 0x47, ++n]);
              },
              async close() {},
            };
          },
        };
      },
    },
  };
  return { pw, log, open: () => open };
}

describe('screenshots', () => {
  test('when one is due: none yet, a new process, a new address, or six hours on; not straight after a failure', () => {
    const now = 1_000_000_000;
    const prev = { takenAt: now - 1000, pid: 10, url: 'http://127.0.0.1:1/' };
    assert.equal(shotDue(null, { pid: null, url: prev.url }, now), true);
    assert.equal(shotDue(prev, { pid: 10, url: prev.url }, now), false);
    assert.equal(shotDue(prev, { pid: 11, url: prev.url }, now), true, 'restarted');
    assert.equal(shotDue(prev, { pid: null, url: prev.url }, now), false, 'an unknown PID is not a change');
    assert.equal(shotDue(prev, { pid: 10, url: 'http://127.0.0.1:2/' }, now), true);
    assert.equal(shotDue({ ...prev, takenAt: now - SHOT.maxAgeMs }, { pid: 10, url: prev.url }, now), true, 'six hours');
    assert.equal(shotDue(null, { pid: 1, url: prev.url }, now, now - 1000), false, 'failed a moment ago');
    assert.equal(shotDue(null, { pid: 1, url: prev.url }, now, now - SHOT.retryMs), true);
  });

  test('Shots: 1280×800 at half scale, stored with its metadata, announced, one browser for the lot', async () => {
    const dir = tmpDir('hw-shots-');
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const f = fakePlaywright();
    const changed: string[] = [];
    const shots = new Shots(dir, { load: async () => f.pw, onChange: (s) => changed.push(s) });
    cleanups.push(() => shots.stop());
    assert.equal(shots.want('a', 'http://127.0.0.1:1/', 5), true);
    assert.equal(shots.want('a', 'http://127.0.0.1:1/', 5), false, 'already queued');
    shots.want('b', 'http://127.0.0.1:2/', 6);
    await shots.settle();
    assert.deepEqual(f.log.filter((l) => l === 'launch'), ['launch']);
    assert.ok(f.log.includes('page 1280x800@0.5'));
    assert.deepEqual(changed, ['a', 'b']);
    const a = shots.get('a')!;
    assert.equal(a.pid, 5);
    assert.match(a.etag, /^"s[0-9a-f]{15}"$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')).pid, 5);
    assert.ok(fs.existsSync(path.join(dir, 'a.png')));
    assert.equal(shots.want('a', 'http://127.0.0.1:1/', 5), false, 'fresh');
    assert.equal(shots.want('a', 'http://127.0.0.1:1/', 7), true, 'a new PID');
    await shots.settle();
    // a new instance reads what's on disk
    assert.equal(new Shots(dir, { load: async () => null }).get('b')?.pid, 6);
    assert.equal(shots.get('../etc'), null, 'slugs only');
    await shots.reset();
    assert.equal(f.open(), 0, 'reset closes the browser');
    assert.equal(fs.existsSync(dir), false);
  });

  test('an app that refuses the connection gets no picture and is not retried at once; no browser installed: nothing', async () => {
    const dir = tmpDir('hw-shots-');
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const f = fakePlaywright({ fail: () => new Error('net::ERR_CONNECTION_REFUSED') });
    const shots = new Shots(dir, { load: async () => f.pw });
    cleanups.push(() => shots.stop());
    shots.want('a', 'http://127.0.0.1:1/', 1);
    await shots.settle();
    assert.equal(shots.get('a'), null);
    assert.equal(shots.want('a', 'http://127.0.0.1:1/', 1), false);
    assert.equal(shots.want('a', 'http://127.0.0.1:1/', 1, true), true, 'unless asked');
    await shots.settle();

    const none = new Shots(dir, { load: async () => null });
    none.want('b', 'http://127.0.0.1:2/', 1);
    await none.settle();
    assert.equal(none.get('b'), null);
  });

  test('a page that never goes quiet is still shot, when the ten seconds are up', async () => {
    const dir = tmpDir('hw-shots-');
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const timeout = Object.assign(new Error('Timeout 10000ms exceeded'), { name: 'TimeoutError' });
    const f = fakePlaywright({ fail: () => timeout });
    const shots = new Shots(dir, { load: async () => f.pw });
    cleanups.push(() => shots.stop());
    shots.want('a', 'http://127.0.0.1:1/', 1);
    await shots.settle();
    assert.ok(shots.get('a'));
  });
});

// ------------------------------------------------------------------------------------------------- the provider

describe('the thumbnailer with every tier', () => {
  async function setup() {
    const s = await tmpStore();
    cleanups.push(s.cleanup);
    const providers = new ProviderRegistry();
    const events: ServerEvent[] = [];
    s.bus.subscribe((e) => events.push(e));
    const health = new Map<string, AppHealth['state']>();
    providers.register({
      name: 'fake-prober',
      appHealth: (slug) => (health.has(slug) ? { ...UNKNOWN_HEALTH, state: health.get(slug)! } : null),
      appIdentity: ({ slug }) => (slug === 'web' ? { pid: 42, ppid: 1, process: 'node', command: 'vite', cwd: '/x', projectDir: '/x', name: 'web', description: null, repo: 'web', branch: 'main', worktree: false, lastCommitAt: null, framework: 'vite', bindAddress: '127.0.0.1', exposed: false, orphaned: false, supervisor: null, displayName: null, startedAt: null, label: null } : null),
    });
    const f = fakePlaywright();
    const fetchNone = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const thumbs = startThumbs({ store: s.store, bus: s.bus, providers, fetch: fetchNone, playwright: async () => f.pw });
    cleanups.push(thumbs.stop);
    const app = createApp({ store: s.store, bus: s.bus, providers, webDist: null });
    const req = (p: string, init: RequestInit = {}) => app.request(p, { ...init, headers: { host: 'localhost:4255', 'content-type': 'application/json', ...(init.headers as object) } });
    await s.store.putApp('web', { name: 'Web', port: 5173 });
    await s.store.putApp('backend', { name: 'API', port: 5174 });
    return { ...s, providers, thumbs, events, req, health, f };
  }
  const view = async (t: Awaited<ReturnType<typeof setup>>, slug: string) => (await (await t.req(`/api/apps/${slug}`)).json()) as { thumb: string | null; thumbKind: string | null };

  test('favicon mode, no favicon: no thumbnail, so the dashboard draws a monogram', async () => {
    const t = await setup();
    await t.thumbs.cache.settle();
    assert.deepEqual(await view(t, 'web'), { ...(await view(t, 'web')), thumb: null, thumbKind: null });
    assert.equal((await t.req('/api/apps/web/thumb')).status, 404);
  });

  test('card mode: a card for every app, drawn only when its bytes are asked for, and 304 on a match', async () => {
    const t = await setup();
    await t.store.patchConfig({ thumbnails: { mode: 'card' } });
    const v = await view(t, 'web');
    assert.equal(v.thumbKind, 'card');
    assert.equal(t.thumbs.cards.size, 0, 'the ETag needed no drawing');
    const res = await t.req('/api/apps/web/thumb');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('etag'), v.thumb);
    const body = new Uint8Array(await res.arrayBuffer());
    // what it shows came from the scanner's identity: framework, repo and branch
    assert.equal(sha(body), sha(svgToPng(cardSvg({ slug: 'web', name: 'Web', address: 'localhost:5173', framework: 'vite', repo: 'web', branch: 'main' }))));
    assert.equal((await t.req('/api/apps/web/thumb', { headers: { 'if-none-match': v.thumb! } })).status, 304);
    // a change to what it shows is a new card
    await t.store.putApp('web', { name: 'Web app', port: 5173 });
    assert.notEqual((await view(t, 'web')).thumb, v.thumb);
  });

  test('screenshot mode: healthy apps are shot (never bookmarks), the rest keep their monogram; refresh re-shoots', async () => {
    const t = await setup();
    await t.store.putGroup('links', { title: 'Links', links: [{ title: 'Example', url: 'https://example.com/' }] });
    t.health.set('web', 'healthy');
    t.health.set('backend', 'down');
    await t.store.patchConfig({ thumbnails: { mode: 'screenshot' } });
    t.bus.emit({ type: 'config' });
    await t.thumbs.shots.settle();
    assert.deepEqual(t.f.log.filter((l) => l.startsWith('shot')), ['shot http://127.0.0.1:5173/']);
    const v = await view(t, 'web');
    assert.equal(v.thumbKind, 'screenshot');
    assert.ok(t.events.some((e) => e.type === 'thumb' && e.slug === 'web'));
    assert.equal((await view(t, 'backend')).thumb, null);

    const r = await t.req('/api/thumbs/refresh', { method: 'POST', body: JSON.stringify({ slug: 'web' }) });
    assert.deepEqual(await r.json(), { taken: 1 });
    assert.notEqual((await view(t, 'web')).thumb, v.thumb);
    assert.deepEqual(await (await t.req('/api/thumbs/refresh', { method: 'POST', body: '{}' })).json(), { taken: 1 }, 'all healthy apps: just web');
    assert.equal((await t.req('/api/thumbs/refresh', { method: 'POST', body: JSON.stringify({ slug: 'nope' }) })).status, 404);

    // screenshots off: the browser closes and the pictures go
    await t.store.patchConfig({ thumbnails: { mode: 'favicon' } });
    t.bus.emit({ type: 'config' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(t.f.open(), 0);
    assert.equal((await view(t, 'web')).thumb, null);
    assert.equal((await t.req('/api/thumbs/refresh', { method: 'POST', body: '{}' })).status, 409);
  });
});

// ------------------------------------------------------------------------------------------------- the command

describe('hallway thumbs', () => {
  function ctx() {
    const home = tmpDir('hw-thumbs-cli-');
    cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
    let out = '';
    const c = makeCtx({ home, env: { PATH: process.env.PATH }, out: (s) => (out += s), err: (s) => (out += s) });
    // no daemon: never look for one on a real port
    c.daemon = async () => null;
    return { c, home, out: () => out };
  }
  /** A fake installer: npm "installs" playwright-core's cli.js, Playwright "downloads" a browser. */
  const fakeExec = (calls: string[][], fail?: 'npm' | 'pw'): Exec => async (cmd, args, { cwd, env }) => {
    calls.push([path.basename(cmd), ...args, `PLAYWRIGHT_BROWSERS_PATH=${env.PLAYWRIGHT_BROWSERS_PATH}`]);
    if (args[0] === 'install' && args.some((a) => a.startsWith('playwright-core@'))) {
      if (fail === 'npm') return 1;
      fs.mkdirSync(path.join(cwd, 'node_modules', 'playwright-core'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'node_modules', 'playwright-core', 'cli.js'), '');
      return 0;
    }
    if (fail === 'pw') return 1;
    fs.mkdirSync(path.join(env.PLAYWRIGHT_BROWSERS_PATH!, 'chromium_headless_shell-1'), { recursive: true });
    fs.writeFileSync(path.join(env.PLAYWRIGHT_BROWSERS_PATH!, 'chromium_headless_shell-1', 'chrome'), Buffer.alloc(2_000_000));
    return 0;
  };

  test('enable installs into the data home and turns screenshots on; disable deletes it and turns them off', async () => {
    const { c, home, out } = ctx();
    const calls: string[][] = [];
    assert.equal(await thumbsCommand(c, ['enable'], {}, undefined, { exec: fakeExec(calls) }), 0);
    const p = browserPaths(home);
    assert.equal(calls.length, 2);
    assert.ok(calls[0]!.includes(`playwright-core@${PLAYWRIGHT_VERSION}`));
    assert.deepEqual(calls[1]!.slice(1, 5), [path.join(p.module, 'cli.js'), 'install', '--only-shell', 'chromium']);
    assert.ok(calls.every((x) => x.at(-1) === `PLAYWRIGHT_BROWSERS_PATH=${p.browsers}`), 'the browser goes in the data home');
    assert.equal(installedBrowser(home)?.version, PLAYWRIGHT_VERSION);
    assert.equal(c.store().currentConfig().thumbnails.mode, 'screenshot');
    assert.match(out(), /Screenshots on/);

    fs.mkdirSync(path.join(home, 'cache', 'thumbs'), { recursive: true });
    fs.writeFileSync(path.join(home, 'cache', 'thumbs', 'x.png'), 'x');
    let status = '';
    c.out = (s) => (status += s);
    await thumbsCommand(c, ['status'], {}, undefined);
    assert.match(status, /Thumbnails: screenshot/);
    assert.match(status, /Browser: installed \(playwright-core .*, 2 MB\)/);
    assert.match(status, /Screenshots: 1/);

    let off = '';
    c.out = (s) => (off += s);
    assert.equal(await thumbsCommand(c, ['disable'], {}, undefined), 0);
    assert.equal(fs.existsSync(p.dir), false);
    assert.equal(fs.existsSync(path.join(home, 'cache', 'thumbs')), false);
    assert.equal(c.store().currentConfig().thumbnails.mode, 'favicon');
    assert.match(off, /Deleted the browser \(2 MB\)/);
    // the edit kept config.yaml's comments
    assert.match(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'), /# Hallway settings/);
  });

  test('a failed install leaves the mode alone and says what failed', async () => {
    for (const fail of ['npm', 'pw'] as const) {
      const { c, home } = ctx();
      await assert.rejects(thumbsCommand(c, ['enable'], {}, undefined, { exec: fakeExec([], fail) }), fail === 'npm' ? /npm install playwright-core failed/ : /playwright install chromium failed/);
      assert.equal(installedBrowser(home), null);
      assert.equal(c.store().currentConfig().thumbnails.mode, 'favicon');
    }
  });

  test('refresh needs the daemon; usage errors', async () => {
    const { c } = ctx();
    await assert.rejects(thumbsCommand(c, ['refresh'], {}, undefined), /daemon isn't running/);
    await assert.rejects(thumbsCommand(c, [], {}, undefined), /thumbs needs/);
    await assert.rejects(thumbsCommand(c, ['shoot'], {}, undefined), /unknown thumbs command/);
    await assert.rejects(thumbsCommand(c, ['enable', 'x'], {}, undefined), /unexpected argument/);
  });
});
