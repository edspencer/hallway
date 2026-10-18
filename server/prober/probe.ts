// One probe of one app (docs/04-apps-health-services.md, "Probing"): TCP connect, then the health path if there is
// one, else `GET /`. GET, never HEAD (some dev servers mishandle HEAD); no redirect-following; the body is abandoned
// once the headers arrive, and latency is the time to them. `Host` is the upstream, so apps with Host checks answer
// normally. A loopback host is tried on 127.0.0.1 and on ::1, the configured family first, and the HTTP request goes
// to whichever accepted the connection (D68).
import http from 'node:http';
import net from 'node:net';
import { VERSION } from '../config.js';
import { candidates } from '../loopback.js';

export type Expected = 'running' | 'stopped' | 'adhoc';

/** What the prober needs to know about an app: the subset of `apps/<slug>.yaml` (or a discovered app) it uses. */
export interface ProbeTarget {
  slug: string;
  port: number;
  /** Default 127.0.0.1. A loopback or wildcard host means 127.0.0.1 or ::1, whichever answers. */
  host?: string;
  expected: Expected;
  health?: { path: string; expectStatus?: number | number[] };
}

/** What a probe found, before flap damping. `not-listening` becomes down, stopped or starting depending on `expected`. */
export type ProbeOutcome = 'healthy' | 'unhealthy' | 'not-listening';

export interface ProbeResult {
  outcome: ProbeOutcome;
  /** Null if nothing answered HTTP (refused, or timed out). */
  httpStatus: number | null;
  /** Milliseconds to the response headers (or to the TCP connect, if HTTP never answered). Null if not listening. */
  latencyMs: number | null;
  /** Why it was unhealthy or not listening, for the card's tooltip. */
  error?: string;
  /** The address that accepted the connection (`127.0.0.1`, `::1`); absent if nothing did. */
  address?: string;
}

export interface ProbeOptions {
  connectTimeoutMs?: number;
  /** `probe.timeoutMs`, default 5 s. */
  timeoutMs?: number;
}

/** `[::1]` for IPv6 in a Host header or URL. */
const hostLiteral = (h: string) => (h.includes(':') ? `[${h}]` : h);

function connect(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean, error?: string) => {
      sock.destroy();
      resolve({ ok, ms: Math.round(performance.now() - t0), error });
    };
    sock.setTimeout(timeoutMs, () => done(false, 'connect timed out'));
    sock.once('connect', () => done(true));
    sock.once('error', (e: NodeJS.ErrnoException) => done(false, e.code ?? e.message));
  });
}

function get(host: string, port: number, path: string, timeoutMs: number): Promise<{ status: number | null; ms: number; error?: string }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (status: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy(); // abandon the body: the status is all we need
      resolve({ status, ms: Math.round(performance.now() - t0), error });
    };
    const req = http.request({
      method: 'GET',
      host,
      port,
      path,
      agent: false,
      headers: { host: `${hostLiteral(host)}:${port}`, 'user-agent': `hallway/${VERSION}`, accept: '*/*' },
    });
    const timer = setTimeout(() => done(null, `no response in ${timeoutMs} ms`), timeoutMs);
    req.once('response', (res) => done(res.statusCode ?? null));
    req.once('error', (e: NodeJS.ErrnoException) => done(null, e.code ?? e.message));
    req.end();
  });
}

/** Whether a status passes: `expectStatus` if given, else any 2xx for a health path, else anything below 500. */
export function statusIsHealthy(status: number, health?: ProbeTarget['health']): boolean {
  if (!health?.path) return status < 500; // 3xx, 401 and 403 count: an app behind a login redirect is up
  const want = health.expectStatus;
  if (want === undefined) return status >= 200 && status < 300;
  return Array.isArray(want) ? want.includes(status) : status === want;
}

export async function probe(t: ProbeTarget, { connectTimeoutMs = 1000, timeoutMs = 5000 }: ProbeOptions = {}): Promise<ProbeResult> {
  // the first address that accepts; if none does, the preferred one's error is the one people see
  let host: string | null = null;
  let error: string | undefined;
  for (const a of candidates(t.host ?? '127.0.0.1')) {
    const tcp = await connect(a, t.port, connectTimeoutMs);
    if (tcp.ok) {
      host = a;
      break;
    }
    error ??= tcp.error;
  }
  if (!host) return { outcome: 'not-listening', httpStatus: null, latencyMs: null, error };
  const path = t.health?.path || '/';
  const res = await get(host, t.port, path.startsWith('/') ? path : `/${path}`, timeoutMs);
  if (res.status === null) return { outcome: 'unhealthy', httpStatus: null, latencyMs: res.ms, error: res.error, address: host };
  const ok = statusIsHealthy(res.status, t.health);
  return {
    outcome: ok ? 'healthy' : 'unhealthy',
    httpStatus: res.status,
    latencyMs: res.ms,
    ...(ok ? {} : { error: `${path} answered ${res.status}` }),
    address: host,
  };
}
