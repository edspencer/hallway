import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { agentRoutes, apiRoutes } from './api.js';
import { WEB_DIST } from './config.js';
import { bus as defaultBus, type EventBus } from './events.js';
import { providers as defaultProviders, type ProviderRegistry } from './providers.js';
import { localOnly } from './security.js';
import { startLogRotation } from './services/rotate.js';
import { startSnapshots } from './store/backups.js';
import type { Services } from './services/index.js';
import { Store } from './store/index.js';
import { startThumbs } from './thumbs/index.js';
import { startWatcher } from './watcher.js';

export interface AppOptions {
  /** The data home's store (server/store/). */
  store: Store;
  /** Defaults to the store's bus (server/events.ts) and the daemon's provider registry (server/providers.ts). */
  bus?: EventBus;
  providers?: ProviderRegistry;
  /** The built dashboard to serve (dist/web). Null: API only, as under `npm run dev`, where Vite serves the UI. */
  webDist?: string | null;
  /** Hostnames accepted besides loopback (security.ts): the development-only HALLWAY_DEV_ALLOWED_HOSTS. */
  extraHosts?: readonly string[];
  startedAt?: Date;
  /** Managed services for the start/stop/restart routes (default: created on first use). */
  services?: () => Services;
}

/**
 * The hostnames the security middleware accepts besides loopback: the configured dashboard host in fronted mode
 * (read on every request, so a config.yaml edit applies at once), plus any development overrides.
 */
export function allowedHosts(store: Store, extra: readonly string[] = []): string[] {
  const cfg = store.currentConfig();
  return cfg.mode === 'fronted' ? [...extra, cfg.domain.dashboard.toLowerCase()] : [...extra];
}

/**
 * The daemon's HTTP app: the JSON API under /api, the agent documents, and the dashboard (a single-page app) for
 * everything else.
 */
export function createApp({ store, bus = store.bus ?? defaultBus, providers = defaultProviders, webDist = WEB_DIST, extraHosts = [], startedAt = new Date(), services }: AppOptions) {
  const app = new Hono();
  app.use('*', localOnly(() => allowedHosts(store, extraHosts)));

  app.route('/api', apiRoutes({ store, bus, providers, startedAt, services }));
  app.route('/', agentRoutes({ store, providers }));

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

export interface ServerOptions extends Omit<AppOptions, 'store'> {
  /** The address to bind. Always 127.0.0.1, except under the development-only HALLWAY_DEV_BIND (config.ts). */
  hostname?: string;
  /** The data home. Its layout is created where missing, then it's read, watched and backed up. */
  home: string;
  /** An already-loaded store for `home` (the CLI reads config.yaml's port first). */
  store?: Store;
  /** Watch the data home, take hourly snapshots and rotate service logs (default true). */
  watch?: boolean;
  /** Find and cache favicons for app and bookmark thumbnails (default true). */
  thumbs?: boolean;
}

/**
 * Serve the dashboard and API on `hostname`:`port`, with the data home loaded, watched and backed up. Resolves with
 * the bound port (useful with port 0), the store, and a function that stops it all; rejects if it can't bind
 * (EADDRINUSE, EACCES), for the CLI to explain.
 */
export async function startServer(port: number, { hostname = '127.0.0.1', home, watch = true, thumbs = true, store: given, ...opts }: ServerOptions) {
  const store = given ?? new Store(home, { bus: opts.bus ?? defaultBus }).init();
  const app = createApp({ ...opts, store });
  const thumbnailer = thumbs ? startThumbs({ store, bus: opts.bus ?? store.bus ?? defaultBus, providers: opts.providers ?? defaultProviders }) : null;
  const { port: bound, close: closeHttp } = await new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      server.off('error', reject);
      const close = () =>
        new Promise<void>((res) => {
          server.close(() => res());
          // idle keep-alive connections and open event streams would otherwise hold close() open
          if ('closeAllConnections' in server) server.closeAllConnections();
        });
      resolve({ port: info.port, close });
    });
    server.once('error', reject);
  });
  const watcher = watch ? startWatcher(store) : null;
  const stopSnapshots = watch ? startSnapshots(home) : () => {};
  const stopRotation = watch ? startLogRotation(store) : () => {};
  await watcher?.ready;
  return {
    port: bound,
    store,
    close: async () => {
      thumbnailer?.stop();
      stopSnapshots();
      stopRotation();
      await watcher?.close();
      await closeHttp();
    },
  };
}
