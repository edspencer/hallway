---
title: Setup, teardown and doctor
description: The one command that needs sudo, what it changes and why that is safe, how to undo it, and the diagnostics that check everything.
---

Every step that needs root lives in one command, `hallway setup`, so the daemon never needs privileges. You only need
it for [fronted mode](/networking/fronted-mode/): direct mode, the default, needs no setup at all.

:::note[Not on Windows]
Fronted mode is macOS and Linux only. On Windows (best effort) its parts have no user-level equivalent, so
`hallway setup` refuses before it looks for or changes anything, `hallway teardown` has nothing to undo, and apps keep
their `http://localhost:<port>` addresses.
:::

## `hallway setup`

<span class="ms ms--shipped">v1</span> Run it once, when you want fronted mode:

```sh
hallway setup --print                    # show the full plan; run nothing
hallway setup                            # fronted mode on *.localhost
hallway setup --domain myname.internal   # under your own domain instead
```

The plan is a numbered list, and each step is tagged with who does it:

- **`[Hallway]`**: Hallway's own files and user-level jobs, as you.
- **`[you]`**: on macOS, `brew install caddy` (and `dnsmasq` for a custom domain) if they're missing, as you.
- **`[sudo]`**: a privileged change. The exact command is shown; a file to be installed as root is first written to
  `~/.hallway/generated/setup/` as you, shown in full, then copied into place with `sudo install`.

For fronted mode on `localhost`, it:

1. installs Caddy if it is missing (macOS, with Homebrew; on Linux it stops and says how to get a release binary);
2. writes Caddy's configuration (`generated/caddy.json`) and the fallback page, and checks them with `caddy validate`;
3. starts **Caddy as you**, as the user-level job `hallway.caddy`, on `127.0.0.1:4443` and `:4480`, with its admin API
   on a private socket;
4. **[sudo]** trusts Hallway's local certificate authority;
5. **[sudo]** redirects loopback ports 443 and 80 to Caddy's 4443 and 4480;
6. sets `mode: fronted` in `config.yaml`;
7. checks that `https://hallway.localhost` answers through the redirect, with Hallway's certificate.

With `--domain`, it also writes and starts Hallway's own dnsmasq (as you) and adds one more `[sudo]` step, the
resolver entry for that domain. See [Custom domains](/networking/custom-domains/).

The rules it follows:

- **Each privileged command is printed with a one-line reason, then run with `sudo`**, so you see exactly what
  happens; `sudo` asks for your password as usual.
- **It is idempotent.** Re-running it checks the real state (the root in the trust store, the installed files' exact
  contents, a TLS handshake on port 443) and only does what is missing; already-done steps say so. If a command fails,
  the run stops there, and running setup again carries on.
- **It refuses before running anything** when the domain is `.local`, a TLD on browsers' HSTS preload list (`.dev`,
  `.app`, …), `.example` or `.invalid`; when anything else holds port 443 or 80, or Caddy's or dnsmasq's ports (it
  names the process, its PID and command line); when a helper it needs is missing and can't be installed; and on
  Linux, when there is no systemd, no `nft` or no system CA store it recognises. It **warns** about a real or made-up
  TLD, a Caddy older than 2.7, and another Caddy's admin API on port 2019.

## The security model

Serving `https://slides.localhost` means something must answer on `127.0.0.1:443`, which only root may bind. The
obvious answer, a Caddy running as root, has a problem: anything that can reach Caddy's admin API can reconfigure it,
for instance to serve files only root can read. A root Caddy would turn any malicious install script on your machine
into a privilege escalation. So Hallway doesn't run one.

- **Caddy never runs as root.** It runs as you, as a LaunchAgent or a systemd user unit, on loopback ports 4443 and
  4480, which need no privileges. It can do nothing you couldn't already do.
- **Its admin API is a Unix socket in your data home** (`state/caddy/admin.sock`) with mode 0600, never a TCP port.
  Only your own processes can reach it, and since Caddy holds no privilege, reaching it gains them nothing.
- **The only privileged changes are fixed, and read nothing you could rewrite later:**
  1. **The redirect** of loopback ports 443 → 4443 and 80 → 4480. On macOS, a pf anchor (`com.apple/hallway`, in
     `/etc/pf.anchors/hallway`), loaded at boot by the `hallway.pf` LaunchDaemon; macOS's own `/etc/pf.conf` already
     evaluates `com.apple/*` anchors, so it is never edited. On Linux, an nftables table of Hallway's own
     (`inet hallway`, in `/etc/hallway/redirect.nft`), applied at boot by `hallway-redirect.service`.
  2. **Trusting Hallway's local certificate authority**: in the System keychain on macOS, in the system CA store on
     Linux (plus your own NSS database, for Chrome, without sudo).
  3. **For a custom domain only, the resolver entry**: `/etc/resolver/<base>` on macOS, a `systemd-resolved` drop-in
     on Linux, pointing that one domain at Hallway's dnsmasq, which also runs as you.

  Each is printed and run through `sudo`. After that, adding, changing or removing an app never needs sudo again: the
  daemon reconfigures Caddy through its socket, as you.

