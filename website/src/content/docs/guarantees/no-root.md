---
title: No root in the daemon
description: Hallway's daemon never runs as root; the only privileged step is one explicit, printed command.
---

**Hallway's daemon never runs as root, and never asks for your password.** It is a single Node process running as
you, listening on `127.0.0.1` only.

## What that means in practice

- <span class="ms ms--v0">v0</span> **No sudo anywhere.** The dashboard, health checks, scanner, bookmarks and running
  Hallway as a login service (a user LaunchAgent) all work as your own user.
- <span class="ms">v1</span> **One privileged command, and it shows its work.** Fronted mode needs a few things only
  root can do: listening on port 443, writing `/etc/resolver`, trusting a certificate authority. They all live in
  [`hallway setup`](/networking/setup-and-doctor/), which **prints each command and why before running it with
  `sudo`**, has a `--print` mode that runs nothing, and is undone by `hallway teardown`.
- <span class="ms">v1</span> **After setup, no more sudo.** Adding, changing or removing an app reconfigures Caddy
  through its admin API, as your user.
- **A short list of places outside the data home**, all named in
  [The data home](/reference/data-home/#outside-the-data-home).

## The hard part: Caddy and port 443

Serving `https://slides.localhost` means something must listen on `127.0.0.1:443`, which macOS allows only for root.
The obvious answer, a root Caddy, has a problem: Caddy's admin API is unauthenticated, so **any process on your
machine could reconfigure a root Caddy**, for instance to serve files only root can read. That would turn any
malicious install script into a privilege escalation.

So this is treated as **blocking for v1**. The options, in order of preference:

1. **No root Caddy at all.** Caddy runs as you on high loopback ports, and `hallway setup` installs a fixed `pf`
   redirect from 443 and 80. The only root component then has one job that can't be reconfigured. (To be verified
   on current macOS, including surviving OS updates.)
2. A root Caddy whose admin API is on a Unix socket only you can open. Better, but your own processes could still
   escalate.
3. A root Caddy with a fixed config and no admin API, reloaded by a privileged helper. Safe, but it needs sudo for
   every app change, which defeats the point.

Binding Caddy to `0.0.0.0:443` as your user would avoid root, but would expose every fronted app to everyone on your
network, so it is not an option by default.

The decision will be recorded in the project's decision log and on this page.
