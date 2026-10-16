// server/proxy/: the Caddy config generator (a golden file pins it), the fallback page, and the daemon pushing to
// Caddy's admin socket on start and on every change. With a real `caddy` on PATH (CI installs one), the golden config
// is also checked by `caddy validate`.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AppConfig } from '../shared/api.ts';
import { sameConfig } from '../server/proxy/admin.ts';
import { caddyConfig, caddyPaths, caddyText, routeTable } from '../server/proxy/caddy.ts';
import { fallbackHtml } from '../server/proxy/fallback.ts';
import { restartCommands, startProxy } from '../server/proxy/index.ts';
import { appHosts, dialAddress, httpsUrl, tldOf } from '../server/proxy/names.ts';
import { defaultConfig, validateApp } from '../server/store/schema.ts';
import { exitWatchdog, onWindows, ROOT, tmpDir, tmpStore } from './fixture.ts';

await exitWatchdog();

const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'proxy');
// the goldens and the admin socket hold POSIX paths: fronted mode is unsupported on Windows (D58)
const POSIX_PATHS = { skip: onWindows("fronted mode is unsupported on Windows (Caddy's admin API is a Unix socket)") };
const app = (slug: string, raw: Record<string, unknown>) => ({ slug, config: validateApp(slug, raw).value as AppConfig });
const APPS = [
  app('review', { name: 'Local Review', port: 5622, proxy: { aliases: ['lr'] } }),
  app('slides', { name: 'Slides', port: 4321, host: '::1' }),
  app('legacy', { name: 'Legacy', port: 8000, host: '0.0.0.0', proxy: { preserveHost: true } }),
];
const fronted = (over: Record<string, any> = {}) => {
  const c = defaultConfig();
  return { ...c, mode: 'fronted' as const, ...over, proxy: { ...c.proxy, ...over.proxy }, domain: { ...c.domain, ...over.domain } };
};