Rejected along the way: a root Caddy with its admin API on TCP or on a user-only socket (your own processes could
still escalate), a root Caddy with no admin API (sudo for every new app), Caddy as you on `0.0.0.0:443` (every app
exposed to your network), and on Linux `setcap` on the Caddy binary (whoever reaches its API could bind any privileged
port). See [No root in the daemon](/guarantees/no-root/).

:::caution[Not yet verified on a real Mac]
The pf redirect has run for real on CI's macOS runners, for locally originated connections. Whether it survives
another tool reloading `/etc/pf.conf`, a macOS update and a reboot hasn't been checked yet. If it stops working,
`hallway doctor` says so and `hallway setup` reinstalls it.
:::

### Without any redirect

If you set `proxy.publicPort` to the same value as `proxy.httpsPort` (4443) in `config.yaml`, setup installs no
redirect: links then carry the port (`https://slides.localhost:4443`). Trusting the certificate still needs sudo once.
See [Fronted mode without the redirect](/networking/fronted-mode/#fronted-mode-without-the-redirect).

### What it changes outside the data home

| | macOS | Linux |
| --- | --- | --- |
| Caddy, as you | `~/Library/LaunchAgents/hallway.caddy.plist` | `~/.config/systemd/user/hallway-caddy.service` |
| dnsmasq, as you (custom domain) | `~/Library/LaunchAgents/hallway.dnsmasq.plist` | `~/.config/systemd/user/hallway-dnsmasq.service` |
| The redirect (sudo) | `/etc/pf.anchors/hallway`, `/Library/LaunchDaemons/hallway.pf.plist` | `/etc/hallway/redirect.nft`, `/etc/systemd/system/hallway-redirect.service` |
| The trusted root (sudo) | the System keychain | the system CA store (e.g. `/usr/local/share/ca-certificates/hallway-local-ca.crt`); your NSS database, as you |
| The resolver (sudo, custom domain) | `/etc/resolver/<base>` | `/etc/systemd/resolved.conf.d/hallway.conf` |

Caddy's configuration, certificates and state, dnsmasq's configuration, and the files staged for `sudo` all stay in
the data home.

## `hallway teardown`

<span class="ms ms--shipped">v1</span> Undo it any time:

```sh
hallway teardown --print                 # show what it would remove; run nothing
hallway teardown
hallway teardown --uninstall-packages    # also uninstall Caddy and dnsmasq from Homebrew
```

It removes only what it finds: the resolver entry, the dnsmasq job, the redirect, the trusted root and the Caddy job,
with `sudo` for the privileged ones, then sets `mode: direct`. The dashboard keeps working at
`http://localhost:4255`. Homebrew packages are left alone unless you ask; on Linux, `--uninstall-packages` only
reminds you to use your package manager. The certificate authority stays in the data home, unused, so a later setup
can trust the same root again.

## `hallway doctor`

```sh
hallway doctor
hallway doctor --json
```

Read-only diagnostics. Each check prints pass, warn or fail with a suggested fix.

**<span class="ms ms--v0">v0</span> The daemon, your data and your services:**

- the daemon is running, its port is free or its own, and its service (launchd job or systemd user unit) is loaded;
- on Linux, whether lingering is on, so services keep running without a login session;
- the data home is readable, and lists any YAML parse or validation errors;
- two declared apps on one port;
- apps listening on `0.0.0.0`, which exposes them to your network;
- managed-service jobs that are missing or orphaned, whose `PATH` contains per-shell version-manager directories or
  entries that no longer exist, or whose Node version has been uninstalled (see
  [the PATH trap](/concepts/services/#the-path-trap)).

**<span class="ms ms--shipped">v1</span> Fronted mode**, when it is on:

- Caddy: its version, its job, its admin socket answering and private, and the configuration it is running matching
  `generated/caddy.json`;
- who holds Caddy's ports and ports 80 and 443 (process, PID and command line), if it isn't Caddy;
- a TLS handshake through the redirect that verifies against Hallway's root, and the HTTP-to-HTTPS redirect;
- the root trusted, with a note for Firefox;
- `*.localhost` resolving (a warning only: browsers resolve it themselves);
- for a custom domain: its TLD (delegated or made up, checked against IANA's list), dnsmasq running and bound to
  loopback only, the resolver entry in place, and both `<base>` and a name under it resolving to your machine.
