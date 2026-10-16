// Tier-1 thumbnails (D13, docs/05-ui.md "Thumbnails"): each app's and each bookmark's favicon, found once, cached in
// `cache/favicons/`, and served with an ETag. It plugs into the core as a provider (D35): `thumb(slug)` for
// `GET /api/apps/:slug/thumb` (and the `thumb` etag on each AppView), `bookmarkIcon(link)` for
// `GET /api/bookmarks/:group/icon`. Lookups never block a request: a missing or stale icon is fetched in the
// background, and a `thumb` (app) or `bookmarks` (group) event tells the dashboard when one arrives or changes.
//
// The `icon:` key of an app or bookmark picks the source: `auto` (the default) looks the site up; an `http(s)` URL is
// fetched as the image itself; a path is read from the data home (and only from inside it); anything else (an emoji)
// isn't an image at all, so there's no thumbnail and the dashboard draws the text.
//
// The other two tiers live beside it: screenshots (shots.ts, opt-in: `thumbnails.mode: screenshot` after `hallway thumbs
// enable`) and generated cards (card.ts). `pickThumb` decides which one an app's thumbnail is (D54).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, ThumbKind } from '../../shared/api.js';
import { VERSION, expandHome } from '../config.js';
import { appUrl } from '../views.js';
import { loadPlaywright, type PlaywrightLike } from './browser.js';
import { type CardModel, cardEtag, cardSvg, svgToPng } from './card.js';
import { Shots } from './shots.js';
import type { EventBus } from '../events.js';
import type { ProviderRegistry } from '../providers.js';
import type { Store } from '../store/index.js';
import { LIMITS, findFavicon, sniffImage, type FetchedIcon } from './favicon.js';

export interface Icon {
  body: Uint8Array;
  contentType: string;
  etag: string;
}

/** How long an answer is good for, by kind of site. Local apps change and come and go; remote sites rarely do. */
export const TTL = {
  local: { fresh: 6 * 3600_000, retryNone: 10 * 60_000 },
  remote: { fresh: 7 * 24 * 3600_000, retryNone: 24 * 3600_000 },
};

interface Rec {
  /** Null: looked, found nothing. */
  icon: Icon | null;
  checkedAt: number;
}

interface Meta {
  key: string;
  contentType: string | null;
  etag: string | null;
  source: string | null;
  checkedAt: number;
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const etagOf = (b: Uint8Array) => `"${hash(Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1')).slice(0, 16)}"`;

function writeBinaryAtomic(file: string, data: Uint8Array | string) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, data, { flag: 'wx' });
  fs.renameSync(tmp, file);
}

export interface CacheOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Called (with the source key) when a key's icon appears, changes or goes. */
  onChange?: (key: string) => void;
}

/**
 * Icons by source key (`page:<url>`, `image:<url>`, `file:<path>`), in memory and on disk. `get` answers at once from
 * what's known and starts a background lookup when that's missing or stale.
 */
export class IconCache {
  private mem = new Map<string, Rec>();
  private inflight = new Map<string, Promise<void>>();
  private fetchImpl: typeof fetch;
  private now: () => number;

