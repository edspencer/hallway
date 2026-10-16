// The CLI's side of the HTTP API: commands that are richer with live data (`status`, `scan`, `claim`, `ignore`,
// `app ls`, `doctor`) ask a running daemon, and fall back to the files when there isn't one. The daemon is looked for
// on config.yaml's `port:` (default 4255), not on $PORT: in an agent's or a developer's shell, $PORT is usually some
// app's port (D44).
import type { ErrorResponse, HealthResponse } from '../shared/api.js';

export class DaemonError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface Daemon {
  url: string;
  version: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

async function call<T>(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new DaemonError((body as ErrorResponse | null)?.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

/** The Hallway daemon on 127.0.0.1:`port`, or null if nothing (or something else) answers there. */
export async function findDaemon(port: number, timeoutMs = 1000): Promise<Daemon | null> {
  const url = `http://localhost:${port}`;
  const base = `http://127.0.0.1:${port}`;
  let health: HealthResponse;
  try {
    health = await call<HealthResponse>(`${base}/api/health`, {}, timeoutMs);
  } catch {
    return null;
  }
  if (!health || health.ok !== true || typeof health.version !== 'string') return null;
  return {
    url,
    version: health.version,
    get: (p) => call(`${base}${p}`),
    post: (p, body) => call(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  };
}
