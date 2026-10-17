// The JSON API (docs/02-architecture.md, "HTTP API"), the SSE stream, and the agent-facing documents. Every route is
// behind the security middleware (server/security.ts). Writes go through the store (server/store/), the one writer;
// live data comes from the providers (server/providers.ts).
import { Hono, type Context } from 'hono';
import type {
  AppsResponse,
  BookmarksResponse,
  ClaimRequest,
  ErrorResponse,
  FrontingResponse,
  HistoryWindow,
  IgnoreRequest,
  LostActionRequest,
  LostResponse,
  ObservedListener,
  ObservedResponse,
} from '../shared/api.js';
import { VERSION, tildify } from './config.js';
import { sseHandler, type EventBus } from './events.js';
import { agentGuide, llmsFullTxt, llmsTxt, readGuide, type GuideInput } from './guide.js';
import type { ProviderRegistry } from './providers.js';
import { ServiceManagerError } from './platform/index.js';
import { dismissLost, reviveLost } from './lost/actions.js';
import { lostSummary } from './lost/index.js';
import { ServiceError, Services } from './services/index.js';
import { appLogs } from './services/logs.js';
import { ResolveError } from './services/resolve.js';
import { ConflictError, NotFoundError, SLUG, ValidationError, type Entry, type Store, type WriteOptions } from './store/index.js';
import { publicUrl } from './proxy/names.js';
import { appView, appViews, configView, declaredView, groupView, groupViews, stateView } from './views.js';

export interface ApiOptions {
  store: Store;
  bus: EventBus;
  providers: ProviderRegistry;
  startedAt: Date;
  /** Managed services (start/stop/restart). Created on first use; tests pass one with a mocked runner. */
  services?: () => Services;
}

const WINDOWS: HistoryWindow[] = ['24h', '7d', '90d'];

/**
 * The URL the client reached us on. The security middleware has checked the Host; behind a TLS-terminating proxy
 * (Caddy in fronted mode, or a development proxy) the scheme comes from X-Forwarded-Proto.
 */
export const baseUrl = (c: Context) => `${c.req.header('x-forwarded-proto') === 'https' ? 'https' : 'http'}://${c.req.header('host') ?? 'localhost'}`;

const fail = (c: Context, status: 400 | 404 | 409 | 501 | 503, body: ErrorResponse) => c.json(body, status);

/** Map the store's errors to status codes; anything else is a 500 with its message. */
function handle(c: Context, e: unknown) {
  if (e instanceof ValidationError) return fail(c, 400, { error: e.message, issues: e.issues });
  if (e instanceof NotFoundError) return fail(c, 404, { error: e.message });
  if (e instanceof ConflictError) return fail(c, 409, { error: e.message, etag: e.etag });
  if (e instanceof ServiceError || e instanceof ResolveError) return fail(c, 409, { error: e.message });
  if (e instanceof ServiceManagerError) return fail(c, 503, { error: e.message });
  process.stderr.write(`hallway: ${c.req.method} ${c.req.path}: ${(e as Error).stack ?? e}\n`);
  return c.json({ error: (e as Error).message ?? 'internal error' } satisfies ErrorResponse, 500);
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('the body is not valid JSON');
  }
}

/** If-Match / If-None-Match: * from the request. */
const writeOpts = (c: Context): WriteOptions => ({ ifMatch: c.req.header('if-match') ?? null, createOnly: c.req.header('if-none-match')?.trim() === '*' });

/**
 * An icon or thumbnail, with its ETag. Some are SVGs fetched from other sites, so they're served as inert images: no
 * scripts, no styles from elsewhere, no sniffing, even when opened directly rather than through an `<img>`.
 */
