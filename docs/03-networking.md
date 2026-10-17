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

### The tiers (D65)

`hallway setup` asks which (or `--trust user|system|none`); re-running it with another switches, removing what the old
tier added. The recommended tier comes first on the dashboard and is the question's default: No admin on a Mac whose
user isn't an admin or that MDM manages, and on Linux without sudo (or without systemd and nftables); System-wide
otherwise.

| | **No admin** (`user`) | **System-wide** (`system`) | **No prompts** (`none`) |
|---|---|---|---|
| macOS links | `https://review.localhost` | the same, and custom domains | `http://review.localhost` |
| macOS asks for | your own Touch ID or password, once (your certificate trust settings) | an administrator (System keychain; the resolver) | nothing |
| Linux links | `https://review.localhost:4443` | `https://review.localhost` (and custom domains) | `http://review.localhost:4480` |
| Linux asks for | nothing (the root goes into `~/.pki/nssdb`) | sudo (nftables redirect, CA store, resolver) | nothing |
| Trusted by | Safari, Chrome, Apple's curl (macOS); Chrome/Chromium (Linux) | everything that reads the system store | n/a |
| Gives up | tools with their own CA list (Node without `--use-system-ca`, certifi, Homebrew's curl); custom domains | nothing | `Secure` cookies in Safari; apps that insist on `https:`; custom domains |

config.yaml records it: `proxy.trust` (absent: a setup from before the tiers, which is System-wide), `proxy.scheme`
(`http` for No prompts) and `proxy.publicPort` (the port in links). Every link Hallway gives comes from those.

### Process and privileges (D47, D65)

**Caddy runs as you, never as root, and never binds 443 or 80 itself.** The only root-owned parts of fronted mode are
fixed jobs that take no configuration from anything a user-level process can write later (resolves
Q-CADDY-UNPRIVILEGED), and on macOS there are none in the No admin and No prompts tiers:

| Part | What | Runs as |
|------|------|---------|
| Caddy | `caddy run --config <data home>/generated/caddy.json`, on `127.0.0.1` and `[::1]`, ports `proxy.httpsPort` (4443) and `proxy.httpPort` (4480). A LaunchAgent / systemd user unit, label `hallway.caddy`. | you |
| Its admin API | A Unix socket, `state/caddy/admin.sock`, mode `0600` (`admin.listen: unix//…/admin.sock\|0600`). Never a TCP port. | you |
| 443 and 80, macOS (every tier) | launchd binds `127.0.0.1` and `::1` on 443 and 80 (80 only for plain HTTP) for four LaunchAgents, `hallway.forward.https`, `…https6`, `…http`, `…http6` (`Sockets`, inetd mode with `Wait`), started on the first connection; each runs `hallway forward <Caddy's port>`, a byte pipe from the socket it's handed to Caddy. | launchd binds, as root; the job runs as you |
| The redirect, Linux (System-wide only) | Loopback 443 → 4443 and 80 → 4480: an nftables table (`inet hallway`, file `/etc/hallway/redirect.nft`) applied at boot by the system unit `hallway-redirect.service`. The other tiers have none: links carry Caddy's port. | root, fixed |
| The trusted root | Hallway's local CA (`Hallway Local CA - <year> ECC Root`). System-wide: the System keychain / the system CA store (root, once). No admin: your login keychain's trust settings (macOS; your own password) or your NSS database (Linux; no prompt). | depends on the tier |
| dnsmasq (custom domains) | `dnsmasq` on `127.0.0.1:domain.dnsPort` (4253), a user-level job `hallway.dnsmasq`. | you |
| The resolver (custom domains) | macOS: `/etc/resolver/<base>` with `nameserver 127.0.0.1` and `port 4253`. Linux: `/etc/systemd/resolved.conf.d/hallway.conf` (`DNS=127.0.0.1:4253`, `Domains=~<base>`). | root, fixed |

Why this shape:

- **macOS lets an unprivileged process bind low ports only on the wildcard address.** Verified: as a normal user,
  binding `127.0.0.1:444` and `[::1]:446` fails with `EACCES`, while `0.0.0.0:445` succeeds. A user Caddy on
  `0.0.0.0:443` would expose every fronted app to the local network (rejected). **But launchd binds loopback 443/80
  for a user's LaunchAgent** (its `Sockets` key) with no sudo (verified 2026-10-17), so that's what Hallway uses, in
  every tier (D65): the old pf redirect (a pf anchor loaded by a `hallway.pf` LaunchDaemon) is retired, and only
  removed from installs that have it. Caddy can't take a socket from launchd without native code
  (`launch_activate_socket`), so small Node forwarders take it (`server/forward.ts`): one per socket, since inetd
  mode hands a job one; a native helper that hands the sockets to Caddy itself is deferred (D65).
- **A root Caddy is a privilege-escalation path.** Its admin API is unauthenticated: any local process could POST a
  config with, say, a `file_server` rooted at `/`, and read root-only files without a password prompt. A Unix socket
  limited to the user doesn't help (the user's own processes are the threat: a malicious install script is enough),
  and `admin off` would need sudo for every app change. With Caddy running as the user, the socket grants nothing the
  user's processes don't already have.
