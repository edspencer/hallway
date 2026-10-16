# 03 — Networking: domains, proxy, TLS

## Two modes

| | **Direct mode** (v0, default) | **Fronted mode** (v1) |
|---|---|---|
| App URLs | `http://localhost:<port>` | `https://<slug>.<base-domain>` |
| Dashboard URL | `http://localhost:4255` | `https://hallway.localhost` (or the custom apex) — and still `http://localhost:4255` |
| Needs | nothing | Caddy; for custom domains also dnsmasq + `/etc/resolver`; one-time CA trust |
| Sudo | never | once, during `hallway setup` |

The dashboard must work in both modes and render links appropriate to the current mode. Direct mode is not a
degraded fallback: it is the whole of v0 and it is immediately valuable on its own. When fronted mode is on, cards
show the hostname as primary and the port as secondary detail.

## Choosing the base domain

### Default: `localhost` (D5)

Apps are served at `<slug>.localhost`; the dashboard at `hallway.localhost`.

Why this is the default:

- **No DNS setup at all.** On macOS the system resolver answers any `*.localhost` name with loopback. Verified on
  macOS (Darwin 27): `dscacheutil -q host -a name foo.localhost` and `… a.b.localhost` both return `127.0.0.1` /
  `::1`, and `curl http://foo.localhost:<port>/` reaches a local server. Chromium and Firefox also resolve
  `*.localhost` to loopback internally. **Unverified:** Safari's behaviour in the address bar (Q-SAFARI-LOCALHOST).
- **Caddy issues local-CA certificates for it automatically.** Caddy's documented rule is that names under
  `localhost`, `.localhost`, `.local`, `.internal` and `.home.arpa` never get public ACME certificates and are
  served from its internal CA.
- **Reserved.** `localhost` is reserved by RFC 6761 and can never be delegated as a public TLD.

### Custom domains

Users can set `domain.base` to something else; **the recommended choice is a name under `.internal`**, e.g.
`myname.internal`. With a custom base the dashboard defaults to the bare apex (`https://myname.internal`) and apps
live underneath (`https://app.myname.internal`). Custom domains need dnsmasq and a resolver file (below). The examples
throughout this spec use `myname.internal`.

Guidance the docs and `hallway doctor` must give:

| Base domain | Verdict | Why |
|-------------|---------|-----|
| `localhost` | ✅ default | Zero DNS, auto local CA, reserved forever. |
| `*.internal` | ✅ recommended custom | ICANN reserved `.internal` for private use (2024); never delegated. Caddy uses its local CA automatically. |
| `*.test` | ✅ fine | Reserved by RFC 6761. **But** Caddy's automatic rule does not list `.test`, so it would attempt public ACME — must force the internal issuer (below). |
| `*.home.arpa` | ✅ fine | RFC 8375, intended for home networks. Long. |
| made-up TLD (e.g. `name.surname`) | ⚠️ allowed, with a warning | Not reserved: it squats on namespace that could be delegated later. Caddy will attempt public ACME unless forced to the internal issuer. See the note below. |
| subdomain of a domain you own (e.g. `local.example.com`) | ✅ possible, advanced | Public DNS records pointing at `127.0.0.1` need no local DNS server at all, and real publicly-trusted certificates are available via ACME DNS-01 (no local CA). Downsides: requires a DNS provider API token; every hostname issued appears in public Certificate Transparency logs, leaking your app names; longer names. Not a v1 target. |
| `*.local` | ❌ refuse | Reserved for mDNS/Bonjour (RFC 6762). macOS's mDNSResponder intercepts `.local` lookups; unicast resolver files for `.local` are unreliable and **wildcards do not work**. |
| `*.dev`, `*.app`, `*.page`, other real TLDs | ❌ refuse (or loud warning) | Real, delegated TLDs. `.dev` and `.app` are on the browser HSTS preload list; the historical "`.dev` for local development" setups all broke when the TLD was delegated and preloaded. |

**Made-up TLDs** — why they are allowed but warned about (some users will want one; steer them to `.internal`):

- DNS protocol: a name like `name.surname` is perfectly valid. Nothing forbids resolving names under an
  undelegated TLD locally.
