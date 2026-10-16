// The JSON API (docs/02-architecture.md, "HTTP API"), the SSE stream, and the agent-facing documents. Every route is
// behind the security middleware (server/security.ts). Writes go through the store (server/store/), the one writer;
// live data comes from the providers (server/providers.ts).
import { Hono, type Context } from 'hono';
import type {
  AppsResponse,
  BookmarksResponse,
  ClaimRequest,
  ErrorResponse,
  HistoryWindow,
  IgnoreRequest,
  ObservedListener,
  ObservedResponse,
} from '../shared/api.js';
import { VERSION, tildify } from './config.js';
import { sseHandler, type EventBus } from './events.js';
import { agentGuide, llmsFullTxt, llmsTxt, readGuide, type GuideInput } from './guide.js';
import type { ProviderRegistry } from './providers.js';
import { ServiceManagerError } from './platform/index.js';
import { ServiceError, Services } from './services/index.js';
import { appLogs } from './services/logs.js';
import { ResolveError } from './services/resolve.js';
import { ConflictError, NotFoundError, SLUG, ValidationError, type Entry, type Store, type WriteOptions } from './store/index.js';
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

const withEtag = (c: Context, e: Entry<unknown>) => {
  if (e.etag) c.header('ETag', e.etag);
};

/** A claimed app's file: the observation's facts, and its command as a commented-out `service:` block. */
function claimFile(o: ObservedListener, req: ClaimRequest) {
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
      ' To have Hallway keep it running as a service (v1), uncomment this and check the command:',
      ' service:',
      `   command: ${JSON.stringify(argv)}`,
      ...(id.cwd ? [`   cwd: ${tildify(id.cwd)}`] : []),
    ].join('\n');
  }
  return { value, header, footer };
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
    c.header('ETag', t.etag);
    c.header('Cache-Control', 'no-cache');
    if (c.req.header('if-none-match') === t.etag) return c.body(null, 304);
    return c.body(t.body as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': t.contentType });
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
      if (!body || typeof body !== 'object' || typeof body.slug !== 'string') throw new ValidationError('the body must be {"slug": "...", "name"?: "...", "expected"?: "running"|"stopped"|"adhoc"}');
      if (!SLUG.test(body.slug)) throw new ValidationError(`"${body.slug}" is not a valid slug`, [{ key: 'slug', message: 'invalid slug' }]);
      if (body.expected !== undefined && !['running', 'stopped', 'adhoc'].includes(body.expected)) throw new ValidationError('expected must be running, stopped or adhoc', [{ key: 'expected', message: 'invalid' }]);
      if (body.name !== undefined && typeof body.name !== 'string') throw new ValidationError('name must be text', [{ key: 'name', message: 'invalid' }]);
      const o = providers.observation(c.req.param('id'));
      if (!o) return fail(c, 404, { error: `no observed listener '${c.req.param('id')}'` });
      const { value, header, footer } = claimFile(o, body as ClaimRequest);
      const e = await store.createApp(body.slug, value, { header, footer });
      bus.emit({ type: 'observed', reason: 'claimed' });
      withEtag(c, e);
      return c.json(declaredView(ctx, body.slug), 201);
    } catch (e) {
      return handle(c, e);
    }
  });

  api.post('/observed/:id/ignore', async (c) => {
    try {
      const body = (await jsonBody(c)) as Partial<IgnoreRequest> | null;
      const by = body?.by;
      if (by !== 'port' && by !== 'process' && by !== 'dir') throw new ValidationError('the body must be {"by": "port" | "process" | "dir"}', [{ key: 'by', message: 'invalid' }]);
      const o = providers.observation(c.req.param('id'));
      if (!o) return fail(c, 404, { error: `no observed listener '${c.req.param('id')}'` });
      const dir = o.identity.projectDir ?? o.identity.cwd;
      const value = by === 'port' ? o.port : by === 'process' ? o.identity.process : dir ? tildify(dir) : null;
      if (value === null || value === '') throw new ValidationError(`the ${by === 'dir' ? 'directory' : 'process name'} of this listener isn't known; ignore it by port instead`, [{ key: 'by', message: 'unknown' }]);
      const e = await store.addIgnore(by, value);
      withEtag(c, e);
      return c.json({ ok: true, ignore: store.currentIgnore() });
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
        apps: appViews(ctx, false).map((a) => ({
          slug: a.slug,
          name: a.name,
          port: a.config?.port ?? null,
          url: a.url,
          expected: a.config?.expected ?? null,
          error: a.problems.some((p) => p.severity === 'error'),
        })),
        groups: groupViews(store).map((g) => ({ group: g.group, title: g.config?.title ?? g.group, links: g.config?.links.length ?? 0 })),
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