- **The same design on both platforms.** On Linux, `setcap cap_net_bind_service` on a Hallway-owned copy of Caddy was
  the alternative: rejected because whoever can reach the admin API could then bind *any* privileged port on any
  address (impersonate a system service on a free low port), and because every Caddy upgrade needs the capability
  set again. A redirect gives no binary any privilege, and Caddy's config is identical everywhere.
- **No `--resume` (resolves Q-CADDY-RESUME).** Verified with Caddy 2.11.7: an admin-API push is autosaved to
  `$XDG_CONFIG_HOME/caddy/autosave.json`, and `caddy run --resume` then **ignores `--config`** whenever that file
  exists. Instead the daemon writes every config to `generated/caddy.json` before pushing it, Caddy starts from that
  file (`--config`), and pushes don't persist (`admin.config.persist: false`). After a reboot Caddy comes back with the
  last routes before the daemon has started, and there is exactly one copy of the truth. The Caddy job's
  `$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` point into `state/caddy/`, so a Caddy the user runs for something else is
  never touched.
- Caddy's storage (the CA, certificates) is `state/caddy/data/` in the data home. The CA's private key is the user's,
  as with mkcert: anything running as the user could already read it.
- **Caddy 2.7 or later.** 2.6.4 doesn't understand the socket's `|0600` mode; 2.7.6 does (research notes).
- The daemon re-pushes the whole config whenever it starts and whenever an app or `config.yaml` changes; a failed push
  (Caddy not running yet) is retried every 30 s. Routine changes, such as adding an app, **never need sudo**.
