---
title: Fronted mode and HTTPS
description: How Hallway uses Caddy to serve every app at https://<slug>.localhost, and why it rewrites the Host header.
---

<span class="ms">v1</span> In fronted mode, [Caddy](https://caddyserver.com) serves each app at
`https://<slug>.<base-domain>`, by default `https://<slug>.localhost`, with a certificate your machine trusts.
For the overview, see [Direct and fronted mode](/concepts/modes/).

## Why Caddy

Hallway generates Caddy's configuration; it never proxies app traffic itself. Caddy brings, out of the box:

- **WebSocket proxying**, transparently. Many apps need it: Vite and Astro hot reload, and apps with live state.
- **Automatic TLS from a local certificate authority**, HTTP→HTTPS redirects, HTTP/2 and HTTP/3.
- **Live config reloads through an admin API**, without dropping connections. This is what lets the unprivileged
  daemon add an app without sudo.

Rejected alternatives: a Node proxy inside the daemon (WebSocket upgrades, TLS and HTTP/2 all reinvented), Traefik
(built around container labels), nginx (manual config, no automatic local TLS) and localias (no wildcard subdomains,
no persistence).

## Hostnames

- The dashboard: `hallway.localhost` (on a custom domain, its bare apex, e.g. `myname.internal`).
- Each app: `<slug>.<base>`, plus any extra names in its `proxy.aliases`.
- `hallway`, `www` and `api` are reserved slugs.

## What a route looks like

For each app the daemon emits one route and pushes the whole configuration to Caddy's admin API. In Caddyfile
notation, for readability:

```caddyfile
{
    # Force the internal CA for everything: needed for .test and made-up TLDs,
    # harmless for .localhost and .internal (already internal by default).
    local_certs
}

slides.localhost {
    reverse_proxy 127.0.0.1:4321 {
        header_up Host {upstream_hostport}     # rewrite Host by default
    }
}

hallway.localhost {
    reverse_proxy 127.0.0.1:4255 {
        header_up Host {upstream_hostport}
    }
}
```

The daemon re-pushes the full configuration whenever it starts and whenever an app file or `config.yaml` changes, and
keeps a copy in `~/.hallway/generated/caddy.json` for debugging.

## Host-header rewriting

Caddy's `reverse_proxy` **preserves the browser's `Host` header** by default. But well-behaved local apps defend
against DNS rebinding by **rejecting any `Host` that isn't localhost**: Local Review answers `403 forbidden host`,
Vite has `server.allowedHosts`, and other dev servers have similar checks. Fronting them unmodified would break them
on day one.

So Hallway **rewrites `Host` to the upstream by default**: the app sees `127.0.0.1:4321`, exactly as if you had
visited it directly. Caddy still adds `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For`, so an app that
needs its public name can read it.

For an app that builds absolute URLs from `Host` and doesn't check it, opt out per app:

```yaml
proxy:
  preserveHost: true
```

:::note[To be verified]
Whether Vite and Astro hot reload works through the proxy with `Host` rewritten, or needs
`server.hmr.clientPort: 443`, is checked during v1. This page will document the fix if one is needed.
:::

## Certificates

- `hallway setup` runs `caddy trust` to install Caddy's root certificate in the macOS System keychain, and
  `hallway doctor` checks that it is trusted.
- **Firefox** uses its own certificate store: set `security.enterprise_roots.enabled` to `true` in `about:config`, or
  import the root by hand. `hallway doctor` mentions this if Firefox is installed.
- Caddy's leaf certificates are short-lived and renewed automatically.
- `hallway teardown` runs `caddy untrust`.

## Privileges, and an open question

On macOS, binding `127.0.0.1:443` needs root. (An unprivileged process can bind low ports only on the wildcard
address, which would expose every fronted app to anyone on the same Wi-Fi: not acceptable.)

The original plan runs Caddy as a dedicated LaunchDaemon, `hallway.caddy`, separate from any Homebrew Caddy you may
already use. But a root Caddy with its unauthenticated admin API would let **any local process** reconfigure it, for
example to serve root-only files: a local privilege escalation. So how Caddy gets port 443 safely is **still open and
blocking for v1**. The leading option runs Caddy as your user on high loopback ports, with a fixed, one-time `pf`
redirect from 443 and 80 installed by `hallway setup`, so the only root component has a job that can't be
reconfigured. See [No root in the daemon](/guarantees/no-root/).

## Ports 80 and 443 may already be taken

Container tools (Docker Desktop, Rancher Desktop, Lima, Colima and similar) often forward ports 80 and 443 from
their VM. `hallway doctor` names the process, PID and owner holding them and suggests the fix, usually turning off
that tool's forwarding of 80 and 443. Fronted mode can't start until they're free, and `hallway setup` stops rather
than fight over them.

## When the daemon is down

If the daemon isn't running, Caddy serves a static fallback page at the dashboard's hostname, rewritten by the daemon
on every change. It lists every app with a working link, so a dead dashboard still answers "what do I have?", and
says how to restart it:

```sh
hallway service restart
# or
launchctl kickstart -k gui/$(id -u)/hallway.daemon
```

## App bind addresses

Many dev servers started with `--host` listen on `0.0.0.0`, which exposes them to your local network. Behind a proxy
they don't need to. Managed services get `HOST=127.0.0.1`; the dashboard marks any app listening on all interfaces as
**exposed**, and `hallway doctor` lists them.
