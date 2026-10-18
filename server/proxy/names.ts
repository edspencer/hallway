// Fronted mode's names (docs/03-networking.md, "Hostname scheme"): an app is `<slug>.<base>` plus `<alias>.<base>` for
// each of its `proxy.aliases`; the dashboard is `domain.dashboard`. Pure functions, shared by the Caddy config, the
// fallback page, the links the API returns and `hallway setup`.
import { isLoopbackHost } from '../loopback.js';

/** `https://review.localhost`, or `https://review.localhost:4443` when links carry a port (`proxy.publicPort`). */
export function httpsUrl(host: string, publicPort = 443): string {
  return publicPort === 443 ? `https://${host}` : `https://${host}:${publicPort}`;
}

/** A link in fronted mode, by config.yaml's `proxy.scheme` and `proxy.publicPort`: `https://review.localhost`,
 *  `https://review.localhost:4443`, `http://review.localhost`, `http://review.localhost:4480` (D65's tiers). */
export function publicUrl(host: string, proxy: { scheme: 'https' | 'http'; publicPort: number }): string {
  const port = publicPort(proxy);
  return `${proxy.scheme}://${host}${port === (proxy.scheme === 'https' ? 443 : 80) ? '' : `:${port}`}`;
}

/** The port in links: `publicPort`, except that the default 443 means 80 for plain HTTP. */
export function publicPort(proxy: { scheme: 'https' | 'http'; publicPort: number }): number {
  return proxy.scheme === 'http' && proxy.publicPort === 443 ? 80 : proxy.publicPort;
}

/** Every hostname an app answers on: `<slug>.<base>` first, then its aliases, lower-case, without duplicates. */
export function appHosts(slug: string, aliases: readonly string[], base: string): string[] {
  return [...new Set([slug, ...aliases].map((l) => `${l}.${base}`.toLowerCase()))];
}

/**
 * Where Caddy dials an app: `localhost:<port>` for a loopback or wildcard host, so Caddy's resolver tries ::1 and
 * 127.0.0.1 on every connection and reaches the server in whichever family it bound (D68); otherwise `host:port`, with
 * an IPv6 address in brackets.
 */
export function dialAddress(host: string, port: number): string {
  if (isLoopbackHost(host)) return `localhost:${port}`;
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h.includes(':') ? `[${h}]:${port}` : `${h}:${port}`;
}

/** The last label of a domain: `myname.internal` → `internal`. */
export const tldOf = (base: string) => base.toLowerCase().replace(/\.$/, '').split('.').pop() ?? '';
