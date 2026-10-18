// server/thumbs/: finding a favicon (parsing, ranking, sniffing, fetching against a fake network), the icon cache, the
// thumbnailer as a provider, and the routes that serve what it finds: app thumbnails and bookmark icons, with ETags and
// as inert images.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AppView, ServerEvent } from '../shared/api.ts';
import { createApp } from '../server/index.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { findFavicon, parseIconLinks, parseManifest, parseSizes, rankCandidates, sniffImage } from '../server/thumbs/favicon.ts';
import { IconCache, appPageUrl, iconSource, startThumbs } from '../server/thumbs/index.ts';
import { exitWatchdog, tmpDir, tmpStore, rmTmp } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((c) => c()));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);

/** A fake network: URL → [status, content-type, body]. Records what was asked for. */
function fakeFetch(routes: Record<string, [number, string, string | Uint8Array]>) {
  const asked: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    const r = routes[url];
    if (!r) throw new TypeError('fetch failed: connection refused');
    const res = new Response(r[2], { status: r[0], headers: { 'content-type': r[1] } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }) as typeof fetch;
  return { f, asked };
}

describe('parsing a page for icons', () => {
  test('link icons, apple-touch icons, sizes, types, a manifest and <base>', () => {
    const html = `<html><head>
      <base href="/app/">
      <link rel="icon" href="favicon-16.png" sizes="16x16">
      <LINK REL='icon' HREF='/big.png' SIZES='64x64 128x128'>
      <link rel="apple-touch-icon" href="touch.png">
      <link rel="mask-icon" href="mask.svg">
      <link rel="icon" type="image/svg+xml" href="logo.svg?v=2&amp;x=1">
      <link rel="manifest" href="/site.webmanifest">
      <link rel="stylesheet" href="x.css">
    </head></html>`;
    const { icons, manifest } = parseIconLinks(html, 'http://127.0.0.1:5173/page');
    assert.equal(manifest, 'http://127.0.0.1:5173/site.webmanifest');
    assert.deepEqual(
      icons.map((i) => [i.url, i.size, i.from]),
      [
        ['http://127.0.0.1:5173/app/favicon-16.png', 16, 'link'],
        ['http://127.0.0.1:5173/big.png', 128, 'link'],
        ['http://127.0.0.1:5173/app/touch.png', 180, 'apple-touch-icon'],
        ['http://127.0.0.1:5173/app/logo.svg?v=2&x=1', 1024, 'link'],
      ],
    );
    assert.equal(parseSizes('any'), 1024);
    assert.equal(parseSizes(null), 0);
  });

  test('manifest icons, skipping maskable-only ones', () => {
    const m = JSON.stringify({ icons: [{ src: '/i-192.png', sizes: '192x192' }, { src: '/m.png', sizes: '512x512', purpose: 'maskable' }, { src: '/a.png', sizes: '512x512', purpose: 'any maskable' }, { nope: 1 }] });
    assert.deepEqual(
      parseManifest(m, 'https://example.com/manifest.json').map((i) => [i.url, i.size]),
      [
        ['https://example.com/i-192.png', 192],
        ['https://example.com/a.png', 512],
      ],
    );
    assert.deepEqual(parseManifest('not json', 'https://example.com/'), []);
  });

  test('ranking: largest first, duplicates once', () => {
    const r = rankCandidates([
      { url: 'a', size: 16, type: null, from: 'link' },
      { url: 'b', size: 180, type: null, from: 'apple-touch-icon' },
      { url: 'a', size: 16, type: null, from: 'link' },
      { url: 'c', size: 180, type: null, from: 'link' },
    ]);
    assert.deepEqual(
      r.map((c) => c.url),
      ['b', 'c', 'a'],
    );
  });

  test('sniffing images by their bytes, not their headers', () => {
    assert.equal(sniffImage(PNG), 'image/png');
    assert.equal(sniffImage(ICO), 'image/x-icon');
    assert.equal(sniffImage(SVG), 'image/svg+xml');
    assert.equal(sniffImage(new TextEncoder().encode('<?xml version="1.0"?><svg/>')), 'image/svg+xml');
    assert.equal(sniffImage(new TextEncoder().encode('<!doctype html><html>')), null);
    assert.equal(sniffImage(new Uint8Array([1, 2])), null);
  });
});

