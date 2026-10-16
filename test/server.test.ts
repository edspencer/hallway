// server/index.ts and server/security.ts: /api/health, the loopback-only Host/Origin/Content-Type rules, serving the
// built dashboard as a single-page app, and binding (only ever 127.0.0.1 by default).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createApp, startServer } from '../server/index.ts';
import { isLocalHost, isLocalOrigin } from '../server/security.ts';
import { ROOT, tmpDir } from './fixture.ts';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// a stand-in for dist/web
const WEB = tmpDir('hw-test-web-');
fs.writeFileSync(path.join(WEB, 'index.html'), '<!doctype html><title>Hallway</title><div id="root"></div>');
fs.mkdirSync(path.join(WEB, 'assets'));
fs.writeFileSync(path.join(WEB, 'assets', 'index-abc123.js'), 'console.log(1)');
fs.writeFileSync(path.join(WEB, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
after(() => fs.rmSync(WEB, { recursive: true, force: true }));

const app = createApp({ webDist: WEB });
const req = (p: string, init: RequestInit & { host?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('host', init.host ?? 'localhost:4255');
  return app.request(p, { ...init, headers });
};

describe('/api/health', () => {
  test('answers { ok: true, version }', async () => {
    const res = await req('/api/health');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await res.json(), { ok: true, version: VERSION });
  });

  test('unknown API paths are JSON 404s, never the dashboard', async () => {
    const res = await req('/api/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
  });
});

describe('security', () => {
  test('loopback Host headers pass, with or without a port', async () => {
    for (const host of ['localhost', 'localhost:4255', '127.0.0.1:4255', '[::1]:4255', 'LOCALHOST:1']) {
      assert.equal((await req('/api/health', { host })).status, 200, host);
    }
  });

  test('any other Host gets 403 (DNS rebinding)', async () => {
    for (const host of ['evil.example', 'evil.example:4255', 'localhost.evil.example', '127.0.0.1.nip.io', '']) {
      const res = await req('/api/health', { host });
      assert.equal(res.status, 403, host);
      assert.deepEqual(await res.json(), { error: 'forbidden host' });
    }
  });

  test('a cross-origin write gets 403; a non-JSON write gets 415; no CORS headers', async () => {
    const cross = await req('/api/health', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(cross.status, 403);
    assert.equal(cross.headers.get('access-control-allow-origin'), null);
    const form = await req('/api/health', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(form.status, 415);
    // DELETE has no body: exempt from the Content-Type rule, not the Origin rule
    assert.equal((await req('/api/x', { method: 'DELETE' })).status, 404);
    assert.equal((await req('/api/x', { method: 'DELETE', headers: { origin: 'http://evil.example' } })).status, 403);
    // a same-origin JSON write gets through to the router
    assert.equal((await req('/api/x', { method: 'POST', headers: { origin: 'http://localhost:4255', 'content-type': 'application/json' }, body: '{}' })).status, 404);
  });

  test('extra hosts are accepted only when configured', async () => {
    const dev = createApp({ webDist: null, extraHosts: ['preview.example.com'] });
    const get = (host: string) => dev.request('/api/health', { headers: { host } });
    assert.equal((await get('preview.example.com')).status, 200);
    assert.equal((await get('preview.example.com:443')).status, 200);
    assert.equal((await get('other.example.com')).status, 403);
    assert.ok(isLocalOrigin('https://preview.example.com', ['preview.example.com']));
    assert.ok(!isLocalOrigin('https://preview.example.com'));
  });

  test('isLocalHost / isLocalOrigin edge cases', () => {
    assert.ok(!isLocalHost(undefined));
    assert.ok(!isLocalHost(null));
    assert.ok(isLocalHost('[::1]'));
    assert.ok(!isLocalOrigin('not a url'));
    assert.ok(!isLocalOrigin('file://localhost/x'));
  });
});

describe('the dashboard', () => {
  test('/ and any client-side route get index.html', async () => {
    for (const p of ['/', '/apps/my-app', '/some/deep/route']) {
      const res = await req(p);
      assert.equal(res.status, 200, p);
      assert.match(await res.text(), /<title>Hallway<\/title>/, p);
    }
  });

  test('built files are served with their types', async () => {
    const js = await req('/assets/index-abc123.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);
    const svg = await req('/favicon.svg');
    assert.match(svg.headers.get('content-type') ?? '', /^image\/svg\+xml/);
  });

  test('an unbuilt dashboard says how to build it', async () => {
    const empty = tmpDir('hw-test-noweb-');
    try {
      const res = await createApp({ webDist: empty }).request('/', { headers: { host: 'localhost' } });
      assert.equal(res.status, 500);
      assert.match(await res.text(), /npm run build/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('with no webDist (npm run dev) only the API is served', async () => {
    const res = await createApp({ webDist: null }).request('/', { headers: { host: 'localhost' } });
    assert.equal(res.status, 404);
  });
});

describe('startServer', () => {
  test('binds 127.0.0.1 and serves /api/health over real HTTP', async () => {
    const s = await startServer(0, { webDist: null });
    try {
      assert.ok(s.port > 0);
      const res = await fetch(`http://127.0.0.1:${s.port}/api/health`);
      assert.deepEqual(await res.json(), { ok: true, version: VERSION });
    } finally {
      await s.close();
    }
  });

  test('rejects with EADDRINUSE when the port is taken', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as net.AddressInfo).port;
    try {
      await assert.rejects(startServer(port, { webDist: null }), { code: 'EADDRINUSE' });
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });
});
