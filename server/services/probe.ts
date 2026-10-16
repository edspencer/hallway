// One health check of each app, for `hallway status` without a daemon ("works without the daemon: reads files,
// probes once", docs/07-cli.md): the prober's own probe and classification (server/prober/), without its flap damping
// or history, which need the daemon.
import type { AppConfig, AppHealth } from '../../shared/api.js';
import { probe } from '../prober/probe.js';
import { classify } from '../prober/state.js';

export async function probeOnce(slug: string, app: AppConfig, timeoutMs = 3000): Promise<Partial<AppHealth>> {
  const r = await probe(
    { slug, port: app.port, host: app.host, expected: app.expected, ...(app.health ? { health: { path: app.health.path, ...(app.health.expectStatus === null ? {} : { expectStatus: app.health.expectStatus }) } } : {}) },
    { timeoutMs },
  );
  const c = classify(r.outcome, app.expected, false);
  return {
    state: c === 'starting' ? 'unknown' : c,
    checkedAt: new Date().toISOString(),
    httpStatus: r.httpStatus,
    latencyMs: r.latencyMs,
    detail: r.outcome === 'healthy' ? null : r.outcome === 'not-listening' ? `not listening${r.error ? ` (${r.error})` : ''}` : (r.error ?? (r.httpStatus !== null ? `HTTP ${r.httpStatus}` : null)),
  };
}
