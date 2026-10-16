// Fronted mode's names (docs/03-networking.md, "Hostname scheme"): an app is `<slug>.<base>` plus `<alias>.<base>` for
// each of its `proxy.aliases`; the dashboard is `domain.dashboard`. Pure functions, shared by the Caddy config, the
// fallback page, the links the API returns and `hallway setup`.

/** `https://review.localhost`, or `https://review.localhost:4443` when links carry a port (`proxy.publicPort`). */
export function httpsUrl(host: string, publicPort = 443): string {
  return publicPort === 443 ? `https://${host}` : `https://${host}:${publicPort}`;
}

/** Every hostname an app answers on: `<slug>.<base>` first, then its aliases, lower-case, without duplicates. */
export function appHosts(slug: string, aliases: readonly string[], base: string): string[] {
  return [...new Set([slug, ...aliases].map((l) => `${l}.${base}`.toLowerCase()))];
}

/** Where Caddy dials an app: `host:port`, with an IPv6 address in brackets and a wildcard bind reached on loopback. */
export function dialAddress(host: string, port: number): string {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '0.0.0.0' || h === '*' || h === '' || h === 'localhost') return `127.0.0.1:${port}`;
  if (h === '::') return `[::1]:${port}`;
  return h.includes(':') ? `[${h}]:${port}` : `${h}:${port}`;
}

/** The last label of a domain: `myname.internal` → `internal`. */
export const tldOf = (base: string) => base.toLowerCase().replace(/\.$/, '').split('.').pop() ?? '';