  constructor(
    private dir: string,
    private opts: CacheOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  private file(key: string, ext: string) {
    return path.join(this.dir, `${hash(key).slice(0, 24)}.${ext}`);
  }

  /** What's on disk for a key, read once per daemon run. */
  private load(key: string): Rec | undefined {
    try {
      const meta = JSON.parse(fs.readFileSync(this.file(key, 'json'), 'utf8')) as Meta;
      if (meta.key !== key) return undefined; // a (vanishingly unlikely) hash collision
      const icon = meta.contentType && meta.etag ? { body: new Uint8Array(fs.readFileSync(this.file(key, 'img'))), contentType: meta.contentType, etag: meta.etag } : null;
      const rec = { icon, checkedAt: meta.checkedAt };
      this.mem.set(key, rec);
      return rec;
    } catch {
      return undefined;
    }
  }

  private save(key: string, rec: Rec, source: string | null) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (rec.icon) writeBinaryAtomic(this.file(key, 'img'), rec.icon.body);
      const meta: Meta = { key, contentType: rec.icon?.contentType ?? null, etag: rec.icon?.etag ?? null, source, checkedAt: rec.checkedAt };
      writeBinaryAtomic(this.file(key, 'json'), JSON.stringify(meta) + '\n');
    } catch (e) {
      process.stderr.write(`hallway: [thumbs] can't cache an icon: ${(e as Error).message}\n`);
    }
  }

  /** The icon for `key`, if one is known; starts a lookup with `look` when nothing is known or it's stale. */
  get(key: string, look: () => Promise<FetchedIcon | null>, ttl = TTL.remote): Icon | null {
    const rec = this.mem.get(key) ?? this.load(key);
    const age = rec ? this.now() - rec.checkedAt : Infinity;
    if (!rec || age > (rec.icon ? ttl.fresh : ttl.retryNone)) void this.refresh(key, look);
    return rec?.icon ?? null;
  }

  /** What's known for `key`, without starting a lookup: undefined if it has never been looked up. */
  peek(key: string): Rec | undefined {
    return this.mem.get(key) ?? this.load(key);
  }

  /** Look `key` up now, unless a lookup is already running. Resolves when it's done. */
  refresh(key: string, look: () => Promise<FetchedIcon | null>): Promise<void> {
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      let found: FetchedIcon | null = null;
      try {
        found = await look();
      } catch {
        found = null;
      }
      const prev = this.mem.get(key);
      const icon = found ? { body: found.body, contentType: found.contentType, etag: etagOf(found.body) } : null;
      const rec = { icon, checkedAt: this.now() };
      this.mem.set(key, rec);
      this.save(key, rec, found?.source ?? null);
      if ((prev?.icon?.etag ?? null) !== (icon?.etag ?? null)) this.opts.onChange?.(key);
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Wait for every running lookup (tests, shutdown). */
  async settle() {
    while (this.inflight.size) await Promise.all([...this.inflight.values()]);
  }
}

/** Where to reach an app from the daemon: its own host and port, with wildcard binds mapped to loopback. */
export function appPageUrl(c: Pick<AppConfig, 'host' | 'port'>): string {
  const h = c.host.toLowerCase();
  const host = ['0.0.0.0', '*', ''].includes(h) ? '127.0.0.1' : h === '::' ? '[::1]' : h.includes(':') ? `[${h.replace(/^\[|\]$/g, '')}]` : h;
  return `http://${host}:${c.port}/`;
}

