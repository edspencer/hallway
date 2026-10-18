// An app's `host:` when it means "this machine" (D68, Q-IPV6). Servers on a Mac often listen on IPv6 loopback only:
// with modern Node, `localhost` resolves to ::1 first, so Vite, Astro, Next and anything else that binds `localhost`
// ends up on [::1]:<port> and nothing at 127.0.0.1:<port>. Elsewhere they're on 127.0.0.1 only, or on both. So a
// loopback (or wildcard) host is never taken to mean one family: whatever checks a port tries both, the configured
// one first, and Caddy dials `localhost:<port>`, which its resolver tries per connection in both families. Pure.

/** The loopback addresses to try for an app's `host:`, preferred first; null for any other host (tried as given). */
export function loopbackCandidates(host: string | undefined): string[] | null {
  const h = (host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '' || h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0' || h === '*') return ['127.0.0.1', '::1'];
  if (h === '::1' || h === '::') return ['::1', '127.0.0.1'];
  return null;
}

/** Whether `host:` means this machine, in either family. */
export const isLoopbackHost = (host: string | undefined) => loopbackCandidates(host) !== null;

/** The addresses to try for a host, in order: both loopback families, or the host itself. */
export const candidates = (host: string | undefined) => loopbackCandidates(host) ?? [(host ?? '').replace(/^\[|\]$/g, '')];

/** `[::1]:5100` or `127.0.0.1:5100`: an address and port as people (and URLs) write them. */
export const hostPort = (address: string, port: number) => `${address.includes(':') ? `[${address}]` : address}:${port}`;

/** Where something was looked for, for messages: `port 5100 (127.0.0.1 or ::1)`, or `192.168.1.20:5100`. */
export const lookedAt = (host: string | undefined, port: number) => (isLoopbackHost(host) ? `port ${port} (127.0.0.1 or ::1)` : hostPort(candidates(host)[0], port));