- If the TLD is later delegated, the local setup **keeps working**: `/etc/resolver/<domain>` takes precedence on the
  machine, and because fronted mode is always HTTPS with a locally trusted CA, the `.dev`-style failure (HSTS preload
  forcing HTTPS onto HTTP-only setups) does not apply. The only loss is being unable to reach the real public name.
- ICANN's 2026 new-gTLD round is in progress (application window closed 12 Aug 2026; Reveal Day 7 Oct 2026; String
  Confirmation Day 17 Nov 2026; delegations would follow years later). Details in `11-research-notes.md`.
- `hallway doctor` should fetch IANA's TLD list (`https://data.iana.org/TLD/tlds-alpha-by-domain.txt`) and warn if the
  configured base domain's TLD is delegated. Cache the list; failure to fetch is a warning, not an error.

### Hostname scheme

- Dashboard: `domain.dashboard` (default `hallway.localhost`; the apex for custom domains).
- Apps: `<slug>.<base>`, plus any `proxy.aliases`.
- Name a resolver file after the **full base domain** (`/etc/resolver/myname.internal`), never just the TLD
  (`/etc/resolver/internal`), so only your own names are captured.
- Verified on the author's machine with an existing resolver file for a two-label domain: macOS resolver files
  scope **both the apex and all subdomains**, so the apex can serve the dashboard.

## Caddy (D4)

### Why Caddy and not a Node proxy in the daemon

- Caddy's `reverse_proxy` handles **WebSocket upgrades transparently**. Many fronted apps need them: Vite/Astro HMR,
  and apps that use WebSockets for live state (Paddock does). A hand-rolled Node proxy needs explicit upgrade
  plumbing and is a source of subtle bugs.
- Caddy does automatic TLS with a local CA, automatic HTTP→HTTPS redirects, HTTP/2 and HTTP/3, and live config reload
  without dropping connections.
- It keeps the daemon simple and unprivileged.

### Process and privileges

- **Caddy must run as root to bind loopback :443/:80 on macOS.** Verified: as a normal user, binding
  `127.0.0.1:444` and `[::1]:446` fails with `EACCES`, while `0.0.0.0:445` succeeds — macOS lets unprivileged
  processes bind low ports only on the wildcard address.
- Binding Caddy to `0.0.0.0:443` as the user would avoid root but **expose every fronted app to the local network**
  (anyone on the same Wi-Fi sending the right `Host`). Not acceptable as a default. If ever offered, it must be paired
  with a `remote_ip` matcher that rejects non-loopback clients and documented as weaker (Q-CADDY-UNPRIVILEGED).
- **Provisional (see the security caveat below):** `hallway setup` installs a dedicated LaunchDaemon, label
  `hallway.caddy`, rather than using `brew services start caddy`. Reasons: (1) don't hijack a Homebrew Caddy service the user may already use for
  something else; (2) control the exact arguments (`caddy run --resume …`); (3) clean teardown.
- Caddy's **admin API** listens on `localhost:2019`. The unprivileged daemon pushes config there (`POST /load` with
  JSON), so routine changes — adding an app — **never need sudo**. Caddy's `--resume` flag restores the last
  pushed config from its autosave on restart, so routes survive a reboot even before the daemon has started. The
  daemon also re-pushes its full config whenever it starts and whenever an app/config file changes. Keep a copy in
  `generated/caddy.json` for debugging. (Exact `--resume`/autosave semantics: verify, Q-CADDY-RESUME.)
- **Security caveat — must be resolved before v1 ships (Q-CADDY-UNPRIVILEGED).** Caddy's admin API is
  unauthenticated by default; it blocks browser cross-origin requests, but **any local process can POST a config to
  it**. If Caddy runs as root, that config can, for example, add a `file_server` rooted at `/`, letting any process
  running as the user read root-only files without a password prompt — a local privilege escalation (a malicious
  package install script would be enough). Options to evaluate, in rough order of preference:
  1. **No root Caddy at all:** run Caddy as the user on `127.0.0.1:8443`/`:8080`, and have `hallway setup` install a
     one-time **pf redirect on `lo0`** from 443→8443 and 80→8080 (loaded at boot by a tiny root LaunchDaemon that only
     runs `pfctl`). The only root component then has a fixed, non-configurable job. Unverified; check that pf `rdr`
     on loopback works on current macOS and survives OS updates (which can rewrite `/etc/pf.conf` — use an anchor
     file).
  2. Root Caddy with the admin API on a **Unix socket** (`admin unix//<path>`) whose permissions restrict it to the
     user. Reduces exposure to other local *users*, but the user's own processes can still escalate — weaker.
  3. Root Caddy with a fixed config file and **no admin API** (`admin off`), reloaded via a privileged helper — needs
     sudo for every app change, defeating "no sudo after setup".
