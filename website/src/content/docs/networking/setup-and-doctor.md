---
title: Setup, teardown and doctor
description: The one command that changes your machine for fronted mode, its three tiers, what each asks for and why that is safe, how to undo it, and the diagnostics that check everything.
---

Every step of fronted mode that touches your machine lives in one command, `hallway setup`, so the daemon never needs
privileges. You only need it for [fronted mode](/networking/fronted-mode/): direct mode, the default, needs no setup
at all.

:::note[Not on Windows]
Fronted mode is macOS and Linux only. On Windows (best effort) its parts have no user-level equivalent, so
`hallway setup` refuses before it looks for or changes anything, `hallway teardown` has nothing to undo, and apps keep
their `http://localhost:<port>` addresses.
:::

## `hallway setup`

<span class="ms ms--shipped">v1</span> Run it once, when you want fronted mode:

```sh
hallway setup --print                    # show the full plan; run nothing
hallway setup                            # asks which tier, then asks before it runs anything
hallway setup --trust user               # User certificate
hallway setup --trust system             # System-wide certificate
hallway setup --trust none               # No HTTPS (plain HTTP)
hallway setup --domain myname.internal   # under your own domain (System-wide certificate)
hallway setup --port 4443                # links on Caddy's own port, when something else holds 443
```

On macOS, install Hallway first (`npm i -g hallway`): setup installs jobs that run the installed `hallway`, so it
refuses to run from npx's cache.

**First, the tier.** On a terminal with no `--trust`, setup asks, with the recommended tier, User certificate (and the
one you have, if any), marked; Enter takes the default. On a Mac:

```
Local domains: open your apps by name instead of by port.

  1) User certificate         https://review.localhost   (recommended)
     macOS asks for your Touch ID or password once, to trust Hallway's certificate for your account. It isn't an administrator prompt.
     Safari, Chrome and Apple's curl trust it; tools that bring their own certificate list (Node, Python) need to be told about it.
  2) System-wide certificate  https://review.localhost
     Needs an administrator's password: it trusts the certificate for every account on this Mac.
     Custom domains (--domain) need it, and so do other accounts and tools that read only the system's certificates.
  3) No HTTPS                 http://review.localhost
     Nothing will ask for a password.
     Plain HTTP: browser APIs that need a secure context still work on .localhost, but Safari drops Secure cookies.

Which? [1]
```

What each tier asks for and gives up, and when to choose another, is on
[Fronted mode: three tiers](/networking/fronted-mode/#three-tiers). With no terminal, or with `--yes`, setup doesn't
ask: it keeps the tier you have, or else takes User certificate, and prints which.

**Then the plan.** Typing `hallway setup` changes nothing on its own. It prints the plan below, says what will ask you
for what, and waits for an answer. For User certificate on a Mac:

```
You'll be asked by macOS, for your Touch ID or password, to change *your* certificate trust settings. This is not an
administrator prompt.
Continue? [y/N]
```

For System-wide certificate it's sudo's password in the terminal (and on macOS, the trust dialog after it); for No HTTPS, and
User certificate on Linux, it's `Nothing here will ask for a password.` The default is no: anything but `y` or `yes` (Enter,
Ctrl-D) runs nothing. For a script or CI, `hallway setup --yes` doesn't ask; with no terminal to ask on and no
`--yes`, setup refuses (exit 2) before it does anything.

The plan is a numbered list, and each step is tagged with who does it:

- **`[Hallway]`**: Hallway's own files and user-level jobs, as you.
- **`[you]`**: a command run as you, with no sudo: on macOS, `brew install caddy` (and `dnsmasq` for a custom domain)
  if they're missing, with Homebrew's auto-update, cleanup and hints turned off for that one command so its output
  doesn't bury setup's; and User certificate's trust step.
- **`[sudo]`**: a privileged change. The exact command is shown; a file to be installed as root is first written to
  `~/.hallway/generated/setup/` as you, shown in full, then copied into place with `sudo install`.

For fronted mode on `localhost`, it:

1. installs Caddy if it is missing (macOS, with Homebrew; on Linux it stops and says how to get a release binary);
2. writes Caddy's configuration (`generated/caddy.json`) and the fallback page, and checks them with `caddy validate`;
3. starts **Caddy as you**, as the user-level job `hallway.caddy`, on `127.0.0.1:4443` and `:4480` (No HTTPS: only
   `:4480`), with its admin API on a private socket;
