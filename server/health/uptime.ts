// Uptime storage (docs/04-apps-health-services.md, "Uptime storage"; Q-STORE, resolved in docs/09-decisions.md):
// state/health.sqlite through `node:sqlite`, which needs no dependency and no flag from Node 22.13
// (docs/11-research-notes.md). Raw samples are kept 48 hours; hourly rollups 90 days.
//
// Rules: uptime excludes `stopped` time (off on purpose is not downtime), and periods with no samples, when the daemon
// wasn't running, are "no data", never down.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Sample } from '../prober/index.js';

const HOUR = 3600_000;
export const SAMPLE_RETENTION_MS = 48 * HOUR;
export const ROLLUP_RETENTION_MS = 90 * 24 * HOUR;

export type Window = '24h' | '7d' | '90d';

/**
 * One bar of an uptime chart. `state` is the worst state seen in it (down > unhealthy > healthy > stopped), or
 * `nodata` when there were no samples: the daemon wasn't running, which is a gap, never down.
 */
export interface UptimeBucket {
  start: string;
  end: string;
  state: 'healthy' | 'unhealthy' | 'down' | 'stopped' | 'nodata';
  /** healthy / (samples − stopped), 0–1; null when every sample was `stopped`, or there were none. */
  uptime: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  samples: number;
  healthy: number;
  unhealthy: number;
  down: number;
  stopped: number;
}

/** An app's uptime chart and summary for one window (`GET /api/apps/:slug/history`). */
export interface UptimeHistory {
  window: Window;
  buckets: UptimeBucket[];
  /** Over the whole window, excluding `stopped` time; null with no data. */
  uptime: number | null;
  latency: { p50: number | null; p95: number | null; max: number | null };
}

/** Each window's bars: 24 h as 48 × 30 min (from samples); 7 d as 56 × 3 h and 90 d as 90 × 1 day (from rollups). */
export const WINDOWS: Record<Window, { bucketMs: number; count: number; source: 'samples' | 'rollups' }> = {
  '24h': { bucketMs: 30 * 60_000, count: 48, source: 'samples' },
  '7d': { bucketMs: 3 * HOUR, count: 56, source: 'rollups' },
  '90d': { bucketMs: 24 * HOUR, count: 90, source: 'rollups' },
};

/**
 * `node:sqlite`, loaded without its one-line "SQLite is an experimental feature" warning (Node 22 and 24 print it on
 * first load). Every other warning still goes through.
 */
export async function loadSqlite(): Promise<typeof import('node:sqlite')> {
  const emit = process.emitWarning;
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    const msg = typeof warning === 'string' ? warning : warning?.message;
    if (/SQLite is an experimental feature/i.test(String(msg))) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    return await import('node:sqlite');
  } catch (e) {
    // engines.node says >=22.13, but npm only warns about that
    throw new Error(`uptime history needs node:sqlite, which Node ${process.version} doesn't have without a flag: use Node 22.13 or later (${(e as Error).message})`);
  } finally {
    process.emitWarning = emit;
  }
}

/** The p-th percentile (0–100) of sorted numbers, nearest-rank. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

interface Counts {
  n: number;
  healthy: number;
  unhealthy: number;
  down: number;
  stopped: number;
}

interface RollupRow extends Counts {
  hour: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

const uptimeOf = (c: Counts) => (c.n - c.stopped > 0 ? c.healthy / (c.n - c.stopped) : null);
const worst = (c: Counts): UptimeBucket['state'] =>
  c.down ? 'down' : c.unhealthy ? 'unhealthy' : c.healthy ? 'healthy' : c.stopped ? 'stopped' : 'nodata';

/** A sample-weighted percentile over per-hour values: an approximation, since rollups don't keep raw latencies. */
function weighted(rows: { v: number | null; w: number }[], p: number): number | null {
  const xs = rows.filter((r) => r.v !== null && r.w > 0).sort((a, b) => a.v! - b.v!);
  const total = xs.reduce((s, r) => s + r.w, 0);
  if (!total) return null;
  let acc = 0;
  for (const r of xs) {
    acc += r.w;
    if (acc >= (p / 100) * total) return r.v;
  }
  return xs.at(-1)!.v;
}

export class UptimeStore {
  /**
   * Every hour before this one is rolled up. Samples are written as they're taken, so an hour never gains one after it
   * ends: `rollup` needn't look behind this again, and has nothing to do until the clock reaches a new hour. 0 until
   * the first rollup (which looks at everything once).
   */
  private rolledTo = 0;

