// server/health/: the uptime store (node:sqlite): samples, hourly rollups, pruning, the 24 h / 7 d / 90 d bars, and
// the rules that uptime excludes `stopped` and that time with no samples is "no data", never down. Plus startHealth,
// the prober feeding the store.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { UptimeStore, percentile } from '../server/health/uptime.ts';
import { startHealth } from '../server/health/index.ts';
import type { Sample } from '../server/prober/index.ts';
import { tmpDir } from './fixture.ts';

const TMP = tmpDir('hw-test-uptime-');
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A fixed "now", on a bucket boundary plus a bit. */
const NOW = Date.parse('2026-10-16T12:10:00Z');

/** One sample a minute for `slug` from `from` for `minutes`, all in `state`. */
function fill(store: UptimeStore, slug: string, from: number, minutes: number, state: Sample['state'], latencyMs: number | null = 10) {
  for (let i = 0; i < minutes; i++)
    store.add({ slug, ts: from + i * MIN, state, httpStatus: state === 'healthy' ? 200 : null, latencyMs: state === 'down' || state === 'stopped' ? null : latencyMs });
}

describe('percentiles', () => {
  test('nearest rank', () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([5], 95), 5);
    assert.equal(percentile([1, 2, 3, 4], 50), 2);
    assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95);
  });
});

describe('the 24 h window', () => {
  test('48 half-hour bars ending with the current one; empty bars are no data', async () => {
    const store = await UptimeStore.open(':memory:');
    const h = store.history('a', '24h', NOW);
    assert.equal(h.buckets.length, 48);
    assert.equal(h.buckets.at(-1)!.start, '2026-10-16T12:00:00.000Z');
    assert.equal(h.buckets[0].start, '2026-10-15T12:30:00.000Z');
    assert.ok(h.buckets.every((b) => b.state === 'nodata' && b.uptime === null && b.samples === 0));
    assert.equal(h.uptime, null);
    store.close();
  });

  test('uptime excludes stopped time; the worst state colours a bar; a daemon outage is a gap', async () => {
    const store = await UptimeStore.open(':memory:');
    const start = NOW - 10 * MIN - 4 * HOUR; // 08:00
    fill(store, 'a', start, 60, 'healthy', 20); // 08:00–09:00 healthy
    fill(store, 'a', start + HOUR, 60, 'stopped'); // 09:00–10:00 stopped on purpose
    // 10:00–11:00: the daemon wasn't running: no samples
    fill(store, 'a', start + 3 * HOUR, 25, 'healthy', 40); // 11:00–11:25
    fill(store, 'a', start + 3 * HOUR + 25 * MIN, 5, 'down'); // 11:25–11:30
    fill(store, 'a', NOW - 10 * MIN, 10, 'unhealthy', 900); // 12:00–12:10
    const h = store.history('a', '24h', NOW);
    const at = (iso: string) => h.buckets.find((b) => b.start === `2026-10-16T${iso}:00.000Z`)!;
    assert.deepEqual([at('08:00').state, at('08:00').uptime], ['healthy', 1]);
    assert.deepEqual([at('09:00').state, at('09:00').uptime, at('09:00').stopped], ['stopped', null, 30], 'all stopped: no uptime figure, not 0 %');
    assert.deepEqual([at('10:00').state, at('10:00').samples], ['nodata', 0], 'no data, never down');
    assert.deepEqual([at('11:00').state, at('11:00').down, at('11:00').uptime], ['down', 5, 25 / 30]);
    assert.equal(at('12:00').state, 'unhealthy');
    // 60 + 25 healthy out of 60 + 30 + 10 non-stopped samples
    assert.equal(h.uptime, 85 / 100);
    assert.deepEqual(h.latency, { p50: 20, p95: 900, max: 900 });
    assert.equal(at('08:00').latencyP50, 20);
    assert.equal(store.history('other', '24h', NOW).uptime, null, 'per app');
    store.close();
  });
});

describe('rollups', () => {
  test('complete hours are rolled up once; the hour in progress is not', async () => {
    const store = await UptimeStore.open(':memory:');
    fill(store, 'a', NOW - 10 * MIN - 2 * HOUR, 130, 'healthy');
    assert.equal(store.rollup(NOW), 2);
    assert.equal(store.rollup(NOW), 0, 'idempotent');
    store.close();
  });

  test('samples go after 48 h, rollups after 90 days; the 7 d and 90 d bars come from rollups', async () => {
    const file = path.join(TMP, 'state', 'health.sqlite');
    const store = await UptimeStore.open(file);
    const old = NOW - 5 * DAY; // five days ago
    fill(store, 'a', old, 120, 'healthy', 15);
    fill(store, 'a', old + 2 * HOUR, 60, 'down');
    fill(store, 'a', old + 3 * HOUR, 60, 'stopped');
    fill(store, 'a', NOW - 100 * DAY, 60, 'healthy'); // older than 90 days
    fill(store, 'a', NOW - 10 * MIN, 10, 'healthy', 30); // now
    store.prune(NOW);

    // the five-day-old samples are gone from the 24 h view…
    const day = store.history('a', '24h', NOW);
    assert.equal(day.buckets.reduce((s, b) => s + b.samples, 0), 10);
    // …but their rollups remain for 7 d, and the current hour is counted from samples
    const week = store.history('a', '7d', NOW);
    assert.equal(week.buckets.length, 56);
    assert.equal(week.buckets.reduce((s, b) => s + b.samples, 0), 120 + 60 + 60 + 10);
    assert.equal(week.uptime, 130 / 190);
    const bad = week.buckets.find((b) => b.down)!;
    assert.equal(bad.state, 'down');
    assert.equal(week.latency.p50, 15);

    const quarter = store.history('a', '90d', NOW);
    assert.equal(quarter.buckets.length, 90);
    assert.equal(quarter.buckets.reduce((s, b) => s + b.samples, 0), 250, 'the 100-day-old hour was pruned');
    assert.equal(quarter.buckets.at(-1)!.start, '2026-10-16T00:00:00.000Z');
    store.close();

    // it's a file: reopening finds the data
    const again = await UptimeStore.open(file);
    assert.equal(again.history('a', '7d', NOW).uptime, 130 / 190);
    again.forget('a');
    assert.equal(again.history('a', '7d', NOW).uptime, null);
    again.close();
  });
});

describe('startHealth', () => {
  test('probes the apps, stores samples and reports transitions', { timeout: 10_000 }, async () => {
    const server = http.createServer((_q, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const states: string[] = [];
    const health = await startHealth({
      home: path.join(TMP, 'home'),
      targets: () => [{ slug: 'web', port, expected: 'running' }],
      onState: (slug, h) => states.push(`${slug}:${h.state}`),
    });
    try {
      // the first probe lands within ~2 s (the start-up spread)
      for (let i = 0; i < 50 && !states.length; i++) await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(states, ['web:healthy']);
      const h = health.history('web');
      assert.equal(h.buckets.at(-1)!.healthy, 1);
      assert.equal(h.uptime, 1);
      assert.ok(fs.existsSync(path.join(TMP, 'home', 'state', 'health.sqlite')));
    } finally {
      health.stop();
      server.close();
    }
  });
});
