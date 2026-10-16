// Finding a site's favicon (docs/05-ui.md, "Thumbnails", tier 1): fetch the page once, read its `<link rel="icon">`,
// `apple-touch-icon` and web-app manifest icons, fall back to `/favicon.ico`, and take the largest that loads. Pure
// parsing is split from fetching so it can be tested without a network. The dominant colour of the tile is picked in
// the dashboard, from the image itself (src/lib/colour.ts): that needs a decoder, and the browser already has one.

/** An icon the page points at, with what it says about its size (0: unknown). */
export interface IconCandidate {
  url: string;
  size: number;
  type: string | null;
  /** Where it was found, for logs: `link`, `apple-touch-icon`, `manifest`, `default`. */
  from: string;
}

export interface FetchedIcon {
  body: Uint8Array;
  contentType: string;
  /** The URL it was finally read from. */
  source: string;
}

/** Limits for one lookup: a favicon is never worth waiting on or holding much memory for. */
export const LIMITS = { timeoutMs: 4000, maxPageBytes: 512 * 1024, maxIconBytes: 512 * 1024, maxCandidates: 4 };

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
};

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The largest edge in a `sizes` attribute (`16x16 32x32`), `any` as very large (an SVG), 0 if absent. */
export function parseSizes(sizes: string | null): number {
  if (!sizes) return 0;
  let best = 0;
  for (const s of sizes.toLowerCase().split(/\s+/)) {
    if (s === 'any') best = Math.max(best, 1024);
    const m = /^(\d+)x(\d+)$/.exec(s);
    if (m) best = Math.max(best, Math.min(Number(m[1]), Number(m[2])));
  }
  return best;
}

