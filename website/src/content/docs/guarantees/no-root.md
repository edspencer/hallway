---
title: No root in the daemon
description: Hallway's daemon never runs as root; the only privileged step is one explicit, printed command.
---

**Hallway's daemon never runs as root, and never asks for your password.** It is a single Node process running as
you, listening on `127.0.0.1` only.

## What that means in practice

- **No sudo anywhere** in normal use. The dashboard, health checks, scanner,
  bookmarks, managed services, the MCP server, thumbnails and running Hallway as a login service (a LaunchAgent or a
  systemd user unit) all work as your own user.
- <span class="ms ms--shipped">v1</span> **One privileged command, and it shows its work.** Fronted mode needs a few
  things only root can do: redirecting ports 443 and 80, trusting a certificate authority and, for a custom domain,
  adding a resolver entry. They all live in [`hallway setup`](/networking/setup-and-doctor/), which **prints each
  command and why before running it with `sudo`**, has a `--print` mode that runs nothing, and is undone by
  `hallway teardown`.
- <span class="ms ms--shipped">v1</span> **After setup, no more sudo.** Adding, changing or removing an app
  reconfigures Caddy through its admin API, as your user.
- **A short list of places outside the data home**, all named in
  [The data home](/reference/data-home/#outside-the-data-home).

## The hard part: Caddy and port 443

Serving `https://slides.localhost` means something must answer on `127.0.0.1:443`, which only root may bind. The
obvious answer, a root Caddy, has a problem: anything that can reach Caddy's admin API can reconfigure it, so **a root
Caddy could be turned against you**, for instance made to serve files only root can read. That would turn any
malicious install script into a privilege escalation.

So **Caddy never runs as root.** It runs as you, on loopback ports 4443 and 4480, with its admin API on a Unix socket
in your data home that only you can open (mode 0600). Since Caddy has no privilege, reaching its API gains nothing.
The root parts are fixed and read nothing you could rewrite later: a redirect from 443 and 80 to Caddy's ports (a pf
anchor on macOS, an nftables table on Linux), the trusted root certificate, and for a custom domain the resolver
entry. See [The security model](/networking/setup-and-doctor/#the-security-model).

Rejected: a root Caddy with its admin API on TCP or on a socket only you can open (your own processes could still
escalate); a root Caddy with no admin API, reloaded by a privileged helper (sudo for every app change, which defeats
the point); and Caddy as you on `0.0.0.0:443`, which would expose every fronted app to everyone on your network.
