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
  whose `Host` is `localhost`, `127.0.0.1` or `[::1]` (and, once fronted mode exists, the dashboard hostname you
  configured), which stops DNS-rebinding attacks from a web page you visit. It accepts writes only as JSON and, when
  the browser sends an `Origin`, only from those same hosts, which stops cross-site request forgery. It never sends
  CORS headers. (`server/security.ts`.)
- **The daemon never runs as root.** Privileged steps (trusting a local certificate authority, binding port 443,
  DNS resolver files) belong only to explicit setup commands that print each step before running it.
- **Nothing reachable over the network launches processes.** Starting a server is a CLI action you (or an agent in
  your own shell) run explicitly; the HTTP API and MCP tools describe apps, they don't execute commands.
- **Your configuration isn't destroyed.** Writes are atomic, and removing an app or bookmark group moves its file to
  `backups/` rather than deleting it.

Some of these describe behaviour still being built (see `docs/08-roadmap.md`); the guarantees apply as each piece
lands.

Out of scope: anything that needs an attacker who can already run code as you, or write to your `~/.hallway`.
Hallway trusts its own config and data files the way your shell trusts your dotfiles. The development-only
`HALLWAY_DEV_BIND` / `HALLWAY_DEV_ALLOWED_HOSTS` variables deliberately relax the first guarantee for previewing a
development build; setting them is not a vulnerability.