4. on macOS, in every tier, has **launchd hold loopback 443 and 80** for Caddy (only 80 for No HTTPS): one small
   LaunchAgent per socket, `hallway.forward.https`, `…https6`, `…http` and `…http6`, with no sudo;
5. trusts Hallway's local certificate authority: **[you]** for your account only (User certificate), or **[sudo]**
   system-wide (System-wide certificate); No HTTPS has no certificate;
6. on Linux, System-wide certificate only, **[sudo]** redirects loopback ports 443 and 80 to Caddy's 4443 and 4480;
7. removes what another tier added, if you're switching (and, on a Mac set up by an older Hallway, **[sudo]** its pf
   redirect);
8. sets `mode: fronted` and the tier (`proxy.trust`, `proxy.scheme`, `proxy.publicPort`) in `config.yaml`;
9. checks that the dashboard's address (`https://hallway.localhost`, or `http://`, or with Linux's port) answers, with
   Hallway's certificate, and if not, says why when it can tell.

With `--domain`, it also writes and starts Hallway's own dnsmasq (as you) and adds one more `[sudo]` step, the
resolver entry for that domain. See [Custom domains](/networking/custom-domains/).

The rules it follows:

- **Each privileged command is printed with a one-line reason, then run with `sudo`**, so you see exactly what
  happens; `sudo` asks for your password as usual. The whole plan is shown, and you're asked to continue, first.
- **It is idempotent.** Re-running it checks the real state (the root in the trust store, the installed files' exact
  contents, the jobs, a TLS handshake on port 443) and only does what is missing; already-done steps say so. If a
  command fails, the run stops there, and running setup again carries on.
- **It refuses before running anything** when the domain is `.local`, a TLD on browsers' HSTS preload list (`.dev`,
  `.app`, …), `.example` or `.invalid`; when `--domain` comes with a tier other than System-wide certificate; when anything else
  holds a low port the tier needs, or Caddy's or dnsmasq's ports (it names the process, its PID and command line);
  when a helper it needs is missing and can't be installed (on Linux, User certificate needs `certutil`); on macOS, when it
  runs from npx's cache, or when User certificate's trust dialog has nobody at the Mac's screen to answer it (over SSH, say);
  and on Linux, for System-wide certificate, when there is no systemd, no `nft` or no system CA store it recognises. It **warns**
  about a real or made-up TLD, a Caddy older than 2.7, and another Caddy's admin API on port 2019.

