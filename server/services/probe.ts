// One health check of one app, for `hallway status` without a daemon ("works without the daemon: reads files,
// probes once", docs/07-cli.md). The daemon's prober (server/prober/) does the real, repeated job.
import type { AppConfig, AppHealth } from '../../shared/api.js';
import { isListening } from './ports.js';

export async function probeOnce(app: AppConfig, timeoutMs = 2000): Promise<Partial<AppHealth>> {
  const host = app.host === '0.0.0.0' || app.host === '*' ? '127.0.0.1' : app.host === '::' ? '::1' : app.host;
  const checkedAt = new Date().toISOString();
  if (!(await isListening(app.port, host, 1000))) {
    const state = app.expected === 'running' ? 'down' : 'stopped';
    return { state, checkedAt, detail: 'not listening' };
  }
  const t0 = Date.now();
  try {
    const url = `http://${host.includes(':') ? `[${host}]` : host}:${app.port}${app.health?.path ?? '/'}`;
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    res.body?.cancel().catch(() => {});
    const ok = app.health ? (app.health.expectStatus ? res.status === app.health.expectStatus : res.status >= 200 && res.status < 300) : res.status < 500;
    return { state: ok ? 'healthy' : 'unhealthy', checkedAt, httpStatus: res.status, latencyMs: Date.now() - t0, detail: ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { state: 'unhealthy', checkedAt, detail: `no HTTP answer (${(e as Error).name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : (e as Error).message})` };
  }
}
