// HTTP sniff (docs/04-apps-health-services.md, "Observed listeners", step 3): `GET /` with a 2 s timeout. Anything
// that answers HTTP at all, with any status, is a web app; record the status, the page title and the favicon link.
// Anything else goes in the collapsed "other listeners" group.
import http from 'node:http';
import https from 'node:https';
import { VERSION } from '../config.js';

export interface Sniff {
  status: number;
  title: string | null;
  favicon: string | null;
  /** The media type, without parameters (`text/html`, `application/json`). Absent in records from before 0.9. */
  contentType?: string | null;
  /** A redirect's `Location`, as sent. */
  location?: string | null;
  /** It answered over HTTPS (D73). */
  tls?: boolean;
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

/** A plain-HTTP answer that says the port wants TLS: Go's servers, nginx and others answer 400 with words like these. */
const WANTS_TLS = /HTTP request to an HTTPS server|plain HTTP request was sent to HTTPS port|speak(s)? HTTPS|TLS handshake|https:\/\/ is required/i;

type Attempt = { sniff: Sniff; wantsTls: boolean } | 'refused' | 'timeout';

function attempt(secure: boolean, address: string, port: number, timeoutMs: number): Promise<Attempt> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Attempt) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      resolve(v);
    };
    const options = {
      host: address,
      port,
      path: '/',
      headers: { host: `localhost:${port}`, 'user-agent': `hallway/${VERSION}`, accept: 'text/html,*/*' },
      agent: false,
    } as const;
    // a development server's certificate is self-signed or for another name: this only looks, so any certificate does
    const req = secure ? https.get({ ...options, rejectUnauthorized: false, servername: 'localhost' }) : http.get(options);
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    req.on('error', () => finish('refused'));
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() || null;
      const location = typeof res.headers.location === 'string' ? res.headers.location : null;
      const html = /html/i.test(contentType ?? '');
      let body = '';
      const parse = () =>
        finish({
          sniff: { status, title: html ? htmlTitle(body) : null, favicon: html ? htmlFavicon(body) : null, contentType, location, tls: secure },
          wantsTls: !secure && status === 400 && WANTS_TLS.test(body),
        });
      // a 400 that isn't a page may be a TLS server saying so: read a little of it; otherwise only pages are read
      const limit = html ? MAX_BODY : status === 400 ? 1024 : 0;
      if (!limit) return parse();
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        // everything we want is in <head>
        if (body.length >= limit || (html && /<\/head>/i.test(body))) parse();
      });
      res.on('end', parse);
      res.on('error', parse);
    });
  });
}

/**
 * `GET /` on `address`:`port`. Resolves with what it learned, or null if the listener doesn't speak HTTP (or didn't
 * answer within the timeout). Never follows redirects: a 302 to a login page is a web app. A listener that only speaks
 * HTTPS (it hung up on plain HTTP, or answered 400 saying it wants TLS) is asked again over TLS, any certificate
 * accepted (D73), and its answer is marked `tls`.
 */
export async function sniff(address: string, port: number, { timeoutMs = 2000 } = {}): Promise<Sniff | null> {
  const plain = await attempt(false, address, port, timeoutMs);
  // silence isn't TLS (a TLS server answers a stray `GET` with an alert or a hang-up), so a timeout isn't asked again
  if (plain === 'timeout' || (plain !== 'refused' && !plain.wantsTls)) return plain === 'timeout' ? null : plain.sniff;
  const secure = await attempt(true, address, port, timeoutMs);
  if (typeof secure === 'object') return secure.sniff;
  return plain === 'refused' ? null : plain.sniff;
}