  private constructor(private db: DatabaseSync) {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS samples (
        slug TEXT NOT NULL, ts INTEGER NOT NULL, state TEXT NOT NULL, http_status INTEGER, latency_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS samples_slug_ts ON samples (slug, ts);
      CREATE TABLE IF NOT EXISTS rollups (
        slug TEXT NOT NULL, hour INTEGER NOT NULL,
        n_samples INTEGER NOT NULL, n_healthy INTEGER NOT NULL, n_unhealthy INTEGER NOT NULL,
        n_down INTEGER NOT NULL, n_stopped INTEGER NOT NULL,
        latency_p50 INTEGER, latency_p95 INTEGER, latency_max INTEGER,
        PRIMARY KEY (slug, hour)
      );
    `);
  }

  /** Open (creating if need be) the store at `file`; `:memory:` for tests. */
  static async open(file: string): Promise<UptimeStore> {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const { DatabaseSync } = await loadSqlite();
    return new UptimeStore(new DatabaseSync(file));
  }

  close() {
    this.db.close();
  }

  add(s: Sample) {
    this.db
      .prepare('INSERT INTO samples (slug, ts, state, http_status, latency_ms) VALUES (?, ?, ?, ?, ?)')
      .run(s.slug, s.ts, s.state, s.httpStatus, s.latencyMs);
  }

  /** Counts and latency percentiles for one slug's samples in [from, to). */
  private aggregate(slug: string, from: number, to: number): Counts & { latencies: number[] } {
    const rows = this.db
      .prepare('SELECT state, latency_ms AS latency FROM samples WHERE slug = ? AND ts >= ? AND ts < ?')
      .all(slug, from, to) as { state: string; latency: number | null }[];
    const c = { n: rows.length, healthy: 0, unhealthy: 0, down: 0, stopped: 0, latencies: [] as number[] };
    for (const r of rows) {
      if (r.state in c) (c as unknown as Record<string, number>)[r.state]++;
      if (r.latency !== null) c.latencies.push(r.latency);
    }
    c.latencies.sort((a, b) => a - b);
    return c;
  }

  private hourRollup(slug: string, hour: number): RollupRow {
    const c = this.aggregate(slug, hour, hour + HOUR);
    return { hour, ...c, p50: percentile(c.latencies, 50), p95: percentile(c.latencies, 95), max: c.latencies.at(-1) ?? null };
  }

  /** Roll up every complete hour (before `now`'s hour) that has samples and no rollup yet. Idempotent. */
  rollup(now = Date.now()) {
    const current = Math.floor(now / HOUR) * HOUR;
    // every history() calls this: within an hour that's already rolled up it's free (D56)
    if (current <= this.rolledTo) return 0;
    const pending = this.db
      .prepare(
        `SELECT DISTINCT s.slug AS slug, (s.ts / ${HOUR}) * ${HOUR} AS hour FROM samples s
         WHERE s.ts >= ? AND s.ts < ? AND NOT EXISTS (SELECT 1 FROM rollups r WHERE r.slug = s.slug AND r.hour = (s.ts / ${HOUR}) * ${HOUR})`,
      )
      .all(this.rolledTo, current) as { slug: string; hour: number }[];
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO rollups (slug, hour, n_samples, n_healthy, n_unhealthy, n_down, n_stopped, latency_p50, latency_p95, latency_max)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { slug, hour } of pending) {
      const r = this.hourRollup(slug, hour);
      insert.run(slug, hour, r.n, r.healthy, r.unhealthy, r.down, r.stopped, r.p50, r.p95, r.max);
    }
    this.rolledTo = current;
    return pending.length;
  }

  /** Drop samples older than 48 h (rolling them up first) and rollups older than 90 days. */
  prune(now = Date.now()) {
    this.rollup(now);
    this.db.prepare('DELETE FROM samples WHERE ts < ?').run(now - SAMPLE_RETENTION_MS);
    this.db.prepare('DELETE FROM rollups WHERE hour < ?').run(now - ROLLUP_RETENTION_MS);
  }

  /** Forget an app entirely (it was removed). */
  forget(slug: string) {
    this.db.prepare('DELETE FROM samples WHERE slug = ?').run(slug);
    this.db.prepare('DELETE FROM rollups WHERE slug = ?').run(slug);
  }

  private rollupsBetween(slug: string, from: number, to: number): RollupRow[] {
    const rows = this.db
      .prepare(
        `SELECT hour, n_samples AS n, n_healthy AS healthy, n_unhealthy AS unhealthy, n_down AS down, n_stopped AS stopped,
                latency_p50 AS p50, latency_p95 AS p95, latency_max AS max
         FROM rollups WHERE slug = ? AND hour >= ? AND hour < ? ORDER BY hour`,
      )
      .all(slug, from, to) as unknown as RollupRow[];
    // the hour in progress isn't rolled up yet: compute it from the samples
    const current = Math.floor(to / HOUR) * HOUR;
    if (to > current && !rows.some((r) => r.hour === current)) {
      const r = this.hourRollup(slug, current);
      if (r.n) rows.push(r);
    }
    return rows;
  }

  /** Uptime and median latency over the last `ms` (default 24 h), straight from the samples: for app cards. */
  summary(slug: string, now = Date.now(), ms = 24 * HOUR): { uptime: number | null; latencyP50: number | null } {
    const c = this.aggregate(slug, now - ms, now + 1);
    return { uptime: uptimeOf(c), latencyP50: percentile(c.latencies, 50) };
  }

  /** The bars and summary for one app's uptime chart (`GET /api/apps/:slug/history`). */
  history(slug: string, window: Window, now = Date.now()): UptimeHistory {
    const w = WINDOWS[window];
    const end = Math.ceil((now + 1) / w.bucketMs) * w.bucketMs; // the bucket holding `now` is the last bar
    const start = end - w.count * w.bucketMs;
    const buckets: UptimeBucket[] = [];
    const bar = (from: number, c: Counts, p50: number | null, p95: number | null): UptimeBucket => ({
      start: new Date(from).toISOString(),
      end: new Date(from + w.bucketMs).toISOString(),
      state: worst(c),
      uptime: uptimeOf(c),
      latencyP50: p50,
      latencyP95: p95,
      samples: c.n,
      healthy: c.healthy,
      unhealthy: c.unhealthy,
      down: c.down,
      stopped: c.stopped,
    });
    const zero = (): Counts => ({ n: 0, healthy: 0, unhealthy: 0, down: 0, stopped: 0 });
    const total = zero();
    let p50: number | null;
    let p95: number | null;
    let max: number | null;

    if (w.source === 'samples') {
      this.rollup(now);
      const all = this.aggregate(slug, start, end);
      for (let from = start; from < end; from += w.bucketMs) {
        const c = this.aggregate(slug, from, from + w.bucketMs);
        buckets.push(bar(from, c, percentile(c.latencies, 50), percentile(c.latencies, 95)));
      }
      Object.assign(total, all);
      p50 = percentile(all.latencies, 50);
      p95 = percentile(all.latencies, 95);
      max = all.latencies.at(-1) ?? null;
    } else {
      this.rollup(now);
      const rows = this.rollupsBetween(slug, start, Math.min(end, now + 1));
      // rows are in hour order: one pass hands each bar its own (not 90 filters over up to 2,160 rows)
      let i = 0;
      for (let from = start; from < end; from += w.bucketMs) {
        while (i < rows.length && rows[i]!.hour < from) i++;
        const first = i;
        while (i < rows.length && rows[i]!.hour < from + w.bucketMs) i++;
        const inBar = rows.slice(first, i);
        const c = zero();
        for (const r of inBar) for (const k of ['n', 'healthy', 'unhealthy', 'down', 'stopped'] as const) c[k] += r[k];
        buckets.push(bar(from, c, weighted(inBar.map((r) => ({ v: r.p50, w: r.n })), 50), weighted(inBar.map((r) => ({ v: r.p95, w: r.n })), 95)));
      }
      for (const r of rows) for (const k of ['n', 'healthy', 'unhealthy', 'down', 'stopped'] as const) total[k] += r[k];
      p50 = weighted(rows.map((r) => ({ v: r.p50, w: r.n })), 50);
      p95 = weighted(rows.map((r) => ({ v: r.p95, w: r.n })), 95);
      max = rows.reduce<number | null>((m, r) => (r.max === null ? m : Math.max(m ?? 0, r.max)), null);
    }
    return { window, buckets, uptime: uptimeOf(total), latency: { p50, p95, max } };
  }
}
