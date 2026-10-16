// What the API returns: the store's files merged with the providers' live data (shared/api.ts). Kept apart from the
// routes so the CLI (`hallway status`, later) can build the same views without HTTP.
import os from 'node:os';
import type {
  AppHealth,
  AppView,
  BookmarkGroupView,
  ConfigView,
  DaemonInfo,
  DiscoveredApp,
  FileProblem,
  HallwayConfig,
  StateResponse,
} from '../shared/api.js';
import { VERSION, tildify } from './config.js';
import type { ProviderRegistry } from './providers.js';
import type { Entry, Store } from './store/index.js';

export const UNKNOWN_HEALTH: AppHealth = Object.freeze({
  state: 'unknown',
  since: null,
  checkedAt: null,
  httpStatus: null,
  latencyMs: null,
  detail: null,
  uptime24h: null,
  latencyP50: null,
}) as AppHealth;

/** Where to open an app: `http://localhost:<port>` (direct), or `https://<slug>.<base>` (fronted). */
export function appUrl(slug: string, port: number, host: string, cfg: HallwayConfig): string {
  if (cfg.mode === 'fronted') return `https://${slug}.${cfg.domain.base}`;
  const h = host.toLowerCase();
  const shown = ['127.0.0.1', 'localhost', '0.0.0.0', '::', '*'].includes(h) ? 'localhost' : h === '::1' || h.includes(':') ? `[${h.replace(/^\[|\]$/g, '')}]` : h;
  return `http://${shown}:${port}`;
}

export interface ViewContext {
  store: Store;
  providers: ProviderRegistry;
}

/** A declared app, from its file and the providers. `withHistory`: include the last 24 h (one app, or /api/state). */
export function declaredView({ store, providers }: ViewContext, slug: string, withHistory = true): AppView | null {
  const e = store.apps.get(slug);
  if (!e) return null;
  const cfg = store.currentConfig();
  const c = e.value;
  return {
    slug,
    source: 'declared',
    adapter: null,
    name: c?.name ?? slug,
    url: c ? appUrl(slug, c.port, c.host, cfg) : null,
    config: c,
    etag: e.etag,
    file: e.file,
    path: e.path,
    problems: store.appProblems(slug),
    managed: !!c?.service,
    health: providers.first('appHealth', slug) ?? UNKNOWN_HEALTH,
    history: withHistory ? providers.first('appHistory', slug, '24h') : null,
    identity: c ? providers.first('appIdentity', { slug, port: c.port, host: c.host }) : null,
  };
}

export function discoveredView({ store, providers }: ViewContext, d: DiscoveredApp, withHistory = true): AppView {
  return {
    slug: d.slug,
    source: 'discovered',
    adapter: d.adapter,
    name: d.name,
    url: d.url ?? appUrl(d.slug, d.port, d.host, store.currentConfig()),
    config: null,
    etag: null,
    file: null,
    path: null,
    problems: [],
    managed: false,
    health: providers.first('appHealth', d.slug) ?? UNKNOWN_HEALTH,
    history: withHistory ? providers.first('appHistory', d.slug, '24h') : null,
    identity: providers.first('appIdentity', { slug: d.slug, port: d.port, host: d.host }),
  };
}

/** Declared apps, then discovered ones whose slug isn't declared, each sorted by name. */
export function appViews(ctx: ViewContext, withHistory = true): AppView[] {
  const byName = (a: AppView, b: AppView) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
  const declared = [...ctx.store.apps.keys()].map((s) => declaredView(ctx, s, withHistory)!).sort(byName);
  const taken = new Set(declared.map((a) => a.slug));
  const discovered = ctx.providers
    .all('discovered')
    .filter((d) => !taken.has(d.slug) && (taken.add(d.slug), true))
    .map((d) => discoveredView(ctx, d, withHistory))
    .sort(byName);
  return [...declared, ...discovered];
}

/** One app by slug: declared first, then discovered. */
export function appView(ctx: ViewContext, slug: string): AppView | null {
  const declared = declaredView(ctx, slug);
  if (declared) return declared;
  const d = ctx.providers.all('discovered').find((x) => x.slug === slug);
  return d ? discoveredView(ctx, d) : null;
}

export function groupView(e: Entry<import('../shared/api.js').BookmarkGroupConfig>): BookmarkGroupView {
  return { group: e.name, config: e.value, etag: e.etag, file: e.file, path: e.path, problems: e.problems };
}

/** Bookmark groups by `order`, then title (a never-valid group sorts last, by name). */
export function groupViews(store: Store): BookmarkGroupView[] {
  const key = (g: BookmarkGroupView) => [g.config?.order ?? Number.MAX_SAFE_INTEGER, g.config?.title ?? g.group] as const;
  return [...store.groups.values()].map(groupView).sort((a, b) => {
    const [oa, ta] = key(a);
    const [ob, tb] = key(b);
    return oa - ob || ta.localeCompare(tb) || a.group.localeCompare(b.group);
  });
}

export function configView(store: Store): ConfigView {
  const e = store.config;
  return { config: store.currentConfig(), etag: e.etag, file: e.file, path: e.path, problems: e.problems };
}

export function daemonInfo(ctx: ViewContext, url: string, startedAt: Date): DaemonInfo {
  return {
    version: VERSION,
    url,
    dataHome: ctx.store.home,
    dataHomeDisplay: tildify(ctx.store.home),
    startedAt: startedAt.toISOString(),
    platform: os.platform(),
    providers: {
      health: ctx.providers.has('appHealth'),
      history: ctx.providers.has('appHistory'),
      scanner: ctx.providers.has('observed') || ctx.providers.has('scan'),
      discovery: ctx.providers.has('discovered'),
    },
  };
}

export function stateView(ctx: ViewContext, url: string, startedAt: Date): StateResponse {
  const problems: FileProblem[] = ctx.store.allProblems();
  return {
    daemon: daemonInfo(ctx, url, startedAt),
    config: configView(ctx.store),
    apps: appViews(ctx),
    bookmarks: groupViews(ctx.store),
    observed: ctx.providers.all('observed'),
    ignore: ctx.store.currentIgnore(),
    problems,
  };
}
