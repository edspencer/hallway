// Which base domains fronted mode accepts (docs/03-networking.md, "Choosing the base domain"; D5, D24):
//   localhost, *.internal, *.test, *.home.arpa      fine
//   .local (and anything under it)                  refused: mDNS owns it, and wildcards don't work
//   an HSTS-preloaded TLD (.dev, .app, …)           refused: a real TLD, and browsers force HTTPS on all of it
//   any other delegated TLD (.com, .io, …)          warned: a real TLD (a subdomain of a domain you own can work)
//   a made-up TLD (not delegated, not reserved)     warned: it squats on a name ICANN could delegate later
// Whether a TLD is delegated comes from IANA's list, fetched and cached for a week; failing to fetch it is a warning.
import fs from 'node:fs';
import path from 'node:path';
import { tldOf } from './names.js';

/** TLDs reserved for exactly this kind of use, never delegated. */
export const RESERVED_TLDS = ['localhost', 'internal', 'test', 'example', 'invalid'];

/**
 * Whole TLDs on Chromium's HSTS preload list (entries with no dot and include_subdomains), extracted from
 * net/http/transport_security_state_static.json on 2026-10-16 (docs/11-research-notes.md). Browsers refuse plain HTTP
 * anywhere under them.
 */
export const HSTS_PRELOADED_TLDS = [
  'amazon', 'android', 'app', 'audible', 'azure', 'bank', 'bing', 'boo', 'channel', 'chrome', 'dad', 'day', 'dev', 'eat', 'esq', 'fire', 'fly',
  'foo', 'fujitsu', 'gle', 'gmail', 'google', 'hangout', 'hotmail', 'imdb', 'ing', 'insurance', 'kindle', 'meet', 'meme', 'microsoft', 'mov',
  'new', 'nexus', 'office', 'page', 'phd', 'play', 'prime', 'prof', 'rsvp', 'search', 'silk', 'skype', 'windows', 'xbox', 'xn--cckwcxetd',
  'xn--jlq480n2rg', 'youtube', 'zappos', 'zip',
];

export const IANA_TLDS_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
const CACHE_MS = 7 * 24 * 3600_000;

export interface TldVerdict {
  verdict: 'ok' | 'warn' | 'refuse';
  /** For people: why. */
  reason: string;
}

/**
 * The verdict on a base domain. `delegated`: IANA's TLD list (lower-case), or null when it couldn't be had (then a
 * TLD that isn't reserved gets a warning that says the check couldn't be made).
 */
export function tldVerdict(base: string, delegated: ReadonlySet<string> | null): TldVerdict {
  const b = base.toLowerCase().replace(/\.$/, '');
  const tld = tldOf(b);
  if (tld === 'local')
    return {
      verdict: 'refuse',
      reason: `.local is reserved for multicast DNS (Bonjour, RFC 6762): the system resolver sends .local names to mDNS, a resolver file for it is unreliable, and wildcards don't work. Use a name under .internal instead, e.g. ${b.replace(/\.local$/, '')}.internal`,
    };
  if (b === 'localhost' || tld === 'localhost') return { verdict: 'ok', reason: '*.localhost resolves to loopback with no DNS set-up (RFC 6761)' };
  if (tld === 'internal') return { verdict: 'ok', reason: '.internal is reserved by ICANN for private use and will never be delegated' };
  if (tld === 'test') return { verdict: 'ok', reason: '.test is reserved for testing (RFC 6761)' };
  if (b === 'home.arpa' || b.endsWith('.home.arpa')) return { verdict: 'ok', reason: 'home.arpa is reserved for home networks (RFC 8375)' };
  if (tld === 'example' || tld === 'invalid') return { verdict: 'refuse', reason: `.${tld} is reserved (RFC 6761) for documentation or for names that must never resolve; use .internal` };
  if (HSTS_PRELOADED_TLDS.includes(tld))
    return { verdict: 'refuse', reason: `.${tld} is a real TLD on the browsers' HSTS preload list (like .dev and .app): it isn't yours to use locally. Use a name under .internal instead` };
  if (!delegated) return { verdict: 'warn', reason: `couldn't fetch IANA's TLD list to check whether .${tld} is a real TLD; prefer a name under .internal` };
  if (delegated.has(tld))
    return {
      verdict: 'warn',
      reason: `.${tld} is a real, delegated TLD: unless ${b} is a domain you own, you'd be shadowing someone else's names on this machine. Prefer a name under .internal`,
    };
  return {
    verdict: 'warn',
    reason: `.${tld} isn't a TLD today, but it isn't reserved either: ICANN could delegate it (a new round of applications is under way), and you'd then be shadowing the real names on this machine. It keeps working locally; .internal is the reserved choice`,
  };
}

/** Parse IANA's list: one upper-case TLD per line, `#` comments. */
export function parseTlds(text: string): Set<string> {
  return new Set(
    text
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#')),
  );
}

/**
 * IANA's TLD list, from `cache/iana-tlds.txt` if it's under a week old, else fetched (and cached). A failed fetch
 * falls back to a stale cache, else null.
 */
export async function delegatedTlds(cacheDir: string, { fetchImpl = fetch, now = Date.now(), timeoutMs = 5000 } = {}): Promise<Set<string> | null> {
  const file = path.join(cacheDir, 'iana-tlds.txt');
  let stale: string | null = null;
  try {
    const st = fs.statSync(file);
    stale = fs.readFileSync(file, 'utf8');
    if (now - st.mtimeMs < CACHE_MS) return parseTlds(stale);
  } catch {
    /* no cache yet */
  }
  try {
    const res = await fetchImpl(IANA_TLDS_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const tlds = parseTlds(text);
    if (!tlds.has('com')) throw new Error("that isn't IANA's TLD list");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, text);
    return tlds;
  } catch {
    return stale ? parseTlds(stale) : null;
  }
}
