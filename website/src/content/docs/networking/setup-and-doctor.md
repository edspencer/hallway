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
- **`[you]`**: on macOS, `brew install caddy` (and `dnsmasq` for a custom domain) if they're missing, as you, with
  Homebrew's auto-update, cleanup and hints turned off for that one command so its output doesn't bury setup's.
- **`[sudo]`**: a privileged change. The exact command is shown; a file to be installed as root is first written to
  `~/.hallway/generated/setup/` as you, shown in full, then copied into place with `sudo install`.

For fronted mode on `localhost`, it:

1. installs Caddy if it is missing (macOS, with Homebrew; on Linux it stops and says how to get a release binary);
2. writes Caddy's configuration (`generated/caddy.json`) and the fallback page, and checks them with `caddy validate`;
3. starts **Caddy as you**, as the user-level job `hallway.caddy`, on `127.0.0.1:4443` and `:4480`, with its admin API
   on a private socket;
4. **[sudo]** trusts Hallway's local certificate authority;
5. **[sudo]** redirects loopback ports 443 and 80 to Caddy's 4443 and 4480;
6. on macOS, **[sudo]** if another tool has told pf to skip loopback, which makes it ignore the redirect, and it's
   safe to undo, loads macOS's own `/etc/pf.conf` again and then the redirect (checked just before; see
   [pf is skipping loopback](#pf-is-skipping-loopback-macos));
7. sets `mode: fronted` in `config.yaml`;
8. checks that `https://hallway.localhost` answers through the redirect, with Hallway's certificate, and if not, says
   why when it can tell.

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

:::caution[Partly verified on a real Mac]
The pf redirect runs for real on CI's macOS runners. On the first desktop Mac it was tried on, it was installed
correctly but ignored, because another tool had told pf to skip loopback; `hallway doctor` and `hallway setup` now
recognise that ([below](#pf-is-skipping-loopback-macos)). Whether the redirect survives a macOS update and a reboot
hasn't been checked yet. If it stops working, `hallway doctor` says so and `hallway setup` reinstalls it.
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
- a TLS handshake through the redirect that verifies against Hallway's root, and the HTTP-to-HTTPS redirect; on
  macOS, when nothing answers on 443, whether pf is skipping loopback (see below);
- the root trusted, with a note for Firefox;
- `*.localhost` resolving (a warning only: browsers resolve it themselves);
- for a custom domain: its TLD (delegated or made up, checked against IANA's list), dnsmasq running and bound to
  loopback only, the resolver entry in place, and both `<base>` and a name under it resolving to your machine.

## Troubleshooting

### pf is skipping loopback (macOS)

If `hallway setup` ends with `✗ https://hallway.localhost: nothing answered`, or `hallway doctor` says nothing answers
on 443, while Caddy itself is fine, check whether pf has been told to ignore the loopback interface:

```sh
sudo pfctl -s Interfaces -v | grep lo0
```

`lo0 (skip)` means some other program loaded a pf ruleset containing `set skip on lo0`. That line is common in VPN
kill switches and firewall apps, and stock macOS doesn't set it. pf then evaluates no rule on loopback at all, so
Hallway's redirect is installed but ignored. Doctor reports it as:

```
✗ pf is set to skip loopback (lo0), so the redirect is ignored; something other than Hallway set this (pf was turned on by …)
    fix: `sudo pfctl -f /etc/pf.conf && sudo launchctl kickstart -k system/hallway.pf` …
```

Loading macOS's own `/etc/pf.conf` again clears the skip, and the `kickstart` loads Hallway's anchor again.
`hallway setup` does the same for you, as a printed `[sudo]` step, but only when it's safe:

- **`/etc/pf.conf` itself says `set skip on lo0`**: reloading it would set the skip again, so setup leaves it alone.
  Take `lo0` out of that line if nothing you use needs it, then run the fix.
- **pf's main ruleset has rules of its own** (anything beyond macOS's `com.apple` anchors, as a VPN kill switch would
  load): reloading `/etc/pf.conf` would drop them, so setup only says so. Turn the skip off in that tool if it lets
  you, or run the fix yourself if you don't need its rules.

Doctor checks by running `sudo -n pfctl …`, which never asks for a password; if sudo has no password cached it says it
couldn't check, and `sudo -v` followed by `hallway doctor` lets it look.

If the program that set the skip does so again (at the next boot, say), the redirect stops working again and doctor
says so. Hallway's boot job deliberately doesn't reload `/etc/pf.conf` itself: at boot nobody is watching, and it
could silently remove another tool's rules.
