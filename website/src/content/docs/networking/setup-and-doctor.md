---
title: Setup, teardown and doctor
description: The one command that needs sudo, how to undo it, and the diagnostics that check everything.
---

Every step that needs root lives in one command, `hallway setup`, so the daemon never needs privileges.

## `hallway setup`

<span class="ms">v1</span> Run it once, when you want fronted mode:

```sh
hallway setup --print                    # show the full plan; run nothing
hallway setup                            # fronted mode on *.localhost
hallway setup --domain myname.internal   # plus a custom domain
```

For fronted mode on `localhost`, it:

1. checks prerequisites, including whether anything else holds ports 80 and 443 or Caddy's admin port;
2. installs Caddy if it is missing (`brew install caddy`), with your consent;
3. installs and starts Hallway's own Caddy job, separate from any Caddy you already run;
4. pushes the routes;
5. trusts Caddy's root certificate (`caddy trust`);
6. sets `mode: fronted` in `config.yaml`;
7. runs `hallway doctor`.

With `--domain`, it also installs dnsmasq, writes its drop-in, starts it, writes `/etc/resolver/<domain>` and sets
`domain.base`. See [Custom domains](/networking/custom-domains/).

The rules it follows:

- **Before each privileged command, it prints the command and a one-line explanation, then runs it with `sudo`**, so
  you see and approve exactly what happens.
- **It is idempotent.** Re-running it is safe and only fixes what is missing.
- **It stops rather than fights.** If something else already holds port 80 or 443, Caddy's admin port, or a Caddy
  instance is running, it says so and stops.
- **It never writes outside** the data home, `/etc/resolver/<base>`, the dnsmasq drop-in,
  `/Library/LaunchDaemons/hallway.*.plist` and `~/Library/LaunchAgents/hallway.*.plist`.

:::note
Exactly how Caddy gets port 443 without a root process that any local program can reconfigure is still being
decided, so the details of steps 3 and 5 may change. See
[Fronted mode and HTTPS](/networking/fronted-mode/#privileges-and-an-open-question).
:::

## `hallway teardown`

<span class="ms">v1</span> Undo it any time:

```sh
hallway teardown
hallway teardown --uninstall-packages    # also remove Caddy and dnsmasq from Homebrew
```

Reverses everything setup installed (the LaunchDaemons, the dnsmasq drop-in, the resolver file, the trusted root via
`caddy untrust`) and sets `mode: direct`. The dashboard keeps working at `http://localhost:4255`. Homebrew packages
are left alone unless you ask.

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

**<span class="ms">v1</span> Networking (upcoming):**

- Caddy is running, its admin API is reachable, and its config matches what the daemon expects;
- ports 80 and 443 belong to Caddy, or **who holds them instead** (process, PID and owner);
- Caddy's root certificate is trusted, with a note for Firefox;
- for a custom domain: dnsmasq is running and bound to loopback only, `/etc/resolver/<base>` exists, and both
  `<base>` and a test subdomain resolve to your machine;
- for a custom domain: its TLD is not delegated (checked against IANA's list), not `.local`, and not HSTS-preloaded.
