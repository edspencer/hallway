// server/prober/: the probe ladder against real local servers, the state machine (classification and flap damping)
// as a pure function, and the scheduler (intervals, jitter, concurrency, live mode, the starting grace period) with
// fake timers and a stand-in probe.
import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { type ProbeResult, type ProbeTarget, probe, statusIsHealthy } from '../server/prober/probe.ts';
import { classify, initialHealth, step } from '../server/prober/state.ts';
import { DEFAULT_PROBE, createProber } from '../server/prober/index.ts';
import { ipv6Loopback } from '../server/proxy/index.ts';
import { answeringAt, waitForPort } from '../server/services/ports.ts';
import { loopbackCandidates, lookedAt } from '../server/loopback.ts';
import { exitWatchdog } from './fixture.ts';

await exitWatchdog();

function listen(server: net.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
            if (server instanceof http.Server) server.closeAllConnections();
          }),
      }),
    ),
  );
}

/** A free port with nothing on it. */
async function freePort() {
  const s = await listen(net.createServer());
  await s.close();
  return s.port;
}

describe('the probe ladder', () => {
  test('status rules: 3xx, 401 and 403 are healthy on /; a health path wants 2xx or expectStatus', { timeout: 10_000 }, () => {
    for (const s of [200, 204, 301, 302, 401, 403, 404]) assert.equal(statusIsHealthy(s), true, String(s));
    for (const s of [500, 502, 503]) assert.equal(statusIsHealthy(s), false, String(s));
    assert.equal(statusIsHealthy(204, { path: '/health' }), true);
    assert.equal(statusIsHealthy(302, { path: '/health' }), false);
    assert.equal(statusIsHealthy(404, { path: '/health' }), false);
    assert.equal(statusIsHealthy(200, { path: '/health', expectStatus: 204 }), false);
    assert.equal(statusIsHealthy(418, { path: '/health', expectStatus: [200, 418] }), true);
  });

  test('against a real server: GET, Host = the upstream, our User-Agent, no redirects followed', { timeout: 10_000 }, async () => {
    const seen: { method?: string; url?: string; host?: string; ua?: string }[] = [];
    const routes: Record<string, number> = { '/': 302, '/health': 200, '/broken': 503, '/login': 200 };
    const s = await listen(
      http.createServer((req, res) => {
        seen.push({ method: req.method, url: req.url, host: req.headers.host, ua: req.headers['user-agent'] });
        res.writeHead(routes[req.url!] ?? 404, req.url === '/' ? { location: '/login' } : {});
        res.end('x'.repeat(1_000_000)); // a big body we never read
      }),
    );
    const t = (o: Partial<ProbeTarget> = {}): ProbeTarget => ({ slug: 'a', port: s.port, expected: 'running', ...o });
    try {
      const root = await probe(t());
      assert.equal(root.outcome, 'healthy');
      assert.equal(root.httpStatus, 302);
      assert.ok(root.latencyMs! >= 0);
      assert.deepEqual(seen, [{ method: 'GET', url: '/', host: `127.0.0.1:${s.port}`, ua: seen[0].ua }]);
      assert.match(seen[0].ua!, /^hallway\//);
      assert.equal((await probe(t({ health: { path: '/health' } }))).outcome, 'healthy');
      const broken = await probe(t({ health: { path: '/broken' } }));
      assert.deepEqual([broken.outcome, broken.httpStatus], ['unhealthy', 503]);
      assert.match(broken.error!, /503/);
      assert.equal((await probe(t({ health: { path: 'missing' } }))).httpStatus, 404, 'a path without its slash still works');
    } finally {
      await s.close();
    }
  });

  test('not listening; and listening but no HTTP answer within the timeout is unhealthy', { timeout: 10_000 }, async () => {
    const port = await freePort();
    const down = await probe({ slug: 'a', port, expected: 'running' });
    assert.deepEqual([down.outcome, down.httpStatus, down.latencyMs], ['not-listening', null, null]);
    assert.equal(down.error, 'ECONNREFUSED');
    const hang = await listen(net.createServer((sock) => sock.resume()));
    try {
      const r = await probe({ slug: 'a', port: hang.port, expected: 'running' }, { timeoutMs: 200 });
      assert.deepEqual([r.outcome, r.httpStatus], ['unhealthy', null]);
      assert.match(r.error!, /no response in 200 ms/);
    } finally {
      await hang.close();
    }
  });
});

// D68 (Q-IPV6): on a Mac, a server that binds `localhost` is often on [::1] only. Real listeners in each family.
const v6 = await ipv6Loopback();
const NO_V6 = v6 ? false : 'no IPv6 loopback on this machine';

/** One HTTP server per address, all on the same port (the first picks it). */
async function onAddresses(addresses: string[]) {
  const servers: http.Server[] = [];
  const seen: { address: string; host?: string }[] = [];
  let port = 0;
  for (const address of addresses) {
    const s = http.createServer((req, res) => {
      seen.push({ address, host: req.headers.host });
      res.end(address);
    });
    await new Promise<void>((r, j) => s.once('error', j).listen(port, address, () => r()));
    port = (s.address() as net.AddressInfo).port;
    servers.push(s);
  }
  return { port, seen, close: () => Promise.all(servers.map((s) => new Promise<void>((r) => (s.close(() => r()), s.closeAllConnections())))) };
}

describe('IPv4 and IPv6 loopback (D68)', () => {
  test('which addresses a host means', () => {
    for (const h of ['127.0.0.1', 'localhost', '0.0.0.0', '*', '', undefined]) assert.deepEqual(loopbackCandidates(h), ['127.0.0.1', '::1'], String(h));
    for (const h of ['::1', '[::1]', '::']) assert.deepEqual(loopbackCandidates(h), ['::1', '127.0.0.1'], h);
    assert.equal(loopbackCandidates('192.168.1.20'), null);
    assert.equal(loopbackCandidates('127.0.0.2'), null, 'another loopback address is taken as given');
    assert.equal(lookedAt('127.0.0.1', 5100), 'port 5100 (127.0.0.1 or ::1)');
    assert.equal(lookedAt('fd00::5', 5100), '[fd00::5]:5100');
  });

  test('a server on [::1] only (Vite on a Mac): healthy at the default host, on ::1, with its own Host', { skip: NO_V6, timeout: 10_000 }, async () => {
    const s = await onAddresses(['::1']);
    try {
      const r = await probe({ slug: 'hmr', port: s.port, expected: 'running' });
      assert.deepEqual([r.outcome, r.httpStatus, r.address], ['healthy', 200, '::1']);
      assert.deepEqual(s.seen, [{ address: '::1', host: `[::1]:${s.port}` }]);
      assert.equal(await answeringAt(s.port), '::1');
      assert.equal(await answeringAt(s.port, '0.0.0.0'), '::1');
      assert.deepEqual(await waitForPort(s.port, '127.0.0.1', { timeoutMs: 1000 }), { ok: true, address: '::1' });
    } finally {
      await s.close();
    }
  });

  test('a server on 127.0.0.1 only, with `host: ::1` in its file: found on 127.0.0.1', { timeout: 10_000 }, async () => {
    const s = await onAddresses(['127.0.0.1']);
    try {
      const r = await probe({ slug: 'a', port: s.port, host: '::1', expected: 'running' });
      assert.deepEqual([r.outcome, r.address], ['healthy', '127.0.0.1']);
      assert.equal(await answeringAt(s.port, '::1'), '127.0.0.1');
    } finally {
      await s.close();
    }
  });

  test('a server on both: the configured family is tried first', { skip: NO_V6, timeout: 10_000 }, async () => {
    const s = await onAddresses(['127.0.0.1', '::1']);
    try {
      assert.equal((await probe({ slug: 'a', port: s.port, expected: 'running' })).address, '127.0.0.1');
      assert.equal((await probe({ slug: 'a', port: s.port, host: '::1', expected: 'running' })).address, '::1');
      assert.deepEqual(s.seen.map((x) => x.address), ['127.0.0.1', '::1']);
    } finally {
      await s.close();
    }
  });

  test("nothing in either family: not listening, and the message doesn't name only one", { timeout: 10_000 }, async () => {
    const port = await freePort();
    const r = await probe({ slug: 'a', port, expected: 'running' });
    assert.deepEqual([r.outcome, r.address, r.error], ['not-listening', undefined, 'ECONNREFUSED']);
    assert.equal(await answeringAt(port), null);
    const w = await waitForPort(port, '127.0.0.1', { timeoutMs: 300, intervalMs: 50 });
    assert.equal(w.ok, false);
    assert.match((w as { reason: string }).reason, new RegExp(`^nothing was listening on port ${port} \\(127\\.0\\.0\\.1 or ::1\\) after 0 s$`));
  });

  test('a host that is not loopback is only ever tried as given', { timeout: 10_000 }, async () => {
    const s = await onAddresses(['127.0.0.1']);
    try {
      // 127.0.0.2 is loopback on Linux but nothing listens there; it must not fall back to 127.0.0.1
      const r = await probe({ slug: 'a', port: s.port, host: '127.0.0.2', expected: 'running' }, { connectTimeoutMs: 300 });
      assert.equal(r.outcome, 'not-listening');
    } finally {
      await s.close();
    }
  });
});

describe('the state machine', () => {
  test('not listening is down only when it should be running (after any grace period); otherwise stopped', { timeout: 10_000 }, () => {
    assert.equal(classify('not-listening', 'running', false), 'down');
    assert.equal(classify('not-listening', 'running', true), 'starting');
    assert.equal(classify('not-listening', 'adhoc', false), 'stopped');
    assert.equal(classify('not-listening', 'stopped', false), 'stopped');
    assert.equal(classify('healthy', 'stopped', false), 'healthy', 'listening is judged on its answer, whatever expected says');
    assert.equal(classify('unhealthy', 'adhoc', false), 'unhealthy');
  });

  test('two failures to leave healthy, one success to return, every other move immediate', { timeout: 10_000 }, () => {
    let h = initialHealth(0);
    const go = (c: Parameters<typeof step>[1]) => {
      const r = step(h, c, 1);
      h = r.next;
      return [h.state, r.changed];
    };
    assert.deepEqual(go('healthy'), ['healthy', true]);
    assert.deepEqual(go('healthy'), ['healthy', false]);
    assert.deepEqual(go('down'), ['healthy', false], 'one failure is damped');
    assert.deepEqual(go('healthy'), ['healthy', false], 'and forgotten after a success');
    assert.deepEqual(go('down'), ['healthy', false]);
    assert.deepEqual(go('down'), ['down', true]);
    assert.deepEqual(go('down'), ['down', false]);
    assert.deepEqual(go('healthy'), ['healthy', true], 'one success returns');
    assert.deepEqual(go('unhealthy'), ['healthy', false]);
    assert.deepEqual(go('stopped'), ['stopped', true], 'consecutive failures of any kind count');
    assert.deepEqual(go('unhealthy'), ['unhealthy', true]);
    assert.deepEqual(go('starting'), ['unknown', true]);
    assert.equal(h.starting, true);
    assert.deepEqual(go('healthy'), ['healthy', true]);
  });

  test('failuresBeforeUnhealthy is configurable', { timeout: 10_000 }, () => {
    const healthy = step(initialHealth(0), 'healthy', 0).next;
    assert.equal(step(healthy, 'down', 0, 1).next.state, 'down');
  });
});

describe('the scheduler', () => {
  afterEach(() => mock.timers.reset());

  /** A stand-in probe whose answer per slug the test controls. */
  function fakeProbe() {
    const answers = new Map<string, ProbeResult['outcome']>();
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let hold: Promise<void> | null = null;
    const fn = async (t: ProbeTarget): Promise<ProbeResult> => {
      calls.push(t.slug);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (hold) await hold;
      inFlight--;
      const outcome = answers.get(t.slug) ?? 'healthy';
      return { outcome, httpStatus: outcome === 'not-listening' ? null : 200, latencyMs: outcome === 'not-listening' ? null : 3 };
    };
    return {
      fn,
      answers,
      calls,
      max: () => maxInFlight,
      holdUntil: (p: Promise<void>) => (hold = p),
    };
  }

  /** Let the probe's promises settle after the fake clock fires a timer. */
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  async function advance(ms: number, step = 1000) {
    for (let t = 0; t < ms; t += step) {
      mock.timers.tick(Math.min(step, ms - t));
      await flush();
    }
  }

  test('a running app that stops goes down after two probes; an adhoc one goes stopped; events only on transitions', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const p = fakeProbe();
    const transitions: string[] = [];
    const samples: string[] = [];
    const prober = createProber({
      targets: () => [
        { slug: 'svc', port: 1, expected: 'running' },
        { slug: 'deck', port: 2, expected: 'adhoc' },
      ],
      probe: p.fn,
      random: () => 0.5, // no jitter
      onTransition: (slug, h, prev) => transitions.push(`${slug}:${prev}->${h.state}`),
      onSample: (s) => samples.push(`${s.slug}:${s.state}`),
    });
    prober.start();
    await advance(1000);
    assert.deepEqual(transitions, ['svc:unknown->healthy', 'deck:unknown->healthy']);
    await advance(60_000);
    assert.equal(transitions.length, 2, 'no event for a probe that changes nothing');

    p.answers.set('svc', 'not-listening');
    p.answers.set('deck', 'not-listening');
    await advance(60_000);
    assert.equal(prober.health('svc')!.state, 'healthy', 'one failed probe is damped');
    await advance(60_000);
    assert.equal(prober.health('svc')!.state, 'down');
    assert.equal(prober.health('deck')!.state, 'stopped');
    assert.deepEqual(transitions.slice(2), ['svc:healthy->down', 'deck:healthy->stopped']);
    assert.ok(samples.includes('svc:down') && samples.includes('deck:stopped'), 'samples record every probe, undamped');
    assert.equal(p.calls.filter((c) => c === 'svc').length, 4);
    prober.stop();
  });

  test('jitter keeps intervals within ±10 %', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const p = fakeProbe();
    const times: number[] = [];
    let r = 0;
    const prober = createProber({
      targets: () => [{ slug: 'a', port: 1, expected: 'running' }],
      probe: async (t, o) => (times.push(Date.now()), p.fn(t)),
      random: () => [0, 0.999][r++ % 2],
    });
    prober.start();
    await advance(200_000, 500);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    assert.ok(gaps.length >= 3);
    for (const g of gaps) assert.ok(g >= 54_000 && g <= 66_500, `gap ${g}`);
    prober.stop();
  });

  test('at most probe.concurrency probes in flight', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const p = fakeProbe();
    let release!: () => void;
    p.holdUntil(new Promise<void>((r) => (release = r)));
    const prober = createProber({
      targets: () => Array.from({ length: 10 }, (_, i) => ({ slug: `app${i}`, port: i + 1, expected: 'running' as const })),
      settings: () => ({ ...DEFAULT_PROBE, concurrency: 3 }),
      probe: p.fn,
      random: () => 0,
    });
    prober.start();
    await advance(10);
    assert.equal(p.calls.length, 3);
    release();
    await flush();
    await flush();
    assert.equal(p.calls.length, 10);
    assert.equal(p.max(), 3);
    prober.stop();
  });

  test('live mode: a connected dashboard pulls probes in to the live interval', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const p = fakeProbe();
    const prober = createProber({ targets: () => [{ slug: 'a', port: 1, expected: 'running' }], probe: p.fn, random: () => 0.5 });
    prober.start();
    await advance(1000);
    assert.equal(p.calls.length, 1);
    prober.setLive(true);
    await advance(15_000);
    assert.equal(p.calls.length, 2, 'the next probe came within the live interval');
    await advance(30_000);
    assert.equal(p.calls.length, 4);
    prober.setLive(false);
    await advance(30_000);
    assert.equal(p.calls.length, 5, 'back to the normal interval after the current one');
    prober.stop();
  });

  test('live mode never slows probing down', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const p = fakeProbe();
    const prober = createProber({
      targets: () => [{ slug: 'a', port: 1, expected: 'running' }],
      settings: () => ({ ...DEFAULT_PROBE, intervalSeconds: 5, liveIntervalSeconds: 15 }),
      probe: p.fn,
      random: () => 0.5,
    });
    prober.start();
    prober.setLive(true);
    await advance(1000);
    await advance(10_000);
    assert.equal(p.calls.length, 3, 'every 5 s, not 15');
    prober.stop();
  });

  test('a fresh start gets a grace period before not listening counts as down', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const p = fakeProbe();
    p.answers.set('svc', 'not-listening');
    const prober = createProber({ targets: () => [{ slug: 'svc', port: 1, expected: 'running' }], probe: p.fn, random: () => 0.5 });
    prober.start();
    prober.markStarting('svc');
    await advance(1000);
    assert.deepEqual([prober.health('svc')!.state, prober.health('svc')!.starting], ['unknown', true]);
    await advance(60_000); // past the 30 s grace
    assert.deepEqual([prober.health('svc')!.state, prober.health('svc')!.starting], ['down', false]);
    prober.stop();
  });

  test('refresh: new apps are probed, removed ones dropped, a changed expected re-judged at once', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const p = fakeProbe();
    p.answers.set('a', 'not-listening');
    let targets: ProbeTarget[] = [{ slug: 'a', port: 1, expected: 'running' }];
    const prober = createProber({ targets: () => targets, probe: p.fn, random: () => 0.5 });
    prober.start();
    await advance(1000);
    assert.equal(prober.health('a')!.state, 'down');
    targets = [{ slug: 'a', port: 1, expected: 'adhoc' }, { slug: 'b', port: 2, expected: 'running' }];
    prober.refresh();
    await advance(1000);
    assert.equal(prober.health('a')!.state, 'stopped');
    assert.equal(prober.health('b')!.state, 'healthy');
    targets = [];
    prober.refresh();
    assert.equal(prober.health('a'), null);
    assert.deepEqual(prober.all(), []);
    prober.stop();
  });

  test('a probe that throws counts as unhealthy rather than stopping the prober', { timeout: 10_000 }, async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const prober = createProber({
      targets: () => [{ slug: 'a', port: 1, expected: 'running' }],
      probe: async () => {
        throw new Error('boom');
      },
      random: () => 0.5,
    });
    prober.start();
    await advance(1000);
    assert.equal(prober.health('a')!.state, 'unhealthy');
    assert.equal(prober.health('a')!.lastProbe?.error, 'boom');
    prober.stop();
  });
});
