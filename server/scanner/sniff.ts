// HTTP sniff (docs/04-apps-health-services.md, "Observed listeners", step 3): `GET /` with a 2 s timeout. Anything
// that answers HTTP at all, with any status, is a web app; record the status, the page title and the favicon link.
// Anything else goes in the collapsed "other listeners" group.
import http from 'node:http';
import { VERSION } from '../config.js';

export interface Sniff {
  status: number;
  title: string | null;
  favicon: string | null;
}

/** Read at most this much of the page looking for <title> and the icon link. */
const MAX_BODY = 256 * 1024;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });

/** The page's <title>, whitespace collapsed and entities decoded. */
export function htmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = m ? decode(m[1]).replace(/\s+/g, ' ').trim() : '';
  return t || null;
}

/** The href of the page's icon link (`rel="icon"`, `shortcut icon`, `apple-touch-icon`), as written. */
export function htmlFavicon(html: string): string | null {
  let fallback: string | null = null;
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1].toLowerCase().split(/\s+/) ?? [];
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = href ? decode(href[1] ?? href[2] ?? href[3]) : null;
    if (!value) continue;
    if (rel.includes('icon')) return value;
    if (rel.includes('apple-touch-icon')) fallback ??= value;
  }
  return fallback;
}

/**
 * `GET /` on `address`:`port`. Resolves with what it learned, or null if the listener doesn't speak HTTP (or didn't
 * answer within the timeout). Never follows redirects: a 302 to a login page is a web app.
 */
export function sniff(address: string, port: number, { timeoutMs = 2000 } = {}): Promise<Sniff | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Sniff | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      resolve(v);
    };
    const req = http.get({
      host: address,
      port,
      path: '/',
      headers: { host: `localhost:${port}`, 'user-agent': `hallway/${VERSION}`, accept: 'text/html,*/*' },
      agent: false,
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    req.on('error', () => finish(null));
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const html = /html/i.test(String(res.headers['content-type'] ?? ''));
      if (!html) return finish({ status, title: null, favicon: null });
      let body = '';
      const parse = () => finish({ status, title: htmlTitle(body), favicon: htmlFavicon(body) });
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        // everything we want is in <head>
        if (body.length >= MAX_BODY || /<\/head>/i.test(body)) parse();
      });
      res.on('end', parse);
      res.on('error', parse);
    });
  });
}
