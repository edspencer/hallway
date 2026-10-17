---
title: Fronted mode and HTTPS
description: How Hallway uses Caddy, running as you, to serve every app at https://<slug>.localhost, and why it rewrites the Host header.
---

<span class="ms ms--shipped">v1</span> In fronted mode, [Caddy](https://caddyserver.com) serves each app at
`https://<slug>.<base-domain>`, by default `https://<slug>.localhost`, with a certificate your machine trusts. It is
optional: turn it on with [`hallway setup`](/networking/setup-and-doctor/) and off with `hallway teardown`. For the
overview, see [Direct and fronted mode](/concepts/modes/).

Until you do, nothing answers at `https://hallway.localhost` or `https://<app>.localhost`, and a browser says the
connection was refused. Hallway says so in three places: the startup banner of `hallway` / `npx hallway`, an info line
in `hallway doctor`, and a **Local domains** panel on the dashboard with the commands to copy (dismissible; the
**Local domains** button in the header brings it back). Once it's on, that button shows the dashboard's host and how
`hallway doctor`'s networking checks went, with each failing check and its fix. The dashboard never runs setup
itself: the privileged steps are only ever `hallway setup`'s, in your terminal.

:::note[Not on Windows]
Fronted mode is macOS and Linux only. On Windows (best effort) its parts have no user-level equivalent, so
`hallway setup` refuses before it looks for or changes anything, `hallway teardown` has nothing to undo, and apps keep
their `http://localhost:<port>` addresses.
:::

## Why Caddy

Hallway generates Caddy's configuration; it never proxies app traffic itself. Caddy brings, out of the box:

- **WebSocket proxying**, transparently. Many apps need it: Vite and Astro hot reload, and apps with live state.
- **Automatic TLS from a local certificate authority**, and HTTP/2.
- **Live config reloads through an admin API**, without dropping connections. This is what lets the unprivileged
  daemon add an app without sudo.

Rejected alternatives: a Node proxy inside the daemon (WebSocket upgrades, TLS and HTTP/2 all reinvented), Traefik
(built around container labels), nginx (manual config, no automatic local TLS) and localias (no wildcard subdomains,
no persistence).

Hallway needs **Caddy 2.7 or later**. On macOS, `hallway setup` installs it with Homebrew if it is missing; on Linux,
put a release binary from [caddyserver.com](https://caddyserver.com/download) on your `PATH` (distribution packages
may be older, and may start a system Caddy on port 80), or point `proxy.caddy` in `config.yaml` at it.

## How it fits together

- **Caddy runs as you**, as a user-level job (`hallway.caddy`: a LaunchAgent on macOS, a systemd user unit on Linux),
  listening on loopback only, `127.0.0.1` and `[::1]`, on ports **4443** (HTTPS) and **4480** (HTTP), which need no
  privileges. Those are `proxy.httpsPort` and `proxy.httpPort` in [`config.yaml`](/reference/config-yaml/).
- **A fixed redirect** sends loopback connections to ports 443 and 80 on to 4443 and 4480, so links need no port
  number. It is a pf anchor on macOS and an nftables table on Linux, installed once by `hallway setup`.
- **Its admin API is a private Unix socket** in the data home, `state/caddy/admin.sock`, readable and writable only
  by you (mode 0600). It never listens on TCP.
- **The daemon pushes the whole configuration** to that socket when it starts and whenever an app file or
  `config.yaml` changes, and first writes it to `~/.hallway/generated/caddy.json`. Caddy starts from that same file,
  so routes are back after a reboot even before the daemon is.

Why it is built this way, and exactly what needs root, is on
[Setup, teardown and doctor](/networking/setup-and-doctor/#the-security-model).

## Hostnames

- The dashboard: `hallway.localhost` (on a custom domain, its bare apex, e.g. `myname.internal`). It is
  `domain.dashboard` in `config.yaml`.
- Each app: `<slug>.<base>`, plus any extra names in its `proxy.aliases`.
- The dashboard's label (`hallway`), `www` and `api` are reserved slugs.
- New apps get a hostname as soon as their YAML file exists: no sudo, no restart.

## What a route looks like

For each app the daemon emits one route. It sends Caddy JSON; in Caddyfile notation, for readability:

```caddyfile
{
    # Every name gets a certificate from the local CA: needed for .test and
    # made-up TLDs, harmless for .localhost and .internal.
    local_certs
}

slides.localhost {
    reverse_proxy 127.0.0.1:4321 {
        header_up Host {upstream_hostport}     # rewrite Host by default
    }
}

hallway.localhost {
    reverse_proxy 127.0.0.1:4255               # the dashboard keeps its Host
}
```

HTTP on port 80 is redirected to HTTPS by Hallway's own route, which knows the public port. HTTP/3 is off.

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

The dashboard's own route is the exception: the daemon gets `hallway.localhost` unchanged, and accepts it in fronted
mode.

**Hot reload works through the proxy** with `Host` rewritten: Vite's HMR was checked with a real hot update and no
`server.hmr.clientPort` setting. (Astro runs on Vite but hasn't been checked separately.)

## Certificates

- Caddy's local certificate authority lives in the data home (`state/caddy/data/`). `hallway setup` trusts its root
  certificate itself, with printed commands: in the **System keychain** on macOS
  (`security add-trusted-cert`), and in the **system CA store** on Linux (`update-ca-certificates` or
  `update-ca-trust`), plus your own NSS database, which Chrome and Chromium read on Linux, without sudo.
- **Firefox** uses its own certificate store: set `security.enterprise_roots.enabled` to `true` in `about:config`, or
  import the root by hand. `hallway doctor` mentions this.
- Caddy's leaf certificates are short-lived and renewed automatically.
- `hallway teardown` removes the root from the trust store. The CA itself stays in the data home, unused.

:::caution[Not yet checked in a browser on a Mac]
On macOS, CI runs setup for real and `curl` accepts the certificate with no extra flags. No browser has been driven
on a real Mac yet: whether Safari, Chrome and Firefox (with the setting above) accept it, and whether Safari resolves
`*.localhost` addresses typed into its address bar, are still to be verified. On Linux, CI checks the same with `curl`
and the system trust store.
:::

## Fronted mode without the redirect

If you can't or don't want to install the redirect (in a container, say), set
`proxy.publicPort` to the same value as `proxy.httpsPort`:

```yaml
# config.yaml
proxy:
  publicPort: 4443
```

`hallway setup` then installs no redirect, and links carry the port: `https://slides.localhost:4443`. Trusting the
certificate still needs sudo once.

## Ports 80 and 443 may already be taken

Container tools (Docker Desktop, Rancher Desktop, Lima, Colima and similar) often forward ports 80 and 443 from
their VM. `hallway setup` refuses to start while anything else holds 80, 443, or Caddy's own ports, and says which
process (name, PID and command line) holds them; turning that tool's forwarding of 80 and 443 off is usually the fix.
On macOS, where you can't see root's sockets, it also checks whether 443 answers with Hallway's certificate.
`hallway doctor` reports the same.

On macOS the redirect can also be installed but ignored: a VPN or firewall app that loads a pf ruleset with
`set skip on lo0` makes pf skip loopback altogether. `hallway doctor` names that, and `hallway setup` clears it when it
can do so without dropping anyone else's rules; see
[pf is skipping loopback](/networking/setup-and-doctor/#pf-is-skipping-loopback-macos).

## When the daemon or an app is down

If the daemon isn't running, Caddy serves a static fallback page (`generated/fallback.html`, rewritten by the daemon
on every change) at the dashboard's hostname. It lists every app with a working link, so a dead dashboard still
answers "what do I have?", and says how to restart it:

```sh
hallway service restart
```

When an app isn't answering, its hostname serves a page that says which app it is, where Caddy looked, and how to
start it, instead of a bare proxy error.

## App bind addresses

Many dev servers started with `--host` listen on `0.0.0.0`, which exposes them to your local network. Behind a proxy
they don't need to. Managed services get `HOST=127.0.0.1`; the dashboard marks any app listening on all interfaces as
**exposed**, and `hallway doctor` lists them.
