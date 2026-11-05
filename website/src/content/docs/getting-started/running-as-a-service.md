---
title: Running as a service
description: Installing Hallway's daemon as a LaunchAgent, a systemd user service or a Windows scheduled task, the commands that manage it, the busy check, its logs and its exit codes.
---

`hallway service install` sets Hallway up to start when you log in and to restart if it stops: a LaunchAgent on
macOS, a systemd user service on Linux, and, best effort, a per-user scheduled task on Windows. Your apps' own
services are a separate thing, managed with `hallway service add` and `hallway stop` (see
[Services and reboots](/concepts/services/)); this page is about Hallway itself.

## Installing

```sh
hallway service install      # see the options below
```

| Option | |
| --- | --- |
| `--port <n>` | The dashboard's port. It's written to `port:` in `config.yaml`, where the daemon and the CLI both read it. Default `4255`. |
| `--dry-run` | Print the unit and write nothing. |
| `--from-checkout` | Install from a git checkout of Hallway on purpose (see below). |
| `--refresh` | Rewrite the installed unit in this version's format, keeping its data home. `hallway update` runs it. Exits 4 if nothing is installed. |
| `--json` | One JSON document on stdout; what people read goes to stderr. |
| `--data-dir <dir>` | The data home the service uses (default `$HALLWAY_HOME`, else `~/.hallway`). |

- **It waits until Hallway answers** before it returns, and prints the dashboard's URL.
- **Running it again is safe:** it keeps the port and settings the service already has (the port in `config.yaml`,
  the data home recorded in the unit), unless you give new ones, and restarts the running service onto them.
- **`--dry-run` prints the unit and writes nothing**: not the unit, not `config.yaml`, not even the data home.
- It refuses to install **from an npx cache** (the folder is temporary, so the service would break when npm prunes
  it), **from a git checkout unless you add `--from-checkout`** (the service would run whatever the checkout last
  built), and **when something else holds the port**.
- Linux only: **linger.** Without it, the service stops when you log out, and starts only when you log in.
  `hallway service install` and `hallway doctor` check, and print `sudo loginctl enable-linger <user>`; Hallway never
  runs `sudo` itself.

## Where things are

| | The unit | The logs |
| --- | --- | --- |
| macOS | `~/Library/LaunchAgents/hallway.daemon.plist` | `~/.hallway/logs/daemon.out.log` and `daemon.err.log` |
| Linux | `~/.config/systemd/user/hallway-daemon.service` | the same |
| Windows | the scheduled task `\hallway.daemon`, and its files in `%LOCALAPPDATA%\hallway\tasks\` | the same, under `%USERPROFILE%\.hallway\logs\` |

The unit runs this Node and this install's `cli.js` by their real paths, never the `hallway` shim, so **if you
remove that Node version (nvm, fnm, volta), `service status` and `doctor` warn, and `service install` again fixes
it.** On Windows the scheduled task runs `hallway supervise`, which starts the daemon, restarts it 10 seconds after it
exits and writes its logs: Task Scheduler does none of that itself. It runs while you're logged on, and needs no
administrator rights.

## The commands

| Command | |
| --- | --- |
| `hallway service install` | Write the unit, start it, wait until it answers. |
| `hallway service uninstall` | **Stops it and removes the unit. Your data and logs stay.** |
| `hallway service start` | Start the installed service, and wait until it answers (30 seconds; if it doesn't, it prints the last 20 lines of the log). |
| `hallway service stop [--force]` | **Stops it until `service start`, or the next login or boot. It doesn't disable the service. To keep it off for good, use `service uninstall`.** |
| `hallway service restart [--force]` | Stop and start it, rewriting the unit first if it's stale. |
| `hallway service status [--json]` | Installed? Running? Which version is installed, which is answering, on which port and pid; the unit and log files, and any warnings. |
| `hallway service logs [-f] [-n <lines>]` | **The last 50 lines; `-f` follows, `-n` sets how many.** |

`install`, `uninstall`, `start`, `stop`, `restart` and `status` take `--json` for scripts; `logs` prints the log
itself. Stopping an *app* is different: `hallway stop <slug>` keeps it stopped across logins too.

When Hallway is stopped, it stops cleanly: it takes no new requests, lets an app start, stop or restart, or a
local-domains setup, that's under way finish (for up to 10 seconds; anything still running then is named in the log),
and exits.

## Busy

**`service stop` and `service restart` first ask the running Hallway whether it's busy**: setting up local domains
from the dashboard, or starting, stopping or restarting an app for you. **If it is, they refuse with exit 75 and say
what's running. Wait and try again, or add `--force`, which prints the same message prefixed `Overriding:` and goes
ahead.** `uninstall` doesn't ask. `hallway busy` asks the same question on its own (0 not busy, 75 busy, 3 nothing
running):

```sh
$ hallway service stop
hallway: Hallway is busy: 1 app start, stop or restart is running. Try `hallway service stop` again once it has finished, or add --force.
$ hallway busy; echo $?
Hallway is busy: 1 app start, stop or restart is running.
75
```

A `hallway start <slug>` or `hallway setup` you run in a terminal isn't counted: it runs in its own process, which
restarting the daemon doesn't touch.

## Logs

The service writes two files, which it appends to: `~/.hallway/logs/daemon.out.log` (stdout) and
`~/.hallway/logs/daemon.err.log` (stderr). (The CLI contract Hallway follows names a single `service.log`; Hallway
kept the two files it already had, which `hallway logs daemon` and `doctor` read too.) `hallway service logs` shows
both. **Hallway rotates them itself** (by copying and truncating, at 10 MB, keeping 3: `services.logMaxBytes` and
`services.logGenerations` in [`config.yaml`](/reference/config-yaml/)), because the service manager holds them open.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Running and answering; or done. |
| `1` | It failed (the message says why). |
| `2` | A usage error, with the usage printed. |
| `3` | **Installed but not running, or not answering.** |
| `4` | **Not installed.** |
| `75` | **Busy:** `stop` or `restart` refused. |

To move to a new version of Hallway, see [Updating](/getting-started/updating/).
