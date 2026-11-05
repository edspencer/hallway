---
title: Installation
description: Installing Hallway from npm on macOS, Linux or Windows, and what it needs.
---


## Install

<span class="ms ms--v0">v0</span> Two commands:

```sh
npm i -g hallway             # Node 22.13 or later
hallway service install      # run the daemon at every login
```

Then open `http://localhost:4255`, or run `hallway open`.

### Just trying it?

```sh
npx hallway                  # the dashboard, in the foreground
```

That runs Hallway from npx's cache until you close the terminal. It's the quick way to try it, not to keep it:
npm can delete that cache at any time, so `hallway service install` refuses to run from it (and `hallway doctor`
flags a service that already does). To keep it, install it with the two commands above; the startup banner says so
too. If the service is already running, `npx hallway` just tells you where and exits.

The banner also says whether **local domains** are on. They're off until you run
[`hallway setup`](/networking/setup-and-doctor/), so `https://hallway.localhost` isn't there yet (a browser says the
connection was refused): use `http://localhost:4255`, or turn them on (with no admin rights, if you like). The dashboard explains them in a panel you can
dismiss.

`hallway service install` registers the daemon with your OS's own service manager and starts it, so the dashboard is
always there without you starting anything:

- **macOS:** a LaunchAgent, `~/Library/LaunchAgents/hallway.daemon.plist`, loaded now and at every login.
- **Linux:** a systemd user unit, `~/.config/systemd/user/hallway-daemon.service`, enabled and started. A user unit
  runs while you are logged in; to keep it running without a login session (and from boot), enable lingering once
  with `loginctl enable-linger $USER`. Hallway never does that for you, and `hallway doctor` warns while it is off.
- **Windows** (best effort): a scheduled task, `\hallway.daemon`, that starts when you log on and runs
  `hallway supervise`, which keeps the daemon running and writes its logs. Its files are in
  `%LOCALAPPDATA%\hallway\tasks\`. It runs while you're logged on. No administrator rights are needed, and none
  are asked for. This has run for real on GitHub's Windows runners, but a real logon starting it hasn't been tried on
  a Windows desktop yet.

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

## Updating

<span class="ms ms--shipped">v2</span> One command:

```sh
hallway update
```

It asks the npm registry for the newest Hallway and shows what would change
(`Update Hallway 0.12.0 → 0.13.0? The service will restart.`, with a link to the release notes), then:

1. checks that Hallway isn't busy (setting up local domains, or starting or stopping an app), as
   [`hallway busy`](/reference/cli/#the-daemon) does;
2. fetches the new version (and the one you have, for a rollback) while the old one is still serving;
3. stops the daemon's service, installs the new version with the package manager you installed it with, and has the
   new version rewrite and start its service;
4. waits until the dashboard answers as the new version. If it doesn't within 30 seconds, it prints the last lines of
   the daemon's log, puts the old version back and starts it again (exit 6). If even that fails, it exits 7 and prints
   the commands to run by hand.

**What it does to your apps.** It says so before it asks. On macOS and Linux, your managed apps keep running: the new
version rewrites their jobs, and an app whose job comes out different is restarted onto it. On Windows, each app's
scheduled task runs through Hallway's own code, which Windows can't replace while it's running, so the update stops
your running apps while it installs and starts them again afterwards.

Without a terminal (a script, an agent's shell), `hallway update` needs `--yes`. The other options:

| | |
| --- | --- |
| `--check` | Say whether there's a newer version, and change nothing. It exits 0 either way; with `--json`, read `updateAvailable`. |
| `--to <version\|tag>` | Install that version or dist-tag (`--to next`). It's the only way to go to a lower version. |
| `--force` | Don't wait while Hallway is busy. The health check and the rollback still run. |
| `--json` | One JSON document on stdout; the progress goes to stderr. |

**When it can't update itself**, it says what to run instead and exits 5. That happens when Hallway runs from npx's
cache (`npx hallway@latest` already runs the newest), from a checkout (`git pull && npm install && npm run build`), as
a dependency of some project, or from a global folder you can't write to (it prints the `sudo npm install -g …` line,
and never runs sudo itself). An install managed by something else, such as Ansible, can set `HALLWAY_UPDATE_HINT`, and
`hallway update` prints that instead.

Nothing in Hallway asks the registry by itself: only `hallway update`, `hallway update --check` and `hallway doctor`
do, when you run them. `hallway service status` repeats what the last of them found, and `hallway doctor --offline`
doesn't ask.

If you'd rather do it by hand:

```sh
npm i -g hallway@latest && hallway service install
```

`hallway service install` restarts the daemon onto the version you just installed, and restarts the forwarders
`hallway setup` installed on macOS if they're still running the old code. `hallway doctor` flags a daemon that's a
different version from its service.

## Requirements

| | |
| --- | --- |
| **OS** | macOS (launchd) or Linux (systemd user units). Windows is best effort (per-user scheduled tasks): everything but fronted mode works; see [the roadmap](/roadmap/#windows) for what hasn't been checked on a real Windows desktop. |
| **Node** | 22.13 or later (for the built-in `node:sqlite` that holds uptime history). |
| **Privileges** | None. The daemon never runs as root, and nothing asks for sudo except `hallway setup` and `hallway teardown`, and only for fronted mode's System-wide certificate tier (or to leave it). |
| **For fronted mode** <span class="ms ms--shipped">v1</span> | Optional, and macOS and Linux only. [Caddy](https://caddyserver.com) 2.7 or later (on macOS `hallway setup` installs it with Homebrew; on Linux, put a release binary from caddyserver.com on your `PATH`), and Hallway installed with `npm i -g` (on macOS setup won't run from npx). Then it depends on the [tier](/networking/fronted-mode/#three-tiers): User certificate needs your own password or Touch ID once on macOS, and `certutil` on Linux; System-wide certificate needs one guided sudo step, and on Linux systemd, `nft` and a system CA store; No HTTPS needs nothing more. See [Setup](/networking/setup-and-doctor/). |
| **For custom domains** <span class="ms ms--shipped">v1</span> | Optional, System-wide certificate tier only. dnsmasq (Homebrew's on macOS, which setup installs; on Linux the `dnsmasq-base` package or similar) and, on Linux, `systemd-resolved`. |
| **For screenshots** <span class="ms ms--shipped">v2</span> | Optional. About 300 MB of disk: `hallway thumbs enable` downloads a headless browser into the data home. See [Thumbnails](/concepts/thumbnails/). |

## Why port 4255?

The default dashboard port is **4255**, which spells **HALL** on a phone keypad, the same trick as Local Review's
5622 (LOCA). It stays clear of common dev-server defaults (Angular 4200, Astro 4321, Jekyll and Phoenix 4000), of
macOS's AirPlay Receiver on 5000 and 7000, and of the range Hallway assigns to new apps (5100–5999). Override it with
`port:` in `config.yaml`, or for one run with `--port <n>` or `$PORT`.

## Where things go

Everything Hallway knows lives in one directory, the **data home**: `~/.hallway`, or wherever `$HALLWAY_HOME` points.
See [The data home](/reference/data-home/). Nothing is written outside it except the service definitions (launchd plists,
systemd user units, or on Windows scheduled tasks and their files in `%LOCALAPPDATA%\hallway\tasks\`) for the daemon and any services you ask for, and, only during `hallway setup`, the jobs, trust and files listed in
[Setup, teardown and doctor](/networking/setup-and-doctor/#what-it-changes-outside-the-data-home).
