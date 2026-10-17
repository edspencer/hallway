// The dashboard's side of the HTTP API (docs/02-architecture.md, "HTTP API"; types in shared/api.ts). Reads resolve
// with the data or reject; writes resolve with a WriteResult so the forms can show a conflict or the validation issues
// next to the fields they concern, rather than a generic error.
import type {
  AppHistory,
  AppView,
  AppsResponse,
  BookmarkGroupView,
  BookmarksResponse,
  ClaimRequest,
  ConfigView,
  ErrorResponse,
  FrontingResponse,
  FrontingSetupJob,
  HealthResponse,
  HintsRequest,
  HistoryWindow,
  IgnoreRequest,
  LostActionRequest,
  LostActionResponse,
  LostNotice,
  ObservedResponse,
  StateResponse,
} from '../shared/api';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw Object.assign(new Error(`GET ${url}: ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

/** The daemon's own health. Rejects if the daemon can't be reached or answers with an error. */
export const getHealth = (signal?: AbortSignal) => getJson<HealthResponse>('/api/health', signal);

/** Everything the page shows, in one call. (index.html preloads it, so this usually answers from that request.) */
export const getState = (signal?: AbortSignal) => getJson<StateResponse>('/api/state', signal);
export const getApps = () => getJson<AppsResponse>('/api/apps').then((r) => r.apps);
export const getBookmarks = () => getJson<BookmarksResponse>('/api/bookmarks').then((r) => r.groups);
export const getObserved = () => getJson<ObservedResponse>('/api/observed').then((r) => r.observed);

/** Local domains, with doctor's checks in fronted mode (`fresh`: run them again rather than reuse the last run). */
export const getFronting = (fresh = false) => getJson<FrontingResponse>(`/api/fronting${fresh ? '?fresh=1' : ''}`);

/** One app, or null when it's gone. */
export async function getApp(slug: string): Promise<AppView | null> {
  try {
    return await getJson<AppView>(`/api/apps/${encodeURIComponent(slug)}`);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** Uptime over a window, or `unavailable` when no uptime store is running (503). */
export async function getHistory(slug: string, window: HistoryWindow): Promise<AppHistory | 'unavailable'> {
  try {
    return await getJson<AppHistory>(`/api/apps/${encodeURIComponent(slug)}/history?window=${window}`);
  } catch (e) {
    if ((e as { status?: number }).status === 503) return 'unavailable';
    throw e;
  }
}

export type WriteResult<T> =
  | { ok: true; value: T; etag: string | null }
  /** 409: the file changed since it was read (or is broken, or already exists). `etag` is what it is now. */
  | { ok: false; kind: 'conflict'; error: string; etag: string | null }
  /** 400: the values aren't valid; `issues` say which. */
  | { ok: false; kind: 'invalid'; error: string; issues: { key: string; message: string }[] }
  | { ok: false; kind: 'error'; error: string };

async function write<T>(method: 'PUT' | 'PATCH' | 'POST' | 'DELETE', url: string, body: unknown, opts: { ifMatch?: string | null; createOnly?: boolean } = {}): Promise<WriteResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
  if (opts.createOnly) headers['If-None-Match'] = '*';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, kind: 'error', error: "Couldn't reach the Hallway daemon." };
  }
  const data = (await res.json().catch(() => null)) as (T & ErrorResponse) | null;
  if (res.ok) return { ok: true, value: data as T, etag: res.headers.get('etag') };
  const error = data?.error ?? `${method} ${url}: ${res.status}`;
  if (res.status === 409) return { ok: false, kind: 'conflict', error, etag: data?.etag ?? null };
  if (res.status === 400) return { ok: false, kind: 'invalid', error, issues: data?.issues ?? [] };
  return { ok: false, kind: 'error', error };
}

const app = (slug: string) => `/api/apps/${encodeURIComponent(slug)}`;
const group = (g: string) => `/api/bookmarks/${encodeURIComponent(g)}`;

/** A JSON merge patch of an app's file (D33): only the keys given change; `null` removes one. */
export const patchApp = (slug: string, patch: Record<string, unknown>, etag: string | null) => write<AppView>('PATCH', app(slug), patch, { ifMatch: etag });
export const patchGroup = (g: string, patch: Record<string, unknown>, etag: string | null) => write<BookmarkGroupView>('PATCH', group(g), patch, { ifMatch: etag });
export const createGroup = (g: string, value: Record<string, unknown>) => write<BookmarkGroupView>('PUT', group(g), value, { createOnly: true });
export const claim = (id: string, req: ClaimRequest) => write<AppView>('POST', `/api/observed/${encodeURIComponent(id)}/claim`, req);
export const ignore = (id: string, by: IgnoreRequest['by']) => write<{ ok: true }>('POST', `/api/observed/${encodeURIComponent(id)}/ignore`, { by } satisfies IgnoreRequest);

/** "Lost at last reboot": run one again once, or as a service (`hallway run`, without or with --persist). */
export const reviveLost = (id: string, how: 'restart' | 'service', req: LostActionRequest = {}) => write<LostActionResponse>('POST', `/api/lost/${encodeURIComponent(id)}/${how}`, req);
/** Dismiss one lost item, or (no id) the whole notice. */
export const dismissLost = (id?: string) => write<{ dismissed: number; lost: LostNotice | null }>('POST', id ? `/api/lost/${encodeURIComponent(id)}/dismiss` : '/api/lost/dismiss', {});

/** The dashboard's Turn on (D65): setup in a tier that needs no administrator, run by the daemon. */
export const turnOnFronting = (trust: 'user' | 'none') => write<FrontingSetupJob>('POST', '/api/fronting/setup', { trust });
export const getFrontingSetup = () => getJson<FrontingSetupJob>('/api/fronting/setup');

/** Show (true) or dismiss (false) a dashboard hint: `dashboard.hints` in config.yaml, so every browser agrees (D63). */
export const setHints = (hints: HintsRequest) => write<ConfigView>('PATCH', '/api/hints', hints);

/** Where a card's thumbnail is: the etag in the query, so a new picture is a new URL. */
export const thumbUrl = (slug: string, etag: string) => `${app(slug)}/thumb?v=${encodeURIComponent(etag.replace(/"/g, ''))}`;
/** A bookmark's favicon (204 while there's none). `v` changes when the group's icons might have. */
export const bookmarkIconUrl = (g: string, url: string, v: number) => `${group(g)}/icon?url=${encodeURIComponent(url)}&v=${v}`;