function golden(name: string, text: string) {
  const file = path.join(GOLDEN, name);
  if (process.env.HALLWAY_UPDATE_GOLDEN) fs.writeFileSync(file, text);
  assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} changed; if on purpose: HALLWAY_UPDATE_GOLDEN=1 npm test`);
}

describe('names', () => {
  test('hosts, dial addresses, links', () => {
    assert.deepEqual(appHosts('review', ['lr', 'review'], 'localhost'), ['review.localhost', 'lr.localhost']);
    assert.equal(dialAddress('127.0.0.1', 1), '127.0.0.1:1');
    assert.equal(dialAddress('0.0.0.0', 1), '127.0.0.1:1');
    assert.equal(dialAddress('::', 1), '[::1]:1');
    assert.equal(dialAddress('::1', 1), '[::1]:1');
    assert.equal(dialAddress('[::1]', 1), '[::1]:1');
    assert.equal(dialAddress('localhost', 1), '127.0.0.1:1');
    assert.equal(httpsUrl('a.localhost'), 'https://a.localhost');
    assert.equal(httpsUrl('a.localhost', 4443), 'https://a.localhost:4443');
    assert.equal(tldOf('myname.internal'), 'internal');
  });
});

describe('the Caddy config', () => {
  const home = '/home/me/.hallway';

  test('golden: the default localhost setup', POSIX_PATHS, () => {
    const out = caddyConfig({ home, config: fronted(), apps: APPS, daemonPort: 4255 });
    assert.deepEqual(out.problems, []);
    golden('caddy-localhost.json', caddyText(out.json));
  });

  test('golden: a custom domain, no IPv6, links on the high port', POSIX_PATHS, () => {
    const out = caddyConfig({ home, config: fronted({ domain: { base: 'myname.internal', dashboard: 'myname.internal' }, proxy: { publicPort: 4443 } }), apps: APPS.slice(0, 1), daemonPort: 4255, ipv6: false });
    golden('caddy-custom.json', caddyText(out.json));
  });

  test('Host is rewritten to the upstream by default (D9); preserveHost keeps it; the dashboard keeps it', () => {
    const { json } = caddyConfig({ home, config: fronted(), apps: APPS, daemonPort: 4255 });
    const routes = (json as any).apps.http.servers.hallway.routes as any[];
    const byHost = new Map(routes.map((r) => [r.match[0].host[0], r.handle[0]]));
    assert.deepEqual(byHost.get('review.localhost').headers.request.set.Host, ['{http.reverse_proxy.upstream.hostport}']);
    assert.deepEqual(byHost.get('lr.localhost').upstreams, [{ dial: '127.0.0.1:5622' }]);
    assert.equal(byHost.get('legacy.localhost').headers, undefined);
    assert.deepEqual(byHost.get('legacy.localhost').upstreams, [{ dial: '127.0.0.1:8000' }]);
    assert.deepEqual(byHost.get('slides.localhost').upstreams, [{ dial: '[::1]:4321' }]);
    assert.equal(byHost.get('hallway.localhost').headers, undefined);
    assert.deepEqual(byHost.get('hallway.localhost').upstreams, [{ dial: '127.0.0.1:4255' }]);
    assert.equal(routes[0].match[0].host[0], 'hallway.localhost', 'the dashboard comes first');
  });

  test('the admin API is a 0600 Unix socket in the data home, never TCP; nothing is persisted outside it', POSIX_PATHS, () => {
    const { json } = caddyConfig({ home, config: fronted(), apps: [], daemonPort: 4255 }) as any;
    assert.equal(json.admin.listen, 'unix//home/me/.hallway/state/caddy/admin.sock|0600');
    assert.equal(json.admin.config.persist, false);
    assert.equal(json.storage.root, '/home/me/.hallway/state/caddy/data');
    assert.equal(json.apps.pki.certificate_authorities.local.install_trust, false);
    assert.deepEqual(json.apps.http.servers.hallway.listen, ['127.0.0.1:4443', '[::1]:4443']);
    assert.deepEqual(json.apps.http.servers['hallway-http'].listen, ['127.0.0.1:4480', '[::1]:4480']);
    for (const s of Object.values(json.apps.http.servers) as any[]) for (const l of s.listen) assert.match(l, /^(127\.0\.0\.1|\[::1\]):/, 'loopback only');
  });

  test('a very deep data home moves the socket to the temp directory (sun_path is ~104 bytes)', POSIX_PATHS, () => {
    const deep = '/x'.repeat(60);
    const p = caddyPaths(deep);
    assert.ok(Buffer.byteLength(p.socket) <= 100, p.socket);
    assert.match(path.basename(p.socket), /^hallway-caddy-[0-9a-f]{12}\.sock$/);
    assert.equal(caddyPaths(deep).socket, p.socket, 'stable');
  });

  test('the HTTP redirect goes to the public port', () => {
    const loc = (publicPort: number) => (caddyConfig({ home, config: fronted({ proxy: { publicPort } }), apps: [], daemonPort: 1 }).json as any).apps.http.servers['hallway-http'].routes[0].handle[0].headers.Location[0];
    assert.equal(loc(443), 'https://{http.request.host}{http.request.uri}');
    assert.equal(loc(4443), 'https://{http.request.host}:4443{http.request.uri}');
  });

  test('a name already taken is skipped and reported, and the first owner keeps it', () => {
    const { routes, problems } = routeTable({
      config: fronted(),
      daemonPort: 1,
      apps: [app('b', { port: 2, proxy: { aliases: ['a', 'hallway'] } }), app('a', { port: 1 })],
    });
    assert.deepEqual(
      routes.map((r) => `${r.host}→${r.target}`),
      ['hallway.localhost→dashboard', 'a.localhost→a', 'b.localhost→b'],
    );
    assert.equal(problems.length, 2);
    assert.match(problems[0], /a\.localhost \(apps\/b\.yaml\) is already taken by apps\/a\.yaml/);
    assert.match(problems[1], /hallway\.localhost .* the dashboard's name/);
  });

  test('sameConfig ignores key order', () => {
    assert.ok(sameConfig({ a: 1, b: [{ c: 1, d: 2 }] }, { b: [{ d: 2, c: 1 }], a: 1 }));
    assert.ok(!sameConfig({ a: 1 }, { a: 2 }));
  });

  // with a real Caddy (CI installs one), the generated config must be one Caddy accepts
  const caddy = (() => {
    try {
      execFileSync('caddy', ['version'], { stdio: 'ignore' });
      return 'caddy';
    } catch {
      return null;
    }
  })();
  test('caddy validate accepts it', { skip: caddy ? false : 'no caddy on PATH' }, () => {
    const dir = tmpDir('hw-test-caddy-');
    try {
      const { json } = caddyConfig({ home: dir, config: fronted(), apps: APPS, daemonPort: 4255 });
      const file = path.join(dir, 'caddy.json');
      fs.writeFileSync(file, caddyText(json));
      const env = { PATH: process.env.PATH ?? '', HOME: dir, XDG_CONFIG_HOME: path.join(dir, 'c'), XDG_DATA_HOME: path.join(dir, 'd') };
      const out = execFileSync(caddy!, ['validate', '--config', file], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.match(out, /Valid configuration/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the fallback page', () => {
  test('lists every app with its link; names are escaped; knows which host is which', () => {
    const html = fallbackHtml({
      config: fronted(),
      apps: [...APPS, app('evil', { name: '<script>alert(1)</script>', port: 1 })],
      restart: restartCommands('launchd', 501),
      directUrl: 'http://localhost:4255',
      now: new Date('2026-10-16T12:00:00Z'),
      tokens: ':root { --hw-bg: #000; }',
    });
    assert.match(html, /<a href="https:\/\/review\.localhost">Local Review<\/a>/);
    assert.match(html, /<a href="https:\/\/slides\.localhost">Slides<\/a>/);
    assert.ok(!html.includes('<script>alert(1)'), 'escaped in the list');
    assert.ok(html.includes('&#60;script&#62;alert(1)&#60;/script&#62;'));
    assert.ok(!/"name":"<script>/.test(html), 'escaped in the inline JSON');
    assert.match(html, /launchctl kickstart -k gui\/501\/hallway\.daemon/);
    assert.match(html, /hallway service restart/);
    assert.match(html, /"lr\.localhost":\{"slug":"review"/);
    assert.match(html, /"dashboard":"hallway\.localhost"/);
    assert.match(html, /--hw-bg: #000/, 'the tokens are inlined');
    assert.match(html, /2026-10-16T12:00:00Z/);
  });

  test('no colour is hard-coded outside the inlined tokens (D28)', () => {
    const html = fallbackHtml({ config: fronted(), apps: [], restart: [], directUrl: 'http://localhost:4255', tokens: '' });
    const style = /<style>([\s\S]*)<\/style>/.exec(html)![1];
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(style), style);
    assert.match(html, /No apps are declared yet/);
  });

  test('restart commands per service manager', () => {
    assert.deepEqual(restartCommands('systemd'), ['hallway service restart', 'systemctl --user restart hallway-daemon.service']);
  });
});

/** A stand-in for Caddy's admin API on a Unix socket: records each POST /load. */
async function fakeCaddy(socket: string) {
  const loads: string[] = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/load') loads.push(body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? '' : JSON.stringify({ error: 'loading new config: nope' }));
    });
  });
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  await new Promise<void>((r) => server.listen(socket, r));
  return { loads, setStatus: (s: number) => (status = s), close: () => new Promise<void>((r) => server.close(() => r())) };
}

const until = async (f: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('the daemon side: startProxy', { skip: onWindows("fronted mode is unsupported on Windows (Caddy's admin API is a Unix socket)") }, () => {
  const homes: (() => void)[] = [];
  after(() => homes.forEach((c) => c()));

  test('direct mode writes and pushes nothing', async () => {
    const { store, bus, home, cleanup } = await tmpStore();
    homes.push(cleanup);
    const fake = await fakeCaddy(caddyPaths(home).socket);
    const p = await startProxy({ store, bus, daemonPort: 4255, ipv6: true, log: () => {} });
    assert.equal(p.status().mode, 'direct');
    assert.equal(fake.loads.length, 0);
    assert.ok(!fs.existsSync(caddyPaths(home).config));
    await p.stop();
    await fake.close();
  });

  test('fronted mode: pushes on start, writes generated/, re-pushes on an app change, and only when it changed', async () => {
    const { store, bus, home, cleanup } = await tmpStore();
    homes.push(cleanup);
    await store.patchConfig({ mode: 'fronted' });
    await store.putApp('review', { name: 'Review', port: 5622 });
    const paths = caddyPaths(home);
    const fake = await fakeCaddy(paths.socket);
    const logs: string[] = [];
    const p = await startProxy({ store, bus, daemonPort: 4255, ipv6: true, log: (s) => logs.push(s) });
    assert.equal(fake.loads.length, 1);
    assert.equal(fake.loads[0], fs.readFileSync(paths.config, 'utf8'), 'the file is what was pushed');
    assert.match(fs.readFileSync(paths.fallback, 'utf8'), /review\.localhost/);
    assert.equal(p.status().pushError, null);

    await store.putApp('slides', { port: 4321 });
    await until(() => fake.loads.length === 2);
    assert.match(fake.loads[1], /slides\.localhost/);

    // an event that changes nothing Caddy cares about pushes nothing
    bus.emit({ type: 'config' });
    await p.refresh();
    assert.equal(fake.loads.length, 2);
    await p.stop();
    await fake.close();
  });

  test('Caddy not running: says so once, retries, and catches up when it appears; a refused config is reported', async () => {
    const { store, bus, home, cleanup } = await tmpStore();
    homes.push(cleanup);
    await store.patchConfig({ mode: 'fronted' });
    const logs: string[] = [];
    const p = await startProxy({ store, bus, daemonPort: 4255, ipv6: true, retryMs: 50, log: (s) => logs.push(s) });
    assert.match(p.status().pushError ?? '', /Caddy isn't running/);
    assert.ok(fs.existsSync(caddyPaths(home).config), 'the file is written regardless: Caddy starts from it');
    const fake = await fakeCaddy(caddyPaths(home).socket);
    await until(() => fake.loads.length === 1);
    await until(() => p.status().pushError === null);
    assert.equal(logs.filter((l) => /isn't running/.test(l)).length, 1, 'said once, not every retry');

    fake.setStatus(400);
    await store.putApp('x', { port: 1 });
    await until(() => /refused the config .*nope/.test(p.status().pushError ?? ''));
    await p.stop();
    await fake.close();
  });
});
