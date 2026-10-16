// server/api.ts and server/views.ts: /api/state and its provider slots, apps and bookmarks CRUD with ETags, claim and
// ignore against a fake scanner, history and scan without providers, and the security rules on the new routes.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AppView, BookmarkGroupView, ObservedListener, StateResponse } from '../shared/api.ts';
import { createApp } from '../server/index.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { appUrl } from '../server/views.ts';
import { defaultConfig } from '../server/store/schema.ts';
import { tmpStore } from './fixture.ts';

const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((c) => c()));

async function setup() {
  const s = await tmpStore();
  cleanups.push(s.cleanup);
  const providers = new ProviderRegistry();
  const app = createApp({ store: s.store, bus: s.bus, providers, webDist: null });
  const req = (p: string, init: RequestInit & { json?: unknown; host?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set('host', init.host ?? 'localhost:4255');
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    return app.request(p, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  };
  return { ...s, providers, app, req };
}

const OBS: ObservedListener = {
  id: 'abc123',
  port: 4567,
  http: true,
  httpStatus: 200,
  title: 'Directory listing',
  favicon: null,
  firstSeen: '2026-10-16T10:00:00.000Z',
  lastSeen: '2026-10-16T10:02:00.000Z',
  suggestedSlug: 'scratch',
  identity: {
    pid: 999,
    ppid: 1,
    process: 'python3',
    command: 'python3 -m http.server 4567',
    cwd: '/tmp/scratch',
    projectDir: null,
    name: 'scratch',
    description: null,
    repo: null,
    branch: null,
    worktree: false,
    lastCommitAt: null,
    framework: null,
    bindAddress: '0.0.0.0',
    exposed: true,
    orphaned: true,
    startedAt: null,
    label: null,
  },
};

describe('/api/state', () => {
  test('a fresh data home: defaults, nothing yet, health unknown, providers off', async () => {
    const { req, home } = await setup();
    const res = await req('/api/state');
    assert.equal(res.status, 200);
    const s = (await res.json()) as StateResponse;
    assert.equal(s.daemon.url, 'http://localhost:4255');
    assert.equal(s.daemon.dataHome, home);
    assert.deepEqual(s.daemon.providers, { health: false, history: false, scanner: false, discovery: false });
    assert.deepEqual(s.config.config, defaultConfig());
    assert.deepEqual(s.apps, []);
    assert.deepEqual(s.bookmarks, []);
    assert.deepEqual(s.observed, []);
    assert.deepEqual(s.ignore, { ports: [], processes: [], dirs: [] });
    assert.deepEqual(s.problems, []);
  });

  test('merges the files with every provider', async () => {
    const x = await setup();
    fs.writeFileSync(path.join(x.home, 'apps/review.yaml'), 'name: Local Review\nport: 5622\n');
    fs.writeFileSync(path.join(x.home, 'apps/broken.yaml'), 'port: [\n');
    fs.writeFileSync(path.join(x.home, 'bookmarks/prod.yaml'), 'title: Production\norder: 10\nlinks:\n  - url: https://admin.example.com\n');
    fs.writeFileSync(path.join(x.home, 'bookmarks/docs.yaml'), 'title: Docs\norder: 20\n');
    x.store.loadAll();
    x.providers.register({
      name: 'fake',
      appHealth: (slug) => (slug === 'review' ? { state: 'healthy', since: null, checkedAt: null, httpStatus: 200, latencyMs: 3, detail: null, uptime24h: 1, latencyP50: 3 } : null),
      appHistory: (_slug, window) => ({ window, buckets: [], uptime: 1, latency: { p50: null, p95: null, max: null } }),
      appIdentity: ({ port }) => (port === 5622 ? { ...OBS.identity, cwd: '/code/review' } : null),
      observed: () => [OBS],
      discovered: () => [
        { slug: 'pm-thing', name: 'PM thing', port: 5001, host: 'localhost', adapter: 'paddock-pm', cwd: null, command: null, status: 'online', url: null },
        { slug: 'review', name: 'shadowed', port: 1, host: 'localhost', adapter: 'paddock-pm', cwd: null, command: null, status: null, url: null },
      ],
    });
    const s = (await (await x.req('/api/state')).json()) as StateResponse;
    assert.deepEqual(s.daemon.providers, { health: true, history: true, scanner: true, discovery: true });
    assert.deepEqual(
      s.apps.map((a) => [a.slug, a.source, a.name, a.url, a.health.state]),
      [
        ['broken', 'declared', 'broken', null, 'unknown'],
        ['review', 'declared', 'Local Review', 'http://localhost:5622', 'healthy'],
        ['pm-thing', 'discovered', 'PM thing', 'http://localhost:5001', 'unknown'],
      ],
    );
    const review = s.apps[1];
    assert.equal(review.identity?.cwd, '/code/review');
    assert.equal(review.history?.window, '24h');
    assert.equal(review.file, 'apps/review.yaml');
    assert.match(review.etag!, /^"[0-9a-f]{16}"$/);
    assert.equal(s.apps[0].problems[0].severity, 'error');
    assert.equal(s.apps[0].problems[0].line, 2);
    assert.deepEqual(s.observed, [OBS]);
    assert.deepEqual(
      s.bookmarks.map((b: BookmarkGroupView) => b.group),
      ['prod', 'docs'],
    );
    assert.equal(s.problems[0].file, 'apps/broken.yaml');
  });

  test('a throwing provider is skipped, not fatal', async () => {
    const x = await setup();
    await x.store.putApp('foo', { port: 1 });
    x.providers.register({
      name: 'bad',
      appHealth: () => {
        throw new Error('nope');
      },
    });
    const s = (await (await x.req('/api/state')).json()) as StateResponse;
    assert.equal(s.apps[0].health.state, 'unknown');
  });
});

describe('apps over HTTP', () => {
  test('PUT creates (201), GET returns it with an ETag, PATCH with If-Match, DELETE moves it', async () => {
    const { req, home } = await setup();
    const put = await req('/api/apps/foo', { method: 'PUT', json: { name: 'Foo', port: 5173 } });
    assert.equal(put.status, 201);
    const created = (await put.json()) as AppView;
    assert.equal(created.config!.port, 5173);
    assert.equal(put.headers.get('etag'), created.etag);

    const get = await req('/api/apps/foo');
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('etag'), created.etag);

    const stale = created.etag!;
    const patch = await req('/api/apps/foo', { method: 'PATCH', json: { expected: 'adhoc' }, headers: { 'if-match': stale } });
    assert.equal(patch.status, 200);
    assert.equal(((await patch.json()) as AppView).config!.expected, 'adhoc');

    const conflict = await req('/api/apps/foo', { method: 'PATCH', json: { expected: 'running' }, headers: { 'if-match': stale } });
    assert.equal(conflict.status, 409);
    const body = (await conflict.json()) as { error: string; etag: string };
    assert.match(body.error, /has changed since you read it/);
    assert.equal(body.etag, patch.headers.get('etag'));

    const replace = await req('/api/apps/foo', { method: 'PUT', json: { name: 'Foo', port: 5174 } });
    assert.equal(replace.status, 200);

    const del = await req('/api/apps/foo', { method: 'DELETE' });
    assert.equal(del.status, 200);
    const d = (await del.json()) as { ok: boolean; movedTo: string };
    assert.ok(d.ok);
    assert.ok(d.movedTo.startsWith(path.join(home, 'backups', 'removed') + path.sep), d.movedTo);
    assert.ok(fs.existsSync(d.movedTo));
    assert.equal((await req('/api/apps/foo')).status, 404);
  });

  test('errors: 400 with issues, 404, If-None-Match: *, bad JSON', async () => {
    const { req } = await setup();
    const bad = await req('/api/apps/foo', { method: 'PUT', json: { port: 0 } });
    assert.equal(bad.status, 400);
    assert.deepEqual(((await bad.json()) as { issues: unknown[] }).issues, [{ key: 'port', message: 'port: must be between 1 and 65535' }]);
    assert.equal((await req('/api/apps/Bad_Slug', { method: 'PUT', json: { port: 1 } })).status, 400);
    assert.equal((await req('/api/apps/nope', { method: 'PATCH', json: { port: 1 } })).status, 404);
    assert.equal((await req('/api/apps/nope', { method: 'DELETE' })).status, 404);
    assert.equal((await req('/api/apps/nope')).status, 404);
    assert.equal((await req('/api/apps/foo', { method: 'PUT', body: '{nope', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await req('/api/apps/foo', { method: 'PUT', json: { port: 1 }, headers: { 'if-none-match': '*' } })).status, 201);
    assert.equal((await req('/api/apps/foo', { method: 'PUT', json: { port: 1 }, headers: { 'if-none-match': '*' } })).status, 409);
  });

  test('a broken file: GET shows the error, writes get 409, the file is untouched', async () => {
    const { req, home, store } = await setup();
    const f = path.join(home, 'apps/foo.yaml');
    fs.writeFileSync(f, 'port: 1\n');
    store.loadAll();
    fs.writeFileSync(f, 'port: 1\nname: [\n');
    store.reloadPath(f);
    const v = (await (await req('/api/apps/foo')).json()) as AppView;
    assert.equal(v.config!.port, 1, 'last good');
    assert.equal(v.problems[0].severity, 'error');
    assert.equal((await req('/api/apps/foo', { method: 'PATCH', json: { port: 2 } })).status, 409);
    assert.equal(fs.readFileSync(f, 'utf8'), 'port: 1\nname: [\n');
  });

  test('history: 400 for a bad window, 404 for no app, 503 with no uptime provider', async () => {
    const { req, store, providers } = await setup();
    await store.putApp('foo', { port: 1 });
    assert.equal((await req('/api/apps/foo/history?window=1y')).status, 400);
    assert.equal((await req('/api/apps/nope/history')).status, 404);
    assert.equal((await req('/api/apps/foo/history')).status, 503);
    providers.register({ name: 'u', appHistory: (_s, window) => ({ window, buckets: [], uptime: 0.5, latency: { p50: 1, p95: 2, max: 3 } }) });
    const h = await req('/api/apps/foo/history?window=7d');
    assert.equal(h.status, 200);
    assert.deepEqual(await h.json(), { window: '7d', buckets: [], uptime: 0.5, latency: { p50: 1, p95: 2, max: 3 } });
  });

  test('thumb: 404 without a provider; with one, an ETag and 304', async () => {
    const { req, providers } = await setup();
    assert.equal((await req('/api/apps/foo/thumb')).status, 404);
    providers.register({ name: 't', thumb: () => ({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png', etag: '"t1"' }) });
    const r = await req('/api/apps/foo/thumb');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal((await req('/api/apps/foo/thumb', { headers: { 'if-none-match': '"t1"' } })).status, 304);
  });
});

describe('bookmarks over HTTP', () => {
  test('PUT, GET, PATCH, DELETE a group', async () => {
    const { req } = await setup();
    const put = await req('/api/bookmarks/prod', { method: 'PUT', json: { title: 'Production', links: [{ title: 'Admin', url: 'https://admin.example.com' }] } });
    assert.equal(put.status, 201);
    const list = (await (await req('/api/bookmarks')).json()) as { groups: BookmarkGroupView[] };
    assert.deepEqual(
      list.groups.map((g) => [g.group, g.config?.title, g.config?.links.length]),
      [['prod', 'Production', 1]],
    );
    const etag = put.headers.get('etag')!;
    assert.equal((await req('/api/bookmarks/prod', { method: 'PATCH', json: { collapsed: true }, headers: { 'if-match': etag } })).status, 200);
    assert.equal((await req('/api/bookmarks/prod', { method: 'PATCH', json: { collapsed: false }, headers: { 'if-match': etag } })).status, 409);
    assert.equal((await req('/api/bookmarks/prod')).status, 200);
    assert.equal((await req('/api/bookmarks/prod', { method: 'DELETE' })).status, 200);
    assert.equal((await req('/api/bookmarks/prod')).status, 404);
  });
});

describe('observed listeners', () => {
  test('without a scanner: an empty list, and scan is 503', async () => {
    const { req } = await setup();
    assert.deepEqual(await (await req('/api/observed')).json(), { observed: [] });
    assert.equal((await req('/api/scan', { method: 'POST', json: {} })).status, 503);
    assert.equal((await req('/api/observed/abc123/ignore', { method: 'POST', json: { by: 'port' } })).status, 404);
  });

  test('claim writes apps/<slug>.yaml from the observation, with the command commented out', async () => {
    const { req, providers, home, events } = await setup().then((x) => {
      const events: unknown[] = [];
      x.bus.subscribe((e) => events.push(e));
      return { ...x, events };
    });
    providers.register({ name: 'scanner', observed: () => [OBS] });
    const r = await req('/api/observed/abc123/claim', { method: 'POST', json: { slug: 'scratch', name: 'Scratch server' } });
    assert.equal(r.status, 201, await r.clone().text());
    const v = (await r.json()) as AppView;
    assert.equal(v.config!.port, 4567, 'the observed port, never a new one');
    assert.equal(v.config!.expected, 'adhoc');
    const text = fs.readFileSync(path.join(home, 'apps/scratch.yaml'), 'utf8');
    assert.match(text, /^# Claimed from the listener on port 4567 \(python3 -m http\.server 4567\) on \d{4}-\d\d-\d\d\.$/m);
    assert.match(text, /^name: Scratch server\nport: 4567\nexpected: adhoc\nproject:\n {2}dir: \/tmp\/scratch$/m);
    assert.match(text, /^# service:\n# {3}command: \["python3","-m","http\.server","4567"\]\n# {3}cwd: \/tmp\/scratch$/m);
    assert.ok(events.some((e) => JSON.stringify(e) === '{"type":"observed","reason":"claimed"}'));
    // claiming onto an existing slug is a conflict; bad bodies are 400; unknown ids 404
    assert.equal((await req('/api/observed/abc123/claim', { method: 'POST', json: { slug: 'scratch' } })).status, 409);
    assert.equal((await req('/api/observed/abc123/claim', { method: 'POST', json: { slug: 'Nope!' } })).status, 400);
    assert.equal((await req('/api/observed/abc123/claim', { method: 'POST', json: { slug: 'x', expected: 'often' } })).status, 400);
    assert.equal((await req('/api/observed/zzz/claim', { method: 'POST', json: { slug: 'x' } })).status, 404);
  });

  test('claim names a worktree sibling repo @ branch, and keeps an IPv6-only listener on ::1', async () => {
    const { req, providers, home } = await setup();
    const wt = { ...OBS, id: 'wt1', identity: { ...OBS.identity, name: 'my-dashboard', label: 'my-dashboard @ branch-a', bindAddress: '::1', exposed: false } };
    providers.register({ name: 'scanner', observed: () => [wt] });
    assert.equal((await req('/api/observed/wt1/claim', { method: 'POST', json: { slug: 'dash-a' } })).status, 201);
    const text = fs.readFileSync(path.join(home, 'apps/dash-a.yaml'), 'utf8');
    assert.match(text, /^name: my-dashboard @ branch-a$/m);
    assert.match(text, /^host: "?::1"?$/m);
  });

  test('ignore by port, process or dir writes ignore.yaml', async () => {
    const { req, providers, store } = await setup();
    providers.register({ name: 'scanner', observed: () => [OBS, { ...OBS, id: 'nodir', identity: { ...OBS.identity, cwd: null, process: null } }] });
    for (const by of ['port', 'process', 'dir'] as const) assert.equal((await req('/api/observed/abc123/ignore', { method: 'POST', json: { by } })).status, 200, by);
    assert.deepEqual(store.currentIgnore(), { ports: [4567], processes: ['python3'], dirs: ['/tmp/scratch'] });
    assert.equal((await req('/api/observed/nodir/ignore', { method: 'POST', json: { by: 'dir' } })).status, 400);
    assert.equal((await req('/api/observed/abc123/ignore', { method: 'POST', json: { by: 'colour' } })).status, 400);
  });

  test('POST /api/scan runs every scanner', async () => {
    const { req, providers } = await setup();
    let scanned = 0;
    providers.register({ name: 'scanner', scan: async () => void scanned++, observed: () => [OBS] });
    const r = await req('/api/scan', { method: 'POST', json: {} });
    assert.equal(r.status, 200);
    assert.equal(scanned, 1);
    assert.deepEqual(await r.json(), { observed: [OBS] });
  });
});

describe('security on the API', () => {
  test('a foreign Host is 403 on every route; cross-origin and non-JSON writes are refused', async () => {
    const { req, home } = await setup();
    for (const p of ['/api/state', '/api/apps', '/api/events', '/llms.txt', '/agent-guide.md']) assert.equal((await req(p, { host: 'evil.example' })).status, 403, p);
    assert.equal((await req('/api/apps/foo', { method: 'PUT', json: { port: 1 }, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await req('/api/apps/foo', { method: 'PUT', body: 'port=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await req('/api/apps/foo', { method: 'DELETE', headers: { origin: 'https://evil.example' } })).status, 403);
    assert.ok(!fs.existsSync(path.join(home, 'apps/foo.yaml')));
  });

  test('fronted mode also accepts the configured dashboard host, following config.yaml', async () => {
    const { req, store } = await setup();
    assert.equal((await req('/api/health', { host: 'hallway.localhost' })).status, 403);
    await store.patchConfig({ mode: 'fronted' });
    assert.equal((await req('/api/health', { host: 'hallway.localhost' })).status, 200);
    assert.equal((await req('/api/health', { host: 'hallway.localhost:443' })).status, 200);
    assert.equal((await req('/api/health', { host: 'other.localhost' })).status, 403);
    await store.patchConfig({ domain: { base: 'myname.internal' } });
    assert.equal((await req('/api/health', { host: 'myname.internal' })).status, 200);
    assert.equal((await req('/api/health', { host: 'hallway.localhost' })).status, 403);
  });

  test("fronted mode: a write from the dashboard's own https origin (through Caddy, Host kept) is accepted", async () => {
    const { req, store, home } = await setup();
    const write = (origin: string) => req('/api/apps/foo', { method: 'PUT', json: { port: 5001 }, host: 'hallway.localhost', headers: { origin } });
    await store.patchConfig({ mode: 'fronted', proxy: { publicPort: 4443 } });
    assert.equal((await write('https://evil.example')).status, 403);
    assert.equal((await write('https://foo.localhost:4443')).status, 403, "an app's origin isn't the dashboard's");
    assert.equal((await write('https://hallway.localhost:4443')).status, 201);
    assert.ok(fs.existsSync(path.join(home, 'apps/foo.yaml')));
    await store.patchConfig({ mode: 'direct' });
    assert.equal((await req('/api/apps/foo', { method: 'DELETE', host: 'localhost', headers: { origin: 'https://hallway.localhost' } })).status, 403, 'direct mode: the dashboard host is foreign again');
  });
});

describe('appUrl', () => {
  test('direct mode links to the port; fronted mode to the slug', () => {
    const cfg = defaultConfig();
    assert.equal(appUrl('a', 5173, '127.0.0.1', cfg), 'http://localhost:5173');
    assert.equal(appUrl('a', 5173, '::1', cfg), 'http://[::1]:5173');
    assert.equal(appUrl('a', 5173, '192.168.1.5', cfg), 'http://192.168.1.5:5173');
    assert.equal(appUrl('a', 5173, '127.0.0.1', { ...cfg, mode: 'fronted' }), 'https://a.localhost');
    assert.equal(appUrl('a', 5173, '127.0.0.1', { ...cfg, mode: 'fronted', proxy: { ...cfg.proxy, publicPort: 4443 } }), 'https://a.localhost:4443');
    assert.equal(appUrl('a', 5173, '127.0.0.1', { ...cfg, mode: 'fronted', domain: { ...cfg.domain, base: 'myname.internal' } }), 'https://a.myname.internal');
  });
});
