// The Caddy configuration for fronted mode (D4, D9, D47): a pure function from the apps and config.yaml to Caddy's
// JSON, which the daemon pushes to Caddy's admin API and writes to generated/caddy.json (the file Caddy starts from).
//
//   https://<dashboard host>      → the daemon (Host kept: the daemon accepts its dashboard host in fronted mode)
//   https://<slug>.<base>, aliases → the app, with Host rewritten to the upstream (D9) unless proxy.preserveHost
//   http://<anything>             → a redirect to https:// on the public port
//   an upstream that doesn't answer → generated/fallback.html, with the upstream's error status
//
// Caddy runs as the user, on loopback ports above 1024 (proxy.httpsPort/httpPort); `hallway setup` redirects 443 and
// 80 to them. Its admin API is a Unix socket in the data home with mode 0600, never a TCP port, so only the user's own
// processes can reconfigure it, and it holds no privilege they don't already have (D47).
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, HallwayConfig } from '../../shared/api.js';
import { dataPaths } from '../config.js';
import { appHosts, dialAddress } from './names.js';

/** The name of Hallway's local CA. Caddy's root certificate is called `<name> - <year> ECC Root`. */
export const CA_NAME = 'Hallway Local CA';

/** Unix socket paths are limited to 104 bytes on macOS (108 on Linux), terminating NUL included. */
const MAX_SOCKET_PATH = 100;

/** Where fronted mode keeps Caddy's things in the data home. */
export function caddyPaths(home: string) {
  const p = dataPaths(home);
  const dir = path.join(p.state, 'caddy');
  let socket = path.join(dir, 'admin.sock');
  // a deep $HALLWAY_HOME would overflow sun_path; then the socket lives in the (per-user on macOS) temp directory
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH) socket = path.join(os.tmpdir(), `hallway-caddy-${crypto.createHash('sha256').update(home).digest('hex').slice(0, 12)}.sock`);
  return {
    dir,
    socket,
    /** Caddy's storage: the local CA, certificates, locks. */
    data: path.join(dir, 'data'),
    /** $XDG_CONFIG_HOME and $XDG_DATA_HOME for the Caddy job, so nothing lands in the user's own Caddy directories. */
    xdgConfig: path.join(dir, 'config'),
    xdgData: path.join(dir, 'xdg-data'),
    /** The root certificate `hallway setup` trusts. */
    rootCert: path.join(dir, 'data', 'pki', 'authorities', 'local', 'root.crt'),
    config: path.join(p.generated, 'caddy.json'),
    fallback: path.join(p.generated, 'fallback.html'),
    generated: p.generated,
  };
}

export interface ProxyAppInput {
  slug: string;
  config: AppConfig;
}

export interface CaddyInput {
  home: string;
  config: HallwayConfig;
  /** Declared apps with a good config (broken files are left out by the caller). */
  apps: readonly ProxyAppInput[];
  /** The daemon's port, for the dashboard host. */
  daemonPort: number;
  /** Listen on [::1] as well as 127.0.0.1 (false where IPv6 loopback is unavailable). */
  ipv6?: boolean;
}

export interface Route {
  host: string;
  /** `dashboard`, or the app's slug. */
  target: string;
  dial: string;
  preserveHost: boolean;
}

export interface CaddyOutput {
  /** Caddy's JSON config. */
  json: Record<string, unknown>;
  /** One per hostname, dashboard first. */
  routes: Route[];
  /** Names that couldn't be routed (a collision), for people. */
  problems: string[];
}

