---
title: Services and reboots
description: Keeping apps alive with native launchd jobs or systemd user units, the PATH trap, log rotation, and "lost at last reboot".
---

Hallway keeps the apps you care about running with the OS's own service manager: **launchd jobs** on macOS, the
mechanism macOS uses for its own background services, and **systemd user units** on Linux. There is no PM2 and no
second process manager.

## Hallway itself

<span class="ms ms--v0">v0</span> Hallway runs itself the same way, as a user LaunchAgent on macOS or a systemd user
unit on Linux:

```sh
hallway service install      # loaded now and at every login
hallway service status
hallway service restart
hallway service uninstall
```

On macOS the job is `~/Library/LaunchAgents/hallway.daemon.plist`; on Linux it is
`~/.config/systemd/user/hallway-daemon.service`. Both start at **login**, not at boot, which is the right behaviour
for a laptop. On Linux, enabling lingering once (`loginctl enable-linger $USER`) keeps Hallway's units running
without a login session and starts them at boot; Hallway never enables it itself, and `hallway doctor` warns while it
is off.

## Managed services

<span class="ms ms--v0">v0</span> An app with a `service:` block is a **managed service**: Hallway generates a job for it,
`~/Library/LaunchAgents/hallway.app.<slug>.plist` on macOS or `~/.config/systemd/user/hallway-app-<slug>.service` on
Linux, and keeps it alive.

```yaml
# apps/slides.yaml
name: Slides
port: 4321
expected: running
service:
  command: ["npx", "astro", "dev", "--port", "4321"]
  cwd: ~/Code/slides
```

```sh
hallway service add slides     # generate and load the job: starts at login, restarted if it exits
hallway stop slides            # stop and disable it, so it stays stopped across logins; expected → stopped
hallway start slides
hallway restart slides
hallway logs slides --follow
hallway service rm slides      # stop managing it; the app stays declared
```

Every Hallway job has a `hallway.` label (`hallway.daemon`, `hallway.app.<slug>`, and in v1 `hallway.caddy`); on Linux
the units are named the same way with hyphens (`hallway-daemon.service`, `hallway-app-<slug>.service`). So they are
easy to find, audit and remove, and can't be confused with jobs you made yourself.

Starting a server for the first time is usually done with [`hallway run`](/agents/hallway-run/), which declares the
app and creates its job in one step.

### Ports and environment

Each managed service gets `PORT` set to its port and `HOST=127.0.0.1` (plus `HOSTNAME`, for frameworks that read
that). `$PORT` and `$HOST` in the command's arguments are replaced with the app's values when the job is generated.
Frameworks that ignore `PORT` need a flag:

| Framework | Flags |
| --- | --- |
| Vite | `--port $PORT --strictPort` |
| Astro | `--port $PORT` |
| Next.js | `-p $PORT` |

In a YAML `command:` list, `$PORT` needs no quoting; on the `hallway run` command line, quote it (`'$PORT'`) so your
shell doesn't expand it first.

`--strictPort` matters for Vite: without it, Vite quietly picks another port when its port is busy, and the app
"moves" away from the address everything else expects.

### The PATH trap

launchd jobs and systemd units inherit no shell environment, so a job's `PATH` has to be written into it. Copying your current shell's
`PATH` is a latent bug: some Node version managers put **per-shell directories** on it. fnm, for example, adds a
`fnm_multishells/<pid>_<timestamp>/bin` symlink created for one terminal session. Copy that into a job and the
service's only route to `node`, `npm` and `npx` is a leftover from a shell that closed long ago. Clean it up and every
`#!/usr/bin/env node` tool the service runs breaks, while the service itself keeps running.

So Hallway's job generator:

- resolves the command and the Node binary to **absolute, real paths** in the version manager's stable install
  directory, never a shim;
- puts **that Node's own `bin` directory first** on `PATH`, so `node`, `npm` and `npx` always resolve, to the same
  Node that runs the service;
- builds the rest of `PATH` from stable directories only, dropping per-shell entries and anything that doesn't exist;
- records the Node version, so `hallway doctor` can warn when it has been uninstalled, and
  `hallway service regenerate` can fix it.

### Logs

Each service writes to `~/.hallway/logs/<slug>.out.log` and `.err.log`. Neither launchd nor systemd rotates those
files, and because they keep them open, renaming doesn't work either, so the daemon copies and truncates them in place once they
pass a size limit (10 MB by default), keeping three generations.

## Lost at last reboot

<span class="ms">v1</span> Upcoming. When Hallway starts, it compares the machine's boot time with the last one it saw. If the machine has rebooted, every
app or listener that was alive before the reboot and is not listening now goes into a notice at the top of the
dashboard: **the doors that closed while you were away**.

```text
⚠ Lost at last reboot (Mon 28 Sep 20:05): 6 apps        [Review]  [Dismiss]
```

Each entry says what it was, where it ran from and the command that started it, with three actions: **restart it
once**, **make it a service**, or **dismiss**.

This only works because Hallway [records what it observes](/concepts/apps/#observed-listeners-the-scanner) while the
processes are alive. Once a process is gone, its working directory can't be recovered by any means, so a tool that
starts looking after the reboot is already too late.
