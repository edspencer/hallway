// server/proxy/: the Caddy config generator (a golden file pins it), the fallback page, and the daemon pushing to
// Caddy's admin socket on start and on every change. With a real `caddy` on PATH (CI installs one), the golden config
// is also checked by `caddy validate`.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { AppConfig } from '../shared/api.ts';
import { sameConfig } from '../server/proxy/admin.ts';
import { caddyConfig, caddyPaths, caddyText, routeTable } from '../server/proxy/caddy.ts';
import { fallbackHtml } from '../server/proxy/fallback.ts';
import { networkChecks } from '../server/proxy/doctor.ts';
import { ipv6Loopback, restartCommands, startProxy } from '../server/proxy/index.ts';
import { darwin } from '../server/platform/darwin.ts';
import { linux } from '../server/platform/linux.ts';
import { win32 } from '../server/platform/win32.ts';
import { appHosts, dialAddress, httpsUrl, publicUrl, tldOf } from '../server/proxy/names.ts';
import { defaultConfig, validateApp } from '../server/store/schema.ts';
import { exitWatchdog, onWindows, ROOT, tmpDir, tmpStore, rmTmp } from './fixture.ts';

await exitWatchdog();
const v6 = await ipv6Loopback();

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
    // D68: any loopback or wildcard host is dialled as localhost, which Caddy tries on ::1 and 127.0.0.1 per connection
    for (const h of ['127.0.0.1', '0.0.0.0', '*', '::', '::1', '[::1]', 'localhost', 'LOCALHOST', ''])
      assert.equal(dialAddress(h, 1), 'localhost:1', h);
    assert.equal(dialAddress('192.168.1.20', 1), '192.168.1.20:1');
    assert.equal(dialAddress('fd00::5', 1), '[fd00::5]:1');
    assert.equal(dialAddress('db.internal', 1), 'db.internal:1');
    assert.equal(httpsUrl('a.localhost'), 'https://a.localhost');
    assert.equal(httpsUrl('a.localhost', 4443), 'https://a.localhost:4443');
    assert.equal(tldOf('myname.internal'), 'internal');
  });
  test("links by the tier's scheme and port (D65): the default port of each scheme is left out", () => {
    assert.equal(publicUrl('a.localhost', { scheme: 'https', publicPort: 443 }), 'https://a.localhost');
    assert.equal(publicUrl('a.localhost', { scheme: 'https', publicPort: 4443 }), 'https://a.localhost:4443');
    assert.equal(publicUrl('a.localhost', { scheme: 'http', publicPort: 443 }), 'http://a.localhost', 'the default 443 means 80 for plain HTTP');
    assert.equal(publicUrl('a.localhost', { scheme: 'http', publicPort: 80 }), 'http://a.localhost');
    assert.equal(publicUrl('a.localhost', { scheme: 'http', publicPort: 4480 }), 'http://a.localhost:4480');
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

  test('plain HTTP (No prompts, D65): the same routes on httpPort, no HTTPS server, no certificates, no redirect', () => {
    const { json } = caddyConfig({ home, config: fronted({ proxy: { scheme: 'http', trust: 'none' } }), apps: APPS, daemonPort: 4255 });
    const servers = (json as any).apps.http.servers;
    assert.deepEqual(Object.keys(servers), ['hallway-http']);
    assert.deepEqual(servers['hallway-http'].listen, ['127.0.0.1:4480', '[::1]:4480']);
    assert.deepEqual(servers['hallway-http'].automatic_https, { disable: true });
    assert.equal(servers['hallway-http'].routes.length, 1 + 4, 'the dashboard and every app name');
    assert.ok(servers['hallway-http'].errors, 'the fallback page');
    assert.equal((json as any).apps.tls, undefined);
    assert.ok(!JSON.stringify(json).includes('static_response'), 'nothing redirects');
  });

  test('Caddy never binds 443 or 80 itself, in any tier (launchd or the redirect hands them over)', () => {
    for (const proxy of [{}, { scheme: 'http' }, { publicPort: 4443 }]) {
      const text = JSON.stringify(caddyConfig({ home, config: fronted({ proxy }), apps: APPS, daemonPort: 4255 }).json);
      assert.ok(!/:443"|:80"/.test(text), text);
      assert.match(text, /"http_port":4480,"https_port":4443/);
    }
  });

  test('Host is rewritten to the upstream by default (D9); preserveHost keeps it; the dashboard keeps it', () => {
    const { json } = caddyConfig({ home, config: fronted(), apps: APPS, daemonPort: 4255 });
    const routes = (json as any).apps.http.servers.hallway.routes as any[];
    const byHost = new Map(routes.map((r) => [r.match[0].host[0], r.handle[0]]));
    assert.deepEqual(byHost.get('review.localhost').headers.request.set.Host, ['{http.reverse_proxy.upstream.hostport}']);
    assert.deepEqual(byHost.get('lr.localhost').upstreams, [{ dial: 'localhost:5622' }]);
    assert.equal(byHost.get('legacy.localhost').headers, undefined);
    assert.deepEqual(byHost.get('legacy.localhost').upstreams, [{ dial: 'localhost:8000' }]);
    assert.deepEqual(byHost.get('slides.localhost').upstreams, [{ dial: 'localhost:4321' }]);
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
  test('caddy validate accepts it, HTTPS and plain HTTP', { skip: caddy ? false : 'no caddy on PATH' }, () => {
    const dir = tmpDir('hw-test-caddy-');
    try {
      for (const proxy of [{}, { scheme: 'http' }]) {
        const { json } = caddyConfig({ home: dir, config: fronted({ proxy }), apps: APPS, daemonPort: 4255 });
        const file = path.join(dir, 'caddy.json');
        fs.writeFileSync(file, caddyText(json));
        const env = { PATH: process.env.PATH ?? '', HOME: dir, XDG_CONFIG_HOME: path.join(dir, 'c'), XDG_DATA_HOME: path.join(dir, 'd') };
        const out = execFileSync(caddy!, ['validate', '--config', file], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        assert.match(out, /Valid configuration/);
      }
    } finally {
      rmTmp(dir);
    }
  });

  // D68 (Q-IPV6): Caddy dials `localhost:<port>` and its resolver tries ::1 and 127.0.0.1 per connection, so an app is
  // reached in whichever family it bound, with no config change when that changes (Vite on a Mac: [::1] only)
  test(
    'the real Caddy reaches an app on [::1] only, on 127.0.0.1 only, and on both; Host is localhost:<port>',
    { skip: !caddy ? 'no caddy on PATH' : !v6 ? 'no IPv6 loopback' : process.platform === 'win32' ? 'fronted mode is unsupported on Windows' : false, timeout: 30_000 },
    async () => {
      const dir = tmpDir('hw-test-caddy6-');
      const servers: http.Server[] = [];
      let child: ReturnType<typeof spawn> | null = null;
      const free = () => new Promise<number>((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
      const serve = async (name: string, addresses: string[]) => {
        let port = 0;
        for (const a of addresses) {
          const s = http.createServer((req, res) => res.end(`${name} via ${a}, Host ${req.headers.host}`));
          await new Promise<void>((r) => s.listen(port, a, () => r()));
          port = (s.address() as net.AddressInfo).port;
          servers.push(s);
        }
        return port;
      };
      try {
        const [six, four, both] = [await serve('six', ['::1']), await serve('four', ['127.0.0.1']), await serve('both', ['::1', '127.0.0.1'])];
        const [httpPort, httpsPort] = [await free(), await free()];
        const apps = [app('six', { port: six }), app('four', { port: four }), app('both', { port: both }), app('gone', { port: await free() })];
        const { json } = caddyConfig({ home: dir, config: fronted({ proxy: { scheme: 'http', httpPort, httpsPort } }), apps, daemonPort: 4255 });
        fs.mkdirSync(path.join(dir, 'state', 'caddy'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'generated'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'generated', 'fallback.html'), 'fallback');
        const file = path.join(dir, 'caddy.json');
        fs.writeFileSync(file, caddyText(json));
        const env = { PATH: process.env.PATH ?? '', HOME: dir, XDG_CONFIG_HOME: path.join(dir, 'c'), XDG_DATA_HOME: path.join(dir, 'd') };
        child = spawn(caddy!, ['run', '--config', file], { env, stdio: 'ignore' });
        const get = (host: string) =>
          new Promise<{ status: number; body: string }>((resolve, reject) => {
            const req = http.get({ host: '127.0.0.1', port: httpPort, path: '/', headers: { host }, agent: false }, (res) => {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () => resolve({ status: res.statusCode!, body }));
            });
            req.on('error', reject);
          });
        const end = Date.now() + 15_000;
        for (;;) {
          try {
            await get('six.localhost');
            break;
          } catch (e) {
            if (Date.now() > end) throw e;
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        assert.deepEqual(await get('six.localhost'), { status: 200, body: `six via ::1, Host localhost:${six}` });
        assert.deepEqual(await get('four.localhost'), { status: 200, body: `four via 127.0.0.1, Host localhost:${four}` });
        assert.match((await get('both.localhost')).body, new RegExp(`^both via (::1|127\\.0\\.0\\.1), Host localhost:${both}$`));
        assert.deepEqual(await get('gone.localhost'), { status: 502, body: 'fallback' }, 'nothing in either family: the fallback page');
      } finally {
        child?.kill();
        await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
        rmTmp(dir);
      }
    },
  );
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
    // D68: an app on loopback may be on either family; the page mustn't say only 127.0.0.1 was tried
    assert.match(html, /"slides\.localhost":\{[^}]*"where":"port 4321 \(127\.0\.0\.1 or ::1\)"/);
    assert.match(html, /'Nothing answered on ' \+ a\.where/);
    assert.ok(!html.includes('"dial"'));
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

describe("doctor's networking checks in direct mode (D63)", () => {
  test('an info line: local domains are off, why hallway.localhost is refused, and `hallway setup`; on Windows, why not', async () => {
    const s = await tmpStore();
    try {
      const deps = { store: s.store, services: null, query: async () => ({ code: 1, stdout: '', stderr: '' }), env: {}, userHome: '/home/me' };
      const [mac] = await networkChecks({ ...deps, platform: darwin });
      assert.equal(mac!.id, 'networking');
      assert.equal(mac!.status, 'info');
      assert.match(mac!.message, /^local domains are off \(mode: direct\), so nothing answers at https:\/\/hallway\.localhost or https:\/\/<app>\.localhost \(a browser says the connection was refused\)/);
      assert.match(mac!.fix!, /^`hallway setup` turns them on/);
      const [win, ...more] = await networkChecks({ ...deps, platform: win32 });
      assert.equal(more.length, 0);
      assert.equal(win!.status, 'info');
      assert.match(win!.message, /Windows/);
      assert.equal(win!.fix, undefined, 'no command to suggest where setup refuses');
    } finally {
      s.cleanup();
    }
  });
});

describe("doctor's networking checks per tier (D65)", () => {
  // a platform whose listener scan sees nothing, and ports nothing else here uses
  const quiet = { ...linux, listListeners: async () => [], processInfo: async () => new Map() };
  const freePort = () => new Promise<number>((r) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => r(p));
    });
  });

  test('No prompts: plain HTTP answers or not, the Safari note, and no certificate checks', async () => {
    const s = await tmpStore();
    const [httpsPort, httpPort] = [await freePort(), await freePort()];
    try {
      await s.store.patchConfig({ mode: 'fronted', proxy: { trust: 'none', scheme: 'http', publicPort: httpPort, httpsPort, httpPort } });
      const deps = { store: s.store, platform: quiet, services: null, query: async () => ({ code: 1, stdout: '', stderr: '' }), env: { PATH: '' }, userHome: '/home/me' };
      const before = await networkChecks(deps);
      const line = (cs: typeof before, id: string) => cs.find((c) => c.id === id);
      assert.equal(line(before, 'redirect')!.status, 'fail');
      assert.match(line(before, 'redirect')!.message, new RegExp(`^nothing answers at http://hallway\\.localhost:${httpPort}$`));
      assert.equal(line(before, 'plain-http')!.status, 'info');
      assert.match(line(before, 'plain-http')!.message, /Safari won't keep Secure cookies over plain HTTP/);
      assert.match(line(before, 'plain-http')!.fix!, /hallway setup --trust user/);
      assert.equal(line(before, 'ca'), undefined, 'no certificate in this tier');
      assert.equal(line(before, 'redirect-http'), undefined, 'no redirect to HTTPS either');
      // something (Caddy, here a stand-in) answering on the HTTP port
      const srv = http.createServer((_q, r) => r.end('{}')).listen(httpPort, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      try {
        const now = await networkChecks(deps);
        assert.equal(line(now, 'redirect')!.status, 'pass');
        assert.equal(line(now, 'redirect')!.message, `http://hallway.localhost:${httpPort} answers (plain HTTP)`);
      } finally {
        srv.close();
      }
    } finally {
      s.cleanup();
    }
  });

  test('No admin on Linux: links on the HTTPS port; the certificate is checked for the account, not the system', async () => {
    const s = await tmpStore();
    const [httpsPort, httpPort] = [await freePort(), await freePort()];
    try {
      await s.store.patchConfig({ mode: 'fronted', proxy: { trust: 'user', publicPort: httpsPort, httpsPort, httpPort } });
      const cs = await networkChecks({ store: s.store, platform: quiet, services: null, query: async () => ({ code: 1, stdout: '', stderr: '' }), env: { PATH: '' }, userHome: '/home/me' });
      assert.match(cs.find((c) => c.id === 'redirect')!.message, new RegExp(`^nothing answers on 127\\.0\\.0\\.1:${httpsPort}$`));
      assert.match(cs.find((c) => c.id === 'redirect-http')!.message, new RegExp(`^http://hallway\\.localhost:${httpPort} doesn't answer`));
      assert.ok(!cs.some((c) => c.id === 'ports-80-443' || c.id === 'low-ports'), 'nothing on 443/80 to check in this tier');
      assert.match(cs.find((c) => c.id === 'ca')!.message, /doesn't exist yet/);
    } finally {
      s.cleanup();
    }
  });
});