/** The routing table: the dashboard host, then each app's names in slug order. A name already taken is skipped. */
export function routeTable({ config, apps, daemonPort }: Pick<CaddyInput, 'config' | 'apps' | 'daemonPort'>): { routes: Route[]; problems: string[] } {
  const routes: Route[] = [{ host: config.domain.dashboard.toLowerCase(), target: 'dashboard', dial: `127.0.0.1:${daemonPort}`, preserveHost: true }];
  const problems: string[] = [];
  const owner = new Map(routes.map((r) => [r.host, r.target]));
  for (const { slug, config: app } of [...apps].sort((a, b) => a.slug.localeCompare(b.slug)))
    for (const host of appHosts(slug, app.proxy.aliases, config.domain.base)) {
      const taken = owner.get(host);
      if (taken) {
        problems.push(`${host} (apps/${slug}.yaml) is already ${taken === 'dashboard' ? "the dashboard's name" : `taken by apps/${taken}.yaml`}; not routed`);
        continue;
      }
      owner.set(host, slug);
      routes.push({ host, target: slug, dial: dialAddress(app.host, app.port), preserveHost: app.proxy.preserveHost });
    }
  return { routes, problems };
}

/** The `unix//abs/path|0600` address Caddy's admin API listens on. */
export const adminAddress = (socket: string) => `unix/${socket}|0600`;

export function caddyConfig(input: CaddyInput): CaddyOutput {
  const { config, ipv6 = true } = input;
  const paths = caddyPaths(input.home);
  const { routes, problems } = routeTable(input);
  const { httpsPort, httpPort, publicPort } = config.proxy;
  const listen = (port: number) => [`127.0.0.1:${port}`, ...(ipv6 ? [`[::1]:${port}`] : [])];

  const proxyRoute = (r: Route) => ({
    '@id': `hallway-${r.target === 'dashboard' ? 'dashboard' : `app-${r.target}`}-${r.host}`,
    match: [{ host: [r.host] }],
    terminal: true,
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: r.dial }],
        // D9: well-behaved local apps reject a Host that isn't theirs (DNS-rebinding defence), so by default the upstream
        // sees its own address; X-Forwarded-Host still carries the public name
        ...(r.preserveHost ? {} : { headers: { request: { set: { Host: ['{http.reverse_proxy.upstream.hostport}'] } } } }),
      },
    ],
  });

  const json = {
    admin: { listen: adminAddress(paths.socket), config: { persist: false } },
    storage: { module: 'file_system', root: paths.data },
    apps: {
      http: {
        http_port: httpPort,
        https_port: httpsPort,
        servers: {
          hallway: {
            listen: listen(httpsPort),
            // HTTP/3 would advertise the high UDP port (Alt-Svc); the redirect covers TCP only
            protocols: ['h1', 'h2'],
            routes: routes.map(proxyRoute),
            errors: {
              routes: [
                {
                  handle: [
                    { handler: 'rewrite', uri: '/fallback.html' },
                    { handler: 'headers', response: { set: { 'Cache-Control': ['no-store'] } } },
                    { handler: 'file_server', root: paths.generated, status_code: '{http.error.status_code}' },
                  ],
                },
              ],
            },
            // our own redirect (below) knows the public port; Caddy's would point at httpsPort
            automatic_https: { disable_redirects: true },
          },
          'hallway-http': {
            listen: listen(httpPort),
            routes: [
              {
                handle: [
                  {
                    handler: 'static_response',
                    status_code: 308,
                    headers: { Location: [`https://{http.request.host}${publicPort === 443 ? '' : `:${publicPort}`}{http.request.uri}`] },
                  },
                ],
              },
            ],
          },
        },
      },
      // every name gets a certificate from Hallway's local CA: `.localhost` and `.internal` would anyway, but `.test`
      // and made-up TLDs would otherwise go to public ACME (the `local_certs` global option, in JSON)
      tls: { automation: { policies: [{ issuers: [{ module: 'internal', ca: 'local' }] }] } },
      // `hallway setup` installs the root itself (and `teardown` removes it): Caddy's own attempt would ask for sudo
      pki: { certificate_authorities: { local: { name: CA_NAME, install_trust: false } } },
    },
  };
  return { json, routes, problems };
}

/** The config file's text: stable, so an unchanged config writes nothing and pushes nothing. */
export const caddyText = (json: unknown) => JSON.stringify(json, null, 2) + '\n';