- Conflict detection: if something else already uses `localhost:2019`, ports 80/443, or a Caddy instance is already
  running, `hallway setup` and `hallway doctor` must say so and stop rather than fight it.

### Port 80/443 conflicts are real

On the author's machine, **ports 80 and 443 were already held** by an `ssh` process owned by the user — the
port-forwarding of a container-runtime VM (Docker Desktop, Rancher Desktop, Lima, Colima and similar do this).
`hallway doctor` must report the process name, PID and owner holding 80/443 and suggest the fix (usually disabling that
tool's port-forward of 80/443). Fronted mode cannot start until this is resolved.

### Route generation

For each app the daemon emits one route. Caddyfile notation (for readability; the implementation should push JSON
via the admin API):

```caddyfile
{
    # Force the internal CA for everything: needed for .test and made-up TLDs,
    # harmless for .localhost/.internal (already internal by default).
    local_certs
}

review.localhost {
    reverse_proxy 127.0.0.1:5622 {
        header_up Host {upstream_hostport}     # D9: rewrite Host by default
    }
}

hallway.localhost {
    reverse_proxy 127.0.0.1:4255 {
        header_up Host {upstream_hostport}
    }
    handle_errors {
        root * /path/to/data-home/generated
        rewrite * /fallback.html
        file_server
    }
}
```

### Host header rewriting (D9)

- Caddy's `reverse_proxy` **preserves the client's Host header by default**.
- Well-behaved local apps defend against DNS rebinding by rejecting any Host that is not localhost. Local Review does
  exactly this (`403 forbidden host`); Vite (`server.allowedHosts`) and other dev servers have similar checks.
  Fronting them with the original Host would break them on day one.
- Therefore: **default `header_up Host {upstream_hostport}`** (the upstream sees `127.0.0.1:5622`).
- Caddy still adds `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For`, so apps that need the public name
  can read it.
- Per-app opt-out: `proxy.preserveHost: true`, for apps that build absolute URLs from Host and do not check it.
- **Verify** (Q-HMR): that Vite/Astro HMR websockets work through the proxy on :443 with Host rewritten. Some setups
  need `server.hmr.clientPort: 443`; document the fix if so.

### Dashboard fallback

If the daemon is down, Caddy serves `generated/fallback.html`: a static page the daemon rewrites on every change,
listing every app with its link, so a dead dashboard still answers "what do I have?". It should say clearly that the
daemon is down and how to restart it (`hallway service restart` or `launchctl kickstart -k gui/<uid>/hallway.daemon`).

### TLS details

- `caddy trust` installs Caddy's root CA into the macOS System keychain; needs admin rights. When Caddy runs as root
  its CA lives in root's Caddy data directory, so trust must target that instance (e.g. `caddy trust --address
  localhost:2019`) — verify (Q-CADDY-TRUST).
- Caddy's docs warn that automatic trust installation is best-effort and can fail when Caddy runs as an unprivileged
  service; `hallway setup` must run `caddy trust` explicitly and `hallway doctor` must verify the root is trusted.
- Firefox uses its own store: set `security.enterprise_roots.enabled = true` (or import the root manually). `hallway
  doctor` should mention this if Firefox is installed.
- Internal leaf certificates are short-lived and renewed automatically by Caddy as long as it runs.
- `caddy untrust` on teardown.

### Why HTTPS is mandatory in fronted mode (D6)

`http://localhost:<port>` is a **secure context** in browsers. `http://app.myname.internal` is **not**. Without
TLS, moving an app behind a custom hostname silently breaks `crypto.subtle`, service workers, `getUserMedia`, the
async clipboard API and anything else gated on secure contexts. (`http://*.localhost` is treated as potentially
trustworthy by modern browsers — verify per browser, Q-SECURE-CONTEXT — but HTTPS everywhere removes the question.)

## DNS for custom domains (dnsmasq)

Only needed when `domain.base` is not `localhost`.

- Install: `brew install dnsmasq`.
- Config (a drop-in owned by Hallway, e.g. `$(brew --prefix)/etc/dnsmasq.d/hallway.conf`, with
  `conf-dir` enabled in the main config):
  ```
  address=/myname.internal/127.0.0.1
  address=/myname.internal/::1
  listen-address=127.0.0.1
  bind-interfaces
  ```
  `listen-address` + `bind-interfaces` matter: without them dnsmasq can become an open resolver on the LAN.
- `address=/<domain>/…` answers the apex **and every subdomain** — a wildcard — so adding an app never touches DNS.
- dnsmasq binds :53, so it runs as root (a LaunchDaemon; `sudo brew services start dnsmasq` creates one).
- Resolver file: `/etc/resolver/<base-domain>` containing `nameserver 127.0.0.1`.
- Verify with `scutil --dns` (the domain should appear as its own resolver) and `dscacheutil -q host -a name
  app.<base>`.

Rejected alternative for custom domains: managing `/etc/hosts` entries per app (what localias does). It needs sudo
for *every new app* and cannot express wildcards. dnsmasq needs sudo once.

## App bind addresses

- Many dev servers started with `--host` bind `0.0.0.0`, exposing them to the local network. Behind a proxy they
  should bind `127.0.0.1`.
- Managed services (v1) get `HOST=127.0.0.1` injected (and `HOSTNAME=127.0.0.1` for frameworks that read that).
- The scanner records each listener's bind address; the dashboard shows a subtle "exposed on network" indicator for
  apps on `*`/`0.0.0.0`, and `hallway doctor` lists them.

## Privileged setup: `hallway setup`

All root-requiring steps live in one command, so the daemon never needs privileges.

- `hallway setup` (fronted mode on `localhost`): check prerequisites → install Caddy if missing (`brew install caddy`, with
  consent) → install the `hallway.caddy` LaunchDaemon → start it → push config → `caddy trust` → set
  `mode: fronted` → run `hallway doctor`.
- `hallway setup --domain <base>`: additionally install dnsmasq, write the drop-in, start its LaunchDaemon, write
  `/etc/resolver/<base>`, set `domain.base`.
- **Before each privileged command, print it and a one-line explanation, then run it via `sudo`** so the user sees
  and approves exactly what happens. `hallway setup --print` prints the full plan without executing anything.
- **Idempotent:** re-running is safe and only fixes what is missing.
- **`hallway teardown`** reverses everything it installed (LaunchDaemons, drop-ins, resolver file, `caddy untrust`) and
  sets `mode: direct`. It never removes Homebrew packages unless asked (`--uninstall-packages`).
- Never write outside: the data home, `/etc/resolver/<base>`, the dnsmasq drop-in, `/Library/LaunchDaemons/hallway.*.plist`,
  `~/Library/LaunchAgents/hallway.*.plist`.

## `hallway doctor`

Read-only diagnostics, each with a pass/warn/fail line and a suggested fix:

- daemon running; its port free/owned by it; its launchd job loaded
- data home readable; any YAML parse/validation errors
- (fronted) Caddy running, admin API reachable, config matches what the daemon expects
- (fronted) ports 80/443 owned by Caddy — or **who owns them instead**
- (fronted) Caddy root CA trusted in the System keychain; Firefox note
- (custom domain) dnsmasq running and bound to loopback only; `/etc/resolver/<base>` present; resolution of
  `<base>` and `probe.<base>` returns loopback
- (custom domain) TLD not in IANA's delegated list; not `.local`; not an HSTS-preloaded TLD
- apps bound to `0.0.0.0`
- two declared apps on one port
- launchd jobs whose `PATH` contains per-shell version-manager directories or entries that no longer exist (see `04`)

## Linux notes (later)

- Resolution of `*.localhost` depends on the resolver (`systemd-resolved` handles it; others may not).
- Custom domains: `systemd-resolved` per-link DNS or a dnsmasq drop-in.
- Binding :443: `setcap cap_net_bind_service` on the Caddy binary allows an unprivileged loopback bind.
- Services: systemd user units instead of LaunchAgents.