:::tip[Pasting into zsh]
Every command Hallway prints for you to copy is one command per line, with no shell metacharacters right after a URL.
If a pasted command still misbehaves in zsh (oh-my-zsh's `url-quote-magic` escapes characters after URLs), run it in
bash.
:::

## The security model

Serving `https://slides.localhost` means something must answer on `127.0.0.1:443`, which only root may bind. The
obvious answer, a Caddy running as root, has a problem: anything that can reach Caddy's admin API can reconfigure it,
for instance to serve files only root can read. A root Caddy would turn any malicious install script on your machine
into a privilege escalation. So Hallway doesn't run one.

- **Nothing of Hallway's runs as root.** Caddy runs as you, as a LaunchAgent or a systemd user unit, on loopback
  ports 4443 and 4480, which need no privileges. It can do nothing you couldn't already do.
- **On macOS, launchd holds 443 and 80.** launchd binds the loopback sockets as root on your behalf and hands them to
  your own LaunchAgents (`hallway.forward.*`), which run as you and only pass bytes on to Caddy. Loopback only: the
  sockets aren't reachable from your network.
- **Its admin API is a Unix socket in your data home** (`state/caddy/admin.sock`) with mode 0600, never a TCP port.
  Only your own processes can reach it, and since Caddy holds no privilege, reaching it gains them nothing.
- **The only privileged changes are fixed, read nothing you could rewrite later, and belong to System-wide certificate:**
  1. **Trusting Hallway's local certificate authority system-wide**: in the System keychain on macOS, in the system
     CA store on Linux (plus your own NSS database, without sudo).
  2. **On Linux, the redirect** of loopback ports 443 → 4443 and 80 → 4480: an nftables table of Hallway's own
     (`inet hallway`, in `/etc/hallway/redirect.nft`), applied at boot by `hallway-redirect.service`.
  3. **For a custom domain only, the resolver entry**: `/etc/resolver/<base>` on macOS, a `systemd-resolved` drop-in
     on Linux, pointing that one domain at Hallway's dnsmasq, which also runs as you.

  Each is printed and run through `sudo`. User certificate and No HTTPS make none of them. After setup, adding, changing or
  removing an app never needs sudo again: the daemon reconfigures Caddy through its socket, as you.

Rejected along the way: a root Caddy with its admin API on TCP or on a user-only socket (your own processes could
still escalate), a root Caddy with no admin API (sudo for every new app), Caddy as you on `0.0.0.0:443` (every app
exposed to your network), and on Linux `setcap` on the Caddy binary (whoever reaches its API could bind any privileged
port). See [No root in the daemon](/guarantees/no-root/).

### What it changes outside the data home

| | macOS | Linux |
| --- | --- | --- |
| Caddy, as you | `~/Library/LaunchAgents/hallway.caddy.plist` | `~/.config/systemd/user/hallway-caddy.service` |
| dnsmasq, as you (custom domain) | `~/Library/LaunchAgents/hallway.dnsmasq.plist` | `~/.config/systemd/user/hallway-dnsmasq.service` |
| Ports 443 and 80 | `~/Library/LaunchAgents/hallway.forward.{https,https6,http,http6}.plist`, as you (every tier) | `/etc/hallway/redirect.nft`, `/etc/systemd/system/hallway-redirect.service` (sudo; System-wide certificate only) |
| The trusted root, User certificate | your login keychain, as you | your NSS database (`~/.pki/nssdb`), as you |
| The trusted root, System-wide certificate (sudo) | the System keychain | the system CA store (e.g. `/usr/local/share/ca-certificates/hallway-local-ca.crt`); your NSS database, as you |
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

Like setup, it shows what it will remove and asks `Continue? [y/N]` first (`--yes` skips the question). It removes
whatever it finds, whichever tier put it there: the resolver entry, the dnsmasq job, the launchd forwarders, an older
Hallway's pf redirect, the nftables redirect, the trusted root (system-wide or for your account) and the Caddy job,
with `sudo` only for the privileged ones. Then it sets `mode: direct` and clears the tier. The dashboard keeps working
at `http://localhost:4255`. Homebrew packages are left alone unless you ask; on Linux, `--uninstall-packages` only
reminds you to use your package manager. The certificate authority stays in the data home, unused, so a later setup
can trust the same root again.

## `hallway doctor`

```sh
hallway doctor
hallway doctor --json
```

Read-only diagnostics. Each check prints pass, warn, fail or info, with a suggested fix.

**<span class="ms ms--v0">v0</span> The daemon, your data and your services:**

- the daemon is running, its port is free or its own, and its service (launchd job or systemd user unit) is loaded;
- on Linux, whether lingering is on, so services keep running without a login session;
- the data home is readable, and lists any YAML parse or validation errors;
- two declared apps on one port;
- apps listening on `0.0.0.0`, which exposes them to your network;
- managed-service jobs that are missing or orphaned, whose `PATH` contains per-shell version-manager directories or
  entries that no longer exist, or whose Node version has been uninstalled (see
  [the PATH trap](/concepts/services/#the-path-trap)).

When fronted mode is off, an info line says so (`i local domains are off (mode: direct), so nothing answers at
https://hallway.localhost …`) with `hallway setup` as the way to turn them on; on Windows it says why they aren't
available.

**<span class="ms ms--shipped">v1</span> Fronted mode**, when it is on (the dashboard's **Local domains** button shows
the same checks):

- Caddy: its version, its job, its admin socket answering and private, and the configuration it is running matching
  `generated/caddy.json`;
- who holds Caddy's ports and ports 80 and 443 (process, PID and command line), if it isn't Caddy;
- on macOS, launchd's forwarders installed and loaded (`✓ 443 and 80 on loopback: launchd, for hallway.caddy`), and a
  warning if an older Hallway's pf redirect is still installed (`hallway setup` removes it, with sudo once);
- a TLS handshake through 443 (or Caddy's port) that verifies against Hallway's root, and the HTTP-to-HTTPS redirect;
  for No HTTPS, `✓ http://hallway.localhost answers (plain HTTP)` and an info line that Safari won't keep `Secure`
  cookies over plain HTTP;
- the root trusted for the tier: System-wide certificate, by the system, with a note for Firefox; User certificate,
  `✓ Hallway's root is trusted for your account`, and an info line on who doesn't trust it (on macOS other accounts
  and tools with their own CA list, with the Node settings to use; on Linux everything but Chrome and Chromium, with
  the root's path for `curl --cacert` and `NODE_EXTRA_CA_CERTS`); a warning if a system-wide trust is left over from
  System-wide certificate;
- `*.localhost` resolving (a warning only: browsers resolve it themselves);
- for a custom domain: its TLD (delegated or made up, checked against IANA's list), dnsmasq running and bound to
  loopback only, the resolver entry in place, and both `<base>` and a name under it resolving to your machine.

## Troubleshooting

### Port 443 is already in use

`hallway setup` (and the dashboard's **Turn on**) stops before it changes anything when another program holds port
443 or 80, and names it: the tool when its command line says which (Rancher Desktop, Docker Desktop, Colima,
OrbStack, Podman, Lima, nginx, Apache, another Caddy), the process and its PID, and whether it listens on every address
(`*`), which means other machines on your network can reach it too. Hallway won't fight it for the port. Either free
the port, or leave it running and give Hallway's links Caddy's own port.

**Free the port**, then run `hallway setup` again (or press **Try again**):

- **Rancher Desktop.** Its Kubernetes runs the Traefik ingress, which holds 80 and 443 on every address (you'll see
  an `ssh` process under `~/Library/Application Support/rancher-desktop/lima/`). Open **Preferences → Kubernetes** and
  untick **Enable Traefik** (or untick **Enable Kubernetes** if you don't use it). From a terminal:

  ```sh
  rdctl set --kubernetes.options.traefik=false
  ```

- **Docker Desktop, Colima, OrbStack, Podman.** A container publishes the port. Hallway names it when `docker ps` can;
  otherwise list them, then stop it or publish it on another port (e.g. `-p 8443:443`):

  ```sh
  docker ps --filter publish=443
  docker stop <name>
  ```

  With Colima's or OrbStack's Kubernetes, a service of type LoadBalancer on 443 does the same: `kubectl get svc -A`
  lists them.
- **Lima.** A port forward from a VM: `limactl list` names them; stop what publishes 443 inside it, or
  `limactl stop <name>`.
- **nginx or Apache.** `brew services stop nginx` (or `httpd`), `sudo apachectl stop` for macOS's own Apache; on
  Linux, `sudo systemctl stop nginx` (or `apache2`). Or move their `listen 443` to another port.

**Or use Caddy's own port.** Hallway's Caddy already listens on 4443 (and 4480), as you, on loopback; only the step
that puts 443 and 80 in front of it needs those ports. Skip it, and links carry the port:

```sh
hallway setup --trust user --port 4443
```

The dashboard is then `https://hallway.localhost:4443`, and each app `https://<app>.localhost:4443`. Every link
Hallway gives (the dashboard, `hallway open`, the agent guide, MCP, doctor) carries the port. The dashboard's
**Use port 4443 instead** button does the same. Once the other tool lets go of 443, move back with one command (or
**Move to port 443** in the header's Local domains dialog):

```sh
hallway setup --port 443
```

`hallway doctor` says which port links carry and whether 443 is free yet. On Linux, User certificate and No HTTPS
always carry the port (nothing unprivileged can hold 443 there), so this only applies to System-wide certificate.

### Nothing answers on 443 (macOS)

If `hallway setup` ends with nothing answering at `https://hallway.localhost`, or `hallway doctor` says launchd isn't
passing the connection on, ask launchd about the forwarder:

```sh
launchctl print gui/$(id -u)/hallway.forward.https
```

Its `state`, `runs` and `last exit code` say whether launchd is holding the socket and whether the forwarder ran. The
forwarders' logs are in the data home's `logs/`. Running `hallway setup` again reinstalls anything missing.
