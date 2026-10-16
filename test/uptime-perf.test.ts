// v2 acceptance criterion 4 (docs/08-roadmap.md): the 90-day view renders from rollups only and stays fast with 30
// apps. Seeded through the uptime store's own API: 90 days of samples, rolled up and pruned as the daemon does, so only
// the last 48 hours of samples are left. The time limits are generous (CI machines are slow and shared); the measured
// numbers are in docs/11-research-notes.md.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UptimeStore } from '../server/health/uptime.ts';
import { exitWatchdog, tmpDir } from './fixture.ts';

await exitWatchdog();

const TMP = tmpDir('hw-test-uptime-perf-');
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-16T12:10:00Z');
const APPS = 30;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test('30 apps, 90 days: the 90-day view comes from rollups and stays fast', { timeout: 120_000 }, async () => {
  const store = await UptimeStore.open(path.join(TMP, 'health.sqlite'));
  after(() => store.close());
  const state = (a: number, ts: number) => (((ts / HOUR) * 7 + a * 13) % 97 < 2 ? 'down' : 'healthy') as 'down' | 'healthy';
  for (let a = 0; a < APPS; a++) {
    // two samples an hour back to 90 days, then one every five minutes for the last two days
    for (let ts = NOW - 90 * DAY; ts < NOW - 48 * HOUR; ts += 30 * MIN) store.add({ slug: `app-${a}`, ts, state: state(a, ts), httpStatus: 200, latencyMs: 5 + ((ts / MIN + a) % 40) });
    for (let ts = NOW - 48 * HOUR; ts < NOW; ts += 5 * MIN) store.add({ slug: `app-${a}`, ts, state: state(a, ts), httpStatus: 200, latencyMs: 5 + ((ts / MIN + a) % 40) });
  }
  store.prune(NOW);

  // rollups only: the samples behind the first 88 days are gone, yet every one of the 90 bars has data
  const h = store.history('app-7', '90d', NOW);
  assert.equal(h.buckets.length, 90);
  assert.ok(h.buckets.every((b) => b.samples > 0), 'every day has data');
  assert.ok(h.uptime! > 0.9 && h.uptime! < 1);
  assert.ok(h.latency.p50 !== null && h.latency.p95 !== null);

  // within an hour, the rollup each history() starts with has nothing to do
  assert.equal(store.rollup(NOW), 0);

  const one: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    store.history(`app-${i}`, '90d', NOW);
    one.push(performance.now() - t);
  }
  const t = performance.now();
  for (let a = 0; a < APPS; a++) store.history(`app-${a}`, '90d', NOW);
  const all = performance.now() - t;
  const week = performance.now();
  for (let a = 0; a < APPS; a++) store.history(`app-${a}`, '7d', NOW);
  const weekAll = performance.now() - week;
  process.stdout.write(`# 90d: ${median(one).toFixed(1)} ms for one app (median), ${all.toFixed(0)} ms for all ${APPS}; 7d: ${weekAll.toFixed(0)} ms for all ${APPS}\n`);
  assert.ok(median(one) < 100, `one app's 90 days took ${median(one).toFixed(1)} ms`);
  assert.ok(all < 2000, `all ${APPS} apps' 90 days took ${all.toFixed(0)} ms`);
});

test('a new hour is still rolled up after the shortcut', { timeout: 10_000 }, async () => {
  const store = await UptimeStore.open(':memory:');
  after(() => store.close());
  const hour = Math.floor(NOW / HOUR) * HOUR;
  store.add({ slug: 'a', ts: hour - 10 * MIN, state: 'healthy', httpStatus: 200, latencyMs: 5 });
  assert.equal(store.rollup(NOW), 1);
  store.add({ slug: 'a', ts: hour + 5 * MIN, state: 'down', httpStatus: null, latencyMs: null });
  assert.equal(store.rollup(NOW + MIN), 0, 'same hour: nothing new is complete');
  assert.equal(store.rollup(NOW + HOUR), 1, 'the next hour: the one that just ended');
  const h = store.history('a', '7d', NOW + HOUR);
  assert.equal(h.buckets.reduce((n, b) => n + b.down, 0), 1);
});