/** How an `icon:` value is looked up: a site, an image URL, a file in the data home, or not an image at all. */
export function iconSource(icon: string, pageUrl: string | null, home: string): { key: string; kind: 'page' | 'image' | 'file'; target: string } | null {
  const v = icon.trim();
  if (v === '' || v === 'auto') return pageUrl ? { key: `page:${pageUrl}`, kind: 'page', target: pageUrl } : null;
  if (/^https?:\/\//i.test(v)) return { key: `image:${v}`, kind: 'image', target: v };
  if (v.startsWith('/') || v.startsWith('~/') || v.startsWith('./') || /^[\w.-]+\/[\w./-]+\.\w+$/.test(v)) {
    const abs = path.resolve(home, expandHome(v));
    const rel = path.relative(home, abs);
    // only images inside the data home: the dashboard must not become a way to read any file on the machine
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return { key: `file:${abs}`, kind: 'file', target: abs };
  }
  return null; // an emoji or other text: drawn by the dashboard
}

/**
 * Which tier an app's thumbnail is (D54). `favicon` (the default): the favicon, else none (the dashboard draws a
 * monogram). `screenshot`: the screenshot, else the favicon, else none. `card`: always the generated card. A card is
 * never a silent fallback: on a door it repeats the name printed under it, and a monogram reads better (D54).
 */
export function pickThumb(mode: ThumbKind, have: { screenshot: boolean; favicon: boolean; card: boolean }): ThumbKind | null {
  const order: ThumbKind[] = mode === 'screenshot' ? ['screenshot', 'favicon'] : mode === 'card' ? ['card'] : ['favicon'];
  return order.find((k) => have[k]) ?? null;
}

/** An address as a card shows it: no scheme, no trailing slash. */
export const shortAddress = (url: string) => url.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');

export interface ThumbsOptions {
  store: Store;
  bus: EventBus;
  providers: ProviderRegistry;
  /** Defaults to `<home>/cache/favicons`. */
  dir?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Defaults to `<home>/cache/thumbs` (screenshots). */
  shotsDir?: string;
  /** Loads playwright-core (tests pass a fake). Defaults to the copy `hallway thumbs enable` installed. */
  playwright?: () => Promise<PlaywrightLike | null>;
  /** How often to look for screenshots that are due (default a minute). */
  tickMs?: number;
}

/** Plug the favicon thumbnailer into the daemon. Returns a function that unplugs it. */
export function startThumbs({ store, bus, providers, dir = path.join(store.home, 'cache', 'favicons'), fetch: f, now, shotsDir = path.join(store.home, 'cache', 'thumbs'), playwright, tickMs = 60_000 }: ThumbsOptions) {
  const doFetch = f ?? fetch;
  /** Source keys → the app slugs and bookmark groups that use them, for change events. */
  const users = new Map<string, { slugs: Set<string>; groups: Set<string> }>();
  const use = (key: string, who: { slug?: string; group?: string }) => {
    let u = users.get(key);
    if (!u) users.set(key, (u = { slugs: new Set(), groups: new Set() }));
    if (who.slug) u.slugs.add(who.slug);
    if (who.group) u.groups.add(who.group);
  };
  const cache = new IconCache(dir, {
    fetch: doFetch,
    now,
    onChange: (key) => {
      const u = users.get(key);
      for (const slug of u?.slugs ?? []) bus.emit({ type: 'thumb', slug });
      for (const group of u?.groups ?? []) bus.emit({ type: 'bookmarks', group });
    },
  });

  const lookup = (src: NonNullable<ReturnType<typeof iconSource>>, local: boolean) => async (): Promise<FetchedIcon | null> => {
    const headers: Record<string, string> = local ? { 'User-Agent': `hallway/${VERSION}` } : {};
    if (src.kind === 'page') return findFavicon(src.target, { fetch: doFetch, headers });
    if (src.kind === 'file') {
      const st = fs.statSync(src.target, { throwIfNoEntry: false });
      if (!st?.isFile() || st.size > LIMITS.maxIconBytes) return null;
      const body = new Uint8Array(fs.readFileSync(src.target));
      const type = sniffImage(body);
      return type ? { body, contentType: type, source: src.target } : null;
    }
    const res = await doFetch(src.target, { headers, redirect: 'follow', signal: AbortSignal.timeout(LIMITS.timeoutMs) });
    if (!res.ok) return null;
    const body = new Uint8Array(await res.arrayBuffer());
    const type = body.byteLength <= LIMITS.maxIconBytes ? sniffImage(body) : null;
    return type ? { body, contentType: type, source: res.url || src.target } : null;
  };

  const appSource = (slug: string) => {
    const c = store.apps.get(slug)?.value;
    if (c) return iconSource(c.icon, appPageUrl(c), store.home);
    const d = providers.all('discovered').find((x) => x.slug === slug);
    return d ? iconSource('auto', d.url ?? appPageUrl(d), store.home) : null;
  };

  const favicon = (slug: string): Icon | null => {
    const src = appSource(slug);
    if (!src) return null;
    use(src.key, { slug });
    return cache.get(src.key, lookup(src, src.kind === 'page'), src.kind === 'page' ? TTL.local : TTL.remote);
  };

  const shots = new Shots(shotsDir, {
    load: playwright ?? (() => loadPlaywright(store.home)),
    now,
    onChange: (slug) => bus.emit({ type: 'thumb', slug }),
    log: (s) => process.stderr.write(s),
  });
  const mode = () => store.currentConfig().thumbnails.mode;

  /** What a card shows for an app, or null for a slug that isn't an app. */
  const cardModel = (slug: string): CardModel | null => {
    const cfg = store.currentConfig();
    const e = store.apps.get(slug);
    const c = e?.value;
    const d = e ? null : providers.all('discovered').find((x) => x.slug === slug);
    if (!e && !d) return null;
    const at = c ?? d;
    const id = at ? providers.first('appIdentity', { slug, port: at.port, host: at.host }) : null;
    const url = d?.url ?? (at ? appUrl(slug, at.port, at.host, cfg) : null);
    return { slug, name: c?.name ?? d?.name ?? slug, address: url ? shortAddress(url) : null, framework: id?.framework ?? null, repo: id?.repo ?? null, branch: id?.branch ?? null };
  };
  /** Drawn cards by slug: drawn when first asked for, again only when what they show changes. */
  const cards = new Map<string, { etag: string; body: Uint8Array }>();
  const card = (slug: string) => {
    const m = cardModel(slug);
    if (!m) return null;
    const etag = cardEtag(m);
    return {
      contentType: 'image/png',
      etag,
      kind: 'card' as const,
      // drawn only when the bytes are wanted: not for the ETag in every AppView, nor for a 304
      get body(): Uint8Array {
        const had = cards.get(slug);
        if (had?.etag === etag) return had.body;
        const body = new Uint8Array(svgToPng(cardSvg(m)));
        cards.set(slug, { etag, body });
        return body;
      },
    };
  };

  const thumb = (slug: string) => {
    const m = mode();
    const shot = m === 'screenshot' ? shots.get(slug) : null;
    const fav = m === 'card' ? null : favicon(slug);
    const c = m === 'card' ? card(slug) : null;
    const kind = pickThumb(m, { screenshot: !!shot, favicon: !!fav, card: !!c });
    if (kind === 'screenshot') return { ...shot!, kind };
    if (kind === 'favicon') return { ...fav!, kind };
    return kind === 'card' ? c : null;
  };

  /** Apps a screenshot could be taken of: declared and discovered (never bookmarks), with the page and the PID behind it. */
  const shootable = () => {
    const out: { slug: string; url: string; pid: number | null; healthy: boolean }[] = [];
    const add = (slug: string, port: number, host: string, url: string) => {
      const h = providers.first('appHealth', slug);
      const pid = providers.first('appIdentity', { slug, port, host })?.pid ?? null;
      out.push({ slug, url, pid, healthy: h?.state === 'healthy' });
    };
    for (const [slug, e] of store.apps) if (e.value) add(slug, e.value.port, e.value.host, appPageUrl(e.value));
    for (const d of providers.all('discovered')) if (!store.apps.has(d.slug)) add(d.slug, d.port, d.host, d.url ?? appPageUrl(d));
    return out;
  };
  /** Queue the healthy apps whose screenshot is due (or `only` that one, regardless, when `force`). */
  const shootDue = (only?: string, force = false) => {
    if (mode() !== 'screenshot') return 0;
    let n = 0;
    for (const a of shootable()) if (a.healthy && (!only || a.slug === only) && shots.want(a.slug, a.url, a.pid, force)) n++;
    return n;
  };
  let lastMode = mode();
  const tick = setInterval(() => shootDue(), tickMs);
  tick.unref?.();

  const bookmarkIcon = (link: { url: string; icon: string }, group?: string): Icon | null => {
    const src = iconSource(link.icon, link.url, store.home);
    if (!src) return null;
    use(src.key, { group });
    return cache.get(src.key, lookup(src, false), TTL.remote);
  };

  /** Look up every app's icon that hasn't been looked up yet (at start, and when apps change), ahead of the page. */
  const warmApps = () => {
    for (const slug of store.apps.keys()) favicon(slug);
  };

  /** Look up every bookmark's icon that hasn't been looked up yet, so the first visit to the page finds them. */
  const warmBookmarks = () => {
    for (const [group, e] of store.groups) for (const l of e.value?.links ?? []) {
      const src = iconSource(l.icon, l.url, store.home);
      if (src && !cache.peek(src.key)) bookmarkIcon(l, group);
    }
  };

  const unsub = bus.subscribe((e) => {
    // a door just opened: its favicon is worth another look straight away
    if (e.type === 'state' && e.state === 'healthy') {
      shootDue(e.slug);
      const src = appSource(e.slug);
      if (src && !cache.peek(src.key)?.icon) {
        use(src.key, { slug: e.slug });
        void cache.refresh(src.key, lookup(src, src.kind === 'page'));
      }
    }
    if (e.type === 'bookmarks') warmBookmarks();
    if (e.type === 'apps' || (e.type === 'app' && e.reason === 'config')) warmApps();
    if (e.type === 'config') {
      const m = mode();
      if (m === lastMode) return;
      // every door's picture may change kind: tell the dashboard about each
      for (const a of shootable()) bus.emit({ type: 'thumb', slug: a.slug });
      // screenshots off: close the browser (disable is about to delete it) and forget the pictures
      if (lastMode === 'screenshot') void shots.reset();
      lastMode = m;
      if (m === 'screenshot') shootDue();
    }
  }, { internal: true });
  const off = providers.register({
    name: 'thumbs',
    thumb,
    async refreshThumbs(slug?: string) {
      if (mode() !== 'screenshot') return 0;
      const before = new Map(shootable().map((a) => [a.slug, shots.get(a.slug)?.takenAt ?? null]));
      shootDue(slug, true);
      await shots.settle();
      return [...before].filter(([s, t]) => (shots.get(s)?.takenAt ?? null) !== t).length;
    },
    bookmarkIcon: (link, group) => bookmarkIcon(link, group),
  });
  const warm = setTimeout(() => (warmApps(), warmBookmarks()), 0);
  warm.unref?.();

  return {
    cache,
    shots,
    cards,
    stop() {
      clearTimeout(warm);
      clearInterval(tick);
      void shots.stop();
      unsub();
      off();
    },
  };
}