- Conflict detection: if something already holds 80 or 443 (or Caddy's high ports, or the dnsmasq port), `hallway
  setup` and `hallway doctor` name it and stop. Port 2019 is only a warning: Hallway's Caddy doesn't use it, but
  another Caddy is probably running.

**Fronted mode with nothing on 443 by hand:** set `proxy.publicPort` to `proxy.httpsPort` (4443) in `config.yaml`
before running a System-wide setup. Links then carry the port (`https://review.localhost:4443`) and nothing is put on
443. The No admin and No prompts tiers on Linux do this themselves.

### Port 80/443 conflicts are real

On the author's machine, **ports 80 and 443 were already held** by an `ssh` process owned by the user — the
port-forwarding of a container-runtime VM (Docker Desktop, Rancher Desktop, Lima, Colima and similar do this).
`hallway setup` and `hallway doctor` report the process name and PID holding 80/443 and suggest the fix (usually
disabling that tool's port-forward of 80/443). On macOS, `lsof` as the user can't see root's listeners, so a
connection test backs it up: something answering on 443 without Hallway's certificate is reported too, with `sudo lsof
-nP -iTCP:443 -sTCP:LISTEN` as the way to name it.

### Route generation

`server/proxy/caddy.ts` turns the apps and `config.yaml` into Caddy JSON (golden files in `test/fixtures/proxy/`).
In Caddyfile notation, for readability:

```caddyfile
{
    admin unix//<data home>/state/caddy/admin.sock|0600 { persist_config off }
    storage file_system <data home>/state/caddy/data
    local_certs               # every name from Hallway's CA: needed for .test and made-up TLDs
    skip_install_trust        # `hallway setup` trusts the root itself
    servers { protocols h1 h2 }   # no HTTP/3: it would advertise the high UDP port
}

hallway.localhost:4443 {      # the dashboard: Host kept (the daemon accepts its dashboard host)
    bind 127.0.0.1 [::1]
    reverse_proxy 127.0.0.1:4255
}

review.localhost:4443, lr.localhost:4443 {    # an app and its proxy.aliases
    bind 127.0.0.1 [::1]
    reverse_proxy 127.0.0.1:5622 {
        header_up Host {upstream_hostport}     # D9: rewrite Host by default
    }
}

(every server) handle_errors {   # an upstream that doesn't answer: the fallback page, with its status (502)
    rewrite * /fallback.html
    file_server { root <data home>/generated }
}

http://:4480 {                # HTTP → HTTPS on the public port (443, or proxy.publicPort)
    bind 127.0.0.1 [::1]
    redir https://{host}{uri} 308
}
```

With `proxy.scheme: http` (No prompts) there's only the HTTP server, on 4480, with the same routes and fallback,
automatic HTTPS off and nothing redirected; no certificate is ever made.

- A name already taken (an alias that is another app's slug, or the dashboard's name) is skipped and reported.
- `host: ::1` is dialled as `[::1]:port`; a wildcard bind is dialled on `127.0.0.1`.
- IPv6 loopback is left out where it can't be bound (some containers), or Caddy would refuse the whole config.

### Host header rewriting (D9)

- Caddy's `reverse_proxy` **preserves the client's Host header by default**.
- Well-behaved local apps defend against DNS rebinding by rejecting any Host that is not localhost. Local Review does
  exactly this (`403 forbidden host`); Vite (`server.allowedHosts`) and other dev servers have similar checks.
  Fronting them with the original Host would break them on day one.
- Therefore: **default `header_up Host {upstream_hostport}`** (the upstream sees `127.0.0.1:5622`). Verified: a
  strict app answers 200 through Caddy with the rewrite and 403 with `proxy.preserveHost: true`.
- Caddy still adds `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For`, so apps that need the public name
  can read it.
- Per-app opt-out: `proxy.preserveHost: true`, for apps that build absolute URLs from Host and do not check it.
- **HMR works with no extra settings (resolves Q-HMR for Vite).** Verified with Vite 8.3.4 behind Caddy, Host
  rewritten: the client's websocket connects to the page's own origin (`wss://<slug>.localhost/`), Caddy upgrades it,
  and an edit is hot-applied with no reload; no `server.hmr.clientPort` is needed. Astro's dev server is Vite, so it
  is expected to behave the same (not separately run).

### Dashboard fallback

If the daemon is down, Caddy serves `generated/fallback.html`: a static, self-contained page (the dashboard's tokens
inlined) that the daemon rewrites on every change, listing every app with its link, so a dead dashboard still answers
"what do I have?". On the dashboard's host it says the daemon isn't running and how to restart it (`hallway service
restart`, then `launchctl kickstart -k gui/<uid>/hallway.daemon` or `systemctl --user restart hallway-daemon.service`).
On an app's host it says that app isn't answering, where Caddy looked, and how to start it (`hallway start <slug>` for
a managed app). The HTTP status stays the upstream error's (502).

### TLS details (resolves Q-CADDY-TRUST)

- Caddy runs as the user, so its CA is in the data home (`state/caddy/data/pki/authorities/local/root.crt`) and there
  is no root instance to point `caddy trust` at. Caddy's own trust installation is turned off (`install_trust: false`:
  it would try sudo from inside a background job); `hallway setup` installs the root itself, with a command it prints:
  - System-wide, macOS: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain
    <root.crt>`; teardown: `security delete-certificate -Z <sha1>` (which takes the trust setting with it).
  - System-wide, Linux: the system store (`/usr/local/share/ca-certificates/hallway-local-ca.crt` +
    `update-ca-certificates`, or `/etc/pki/ca-trust/source/anchors/` + `update-ca-trust extract`), and, as the user,
    the NSS database Chrome reads on Linux (`certutil -d sql:~/.pki/nssdb`) when `certutil` and that database exist.
  - No admin, macOS: `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db <root.crt>`, no
    sudo: macOS asks for the user's own Touch ID or password (`com.apple.trust-settings.user`), never an admin's. Only
    from a GUI session: run headless it waits on the dialog forever, so setup refuses when the console user isn't you.
    Teardown: `security remove-trusted-cert <root.crt>` (may ask again), then `delete-certificate -Z <sha1>`.
  - No admin, Linux: only the NSS database, made first if Chrome hasn't run yet (`certutil -N --empty-password`).
- `hallway doctor` checks the root is trusted where the tier puts it (macOS: its SHA-1 in `security find-certificate
  -a -Z` of the System or the login keychain, and for the user domain its name in `security dump-trust-settings`;
  Linux: the installed file, or the NSS database's copy).
- Firefox uses its own store: set `security.enterprise_roots.enabled = true` (or import the root manually). `hallway
  doctor` mentions this when Firefox is installed.
- Internal leaf certificates last 12 hours and are renewed automatically by Caddy as long as it runs.

### Why HTTPS is mandatory in fronted mode (D6)

`http://localhost:<port>` is a **secure context** in browsers. `http://app.myname.internal` is **not**. Without
TLS, moving an app behind a custom hostname silently breaks `crypto.subtle`, service workers, `getUserMedia`, the
async clipboard API and anything else gated on secure contexts. (`http://*.localhost` *is* a secure context in
Chromium, Firefox and WebKit, verified 2026-10-17, but WebKit still drops `Secure` cookies over plain HTTP; HTTPS
removes the question. Plain HTTP on `*.localhost` is the opt-in No prompts tier (D65); custom domains are HTTPS only.)

