# 07 — CLI reference

Binary: `hallway`. A short alias (`hw`) is proposed but not decided (Q-BINARY); this reference uses `hallway`
throughout. Exit codes: `0` success, `1` error, `2` usage error (usage printed). Every listing command supports
`--json` for agents and scripts (`status`, `scan`, `app ls`, `bookmark ls`, `doctor`, `service status`,
`service regenerate`; `run`, `claim`, `app add` and `bookmark add` take it too). Milestone in brackets; **built**
marks what exists (the rest is still to come). The code is `server/cli.ts` (parsing in `server/args.ts`) and
`server/commands/`; the services behind them are `server/services/` and `server/platform/`.

Commands that are richer with live data look for the daemon on `127.0.0.1:<config.yaml port>` (default 4255; not
`$PORT`, D44) and fall back to the files when it isn't running. Every write goes through the store.

## Daemon

| Command | Description |
|---------|-------------|
| `hallway` / `hallway serve [--port N] [--quiet]` | Run the daemon in the foreground (the default command, as Local Review does). [v0, **built**] |
| `hallway open` | Open the dashboard in the default browser (`open` / `xdg-open`; fronted URL if fronted, else direct). Exits 1 if nothing answers. [v0, **built**] |
| `hallway service install` | Generate and load the daemon's job: `~/Library/LaunchAgents/hallway.daemon.plist` on macOS, `~/.config/systemd/user/hallway-daemon.service` on Linux (D40); starts at login, restarted if it exits. Runs the installed CLI with the Node that runs it (`node …/dist/server/cli.js serve --quiet`), passes `$HALLWAY_HOME` on if it's set, waits for the port and prints the URL. Refuses if something else holds the port. Idempotent (re-running regenerates and restarts). On Linux it suggests `loginctl enable-linger` for running without a login session. [v0, **built**] |
| `hallway service uninstall` | Stop it and remove the definition. [v0, **built**] |
| `hallway service status [--json]` | Installed / loaded / running (pid) / last exit status / starts at login, whether the dashboard answers, and the recorded Node. Exits 0 either way. [v0, **built**] |
| `hallway service restart` | `launchctl kickstart -k` / `systemctl --user restart` (the definition is regenerated first if it changed). [v0, **built**] |
| `hallway --version`, `hallway --help` | [v0, **built**] |

## Status and discovery

| Command | Description |
|---------|-------------|
| `hallway status [slug] [--json]` | Table: state mark · slug · state · address · port · uptime 24 h · source. With a slug, also the detail, file, process and problems; `--json` gives `{ daemon, apps, observed }` (or the one app's view). Works without the daemon (reads files, probes each app once) but is richer with it. [v0, **built**] |
| `hallway scan [--json]` | Run the scanner now and print observed listeners with identity (port, id, name, directory, command). [v0, **built**] |
| `hallway claim <port\|observation-id> [--slug S] [--name N] [--expected E]` | Turn an observed listener into a declared app; the slug defaults to the scanner's suggestion. [v0, **built**] |
| `hallway ignore <port\|observation-id> [--by port\|process\|dir]` | Hide an observed listener (default `--by port`; a port number needs no scan). [v0, **built**] |

## Apps

| Command | Description |
|---------|-------------|
| `hallway app add <slug> [--port N] [--name N] [--expected E] [--health PATH]` | Declare an app (writes `apps/<slug>.yaml`). Without `--port`, one is assigned from `ports.assignRange`. Refuses an existing slug. [v0, **built**] |
| `hallway app ls [--json]` | List declared + discovered apps: slug, name, port, expected, source, service (`service` / `run` / `-`), URL. [v0, **built**] |
| `hallway app edit <slug>` | Open the YAML in `$VISUAL` / `$EDITOR` (default `vi`), then report any problems in it. [v0, **built**] |
| `hallway app rm <slug>` | Remove (moves the file to `backups/removed/`; first stops and removes its job if it has one). [v0, **built**] |

## Services and ad-hoc runs

| Command | Description |
|---------|-------------|
| `hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name N] [--json] -- <cmd...>` | Start a server under launchd / systemd, wait for it to listen (30 s), print its URL and log files, exit 0; or print why not and the last 30 log lines, exit 1. `$PORT` and `$HOST` in the command become the app's (quote them: `'$PORT'`, D42). Re-running with no command reuses the recorded one. See `04` and D45. [v1, **built**] |
| `hallway stop <slug>` / `hallway start <slug>` / `hallway restart <slug>` | Lifecycle of a managed app; `start` and `restart` wait for the port and print the URL. `stop` sets `expected: stopped` and keeps it stopped across logins; `start` sets `running` (or `adhoc` for a non-persistent `run`) (D41). [v1, **built**] |
| `hallway logs <slug> [--lines N] [--follow\|-f]` | The last N lines (default 50) of its `logs/<slug>.out.log` and `.err.log`, `tail`-style; `--follow` keeps printing, across rotations. `hallway logs daemon` shows the daemon's own (which is why an app called `daemon` can't be a managed service). [v1, **built**] |
| `hallway service add <slug> [-- <cmd...>]` | Make a declared app a managed service (RunAtLoad + KeepAlive). With a command, writes the `service:` block (cwd: the current directory); without, uses the one in the file. [v1, **built**] |
| `hallway service rm <slug>` | Stop managing it: the job is stopped and removed, and so is the `service:` block (the app stays declared). [v1, **built**] |
| `hallway service regenerate [slug] [--json]` | Rewrite the job definitions (apps' and the daemon's) from the YAML and the current Node and PATH, e.g. after a Node upgrade broke an absolute path; running jobs are restarted onto them. Exits 1 if any couldn't be. [v1, **built**] |

