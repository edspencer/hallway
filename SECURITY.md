# Security policy

## Supported versions

Hallway is pre-release: nothing has been published yet. Once it is, fixes go into the latest minor release only.

## Reporting a vulnerability

Please report it privately through GitHub's private vulnerability reporting:
**https://github.com/edspencer/hallway/security/advisories/new**. Don't open a public issue or pull request for it.

Say what you found, which version or commit, and how to reproduce it. You'll get an acknowledgement, and we'll agree
on a fix and a disclosure date with you before anything is published. Hallway is maintained by one person, so allow
a few days for a first response.

## What Hallway protects

Hallway runs on your machine as your user, keeps a directory of the web servers you run locally, and keeps its
configuration in `~/.hallway`. What it's built to guarantee, and so what counts as a vulnerability if broken:

- **Only you can reach the daemon.** It binds 127.0.0.1 only, never a public interface. It answers only requests
  whose `Host` is `localhost`, `127.0.0.1` or `[::1]` (and, in fronted mode, the dashboard's hostname, such as
  `hallway.localhost`), which stops DNS-rebinding attacks from a web page you visit. It accepts writes only as JSON and, when
  the browser sends an `Origin`, only from those same hosts, which stops cross-site request forgery. It never sends
  CORS headers. (`server/security.ts`.)
- **Nothing of Hallway's runs as root: not the daemon, not Caddy.** On macOS, launchd binds loopback ports 443 and
  80 as root on your behalf and hands them to small LaunchAgents of yours that pass connections on to Caddy, as you.
  The privileged steps belong only to `hallway setup` and `hallway teardown`,
  which print each step before running it through `sudo`, and only to their System-wide certificate tier: trusting Hallway's
  local certificate authority system-wide (on macOS, in the System keychain), on Linux redirecting ports 443 and 80
  to Caddy's loopback ports, and a resolver entry for a custom domain. The User certificate tier trusts the certificate for
  your account only, and No HTTPS serves plain HTTP; neither uses sudo, except once to remove what an earlier
  System-wide certificate setup (or an older Hallway's pf redirect) installed. Caddy's admin API is a Unix socket only you
  can open (mode 0600, in the data home).
- **MCP never launches processes.** No MCP tool starts, stops or installs anything, and none can add a `service`
  block or change a port (D10, D53). The dashboard's HTTP API is different: it can write an app's
  `service` block and start, stop and restart managed apps (and servers lost at the last reboot), so it is as
  powerful as your shell. That is why it answers only requests that pass the checks above.
- **Your configuration isn't destroyed.** Writes are atomic, and removing an app or bookmark group moves its file to
  `backups/` rather than deleting it.

Out of scope: anything that needs an attacker who can already run code as you, or write to your `~/.hallway`.
Hallway trusts its own config and data files the way your shell trusts your dotfiles. The development-only
`HALLWAY_DEV_BIND` / `HALLWAY_DEV_ALLOWED_HOSTS` variables deliberately relax the first guarantee for previewing a
development build; setting them is not a vulnerability.