## DNS for custom domains (dnsmasq)

Only needed when `domain.base` is not `localhost`.

- **Hallway runs its own dnsmasq, as the user, on `127.0.0.1:4253`** (`domain.dnsPort`), from
  `generated/dnsmasq.conf`:
  ```
  port=4253
  listen-address=127.0.0.1
  bind-interfaces
  no-resolv
  no-hosts
  address=/myname.internal/127.0.0.1
  address=/myname.internal/::1
  ```
  `listen-address` + `bind-interfaces` keep it off the LAN (no open resolver); `no-resolv` means it answers the base
  domain and refuses everything else. `address=/<domain>/…` answers the apex **and every subdomain** — a wildcard — so
  adding an app never touches DNS. Verified: dnsmasq 2.90 as an arbitrary uid on 4253 answers A and AAAA for the apex
  and `a.b.<base>`, and REFUSES `example.com`.
- A port above 1024 means no root dnsmasq and no clash with one the user already runs on 53. The system resolver is
  pointed at it **for the base domain only**:
  - macOS: `/etc/resolver/<base>` with `nameserver 127.0.0.1` and `port 4253` (resolver(5) supports a `port` line).
    Unverified on macOS (CI's macOS job runs it).
  - Linux: a `systemd-resolved` drop-in, `DNS=127.0.0.1:4253` and `Domains=~<base>` (the `IP:port` form needs systemd
    246 or later). Without systemd-resolved, setup refuses custom domains and says how to point another resolver at it.
- Install dnsmasq: `brew install dnsmasq` (setup runs it, as you, if Homebrew is there); on Debian/Ubuntu
  `dnsmasq-base`, which starts no system service.
- Verify with `scutil --dns` / `resolvectl status` and `dscacheutil -q host -a name app.<base>` / `getent hosts
  app.<base>`; `hallway doctor` resolves `<base>` and a name under it.

Rejected alternatives: managing `/etc/hosts` entries per app (what localias does: sudo for *every new app*, no
wildcards); a root dnsmasq on :53 with a drop-in in Homebrew's dnsmasq (edits the user's dnsmasq, root for no reason).

## App bind addresses

- Many dev servers started with `--host` bind `0.0.0.0`, exposing them to the local network. Behind a proxy they
  should bind `127.0.0.1`.
