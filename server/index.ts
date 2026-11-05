import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { agentRoutes, apiRoutes } from './api.js';
import { BusyTracker, busyCounts, type BusyKind } from './busy.js';
import { VERSION, WEB_DIST } from './config.js';
import { removeRuntimeFile, writeRuntimeFile } from './contract/runtime-file.js';
import { bus as defaultBus, type EventBus } from './events.js';
import { providers as defaultProviders, type ProviderRegistry } from './providers.js';
import { mcpEndpoint, type McpEndpoint } from './mcp/index.js';
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
  /** The MCP endpoint (server/mcp/); default: one made for this app. */
  mcp?: McpEndpoint;
  /** The app operations in flight, for /api/busy and a stopping daemon (default: one for this app). */
  busy?: BusyTracker;
  /** True once the daemon is stopping: every new request is answered 503 (D77). */
  stopping?: () => boolean;
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
export function createApp({ store, bus = store.bus ?? defaultBus, providers = defaultProviders, webDist = WEB_DIST, extraHosts = [], startedAt = new Date(), services, mcp, busy, stopping }: AppOptions) {
  const app = new Hono();
  app.use('*', localOnly(() => allowedHosts(store, extraHosts)));
  // a stopping daemon finishes what it's doing and starts nothing new (D77)
  if (stopping)
    app.use('*', async (c, next) => {
      if (!stopping()) return next();
      c.header('Connection', 'close');
      return c.json({ error: 'Hallway is stopping.' }, 503);
    });

  const endpoint = mcp ?? mcpEndpoint({ store, bus, providers, startedAt });
  app.all('/mcp', (c) => endpoint.handle(c));

  app.route('/api', apiRoutes({ store, bus, providers, startedAt, services, busy }));
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
  /** Watch the data home, take hourly snapshots, rotate service logs and write `<home>/runtime.json` (default true). */
  watch?: boolean;
  /** Find and cache favicons for app and bookmark thumbnails (default true). */
  thumbs?: boolean;
}

/** The host for runtime.json's URL: loopback, unless the development-only HALLWAY_DEV_BIND names one address. */
function urlHost(hostname: string): string {
  if (hostname === '0.0.0.0' || hostname === '::' || hostname === '127.0.0.1') return '127.0.0.1';
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

/**
 * Serve the dashboard and API on `hostname`:`port`, with the data home loaded, watched and backed up. Resolves with
 * the bound port (useful with port 0), the store, and a function that stops it all; rejects if it can't bind
 * (EADDRINUSE, EACCES), for the CLI to explain.
 */
export async function startServer(port: number, { hostname = '127.0.0.1', home, watch = true, thumbs = true, store: given, ...opts }: ServerOptions) {
  const store = given ?? new Store(home, { bus: opts.bus ?? defaultBus }).init();
  const providers = opts.providers ?? defaultProviders;
  const busy = opts.busy ?? new BusyTracker();
  let stopping = false;
  const mcp = mcpEndpoint({ store, bus: opts.bus ?? store.bus ?? defaultBus, providers, startedAt: opts.startedAt ?? new Date() });
  const app = createApp({ ...opts, store, mcp, busy, stopping: () => stopping });
  const thumbnailer = thumbs ? startThumbs({ store, bus: opts.bus ?? store.bus ?? defaultBus, providers: opts.providers ?? defaultProviders }) : null;
  const { port: bound, close: closeHttp, refuse } = await new Promise<{ port: number; close: () => Promise<void>; refuse: () => void }>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      server.off('error', reject);
      let closed: Promise<void> | null = null;
      // no new connections, and idle keep-alive ones closed; requests under way still get their answers
      const refuse = () => {
        closed ??= new Promise<void>((res) => server.close(() => res()));
        if ('closeIdleConnections' in server) server.closeIdleConnections();
        return closed;
      };
      const close = () => {
        const done = refuse();
        // open event streams, and anything else still open, would otherwise hold close() open
        if ('closeAllConnections' in server) server.closeAllConnections();
        return done;
      };
      resolve({ port: info.port, close, refuse });
    });
    server.once('error', reject);
  });
  const watcher = watch ? startWatcher(store) : null;
  const stopSnapshots = watch ? startSnapshots(home) : () => {};
  const stopRotation = watch ? startLogRotation(store) : () => {};
  await watcher?.ready;
  // where the CLI finds this daemon: `busy` only here, the other commands when config.yaml's port doesn't say (D46, D75)
  if (watch) {
    try {
      writeRuntimeFile(home, { pid: process.pid, port: bound, url: `http://${urlHost(hostname)}:${bound}`, version: VERSION });
    } catch {
      /* best effort: the CLI still finds a daemon on config.yaml's port */
    }
  }
  const close = async () => {
    if (watch) removeRuntimeFile(home);
    thumbnailer?.stop();
    await mcp.close();
    stopSnapshots();
    stopRotation();
    await watcher?.close();
    await closeHttp();
  };
  return {
    port: bound,
    store,
    busy,
    close,
    /**
     * Stop the way SIGTERM asks (the CLI contract's §8, D77): refuse new connections and answer 503 to any new request,
     * wait up to `timeoutMs` for the work /api/busy counts (the local-domains setup, app operations) to finish, then
     * close everything and remove runtime.json. Resolves with what was still under way when it gave up (all zero when
     * it finished), so the caller can record it. `waiting` is called once, if there's anything to wait for.
     */
    drain: async (timeoutMs: number, waiting?: (counts: Record<BusyKind, number>) => void): Promise<Record<BusyKind, number>> => {
      stopping = true;
      refuse();
      const total = (c: Record<BusyKind, number>) => Object.values(c).reduce((a, b) => a + b, 0);
      let counts = busyCounts(busy, providers);
      if (total(counts) > 0) {
        waiting?.(counts);
        const until = Date.now() + timeoutMs;
        while (total(counts) > 0 && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 100));
          counts = busyCounts(busy, providers);
        }
        // the answer to the request that just finished, written before its connection is closed
        await new Promise((r) => setTimeout(r, 50));
      }
      await close();
      return counts;
    },
  };
}