function resolve(href: string, base: string): string | null {
  try {
    const u = new URL(decodeEntities(href), base);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The icons a page's HTML points at, and its manifest's URL. Only the `<head>`-ish part is read. */
export function parseIconLinks(html: string, pageUrl: string): { icons: IconCandidate[]; manifest: string | null } {
  const icons: IconCandidate[] = [];
  let manifest: string | null = null;
  // a <base href> changes what relative links resolve against
  const baseTag = /<base\s[^>]*>/i.exec(html)?.[0];
  const base = (baseTag && resolve(attr(baseTag, 'href') ?? '', pageUrl)) || pageUrl;
  for (const [tag] of html.matchAll(/<link\s[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr(tag, 'href');
    if (!href) continue;
    const url = resolve(href, base);
    if (!url) continue;
    if (rel.includes('manifest')) {
      manifest ??= url;
      continue;
    }
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!touch && !rel.includes('icon')) continue;
    if (rel.includes('mask-icon')) continue; // a monochrome Safari pinned-tab silhouette, not a picture
    const type = attr(tag, 'type')?.toLowerCase() ?? null;
    let size = parseSizes(attr(tag, 'sizes'));
    if (!size) size = touch ? 180 : type === 'image/svg+xml' || /\.svg(\?|$)/i.test(url) ? 1024 : 32;
    icons.push({ url, size, type, from: touch ? 'apple-touch-icon' : 'link' });
  }
  return { icons, manifest };
}

/** A web-app manifest's icons. */
export function parseManifest(json: string, manifestUrl: string): IconCandidate[] {
  try {
    const m = JSON.parse(json) as { icons?: { src?: unknown; sizes?: unknown; type?: unknown; purpose?: unknown }[] };
    if (!Array.isArray(m.icons)) return [];
    return m.icons.flatMap((i) => {
      if (typeof i?.src !== 'string') return [];
      // maskable icons are padded for a launcher's mask and look shrunken on a tile; prefer "any"
      const purpose = typeof i.purpose === 'string' ? i.purpose : 'any';
      if (!/\bany\b/.test(purpose) && /\bmaskable\b/.test(purpose)) return [];
      const url = resolve(i.src, manifestUrl);
      if (!url) return [];
      return [{ url, size: parseSizes(typeof i.sizes === 'string' ? i.sizes : null) || 192, type: typeof i.type === 'string' ? i.type : null, from: 'manifest' }];
    });
  } catch {
    return [];
  }
}

/** Largest first; on a tie, a bitmap before an SVG (it renders the same everywhere) and the page's own order. */
export function rankCandidates(cands: IconCandidate[]): IconCandidate[] {
  const seen = new Set<string>();
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.size - a.c.size || a.i - b.i)
    .map(({ c }) => c)
    .filter((c) => !seen.has(c.url) && (seen.add(c.url), true));
}

/** What an image's first bytes say it is, or null if it isn't one we'll serve. */
export function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length < 4) return null;
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || ((head.startsWith('<?xml') || head.startsWith('<!--')) && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

/** Read a body up to `max` bytes; null if it's larger. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function dataUrlImage(url: string): FetchedIcon | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const body = m[2] ? Uint8Array.from(Buffer.from(m[3], 'base64')) : new TextEncoder().encode(decodeURIComponent(m[3]));
  const type = sniffImage(body);
  return type && body.byteLength <= LIMITS.maxIconBytes ? { body, contentType: type, source: 'data:' } : null;
}

export interface LookupOptions {
  fetch?: typeof fetch;
  /** Extra request headers (a local app's probe sends `User-Agent: hallway/<version>`). */
  headers?: Record<string, string>;
  /** Overrides the per-request timeout (tests, shutdown). */
  signal?: AbortSignal;
}

/**
 * The best favicon for a page, or null if it has none that loads. Never throws for network or content problems;
 * those are "no icon".
 */
export async function findFavicon(pageUrl: string, opts: LookupOptions = {}): Promise<FetchedIcon | null> {
  const f = opts.fetch ?? fetch;
  const get = (url: string, accept: string) =>
    f(url, { headers: { Accept: accept, ...opts.headers }, redirect: 'follow', signal: opts.signal ?? AbortSignal.timeout(LIMITS.timeoutMs) });

  const cands: IconCandidate[] = [];
  let finalUrl = pageUrl;
  try {
    const res = await get(pageUrl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
    finalUrl = res.url || pageUrl;
    const type = res.headers.get('content-type') ?? '';
    const body = res.ok && /html|xml/i.test(type) ? await readCapped(res, LIMITS.maxPageBytes) : (await res.body?.cancel(), null);
    if (body) {
      const html = new TextDecoder().decode(body);
      const { icons, manifest } = parseIconLinks(html, finalUrl);
      cands.push(...icons);
      if (manifest && !manifest.startsWith('data:')) {
        try {
          const m = await get(manifest, 'application/manifest+json,application/json;q=0.9');
          const mb = m.ok ? await readCapped(m, 128 * 1024) : (await m.body?.cancel(), null);
          if (mb) cands.push(...parseManifest(new TextDecoder().decode(mb), m.url || manifest));
        } catch {
          /* no manifest: fine */
        }
      }
    }
  } catch {
    /* the page didn't load: still try /favicon.ico below */
  }
  try {
    cands.push({ url: new URL('/favicon.ico', finalUrl).href, size: 1, type: 'image/x-icon', from: 'default' });
  } catch {
    /* an odd URL: no default */
  }

  for (const c of rankCandidates(cands).slice(0, LIMITS.maxCandidates)) {
    if (c.url.startsWith('data:')) {
      const d = dataUrlImage(c.url);
      if (d) return d;
      continue;
    }
    try {
      const res = await get(c.url, 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5');
      if (!res.ok) {
        await res.body?.cancel();
        continue;
      }
      const body = await readCapped(res, LIMITS.maxIconBytes);
      const type = body && body.byteLength ? sniffImage(body) : null;
      if (body && type) return { body, contentType: type, source: res.url || c.url };
    } catch {
      /* try the next one */
    }
  }
  return null;
}