- Managed services (v1) get `HOST=127.0.0.1` injected (and `HOSTNAME=127.0.0.1` for frameworks that read that).
- The scanner records each listener's bind address; the dashboard shows a subtle "exposed on network" indicator for
  apps on `*`/`0.0.0.0`, and `hallway doctor` lists them.

## Setup: `hallway setup`

Everything that changes the machine outside Hallway's own files lives in one command, so the daemon never needs
privileges (`server/proxy/setup.ts`; the tiers in `server/proxy/tiers.ts`; the platform recipes in
`server/platform/fronting-darwin.ts` and `fronting-linux.ts`).

- **The tier first** (D65): `--trust user|system|none`, else, on a terminal, a question listing the three with their
  URLs and what each asks for (the current tier, or the recommended one, is the default); without a terminal, or with
  `--yes` or `--print`, the current tier, else the recommended one, said in one line. `--domain` means System-wide
  (with another `--trust` it's a usage error).
- `hallway setup`: check → (macOS, if missing: `brew install caddy`, as you) → write `generated/caddy.json` and check
  it with `caddy validate` → install and start the `hallway.caddy` user job → wait for its admin socket (and, for
  HTTPS, its CA) → (macOS) load the forwarders, launchd holding 443 and 80 → trust the root: **sudo** (System-wide) or
  **you** (No admin) → (Linux, System-wide) **sudo**: install the redirect → remove what another tier (or an older
  Hallway: the pf redirect) added → set `mode: fronted` and the tier → check the dashboard answers at its address, with
  Hallway's certificate for HTTPS. (Homebrew runs with `HOMEBREW_NO_AUTO_UPDATE`, `HOMEBREW_NO_INSTALL_CLEANUP` and
  `HOMEBREW_NO_ENV_HINTS`, so its output doesn't bury setup's.)
- **The forwarders run Hallway's own CLI**, so, like the daemon's job, they must point at an installed one, never
  npx's cache (D61): on macOS setup refuses from npx before it changes anything.
- `hallway setup --domain <base>`: also checks the TLD (below), writes `generated/dnsmasq.conf`, starts the
  `hallway.dnsmasq` user job, and (**sudo**) installs the resolver; `config.yaml` gets `domain.base`.
- Every step is printed before it runs: `[Hallway]` steps (its own files and user-level jobs), `[you]` (Homebrew;
  trusting the root for your account), `[sudo]` (each command shown exactly, after the contents of any file it
  installs); a step that may raise the OS's own dialog says so under it. Files to install as root are first
  written to `generated/setup/` as the user and then copied with `sudo install`, so what lands in `/etc` is exactly
  what was shown. `hallway setup --print` prints the whole plan and runs nothing.
