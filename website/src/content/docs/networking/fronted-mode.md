---
title: Fronted mode and HTTPS
description: How Hallway uses Caddy, running as you, to serve every app at https://<slug>.localhost, the three tiers of setup, and why it rewrites the Host header.
---

<span class="ms ms--shipped">v1</span> In fronted mode, [Caddy](https://caddyserver.com) serves each app at
`https://<slug>.<base-domain>`, by default `https://<slug>.localhost`, with a certificate your machine trusts. It is
optional: turn it on with [`hallway setup`](/networking/setup-and-doctor/) and off with `hallway teardown`. For the
overview, see [Direct and fronted mode](/concepts/modes/).

Until you do, nothing answers at `https://hallway.localhost` or `https://<app>.localhost`, and a browser says the
connection was refused. Hallway says so in three places: the startup banner of `hallway` / `npx hallway`, an info line
in `hallway doctor`, and a **Local domains** panel on the dashboard with the commands to copy (dismissible; the
**Local domains** button in the header brings it back). Once it's on, that button shows the dashboard's host and how
`hallway doctor`'s networking checks went, with each failing check and its fix. The panel lists the three tiers below,
User certificate first and already chosen, with what it will ask for and a **Turn on** button that runs the same setup
from the dashboard (on a Mac, macOS then asks for your Touch ID; verified on a real Mac). Choose another tier to see
its details: No HTTPS has Turn on too, and System-wide certificate always runs in your terminal, where setup shows its
plan and asks before it changes anything, so the panel gives you its command to copy.

:::note[Not on Windows]
Fronted mode is macOS and Linux only. On Windows (best effort) its parts have no user-level equivalent, so
`hallway setup` refuses before it looks for or changes anything, `hallway teardown` has nothing to undo, and apps keep
their `http://localhost:<port>` addresses.
:::

## Three tiers

`hallway setup` asks which of three tiers you want (or takes `--trust user`, `--trust system` or `--trust none`). They
differ in what they ask for and what they give up. For an app called `review`:

| | **User certificate** (`--trust user`) | **System-wide certificate** (`--trust system`) | **No HTTPS** (`--trust none`) |
| --- | --- | --- | --- |
| macOS address | `https://review.localhost` | `https://review.localhost`, or a [custom domain](/networking/custom-domains/) | `http://review.localhost` |
| Linux address | `https://review.localhost:4443` | `https://review.localhost`, or a custom domain | `http://review.localhost:4480` |
| macOS asks for | your **own** Touch ID or password, once, to trust Hallway's certificate for your account (not an administrator prompt) | an administrator's password (sudo), and macOS's trust dialog | nothing |
| Linux asks for | nothing | sudo | nothing |
| Trusted by | macOS: Safari, Chrome and Apple's `curl`, for your account. Linux: Chrome and Chromium only | everything that reads the system's trust store, for every account | nothing to trust: no certificate |
| Gives up | tools with their own CA list ([below](#certificates)); custom domains | nothing | Safari drops `Secure` cookies (and `__Host-` / `__Secure-` ones); apps that insist on `https:` break; custom domains |

- **User certificate** is the recommended tier, on every machine: it never needs an administrator, even on a Mac where
  admin rights are only lent now and then (a managed Mac). On macOS the root goes into your login keychain; on Linux into your own
  NSS database, `~/.pki/nssdb`, which needs `certutil` (Debian and Ubuntu: `libnss3-tools`; Fedora: `nss-tools`; Arch:
  `nss`). On Linux nothing can hold port 443 without root, so links carry Caddy's port.
- **System-wide certificate** is what `hallway setup` did before the tiers: the root goes into the System keychain
  (macOS) or the system CA store (Linux, plus your NSS database), and on Linux an nftables redirect takes 443 and 80.
  Choose it for custom domains, which need it because the system resolver has to be pointed at them (`--domain`
  implies it, and `--domain` with another `--trust` is refused); for other accounts on the machine; for tools that
  read only the system's certificates; and on Linux for links without a port.
- **No HTTPS** is plain HTTP, with nothing to trust. Browsers still treat `*.localhost` as a secure context, so
  `crypto.subtle`, service workers and the like keep working.

Without `--trust`, the question's default is **User certificate**, the recommended tier on macOS and Linux alike,
whether or not you're an administrator. With no terminal to ask on (or with `--yes`), setup keeps the tier you have,
or else takes User certificate, and says which.

**Switching tier** is running setup again with another `--trust`. It removes what the old tier added: leaving
System-wide certificate removes the system trust and the redirect (which needs sudo, this once); moving to No HTTPS removes the
trust for your account.

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
  privileges. Those are `proxy.httpsPort` and `proxy.httpPort` in [`config.yaml`](/reference/config-yaml/). Caddy
  never binds 443 or 80 itself.
- **How ports 443 and 80 reach Caddy**, so that links need no port number:
  - **macOS, every tier: launchd's sockets.** launchd, which already runs as root, binds loopback 443 and 80
    (`127.0.0.1` and `::1`) on your behalf for four small LaunchAgents of your own: `hallway.forward.https`,
    `hallway.forward.https6`, `hallway.forward.http` and `hallway.forward.http6`. launchd starts one on the first
    connection, and it passes the bytes on to Caddy's 4443 or 4480. No sudo and no prompt. No HTTPS holds only 80.
    These jobs run the installed `hallway`, so setup refuses to install them from npx's cache: install Hallway with
    `npm i -g hallway` first.
  - **Linux, System-wide certificate only: a redirect.** An nftables table of Hallway's own sends loopback 443 and 80 to 4443
    and 4480, installed once by `hallway setup` with sudo. In the other two tiers nothing takes 443 or 80 (Linux has
    no way to give them to an unprivileged process), so links carry Caddy's port: `:4443`, or `:4480` for No HTTPS.
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
    reverse_proxy localhost:4321 {             # 127.0.0.1 or ::1, whichever answers
        header_up Host {upstream_hostport}     # rewrite Host by default
    }
}

hallway.localhost {
    reverse_proxy 127.0.0.1:4255               # the dashboard keeps its Host
}
```

An app on loopback is dialled as `localhost:<port>`, so Caddy tries `::1` and `127.0.0.1` on every connection and
reaches it in whichever one it listens on. That matters on a Mac, where Vite, Astro, Next and most dev servers listen
on `[::1]` only by default (`localhost` resolves to `::1` first there).

HTTP on port 80 is redirected to HTTPS by Hallway's own route, which knows the public port. In the No HTTPS tier
the routes themselves are plain HTTP and nothing is redirected. HTTP/3 is off.

## Host-header rewriting

Caddy's `reverse_proxy` **preserves the browser's `Host` header** by default. But well-behaved local apps defend
against DNS rebinding by **rejecting any `Host` that isn't localhost**: Local Review answers `403 forbidden host`,
Vite has `server.allowedHosts`, and other dev servers have similar checks. Fronting them unmodified would break them
on day one.

So Hallway **rewrites `Host` to the upstream by default**: the app sees `localhost:4321`, exactly as if you had
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
  certificate itself, with printed commands, where the tier says:
  - **User certificate:** for your account only. On macOS, in your login keychain (`security add-trusted-cert`, no sudo;
    macOS asks for your own Touch ID or password). On Linux, in your NSS database, with no prompt.
  - **System-wide certificate:** in the **System keychain** on macOS (sudo, plus macOS's trust dialog), and in the **system CA
    store** on Linux (`update-ca-certificates` or `update-ca-trust`), plus your own NSS database.
  - **No HTTPS:** nowhere; there is no certificate.
- **Tools that bring their own CA list** don't read your login keychain or NSS database: Node without
  `--use-system-ca`, Python's `certifi`, Homebrew's `curl`, containers. With User certificate, point them at the root file,
  e.g. `NODE_EXTRA_CA_CERTS=<root>` or `curl --cacert <root>`; on Linux that goes for the system's `curl`, Node and
  Firefox too. `hallway doctor` names the file.
- **Firefox** uses its own certificate store: set `security.enterprise_roots.enabled` to `true` in `about:config`, or
  import the root by hand. `hallway doctor` mentions this.
- Caddy's leaf certificates are short-lived and renewed automatically.
- `hallway teardown` removes the root from wherever it was trusted. The CA itself stays in the data home, unused.

:::caution[Partly checked on a real Mac]
On a real Mac, `hallway setup --trust user` ran the User certificate trust step itself — its plan, what will ask, one sudo
password (migrating off an older System-wide certificate install) and then macOS's Touch ID dialog for the user's own trust
settings — and Safari and Chrome then loaded the dashboard and every app with no certificate warning; a user
LaunchAgent's launchd socket on a privileged loopback port answered with no sudo and no prompt; and Vite's hot reload
worked through launchd's sockets, the forwarders and Caddy. The dashboard's **Turn on** for User certificate, run by
the background daemon, brought up macOS's Touch ID dialog too, and local domains came up. CI's macOS runners also run setup for real with launchd's
sockets on 443 and 80. Still to check on a desktop Mac: Firefox with a root trusted for the user; launchd's sockets
and the trust settings across a logout and a reboot; a managed (MDM) Mac; and Docker Desktop or similar already
holding 443. On Linux, CI checks the tiers with `curl`.
:::

## Ports 80 and 443 may already be taken

Container tools (Docker Desktop, Rancher Desktop, Lima, Colima and similar) often forward ports 80 and 443 from
their VM. `hallway setup` refuses to start while anything else holds the low ports its tier needs, or Caddy's own
ports, and says which process (name, PID and command line) holds them; turning that tool's forwarding of 80 and 443
off is usually the fix. On macOS, where you can't see root's sockets, it also checks whether 443 answers with
Hallway's certificate. `hallway doctor` reports the same.

## From an older Hallway on macOS

Before the tiers, setup on macOS used a pf redirect run by root (the `hallway.pf` LaunchDaemon and a
`com.apple/hallway` anchor). `hallway doctor` flags one that's still installed. Run `hallway setup` again to move to
launchd's sockets: it removes the pf redirect, which needs sudo once.

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