describe('findFavicon', () => {
  test('takes the largest icon that loads, falling back down the list', async () => {
    const { f, asked } = fakeFetch({
      'http://127.0.0.1:5173/': [200, 'text/html', '<link rel="icon" href="/big.png" sizes="192x192"><link rel="icon" href="/small.png" sizes="16x16">'],
      'http://127.0.0.1:5173/big.png': [404, 'text/plain', 'no'],
      'http://127.0.0.1:5173/small.png': [200, 'image/png', PNG],
    });
    const got = await findFavicon('http://127.0.0.1:5173/', { fetch: f });
    assert.equal(got?.contentType, 'image/png');
    assert.equal(got?.source, 'http://127.0.0.1:5173/small.png');
    assert.deepEqual(asked, ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/big.png', 'http://127.0.0.1:5173/small.png']);
  });

  test('falls back to /favicon.ico, and refuses things that are not images', async () => {
    const { f } = fakeFetch({
      'https://example.com/': [200, 'text/html', '<link rel="icon" href="/fake.png">'],
      'https://example.com/fake.png': [200, 'image/png', '<html>a soft 404</html>'],
      'https://example.com/favicon.ico': [200, 'image/vnd.microsoft.icon', ICO],
    });
    assert.equal((await findFavicon('https://example.com/', { fetch: f }))?.contentType, 'image/x-icon');
  });

  test('a page that does not answer, or has nothing: null, never a throw', async () => {
    assert.equal(await findFavicon('http://127.0.0.1:1/', { fetch: fakeFetch({}).f }), null);
    const { f } = fakeFetch({ 'https://example.com/': [200, 'text/html', '<title>x</title>'], 'https://example.com/favicon.ico': [404, 'text/html', 'no'] });
    assert.equal(await findFavicon('https://example.com/', { fetch: f }), null);
  });

  test('data: URLs in the page are decoded', async () => {
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
    const { f } = fakeFetch({ 'https://example.com/': [200, 'text/html', `<link rel="icon" href="${svg}">`] });
    assert.equal((await findFavicon('https://example.com/', { fetch: f }))?.contentType, 'image/svg+xml');
  });
});

describe('icon sources', () => {
  const home = path.resolve('/home/me/.hallway'); // D:\home\me\.hallway on Windows
  test('auto, an image URL, a file inside the data home, or text', () => {
    assert.deepEqual(iconSource('auto', 'http://127.0.0.1:4000/', home), { key: 'page:http://127.0.0.1:4000/', kind: 'page', target: 'http://127.0.0.1:4000/' });
    assert.equal(iconSource('https://cdn.example.com/logo.png', null, home)?.kind, 'image');
    assert.deepEqual(iconSource('icons/app.png', null, home), { key: `file:${path.join(home, 'icons', 'app.png')}`, kind: 'file', target: path.join(home, 'icons', 'app.png') });
    assert.equal(iconSource('🍲', 'http://x/', home), null);
  });

  test('never a file outside the data home', () => {
    assert.equal(iconSource('/etc/passwd', null, home), null);
    assert.equal(iconSource('./../../secret.png', null, home), null);
    assert.equal(iconSource('~/.ssh/id_rsa.png', null, home), null);
  });

  test("an app's page: its own host and port, wildcard binds on loopback", () => {
    // D68: loopback in either family is reached as localhost (fetch and the browser try ::1 and 127.0.0.1)
    assert.equal(appPageUrl({ host: '127.0.0.1', port: 5173 }), 'http://localhost:5173/');
    assert.equal(appPageUrl({ host: '0.0.0.0', port: 1 }), 'http://localhost:1/');
    assert.equal(appPageUrl({ host: '::', port: 2 }), 'http://localhost:2/');
    assert.equal(appPageUrl({ host: '::1', port: 3 }), 'http://localhost:3/');
    assert.equal(appPageUrl({ host: '192.168.1.20', port: 4 }), 'http://192.168.1.20:4/');
    assert.equal(appPageUrl({ host: 'fd00::5', port: 5 }), 'http://[fd00::5]:5/');
  });
});

describe('IconCache', () => {
  test('answers at once, looks up in the background, and tells when it changes', async () => {
    const dir = tmpDir('hw-test-icons-');
    cleanups.push(() => rmTmp(dir));
    let now = 1000;
    const changed: string[] = [];
    const cache = new IconCache(dir, { now: () => now, onChange: (k) => changed.push(k) });
    let calls = 0;
    const look = async () => (calls++, { body: PNG, contentType: 'image/png', source: 'x' });
    assert.equal(cache.get('page:a', look), null, 'nothing known yet');
    await cache.settle();
    const icon = cache.get('page:a', look);
    assert.equal(icon?.contentType, 'image/png');
    assert.match(icon!.etag, /^"[0-9a-f]{16}"$/);
    assert.deepEqual(changed, ['page:a']);
    assert.equal(calls, 1, 'fresh: not looked up again');

    // a second cache on the same directory reads it from disk
    const again = new IconCache(dir, { now: () => now });
    assert.equal(again.get('page:a', async () => null)?.etag, icon!.etag);

    // nothing found is remembered too, and retried after a while
    let none = 0;
    cache.get('page:b', async () => (none++, null));
    await cache.settle();
    cache.get('page:b', async () => (none++, null));
    await cache.settle();
    assert.equal(none, 1);
    now += 25 * 3600_000;
    cache.get('page:b', async () => (none++, null));
    await cache.settle();
    assert.equal(none, 2);
    assert.deepEqual(changed, ['page:a'], 'no icon → no icon is not a change');
  });
});

describe('the thumbnailer and its routes', () => {
  async function setup(routes: Record<string, [number, string, string | Uint8Array]>) {
    const s = await tmpStore();
    cleanups.push(s.cleanup);
    const providers = new ProviderRegistry();
    const events: ServerEvent[] = [];
    s.bus.subscribe((e) => events.push(e));
    const { f } = fakeFetch(routes);
    const thumbs = startThumbs({ store: s.store, bus: s.bus, providers, fetch: f });
    cleanups.push(thumbs.stop);
    const app = createApp({ store: s.store, bus: s.bus, providers, webDist: null });
    const req = (p: string, headers: Record<string, string> = {}) => app.request(p, { headers: { host: 'localhost:4255', ...headers } });
    return { ...s, providers, thumbs, events, req };
  }

  test("an app's favicon: found, announced, served with an ETag as an inert image", async () => {
    const t = await setup({
      'http://localhost:5173/': [200, 'text/html', '<link rel="icon" href="/i.svg">'],
      'http://localhost:5173/i.svg': [200, 'image/svg+xml', SVG],
    });
    await t.store.putApp('demo', { name: 'Demo', port: 5173 });
    assert.equal((await t.req('/api/apps/demo/thumb')).status, 404, 'not found yet');
    await t.thumbs.cache.settle();
    assert.ok(t.events.some((e) => e.type === 'thumb' && e.slug === 'demo'));
    const view = (await (await t.req('/api/apps/demo')).json()) as AppView;
    assert.match(view.thumb ?? '', /^"[0-9a-f]{16}"$/);
    const res = await t.req('/api/apps/demo/thumb');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.equal(res.headers.get('etag'), view.thumb);
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'.*sandbox/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await t.req('/api/apps/demo/thumb', { 'if-none-match': view.thumb! })).status, 304);
    assert.ok(fs.readdirSync(path.join(t.home, 'cache', 'favicons')).length >= 2, 'cached on disk');
  });

  test('an emoji icon has no thumbnail and fetches nothing', async () => {
    const t = await setup({});
    await t.store.putApp('soup', { name: 'Soup', port: 5174, icon: '🍲' });
    await t.thumbs.cache.settle();
    const view = (await (await t.req('/api/apps/soup')).json()) as AppView;
    assert.equal(view.thumb, null);
  });

  test("a bookmark's icon: only for a URL in that group; 204 until there is one", async () => {
    const t = await setup({
      'https://status.example.com/': [200, 'text/html', '<link rel="icon" href="/fav.png">'],
      'https://status.example.com/fav.png': [200, 'image/png', PNG],
    });
    await t.store.putGroup('prod', { title: 'Production', links: [{ title: 'Status', url: 'https://status.example.com/' }] });
    const url = encodeURIComponent('https://status.example.com/');
    assert.equal((await t.req(`/api/bookmarks/prod/icon?url=${encodeURIComponent('https://evil.example/')}`)).status, 404);
    assert.equal((await t.req(`/api/bookmarks/nope/icon?url=${url}`)).status, 404);
    const first = await t.req(`/api/bookmarks/prod/icon?url=${url}`);
    assert.ok(first.status === 204 || first.status === 200);
    await t.thumbs.cache.settle();
    assert.ok(t.events.some((e) => e.type === 'bookmarks' && e.group === 'prod'), 'the group is told its icon arrived');
    const res = await t.req(`/api/bookmarks/prod/icon?url=${url}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  });
});
