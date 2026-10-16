import type { HealthResponse } from '../shared/api';

/** The daemon's own health. Rejects if the daemon can't be reached or answers with an error. */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api/health: ${res.status}`);
  return res.json();
}