function image(c: Context, t: { body: Uint8Array; contentType: string; etag: string }) {
  c.header('ETag', t.etag);
  c.header('Cache-Control', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  if (c.req.header('if-none-match') === t.etag) return c.body(null, 304);
  return c.body(t.body as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': t.contentType });
}

const withEtag = (c: Context, e: Entry<unknown>) => {
  if (e.etag) c.header('ETag', e.etag);
};

/** A claimed app's file: the observation's facts, and its command as a commented-out `service:` block. */
export function claimFile(o: ObservedListener, req: ClaimRequest) {
  const id = o.identity;
  const dir = id.projectDir ?? id.cwd;
  const value: Record<string, unknown> = {
    // `repo @ branch` for a worktree sibling, so two checkouts of one app don't both claim its package name
    name: req.name?.trim() || id.label || id.name || req.slug,
    ...(id.description ? { description: id.description } : {}),
    port: o.port,
    // listening on IPv6 loopback only: the default host (127.0.0.1) wouldn't reach it
    ...(id.bindAddress === '::1' ? { host: '::1' } : {}),
    expected: req.expected ?? 'adhoc',
    ...(dir ? { project: { dir: tildify(dir) } } : {}),
  };
  const header = ` Claimed from the listener on port ${o.port}${id.command ? ` (${id.command})` : ''} on ${new Date().toISOString().slice(0, 10)}.`;
  let footer: string | undefined;
  if (id.command) {
    const argv = id.command.split(/\s+/).filter(Boolean);
    footer = [
      ' To have Hallway keep it running as a service, uncomment this and check the command (or use `hallway service add`):',
      ' service:',
      `   command: ${JSON.stringify(argv)}`,
      ...(id.cwd ? [`   cwd: ${tildify(id.cwd)}`] : []),
    ].join('\n');
  }
  return { value, header, footer };
}

/**
 * Claim an observed listener: write `apps/<slug>.yaml` from what was observed (the dashboard's Claim, `POST
 * /api/observed/:id/claim`, MCP's `claim_observed`). Resolves with the slug; throws the store's errors.
 */
export async function claimObserved({ store, bus, providers }: Pick<ApiOptions, 'store' | 'bus' | 'providers'>, id: string, body: Partial<ClaimRequest> | null | undefined) {
  if (!body || typeof body !== 'object' || typeof body.slug !== 'string') throw new ValidationError('the body must be {"slug": "...", "name"?: "...", "expected"?: "running"|"stopped"|"adhoc"}');
  if (!SLUG.test(body.slug)) throw new ValidationError(`"${body.slug}" is not a valid slug`, [{ key: 'slug', message: 'invalid slug' }]);
  if (body.expected !== undefined && !['running', 'stopped', 'adhoc'].includes(body.expected)) throw new ValidationError('expected must be running, stopped or adhoc', [{ key: 'expected', message: 'invalid' }]);
  if (body.name !== undefined && typeof body.name !== 'string') throw new ValidationError('name must be text', [{ key: 'name', message: 'invalid' }]);
  const o = providers.observation(id);
  if (!o) throw new NotFoundError(`no observed listener '${id}'`);
  const { value, header, footer } = claimFile(o, body as ClaimRequest);
  await store.createApp(body.slug, value, { header, footer });
  bus.emit({ type: 'observed', reason: 'claimed' });
  return body.slug;
}

/** Hide an observed listener by its port, process name or directory (`ignore.yaml`). Resolves with ignore.yaml's entry. */
export async function ignoreObserved({ store, providers }: Pick<ApiOptions, 'store' | 'providers'>, id: string, by: unknown) {
  if (by !== 'port' && by !== 'process' && by !== 'dir') throw new ValidationError('the body must be {"by": "port" | "process" | "dir"}', [{ key: 'by', message: 'invalid' }]);
  const o = providers.observation(id);
  if (!o) throw new NotFoundError(`no observed listener '${id}'`);
  const dir = o.identity.projectDir ?? o.identity.cwd;
  const value = by === 'port' ? o.port : by === 'process' ? o.identity.process : dir ? tildify(dir) : null;
  if (value === null || value === '') throw new ValidationError(`the ${by === 'dir' ? 'directory' : 'process name'} of this listener isn't known; ignore it by port instead`, [{ key: 'by', message: 'unknown' }]);
  return store.addIgnore(by, value);
}

export function apiRoutes({ store, bus, providers, startedAt, services }: ApiOptions) {
  const ctx = { store, providers };
  let svc: Services | undefined;
  const getServices = services ?? (() => (svc ??= new Services({ store })));
  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true, version: VERSION }));
  api.get('/state', (c) => c.json(stateView(ctx, baseUrl(c), startedAt)));
  api.get('/events', sseHandler(bus));
  api.get('/config', (c) => {
    const v = configView(store);
    withEtag(c, store.config);
    return c.json(v);
  });

  // ---------------- dashboard hints and local domains (D63) ----------------
  // only `dashboard.hints` in config.yaml: the dashboard can dismiss a hint, not edit the rest of the file
  api.patch('/hints', async (c) => {
    try {
      const body = await jsonBody(c);
      const known = ['localDomains'];
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('the body must be an object such as { "localDomains": false }');
      const issues = Object.entries(body).flatMap(([k, v]) =>
        !known.includes(k) ? [{ key: k, message: `unknown hint (known: ${known.join(', ')})` }] : typeof v !== 'boolean' ? [{ key: k, message: 'must be true or false' }] : [],
      );
      if (issues.length) throw new ValidationError(issues.map((i) => `${i.key}: ${i.message}`).join('; '), issues);
      const e = await store.patchConfig({ dashboard: { hints: body } }, writeOpts(c));
      withEtag(c, e);
      return c.json(configView(store));
    } catch (e) {
      return handle(c, e);
    }
  });

  // local domains: what fronted mode gives, whether it's on, and (in fronted mode) doctor's checks. Read-only: setup is
  // `hallway setup`, never the daemon (AGENTS.md)
  api.get('/fronting', async (c) => {
    const fronting = providers.first('fronting');
    if (!fronting) return fail(c, 503, { error: 'local domains are not available in this daemon (no fronting provider is running)' });
    try {
      const r = await providers.first('frontingChecks', c.req.query('fresh') === '1');
      return c.json({ fronting, checks: r?.checks ?? null, checkedAt: r?.checkedAt ?? null } satisfies FrontingResponse);
    } catch (e) {
      return handle(c, e);
    }
  });

  // ---------------- apps ----------------
  api.get('/apps', (c) => c.json({ apps: appViews(ctx, false) } satisfies AppsResponse));

  api.get('/apps/:slug', (c) => {
    const slug = c.req.param('slug');
    const v = appView(ctx, slug);
    if (!v) return fail(c, 404, { error: `no app '${slug}'` });
    if (v.etag) c.header('ETag', v.etag);
    return c.json(v);
  });

  api.put('/apps/:slug', async (c) => {
    try {
      const slug = c.req.param('slug');
      const existed = store.apps.has(slug);
      const e = await store.putApp(slug, await jsonBody(c), writeOpts(c));
      withEtag(c, e);
      return c.json(declaredView(ctx, slug), existed ? 200 : 201);
    } catch (e) {
      return handle(c, e);
    }
  });

  api.patch('/apps/:slug', async (c) => {
    try {
      const slug = c.req.param('slug');
      const e = await store.patchApp(slug, await jsonBody(c), writeOpts(c));
      withEtag(c, e);
      return c.json(declaredView(ctx, slug));
    } catch (e) {
      return handle(c, e);
    }
  });

  api.delete('/apps/:slug', async (c) => {
    try {
      const dest = await store.deleteApp(c.req.param('slug'), writeOpts(c));
      return c.json({ ok: true, movedTo: tildify(dest) });
    } catch (e) {
      return handle(c, e);
    }
  });

  api.get('/apps/:slug/history', (c) => {
    const slug = c.req.param('slug');
    const window = (c.req.query('window') ?? '24h') as HistoryWindow;
    if (!WINDOWS.includes(window)) return fail(c, 400, { error: `window must be one of ${WINDOWS.join(', ')}` });
    if (!appView(ctx, slug)) return fail(c, 404, { error: `no app '${slug}'` });
    if (!providers.has('appHistory')) return fail(c, 503, { error: 'uptime history is not available (no uptime provider is running)' });
    return c.json(providers.first('appHistory', slug, window) ?? { window, buckets: [], uptime: null, latency: { p50: null, p95: null, max: null } });
  });

  api.get('/apps/:slug/thumb', (c) => {
    const slug = c.req.param('slug');
    const t = providers.first('thumb', slug);
    if (!t) return fail(c, 404, { error: `no thumbnail for '${slug}'` });
    return image(c, t);
  });

  api.post('/thumbs/refresh', async (c) => {
    try {
      const body = (await jsonBody(c)) as { slug?: unknown } | null;
      const slug = body?.slug;
      if (slug !== undefined && typeof slug !== 'string') return fail(c, 400, { error: 'slug must be a string' });
      if (slug && !appView(ctx, slug)) return fail(c, 404, { error: `no app '${slug}'` });
      if (store.currentConfig().thumbnails.mode !== 'screenshot') return fail(c, 409, { error: 'screenshots are off (thumbnails.mode is not screenshot): `hallway thumbs enable` turns them on' });
      if (!providers.has('refreshThumbs')) return fail(c, 503, { error: 'screenshots are not available (no thumbnailer is running)' });
      return c.json({ taken: await providers.refreshThumbs(slug || undefined) });
    } catch (e) {
      return handle(c, e);
    }
  });

  // ---------------- managed services (v1) ----------------
  api.get('/apps/:slug/logs', (c) => {
    const slug = c.req.param('slug');
    if (!store.apps.has(slug)) return fail(c, 404, { error: `no app '${slug}'` });
    const lines = Number(c.req.query('lines') ?? 200);
    if (!Number.isInteger(lines) || lines < 0 || lines > 10000) return fail(c, 400, { error: 'lines must be a whole number from 0 to 10000' });
    const l = appLogs(store.home, slug, lines);
    return c.json({ slug, out: { file: tildify(l.out.file), text: l.out.text }, err: { file: tildify(l.err.file), text: l.err.text } });
  });

  api.post('/apps/:slug/service/:action', async (c) => {
    try {
      const slug = c.req.param('slug');
      const action = c.req.param('action');
      if (!store.apps.has(slug)) return fail(c, 404, { error: `no app '${slug}'` });
      const s = getServices();
      if (action === 'start' || action === 'restart') providers.first('serviceStarting', slug);
      if (action === 'start') await s.startApp(slug);
      else if (action === 'stop') await s.stopApp(slug);
      else if (action === 'restart') await s.restartApp(slug);
      else return fail(c, 404, { error: 'the action must be start, stop or restart' });
      return c.json({ ok: true, app: declaredView(ctx, slug), service: await s.status(`hallway.app.${slug}`) });
    } catch (e) {
      return handle(c, e);
    }
  });

  // ---------------- bookmarks ----------------
  // A bookmark's favicon: only for a URL that is in the group, so this never becomes a way to fetch anything.
  api.get('/bookmarks/:group/icon', (c) => {
    const link = store.groups.get(c.req.param('group'))?.value?.links.find((l) => l.url === c.req.query('url'));
    if (!link) return fail(c, 404, { error: 'no such bookmark' });
    const t = providers.first('bookmarkIcon', link, c.req.param('group'));
    // nothing (yet): 204 rather than 404, so a dashboard asking for a chip's icon isn't an error in the console
    if (!t) return c.body(null, 204, { 'Cache-Control': 'no-store' });
    return image(c, t);
  });

  api.get('/bookmarks', (c) => c.json({ groups: groupViews(store) } satisfies BookmarksResponse));

  api.get('/bookmarks/:group', (c) => {
    const e = store.groups.get(c.req.param('group'));
    if (!e) return fail(c, 404, { error: `no bookmark group '${c.req.param('group')}'` });
    withEtag(c, e);
    return c.json(groupView(e));
  });

  api.put('/bookmarks/:group', async (c) => {
    try {
      const group = c.req.param('group');
      const existed = store.groups.has(group);
      const e = await store.putGroup(group, await jsonBody(c), writeOpts(c));
      withEtag(c, e);
      return c.json(groupView(e), existed ? 200 : 201);
    } catch (e) {
      return handle(c, e);
    }
  });

  api.patch('/bookmarks/:group', async (c) => {
    try {
      const e = await store.patchGroup(c.req.param('group'), await jsonBody(c), writeOpts(c));
      withEtag(c, e);
      return c.json(groupView(e));
    } catch (e) {
      return handle(c, e);
    }
  });

  api.delete('/bookmarks/:group', async (c) => {
    try {
      const dest = await store.deleteGroup(c.req.param('group'), writeOpts(c));
      return c.json({ ok: true, movedTo: tildify(dest) });
    } catch (e) {
      return handle(c, e);
    }
  });

  // ---------------- observed listeners ----------------
  api.get('/observed', (c) => c.json({ observed: providers.all('observed') } satisfies ObservedResponse));

  api.post('/scan', async (c) => {
    try {
      if (!(await providers.scan())) return fail(c, 503, { error: 'scanning is not available (no scanner is running)' });
      return c.json({ observed: providers.all('observed') } satisfies ObservedResponse);
    } catch (e) {
      return handle(c, e);
    }
  });

  api.post('/observed/:id/claim', async (c) => {
    try {
      const body = (await jsonBody(c)) as Partial<ClaimRequest> | null;
      const slug = await claimObserved({ store, bus, providers }, c.req.param('id'), body);
      if (store.apps.get(slug)) withEtag(c, store.apps.get(slug)!);
      return c.json(declaredView(ctx, slug), 201);
    } catch (e) {
      return handle(c, e);
    }
  });

  api.post('/observed/:id/ignore', async (c) => {
    try {
      const body = (await jsonBody(c)) as Partial<IgnoreRequest> | null;
      const e = await ignoreObserved({ store, providers }, c.req.param('id'), body?.by);
      withEtag(c, e);
      return c.json({ ok: true, ignore: store.currentIgnore() });
    } catch (e) {
      return handle(c, e);
    }
  });

  // ---------------- lost at last reboot (v1, D54) ----------------
  api.get('/lost', (c) => c.json({ lost: providers.first('lost') } satisfies LostResponse));

  // restart once / make it a service: `hallway run`'s code path (server/lost/actions.ts); 200 even when it didn't come
  // up, with `ok: false`, the reason and the last log lines, as `hallway run --json` reports it
  api.post('/lost/:id/:action{restart|service}', async (c) => {
    try {
      // the body is optional: {} or {"slug": "..."}
      const text = await c.req.text();
      let body: LostActionRequest | null = null;
      try {
        body = text.trim() ? JSON.parse(text) : null;
      } catch {
        throw new ValidationError('the body is not valid JSON');
      }
      return c.json(await reviveLost({ services: getServices(), providers, bus, run: { timeoutMs: 20_000 } }, c.req.param('id'), c.req.param('action') === 'service', body));
    } catch (e) {
      return handle(c, e);
    }
  });

  api.post('/lost/:id/dismiss', (c) => {
    try {
      const dismissed = dismissLost(providers, c.req.param('id'));
      return c.json({ dismissed, lost: providers.first('lost') });
    } catch (e) {
      return handle(c, e);
    }
  });

  api.post('/lost/dismiss', (c) => {
    try {
      const dismissed = dismissLost(providers);
      return c.json({ dismissed, lost: providers.first('lost') });
    } catch (e) {
      return handle(c, e);
    }
  });

  api.all('*', (c) => fail(c, 404, { error: 'not found' }));
  return api;
}