## Bookmarks

| Command | Description |
|---------|-------------|
| `hallway bookmark add <group> <url> [--title T] [--description D]` | Append a link (comments in the file are kept), creating the group file if needed. [v0, **built**] |
| `hallway bookmark ls [group] [--json]` | Groups and their links, numbered from 1. Always from the files. [v0, **built**] |
| `hallway bookmark rm <group> <url\|number>` | Remove a link by URL, or by its number in `bookmark ls` (from 1). Snapshots first (D34). [v0, **built**] |
| `hallway bookmark edit <group>` | Open the group YAML in `$EDITOR`, then report any problems. [v0, **built**] |

## Networking

| Command | Description |
|---------|-------------|
| `hallway setup [--domain BASE] [--print]` | Privileged setup for fronted mode; prints each command before running it with `sudo`. See `03`. [v1] |
| `hallway teardown [--uninstall-packages]` | Reverse `hallway setup`. [v1] |
| `hallway doctor [--json]` | Read-only diagnostics with suggested fixes (it never creates the data home). Built: the data home, every file's errors and warnings (including two apps on one port), the daemon answering (or what else holds its port), the daemon's service, lingering on Linux, every generated job's PATH (per-shell or missing entries) and program (a vanished Node), jobs without an app and apps without a job, apps exposed on the network (from the daemon). Networking checks say "not applicable in direct mode" until fronted mode exists. Exits 1 if any check fails. See `03`. [v0 for daemon/data checks, **built**; v1 for networking] |

## Agents

| Command | Description |
|---------|-------------|
| `hallway guide [--snippet]` | Print the agent guide, or just the snippet for agent instruction files. [v0, **built**] |
| `hallway mcp` | stdio MCP bridge to the daemon. [v2] |
| `hallway hook check-command` | Optional pre-tool-use hook helper; blocks bare dev-server starts. [v2] |

## Thumbnails

| Command | Description |
|---------|-------------|
| `hallway thumbs enable` / `disable` | Install/remove the optional headless browser and switch `thumbnails.mode`. [v2] |
| `hallway thumbs refresh [slug]` | Re-shoot now. [v2] |

## Environment variables

| Variable | Meaning |
|----------|---------|
| `HALLWAY_HOME` | Data home (default `~/.hallway`) |
| `PORT` | Daemon port for `hallway serve` (default 4255) |
| `HALLWAY_DEV` | Development mode (API next to Vite's dev server port, as Local Review does) |

## HTTP routes behind the service commands

`GET /api/apps/:slug/logs?lines=200` (both logs' tails) and `POST /api/apps/:slug/service/start|stop|restart` (the
same lifecycle as the CLI, for the dashboard). They are behind the same security middleware as every write; MCP has no
equivalent (D10).

