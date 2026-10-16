// Caddy's admin API, over the Unix socket in the data home (D46): load a config, read the running one, ask whether
// it's there at all. Used by the daemon (pushing on every change) and by `hallway doctor` and `hallway setup`.
import http from 'node:http';

export interface AdminResponse {
  status: number;
  body: string;
}

export class CaddyUnreachable extends Error {
  constructor(
    public socket: string,
    public code: string | undefined,
  ) {
    super(code === 'ENOENT' || code === 'ECONNREFUSED' ? `Caddy isn't running (nothing on ${socket})` : `can't reach Caddy's admin API on ${socket}: ${code ?? 'error'}`);
  }
}

export function adminRequest(socket: string, method: string, path: string, body?: string, timeoutMs = 10_000): Promise<AdminResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: socket, method, path, headers: body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', (e: NodeJS.ErrnoException) => reject(new CaddyUnreachable(socket, e.code)));
    req.end(body);
  });
}

/** Replace Caddy's whole config. Throws CaddyUnreachable, or an Error with Caddy's message if it refused the config. */
export async function loadConfig(socket: string, text: string): Promise<void> {
  const r = await adminRequest(socket, 'POST', '/load', text);
  if (r.status !== 200) throw new Error(`Caddy refused the config (HTTP ${r.status}): ${caddyError(r.body)}`);
}

/** Caddy's running config, or null if it has none. Throws CaddyUnreachable. */
export async function runningConfig(socket: string): Promise<unknown> {
  const r = await adminRequest(socket, 'GET', '/config/');
  if (r.status !== 200) throw new Error(`Caddy's admin API answered HTTP ${r.status}: ${caddyError(r.body)}`);
  return JSON.parse(r.body);
}

function caddyError(body: string) {
  try {
    return (JSON.parse(body) as { error?: string }).error ?? body.trim();
  } catch {
    return body.trim();
  }
}

/** Same config? Key order doesn't matter (Caddy returns its own). */
export function sameConfig(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