/** /agent-guide.md, /llms.txt, /llms-full.txt: read-only, and nothing the dashboard doesn't already show to localhost. */
export function agentRoutes({ store, providers }: Pick<ApiOptions, 'store' | 'providers'>) {
  const ctx = { store, providers };
  const r = new Hono();
  const input = (c: Context): GuideInput => {
    const cfg = store.currentConfig();
    return {
      guide: readGuide(),
      url: baseUrl(c),
      live: {
        version: VERSION,
        home: store.home,
        mode: cfg.mode,
        base: cfg.domain.base,
        appsAt: publicUrl(`<slug>.${cfg.domain.base}`, cfg.proxy),
        apps: appViews(ctx, false).map((a) => ({
          slug: a.slug,
          name: a.name,
          port: a.config?.port ?? null,
          url: a.url,
          expected: a.config?.expected ?? null,
          error: a.problems.some((p) => p.severity === 'error'),
        })),
        groups: groupViews(store).map((g) => ({ group: g.group, title: g.config?.title ?? g.group, links: g.config?.links.length ?? 0 })),
        lost: lostSummary(providers.first('lost')),
      },
    };
  };
  const text = (c: Context, body: string, type: string) => {
    c.header('Cache-Control', 'no-store');
    return c.body(body, 200, { 'Content-Type': `${type}; charset=utf-8` });
  };
  r.get('/llms.txt', (c) => text(c, llmsTxt(input(c)), 'text/plain'));
  r.get('/llms-full.txt', (c) => text(c, llmsFullTxt(input(c)), 'text/plain'));
  r.get('/agent-guide.md', (c) => text(c, agentGuide(input(c)), 'text/markdown'));
  return r;
}
