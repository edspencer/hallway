// The MCP tools and resources (docs/06-agent-interface.md, "MCP server"; D8, D10, D50). A typed convenience layer
// over the same store and views as the HTTP API: every write goes through the Store (D7), takes an optional `etag`
// (If-Match) and returns the new one. Nothing here starts, stops or installs a process (D10): `declare_app` and
// `update_app` refuse `service`, `update_app` refuses a port change (D17), `remove_app` refuses a managed app.
import { McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { AppState, AppView, HistoryWindow } from '../../shared/api.js';
import { claimObserved, ignoreObserved } from '../api.js';
import { VERSION, tildify } from '../config.js';
import type { EventBus } from '../events.js';
import type { ProviderRegistry } from '../providers.js';
import { ConflictError, NotFoundError, ValidationError, type Entry, type Store } from '../store/index.js';
import { appView, appViews, declaredView, groupView, groupViews, stateView } from '../views.js';

export interface McpContext {
  store: Store;
  bus: EventBus;
  providers: ProviderRegistry;
  startedAt: Date;
}

export const STATE_URI = 'hallway://state';
export const appUri = (slug: string) => `hallway://apps/${slug}`;

const STATES: AppState[] = ['healthy', 'unhealthy', 'down', 'stopped', 'unknown'];

const INSTRUCTIONS = `Hallway is the local dashboard of every web server on this machine: declared apps (apps/<slug>.yaml), \
observed listeners nobody has named yet, and bookmarks (bookmarks/<group>.yaml). These tools read and edit those files; \
every write returns the file's new etag, and passing an etag back makes the write fail if the file changed meanwhile. \
They never start or stop a process: to run a dev server, use the shell command \`hallway run <slug> -- <command>\` \
(it keeps the server running outside your session on a stable port and prints its URL). Never change an existing \
app's port.`;

// ---------------------------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------------------------

const ok = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

/** A tool error the agent can act on: the message, and for a conflict the file's current etag. */
function failure(e: unknown): CallToolResult {
  let text: string;
  if (e instanceof ConflictError) text = `Conflict: ${e.message}${e.etag ? ` (the file's current etag is ${e.etag}; read it again and retry with that)` : ''}`;
  else if (e instanceof ValidationError) text = `Invalid: ${e.message}${e.issues.length ? `\n${e.issues.map((i) => `- ${i.key || '(file)'}: ${i.message}`).join('\n')}` : ''}`;
  else if (e instanceof NotFoundError || e instanceof Refused) text = e.message;
  else {
    process.stderr.write(`hallway: [mcp] ${(e as Error).stack ?? e}\n`);
    text = `Error: ${(e as Error).message ?? e}`;
  }
  return { content: [{ type: 'text', text }], isError: true };
}

/** A request the tools refuse on principle (D10, D17), not because it's malformed. */
export class Refused extends Error {}

const run =
  <A>(fn: (args: A) => Promise<Record<string, unknown>> | Record<string, unknown>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return failure(e);
    }
  };

const opts = (etag: string | undefined) => ({ ifMatch: etag ?? null });

// ---------------------------------------------------------------------------------------------------------------
// Views: compact for lists, full for one app
// ---------------------------------------------------------------------------------------------------------------

function summary(a: AppView) {
  return {
    slug: a.slug,
    name: a.name,
    source: a.source,
    url: a.url,
    port: a.config?.port ?? null,
    state: a.health.state,
    ...(a.health.starting ? { starting: true } : {}),
    detail: a.health.detail,
    expected: a.config?.expected ?? null,
    uptime24h: a.health.uptime24h,
    managed: a.managed,
    tags: a.config?.tags ?? [],
    errors: a.problems.filter((p) => p.severity === 'error').map((p) => `${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`),
  };
}

function detail(a: AppView) {
  const h = a.history;
  return {
    ...summary(a),
    description: a.config?.description ?? null,
    config: a.config,
    etag: a.etag,
    file: a.file,
    path: a.path ? tildify(a.path) : null,
    health: a.health,
    identity: a.identity,
    history24h: h ? { uptime: h.uptime, latency: h.latency, bars: h.buckets.map((b) => b.state) } : null,
    problems: a.problems,
  };
}

const matchesFilter = (a: AppView, q: string) => {
  const needle = q.toLowerCase();
  return [a.slug, a.name, a.url ?? '', a.config?.description ?? '', String(a.config?.port ?? ''), ...(a.config?.tags ?? [])].some((s) => s.toLowerCase().includes(needle));
};

// ---------------------------------------------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------------------------------------------

const slug = z.string().describe('The app slug: lower-case letters, digits and hyphens (the file name, apps/<slug>.yaml).');
const group = z.string().describe('The bookmark group slug (the file name, bookmarks/<group>.yaml).');
const etag = z.string().optional().describe("The etag you last read. If given, the write fails with a conflict when the file has changed since.");
const expected = z.enum(['running', 'stopped', 'adhoc']);
const healthCheck = z.object({ path: z.string(), expectStatus: z.number().int().nullable().optional() });
const appLink = z.object({ label: z.string(), path: z.string().optional(), url: z.string().optional() });

// Loose objects on purpose: a `service` block (or any key the file format doesn't have) reaches the handler and is
// refused with a message that says why, rather than being silently dropped by the schema.
const appFields = {
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  host: z.string().optional().describe('Where it listens (default 127.0.0.1).'),
  expected: expected.optional().describe('running: should always be up. stopped: off on purpose. adhoc: up sometimes (default running).'),
  health: healthCheck.nullable().optional().describe('How to check it; leave out to probe GET / (any status below 500 is healthy).'),
  tags: z.array(z.string()).optional(),
  links: z.array(appLink).optional().describe('Deep links shown on the card: {label, path} or {label, url}.'),
  icon: z.string().nullable().optional(),
};

const which = {
  url: z.string().optional().describe('The link, by its URL.'),
  index: z.number().int().min(0).optional().describe('Or by its 0-based position in the group.'),
};
const pick = (a: { url?: string; index?: number }): string | number => {
  if ((a.url === undefined) === (a.index === undefined)) throw new ValidationError('give either url or index');
  return a.url ?? a.index!;
};

const NO_SERVICE =
  'Refused: MCP tools never set up a process to run (D10). To have Hallway run this app, use the shell command `hallway run <slug> -- <command>` or `hallway service add <slug> -- <command>`.';

// ---------------------------------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------------------------------

/**
 * One MCP server instance (the SDK makes one per request, so this must be cheap: it only registers handlers). Resource
 * subscriptions are offered to 2026-era clients only: they arrive on a `subscriptions/listen` stream, and a 2025-era
 * client served statelessly has no stream to receive them on.
 */
export function createMcpServer(ctx: McpContext, era: 'legacy' | 'modern' = 'modern'): McpServer {
  const { store, providers } = ctx;
  const vctx = { store, providers };
  const server = new McpServer(
    { name: 'hallway', title: 'Hallway', version: VERSION },
    { instructions: INSTRUCTIONS, ...(era === 'modern' ? { capabilities: { resources: { subscribe: true, listChanged: true } } } : {}) },
  );

  const written = (e: Entry<unknown>) => ({ etag: e.etag, file: e.file });
  const app = (s: string) => {
    const v = declaredView(vctx, s);
    return v ? detail(v) : null;
  };

  // ---------------- reading ----------------
  server.registerTool(
    'get_status',
    {
      title: 'Status of every app',
      description: 'Every app with its state, URL and 24-hour uptime, counts by state, and how many observed listeners are waiting to be named.',
      inputSchema: z.object({ filter: z.string().optional().describe('Only apps whose slug, name, URL, description, port or tags contain this.') }),
      annotations: { readOnlyHint: true },
    },
    run(({ filter }) => {
      const all = appViews(vctx, false);
      const apps = filter ? all.filter((a) => matchesFilter(a, filter)) : all;
      const counts = Object.fromEntries(STATES.map((s) => [s, apps.filter((a) => a.health.state === s).length]));
      return {
        apps: apps.map(summary),
        counts,
        observed: providers.all('observed').length,
        healthChecks: providers.has('appHealth'),
        problems: store.allProblems().filter((p) => p.severity === 'error').length,
      };
    }),
  );

  server.registerTool(
    'list_apps',
    {
      title: 'List apps',
      description: 'Apps with their configuration and live state.',
      inputSchema: z.object({
        source: z.enum(['declared', 'discovered']).optional(),
        state: z.enum(['healthy', 'unhealthy', 'down', 'stopped', 'unknown']).optional(),
        tag: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    run(({ source, state, tag }) => ({
      apps: appViews(vctx, false)
        .filter((a) => (!source || a.source === source) && (!state || a.health.state === state) && (!tag || (a.config?.tags ?? []).includes(tag)))
        .map((a) => ({ ...summary(a), config: a.config, etag: a.etag })),
    })),
  );

  server.registerTool(
    'get_app',
    {
      title: 'One app in full',
      description: "An app's configuration, etag, live health, the process listening on its port, and its last 24 hours of uptime.",
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    run(({ slug: s }) => {
      const v = appView(vctx, s);
      if (!v) throw new NotFoundError(`no app '${s}'`);
      return detail(v);
    }),
  );

  server.registerTool(
    'get_history',
    {
      title: 'Uptime history',
      description: "An app's uptime bars and latency over 24 hours (48 × 30 min), 7 days (56 × 3 h) or 90 days (one per day).",
      inputSchema: z.object({ slug, window: z.enum(['24h', '7d', '90d']).default('24h') }),
      annotations: { readOnlyHint: true },
    },
    run(({ slug: s, window }) => {
      if (!appView(vctx, s)) throw new NotFoundError(`no app '${s}'`);
      if (!providers.has('appHistory')) throw new Refused('Uptime history is not available: no uptime provider is running.');
      const h = providers.first('appHistory', s, window as HistoryWindow);
      return { slug: s, ...(h ?? { window, buckets: [], uptime: null, latency: { p50: null, p95: null, max: null } }) };
    }),
  );

  server.registerTool(
    'list_observed',
    {
      title: 'Observed listeners',
      description: 'Servers listening on this machine that no app declares, with what is known about each (process, directory, git branch, page title). Claim one to name it, or ignore it.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    run(() => ({ observed: providers.all('observed'), scanner: providers.has('observed') || providers.has('scan') })),
  );

  server.registerTool(
    'list_bookmarks',
    {
      title: 'List bookmarks',
      description: 'Bookmark groups and their links, with each group file’s etag.',
      inputSchema: z.object({ group: group.optional() }),
      annotations: { readOnlyHint: true },
    },
    run(({ group: g }) => {
      if (g === undefined) return { groups: groupViews(store) };
      const e = store.groups.get(g);
      if (!e) throw new NotFoundError(`no bookmark group '${g}'`);
      return { groups: [groupView(e)] };
    }),
  );

  // ---------------- apps ----------------
  server.registerTool(
    'declare_app',
    {
      title: 'Declare an app',
      description:
        'Name a server that is (or will be) listening on a port: writes apps/<slug>.yaml. Creates only; to change an existing app use update_app. It never starts anything (no `service` block): to run a server, use `hallway run` in the shell.',
      inputSchema: z.looseObject({ slug, port: z.number().int().min(1).max(65535).describe('The port it listens on.'), ...appFields }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    run(async ({ slug: s, ...body }) => {
      if ('service' in body) throw new Refused(NO_SERVICE);
      const e = await store.putApp(s, body, { createOnly: true });
      return { app: app(s), ...written(e) };
    }),
  );

  server.registerTool(
    'update_app',
    {
      title: 'Update an app',
      description:
        "Change an app's fields with a JSON merge patch (null removes a key; lists are replaced whole). Comments and unknown keys in the file are kept. Never changes `port` (other things rely on it) or `service` (use the CLI).",
      inputSchema: z.object({ slug, patch: z.looseObject(appFields).describe('The fields to change.'), etag }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    run(async ({ slug: s, patch, etag: tag }) => {
      if ('service' in patch) throw new Refused(NO_SERVICE.replace('never set up a process to run', "never change how an app is run"));
      const current = store.apps.get(s);
      if ('port' in patch && !(current?.value && patch.port === current.value.port))
        throw new Refused(
          `Refused: an app's port is never changed (D17): other things rely on it. If the server really moved, declare it under a new slug, or ask the user to edit ${current?.file ?? `apps/${s}.yaml`}.`,
        );
      const { port: _same, ...rest } = patch as Record<string, unknown>;
      const e = await store.patchApp(s, rest, opts(tag));
      return { app: app(s), ...written(e) };
    }),
  );

  server.registerTool(
    'remove_app',
    {
      title: 'Remove an app',
      description: "Move an app's file to the data home's backups (it can be restored by copying it back). Refused for an app Hallway runs as a service: use `hallway app rm` in the shell.",
      inputSchema: z.object({ slug, etag }),
      annotations: { destructiveHint: true },
    },
    run(async ({ slug: s, etag: tag }) => {
      const e = store.apps.get(s);
      if (e?.value?.service || (e?.raw && /^service\s*:/m.test(e.raw)))
        throw new Refused(`Refused: '${s}' is run by Hallway as a service, and MCP tools never stop processes (D10). Use \`hallway app rm ${s}\` in the shell.`);
      const dest = await store.deleteApp(s, opts(tag));
      return { removed: s, movedTo: tildify(dest) };
    }),
  );

  // ---------------- observed ----------------
  server.registerTool(
    'claim_observed',
    {
      title: 'Claim an observed listener',
      description: "Turn an observed listener into a declared app (as the dashboard's Claim does): writes apps/<slug>.yaml from what was observed.",
      inputSchema: z.object({ id: z.string().describe('The id from list_observed.'), slug, name: z.string().optional(), expected: expected.optional().describe('Default adhoc.') }),
      annotations: { destructiveHint: false },
    },
    run(async ({ id, ...req }) => {
      const s = await claimObserved(ctx, id, req);
      return { app: app(s), ...written(store.apps.get(s)!) };
    }),
  );

  server.registerTool(
    'ignore_observed',
    {
      title: 'Ignore an observed listener',
      description: 'Hide an observed listener for good, by its port, its process name or its directory (appends to ignore.yaml).',
      inputSchema: z.object({ id: z.string().describe('The id from list_observed.'), by: z.enum(['port', 'process', 'dir']) }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    run(async ({ id, by }) => {
      const e = await ignoreObserved(ctx, id, by);
      return { ignore: store.currentIgnore(), ...written(e) };
    }),
  );

  // ---------------- bookmarks ----------------
  server.registerTool(
    'upsert_bookmark_group',
    {
      title: 'Create or update a bookmark group',
      description: 'Create bookmarks/<group>.yaml, or change its title, order or collapsed flag. Links are kept.',
      inputSchema: z.object({
        group,
        title: z.string().optional(),
        order: z.number().int().optional().describe('Groups sort by order, then title (default 100).'),
        collapsed: z.boolean().optional(),
        etag,
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    run(async ({ group: g, etag: tag, ...fields }) => {
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const e = store.groups.has(g) ? await store.patchGroup(g, patch, opts(tag)) : await store.putGroup(g, patch, { ...opts(tag), createOnly: !tag });
      return { group: groupView(e), ...written(e) };
    }),
  );

  server.registerTool(
    'add_bookmark',
    {
      title: 'Add a bookmark',
      description: "Append a link to a group (creating the group if it doesn't exist). The file's comments are kept.",
      inputSchema: z.object({
        group,
        url: z.string().describe('Where it goes (http, https, or another scheme).'),
        title: z.string().optional().describe("The link text (default: the URL's host name)."),
        description: z.string().optional(),
        icon: z.string().optional().describe('auto, an image URL, a path in the data home, or an emoji.'),
        tags: z.array(z.string()).optional(),
        etag,
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    run(async ({ group: g, etag: tag, title, url, description, icon, tags }) => {
      // in the order people write them: title first
      const e = await store.addBookmark(g, { title, url, description, icon, tags }, opts(tag));
      return { group: groupView(e), ...written(e) };
    }),
  );

  server.registerTool(
    'update_bookmark',
    {
      title: 'Update a bookmark',
      description: 'Change one link (found by url or index) with a merge patch: null removes a key. It keeps its place and comments.',
      inputSchema: z.object({
        group,
        ...which,
        patch: z.object({
          title: z.string().nullable().optional(),
          url: z.string().optional(),
          description: z.string().nullable().optional(),
          icon: z.string().nullable().optional(),
          tags: z.array(z.string()).nullable().optional(),
        }),
        etag,
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    run(async ({ group: g, patch, etag: tag, ...w }) => {
      const link = await store.updateBookmark(g, pick(w), patch, opts(tag));
      return { link, ...written(store.groups.get(g)!) };
    }),
  );

  server.registerTool(
    'remove_bookmark',
    {
      title: 'Remove a bookmark',
      description: 'Remove one link (by url or index) from a group. A snapshot of the data home is taken first.',
      inputSchema: z.object({ group, ...which, etag }),
      annotations: { destructiveHint: true },
    },
    run(async ({ group: g, etag: tag, ...w }) => {
      const removed = await store.removeBookmark(g, pick(w), opts(tag));
      return { removed, ...written(store.groups.get(g)!) };
    }),
  );

  server.registerTool(
    'remove_bookmark_group',
    {
      title: 'Remove a bookmark group',
      description: "Move a group's file to the data home's backups (it can be restored by copying it back).",
      inputSchema: z.object({ group, etag }),
      annotations: { destructiveHint: true },
    },
    run(async ({ group: g, etag: tag }) => {
      const dest = await store.deleteGroup(g, opts(tag));
      return { removed: g, movedTo: tildify(dest) };
    }),
  );

  // ---------------- resources (change notifications: server/mcp/index.ts) ----------------
  server.registerResource('state', STATE_URI, { title: 'Hallway state', description: 'Everything the dashboard shows: apps, bookmarks, observed listeners, problems.', mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(stateView(vctx, `http://localhost:${store.currentConfig().port}`, ctx.startedAt)) }],
  }));

  server.registerResource(
    'app',
    new ResourceTemplate('hallway://apps/{slug}', {
      list: async () => ({ resources: appViews(vctx, false).map((a) => ({ uri: appUri(a.slug), name: a.slug, title: a.name, mimeType: 'application/json' })) }),
    }),
    { title: 'One app', description: 'An app in full, as get_app returns it.', mimeType: 'application/json' },
    async (uri, { slug: s }) => {
      const v = appView(vctx, String(s));
      if (!v) throw new NotFoundError(`no app '${s}'`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(detail(v)) }] };
    },
  );

  return server;
}
