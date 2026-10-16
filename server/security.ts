import type { MiddlewareHandler } from 'hono';

// DNS rebinding / CSRF: the daemon only listens on 127.0.0.1, but a web page could still reach it via a DNS name that
// resolves to 127.0.0.1 (rebinding) or by POSTing a "simple" cross-site request. So:
// - every request must carry a loopback Host header (or one of the extra hosts: in fronted mode the configured
//   dashboard host; in development, HALLWAY_DEV_ALLOWED_HOSTS);
// - writes must be JSON (forces a CORS preflight, which we never grant) and, if the browser sends an Origin, it must
//   be an allowed host too. DELETE has no body, so it's exempt from the Content-Type rule but not the Origin rule.
// No CORS headers are ever sent. (docs/02-architecture.md, "Security model".)

function hostname(host: string) {
  const h = host.toLowerCase();
  // [::1]:4255 → [::1]; localhost:4255 → localhost
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.replace(/:\d+$/, '');
}

export function isLocalHost(host: string | undefined | null, extra: readonly string[] = []): boolean {
  if (!host) return false;
  const h = hostname(host);
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || extra.includes(h);
}

export function isLocalOrigin(origin: string, extra: readonly string[] = []): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && isLocalHost(u.host, extra);
  } catch {
    return false;
  }
}

/**
 * The middleware for every route. `extra` lists lower-case hostnames (no port) to accept besides loopback; as a
 * function it's asked on every request, so a host that depends on config.yaml (fronted mode's dashboard host) follows
 * edits to it.
 */
export function localOnly(extra: readonly string[] | (() => readonly string[]) = []): MiddlewareHandler {
  return async (c, next) => {
    const extraHosts = typeof extra === 'function' ? extra() : extra;
    if (!isLocalHost(c.req.header('host'), extraHosts)) return c.json({ error: 'forbidden host' }, 403);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin && !isLocalOrigin(origin, extraHosts)) return c.json({ error: 'forbidden origin' }, 403);
      const ct = c.req.header('content-type') ?? '';
      if (c.req.method !== 'DELETE' && !/^application\/json\b/i.test(ct)) return c.json({ error: 'expected Content-Type: application/json' }, 415);
    }
    await next();
  };
}
