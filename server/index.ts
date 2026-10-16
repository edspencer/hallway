import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { HealthResponse } from '../shared/api.js';
import { VERSION, WEB_DIST } from './config.js';
import { localOnly } from './security.js';

export interface AppOptions {
  /** The built dashboard to serve (dist/web). Null: API only, as under `npm run dev`, where Vite serves the UI. */
  webDist?: string | null;
  /** Hostnames accepted besides loopback (security.ts). */
  extraHosts?: readonly string[];
}

/** The daemon's HTTP app: the JSON API under /api, and the dashboard (a single-page app) for everything else. */
export function createApp({ webDist = WEB_DIST, extraHosts = [] }: AppOptions = {}) {
  const app = new Hono();
  app.use('*', localOnly(extraHosts));

  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION } satisfies HealthResponse));
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  if (webDist) {
    // Vite's hashed bundles, the favicon and anything else in dist/web; then index.html for every other path, so the
    // dashboard's client-side routes survive a reload.
    if (fs.existsSync(webDist)) app.use('*', serveStatic({ root: webDist }));
    app.get('*', (c) => {
      const index = path.join(webDist, 'index.html');
      if (!fs.existsSync(index)) return c.text('The dashboard is not built. Run `npm run build` (or `npm start`).', 500);
      c.header('Cache-Control', 'no-cache');
      return c.html(fs.readFileSync(index, 'utf8'));
    });
  }
  return app;
}

export interface ServerOptions extends AppOptions {
  /** The address to bind. Always 127.0.0.1, except under the development-only HALLWAY_DEV_BIND (config.ts). */
  hostname?: string;
}

/**
 * Serve the dashboard and API on `hostname`:`port`. Resolves with the bound port (useful with port 0) and a function
 * that stops the server; rejects if it can't bind (EADDRINUSE, EACCES), for the CLI to explain.
 */
export function startServer(port: number, { hostname = '127.0.0.1', ...opts }: ServerOptions = {}) {
  const app = createApp(opts);
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      server.off('error', reject);
      const close = () =>
        new Promise<void>((res) => {
          server.close(() => res());
          // idle keep-alive connections would otherwise hold close() open
          if ('closeAllConnections' in server) server.closeAllConnections();
        });
      resolve({ port: info.port, close });
    });
    server.once('error', reject);
  });
}
