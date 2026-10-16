---
title: Installation
description: Installing Hallway from npm on macOS or Linux, and what it needs.
---


## Install

<span class="ms ms--v0">v0</span> Two commands:

```sh
npm i -g hallway             # Node 22.13 or later
hallway service install      # run the daemon at every login
```

Then open `http://localhost:4255`, or run `hallway open`.

`hallway service install` registers the daemon with your OS's own service manager and starts it, so the dashboard is
always there without you starting anything:

- **macOS:** a LaunchAgent, `~/Library/LaunchAgents/hallway.daemon.plist`, loaded now and at every login.
- **Linux:** a systemd user unit, `~/.config/systemd/user/hallway-daemon.service`, enabled and started. A user unit
  runs while you are logged in; to keep it running without a login session (and from boot), enable lingering once
  with `loginctl enable-linger $USER`. Hallway never does that for you, and `hallway doctor` warns while it is off.
- **Windows** (best effort): a scheduled task, `\hallway.daemon`, that starts when you log on and runs
  `hallway supervise`, which keeps the daemon running and writes its logs. Its files are in
  `%LOCALAPPDATA%\hallway\tasks\`. It runs while you're logged on. No administrator rights are needed, and none
  are asked for.

It is idempotent: run it again any time. Undo it with `hallway service uninstall`; `hallway service status` says
whether it is running.

Finally, tell your coding agents about it. This prints a short paragraph to paste into an agent instruction file such
as `CLAUDE.md` or `AGENTS.md`:

```sh
hallway guide --snippet
```

Optional extras, each on its own page: memorable HTTPS names such as `https://my-app.localhost` with
[`hallway setup`](/networking/setup-and-doctor/), the [MCP server](/agents/mcp/) and the
[dev-server hook](/agents/hook/) for coding agents, and [screenshot thumbnails](/concepts/thumbnails/).

To try Hallway without installing it as a service, run the daemon in the foreground instead:

```sh
hallway              # same as `hallway serve`; Ctrl-C to stop
hallway open         # open the dashboard in your browser
```

## Requirements

| | |
| --- | --- |
| **OS** | macOS (launchd) or Linux (systemd user units). Windows is best effort (per-user scheduled tasks): everything but fronted mode works. |
| **Node** | 22.13 or later (for the built-in `node:sqlite` that holds uptime history). |
| **Privileges** | None. The daemon never runs as root, and nothing asks for sudo except `hallway setup` and `hallway teardown`. |
| **For fronted mode** <span class="ms ms--shipped">v1</span> | Optional. [Caddy](https://caddyserver.com) 2.7 or later (on macOS `hallway setup` installs it with Homebrew; on Linux, put a release binary from caddyserver.com on your `PATH`), and one guided sudo step. On Linux also systemd, `nft` and a system CA store. See [Setup](/networking/setup-and-doctor/). |
| **For custom domains** <span class="ms ms--shipped">v1</span> | Optional. dnsmasq (Homebrew's on macOS, which setup installs; on Linux the `dnsmasq-base` package or similar) and, on Linux, `systemd-resolved`. |
| **For screenshots** <span class="ms ms--shipped">v2</span> | Optional. About 300 MB of disk: `hallway thumbs enable` downloads a headless browser into the data home. See [Thumbnails](/concepts/thumbnails/). |

## Why port 4255?

The default dashboard port is **4255**, which spells **HALL** on a phone keypad, the same trick as Local Review's
5622 (LOCA). It stays clear of common dev-server defaults (Angular 4200, Astro 4321, Jekyll and Phoenix 4000), of
macOS's AirPlay Receiver on 5000 and 7000, and of the range Hallway assigns to new apps (5100–5999). Override it with
`port:` in `config.yaml`, or for one run with `--port <n>` or `$PORT`.

## Where things go

Everything Hallway knows lives in one directory, the **data home**: `~/.hallway`, or wherever `$HALLWAY_HOME` points.
See [The data home](/reference/data-home/). Nothing is written outside it except the service definitions (launchd plists
or systemd user units) for the daemon and any services you ask for, and, only during `hallway setup`, the files listed in
[Setup, teardown and doctor](/networking/setup-and-doctor/#what-it-changes-outside-the-data-home).
