// Types shared by the daemon (server/) and the dashboard (src/). Keep this file free of imports and of anything that
// needs Node or the DOM: it's compiled by both tsconfigs.

/** `GET /api/health`: the daemon's own health (docs/02-architecture.md, "HTTP API"). */
export interface HealthResponse {
  ok: true;
  version: string;
}

/** An app's health classification (docs/04-apps-health-services.md, "Health states"; D12). */
export type AppState = 'healthy' | 'unhealthy' | 'down' | 'stopped' | 'unknown';

/** Where an app came from (D11). */
export type AppSource = 'declared' | 'discovered' | 'observed';
