// server/live.ts: the scanner, prober and uptime store plugged into the real daemon core (a Store on a throwaway data
// home, its bus, the HTTP API), over a fake platform listing real local servers. Covers /api/observed, claiming,
// declared ports enriching their app, state events, and a `running` app going down while an `adhoc` one goes stopped.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { AppHistory, AppView, ObservedResponse, ServerEvent, StateResponse } from '../shared/api.ts';
import { createApp } from '../server/index.ts';
import { probeDetail, startLive } from '../server/live.ts';
import { type Platform, type ProcessInfo, type RawListener, currentPlatform } from '../server/platform/index.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { exitWatchdog, tmpDir, tmpStore, rmTmp } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => void | Promise<void>)[] = [];
after(async () => {
  for (const c of cleanups.reverse()) await c();
});

function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_q, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<title>Scratch</title>');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
            server.closeAllConnections();
          }),
      }),
    ),
  );
}

async function until(what: string, ok: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('the live provider', () => {
  test('observed, claim, enrichment, and down vs stopped', { timeout: 30_000 }, async () => {
    const { store, bus, cleanup } = await tmpStore();
    cleanups.push(cleanup);
    // a dashboard is "connected" (the prober goes live), and probes come every second
    const events: ServerEvent[] = [];
    bus.subscribe((e) => events.push(e));
    // the OS picks the servers' ports, which on macOS are in the ephemeral range
    await store.patchConfig({ probe: { liveIntervalSeconds: 1 }, scan: { includeEphemeralPorts: true } });

    const [svc, deck, scratch] = await Promise.all([listen(), listen(), listen()]);
    // closed here too, so a failing assertion can't leave a server holding the test process open
    cleanups.push(() => scratch.close(), () => svc.close(), () => deck.close());
    await store.createApp('svc', { name: 'Service', port: svc.port, expected: 'running' });
    await store.createApp('deck', { name: 'Deck', port: deck.port, expected: 'adhoc' });

    const dir = tmpDir('hw-test-live-proj-');
    cleanups.push(() => rmTmp(dir));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'scratch-pad', description: 'Notes' }));
    const raw: RawListener[] = [
      { pid: 21, process: 'node', port: svc.port, address: '127.0.0.1' },
      { pid: 22, process: 'python3', port: scratch.port, address: '127.0.0.1' },
    ];
    const platform = {
      ...currentPlatform(),
      listListeners: async () => raw,
      processInfo: async (pids: number[]) =>
        new Map(pids.map((pid): [number, ProcessInfo] => [pid, { pid, ppid: 1, command: 'python3 -m http.server', argv: ['python3', '-m', 'http.server'], cwd: dir, startTime: 1, orphan: true }])),
      bootTime: async () => Date.parse('2026-10-01T08:00:00Z'),
    } satisfies Platform;

    const providers = new ProviderRegistry();
    const live = await startLive({ store, bus, providers, platform });
    cleanups.push(() => live.stop());
    await live.ready;
    const app = createApp({ store, bus, providers, webDist: null });
    const req = (p: string, init: RequestInit = {}) => app.request(p, { ...init, headers: { host: 'localhost:4255', 'content-type': 'application/json', ...init.headers } });

    // only the unknown listener is observed; the declared one enriches its app
    const obs = (await (await req('/api/observed')).json()) as ObservedResponse;
    assert.deepEqual(obs.observed.map((o) => o.port), [scratch.port]);
    const o = obs.observed[0];
    assert.equal(o.http, true);
    assert.equal(o.title, 'Scratch');
    assert.equal(o.identity.cwd, dir);
    assert.equal(o.identity.name, 'scratch-pad');
    assert.equal(o.identity.orphaned, true);
    assert.equal(o.suggestedSlug, 'scratch-pad');
    assert.ok(events.some((e) => e.type === 'observed' && e.reason === 'scan'));

    await until('both apps healthy', () => live.health.prober.health('svc')?.state === 'healthy' && live.health.prober.health('deck')?.state === 'healthy');
    const state = (await (await req('/api/state')).json()) as StateResponse;
    const svcView = state.apps.find((a) => a.slug === 'svc')!;
    assert.equal(svcView.health.state, 'healthy');
    assert.equal(svcView.health.httpStatus, 200);
    assert.equal(svcView.health.uptime24h, 1);
    assert.equal(svcView.identity?.pid, 21, 'the scanner enriches the declared app');
    assert.equal(svcView.history?.buckets.length, 48);
    const hist = (await (await req('/api/apps/svc/history?window=7d')).json()) as AppHistory;
    assert.equal(hist.buckets.length, 56);

    // claim the observed one: the file keeps its port, and it leaves the observed list at once
    const claimed = await req(`/api/observed/${o.id}/claim`, { method: 'POST', body: JSON.stringify({ slug: 'scratch-pad' }) });
    assert.equal(claimed.status, 201);
    assert.equal(((await claimed.json()) as AppView).config?.port, scratch.port);
    assert.match(fs.readFileSync(path.join(store.home, 'apps', 'scratch-pad.yaml'), 'utf8'), new RegExp(`port: ${scratch.port}`));
    assert.deepEqual(((await (await req('/api/observed')).json()) as ObservedResponse).observed, []);
    await until('the claimed app is probed', () => live.health.prober.health('scratch-pad')?.state === 'healthy');

    // stop both: the running one goes down (after two failed probes), the adhoc one stopped
    events.length = 0;
    await Promise.all([svc.close(), deck.close()]);
    await until('down and stopped', () => live.health.prober.health('svc')?.state === 'down' && live.health.prober.health('deck')?.state === 'stopped');
    const states = events.filter((e) => e.type === 'state');
    assert.deepEqual(states.map((e) => e.type === 'state' && `${e.slug}:${e.state}`).sort(), ['deck:stopped', 'svc:down']);
    const after = (await (await req('/api/apps/svc')).json()) as AppView;
    assert.equal(after.health.state, 'down');
    assert.equal(after.health.detail, 'connection refused');
  });

  test('turning the scanner off empties the tray; turning it on scans at once', { timeout: 30_000 }, async () => {
    const { store, bus, cleanup } = await tmpStore();
    cleanups.push(cleanup);
    await store.patchConfig({ scan: { includeEphemeralPorts: true } });
    const srv = await listen();
    cleanups.push(() => srv.close());
    let scans = 0;
    const platform = {
      ...currentPlatform(),
      listListeners: async () => (scans++, [{ pid: 31, process: 'python3', port: srv.port, address: '127.0.0.1' }]),
      processInfo: async (pids: number[]) =>
        new Map(pids.map((pid): [number, ProcessInfo] => [pid, { pid, ppid: 1, command: 'python3 -m http.server', argv: ['python3', '-m', 'http.server'], cwd: store.home, startTime: 1, orphan: false }])),
      bootTime: async () => Date.parse('2026-10-01T08:00:00Z'),
    } satisfies Platform;
    const live = await startLive({ store, bus, providers: new ProviderRegistry(), platform });
    cleanups.push(() => live.stop());
    await live.ready;
    assert.deepEqual(live.observed().map((o) => o.port), [srv.port]);

    const events: ServerEvent[] = [];
    bus.subscribe((e) => events.push(e));
    await store.patchConfig({ scan: { enabled: false } });
    assert.deepEqual(live.observed(), [], 'the last scan is not shown while scanning is off');
    assert.ok(events.some((e) => e.type === 'observed' && e.reason === 'config'));

    const before = scans;
    await store.patchConfig({ scan: { enabled: true } });
    await until('a scan straight away', () => scans > before, 5000);
    await until('the listener is back', () => live.observed().length === 1, 5000);
  });

  test('probe details for people', { timeout: 30_000 }, () => {
    const h = (lastProbe: object | null, starting = false) =>
      ({ slug: 'a', state: 'unknown', starting, failures: 0, since: 0, lastProbe }) as Parameters<typeof probeDetail>[0];
    assert.equal(probeDetail(h(null)), null);
    assert.equal(probeDetail(h({ outcome: 'not-listening', httpStatus: null, latencyMs: null, error: 'ECONNREFUSED', at: 0 })), 'connection refused');
    assert.equal(probeDetail(h({ outcome: 'unhealthy', httpStatus: null, latencyMs: 5000, error: 'no response in 5000 ms', at: 0 })), 'timed out after 5000 ms');
    assert.equal(probeDetail(h({ outcome: 'unhealthy', httpStatus: 502, latencyMs: 3, at: 0 })), 'HTTP 502');
    assert.equal(probeDetail(h({ outcome: 'healthy', httpStatus: 200, latencyMs: 3, at: 0 })), null);
    assert.equal(probeDetail(h({ outcome: 'not-listening', httpStatus: null, latencyMs: null, at: 0 }, true)), 'starting');
  });
});