- **It asks first (D67).** Typing `hallway setup` changes nothing by itself: it prints the plan (what `--print`
  shows), says what will ask for what (sudo's password in the terminal; on macOS, when the root isn't trusted yet,
  also the system's own Touch ID or password dialog for changing trust settings, which macOS requires even under sudo
  since Big Sur, and which for No admin is the user's own, "not an administrator prompt"; or that nothing will ask),
  then asks `Continue? [y/N]`. Anything but `y`/`yes` (Enter and Ctrl-D included) runs nothing and
  exits 1. `--yes` skips the question (scripts, CI); with no terminal and no `--yes` it's a usage error (exit 2),
  before anything runs. `hallway teardown` asks the same way.
- **Idempotent:** a part already in place is skipped, judged by asking the real thing (the root's fingerprint in the
  trust store; the installed files' exact text, or the forwarders' jobs, plus a TLS handshake on 443 that meets
  Hallway's CA). Re-running only
  fixes what is missing; a failed command stops the run, and running it again picks up where it stopped.
- **Refusals**, before anything runs: `.local` (mDNS); an HSTS-preloaded TLD (`.dev`, `.app`, … the 51 whole-TLD
  entries on Chromium's preload list); `.example`/`.invalid`; something else on 80/443 or on Caddy's or dnsmasq's
  ports (named); a missing Caddy or dnsmasq with no Homebrew to install it; on Linux, no systemd, no `nft` or no CA
  store for System-wide (with what to install), no `certutil` for No admin; on macOS, the CLI in npx's cache, or (No
  admin) nobody at the Mac's screen to answer the trust dialog. **Warnings:** a delegated TLD (a domain you might own); a made-up TLD; Caddy older
  than 2.7; something on port 2019. The TLD check uses IANA's list, cached for a week in `cache/iana-tlds.txt`; a
  failed fetch is a warning.
- **`hallway teardown [--print] [--uninstall-packages] [--yes]`** reverses only what is there (the resolver, the dnsmasq job,
  the forwarders, an old pf redirect or the nftables one, the root trusted system-wide or for you, the Caddy job) and
  sets `mode: direct`, clearing the tier; the dashboard keeps working on
  `http://localhost:4255`. It never removes packages unless asked (`--uninstall-packages`: Homebrew's `caddy` and
  `dnsmasq`; on Linux it says to use the package manager). The CA stays, unused, in the data home.
- Never writes outside: the data home; `~/Library/LaunchAgents/hallway.*.plist` or `~/.config/systemd/user/hallway-*`;
  `/etc/hallway/` and `/etc/systemd/system/hallway-redirect.service` (Linux, System-wide); `/etc/resolver/<base>` or
  `/etc/systemd/resolved.conf.d/hallway.conf`; the trust store, or the user's login keychain or `~/.pki/nssdb`. (It
  removes `/Library/LaunchDaemons/hallway.pf.plist` and `/etc/pf.anchors/hallway` where an older Hallway left them.)
- **Commands Hallway prints for copying avoid zsh's paste traps** (D65): one command per line, no shell metacharacters
  right after a URL, or a note to run them in bash.

## `hallway doctor`

Read-only diagnostics, each with a pass/warn/fail line and a suggested fix:

- daemon running; its port free/owned by it; its launchd job loaded
- data home readable; any YAML parse/validation errors
- (fronted) Caddy installed and at least 2.7; its job installed and running; its admin socket answering, private
  (`0600`), and holding the config in `generated/caddy.json`
- (fronted) Caddy's ports, and (Linux, System-wide) 80/443, held by nothing else — or **who holds them instead**
  (name and PID)
- (fronted, macOS) `443 and 80 on loopback: launchd, for hallway.caddy`: the forwarders installed and loaded; an old
  pf redirect named as left over (`hallway setup` removes it, needing admin once)
- (fronted) `https://<dashboard>` reaches Hallway's Caddy (through launchd's socket, or the redirect), with a
  certificate that verifies against Hallway's root, and `http://` redirects; or, No prompts, `http://<dashboard>`
  answers, with an `info` line on Safari's `Secure` cookies
- (fronted) Hallway's root trusted where the tier puts it (the system, or your account, with an `info` line on who
  else won't trust it and how to tell Node); a leftover system-wide trust in another tier; a Firefox note when Firefox
  is installed
- (fronted, `localhost`) `*.localhost` resolves to loopback through the system resolver (a warning: browsers resolve it
  themselves)
- (custom domain) dnsmasq running and bound to loopback only; the resolver configuration present; `<base>` and a name
  under it resolve to loopback
- (custom domain) TLD not `.local`, not HSTS-preloaded, not delegated (IANA's list), not made up
- apps bound to `0.0.0.0`
- two declared apps on one port
- launchd jobs whose `PATH` contains per-shell version-manager directories or entries that no longer exist (see `04`)

## Linux

- `*.localhost` resolves through `systemd-resolved` (and `nss-myhostname`); doctor warns if it doesn't.
- No unprivileged way to loopback 443 exists (`ip_unprivileged_port_start` is 1024, and a systemd *user* socket unit
  gets `EACCES`: the user manager binds as the user), so No admin and No prompts carry Caddy's port in links.
- The redirect (System-wide) is nftables (`inet hallway`, a nat `output` chain), applied by a oneshot system unit after
  `nftables.service`; the file deletes and re-creates its own table, so re-applying it never duplicates rules and no
  one else's rules are touched.
- Custom domains: a `systemd-resolved` drop-in routing `~<base>` to Hallway's dnsmasq.
- Services: systemd user units (`hallway-caddy.service`, `hallway-dnsmasq.service`) instead of LaunchAgents.
