---
title: CLI
description: "Every hallway command and its flags, as `hallway --help` lists them, with the milestone each belongs to."
---

The binary is `hallway`. (A short alias, `hw`, has been proposed but not decided.) Every listing command takes
`--json` for agents and scripts. `hallway --help` prints the same list, grouped the same way.

**Exit codes:** `0` success, `1` error, `2` usage error (the usage is printed). The daemon's `service` commands add
`3`, not running, and `4`, not installed: the codes `systemctl status` uses, shared by the author's other local tools.
`hallway update` adds `5`, this install can't update itself (it prints what to run instead), `6`, the update failed
and was rolled back, and `7`, the rollback failed too; `75` means Hallway is busy.

Every command takes **`--data-dir <dir>`**, the [data home](/reference/data-home/) for that run (`$HALLWAY_HOME` does
the same; default `~/.hallway`).

Each command is marked with the milestone it belongs to. Everything on this page is in the current release.

## The daemon

| Command | Description | |
| --- | --- | --- |
| `hallway` / `hallway serve [--port N] [--quiet]` | Run the daemon in the foreground (the default command): the dashboard and API on `http://localhost:<port>`, 127.0.0.1 only. The port is `--port`, else `$PORT`, else `port:` in `config.yaml`, else 4255. Its first line is always `Hallway <version>: <url>`, then the data home. On a terminal a banner comes first (on stderr), and it says whether local domains are on (and how to turn them on) and, from `npx`, how to keep it running; `--quiet` (`-q`) prints just the first line. If Hallway is already running on the port, it says where and exits 0. | <span class="ms ms--v0">v0</span> |
| `hallway open` | Open the dashboard in your browser (`https://hallway.localhost`, or your domain's, in fronted mode). | <span class="ms ms--v0">v0</span> |
| `hallway service install [--port <n>] [--dry-run] [--from-checkout] [--json]` | Generate and load the daemon's service, so it runs at every login: `~/Library/LaunchAgents/hallway.daemon.plist` on macOS, `~/.config/systemd/user/hallway-daemon.service` on Linux, the scheduled task `\hallway.daemon` on Windows (best effort; starts at logon). Idempotent: run over a running daemon, it restarts it. `--port` sets `port:` in `config.yaml`. `--dry-run` prints the unit and writes nothing. It refuses to install from npx's cache, from a git checkout unless you add `--from-checkout`, and when something else holds the port. | <span class="ms ms--v0">v0</span> |
| `hallway service install --refresh` | Rewrite the installed service in this version's format, keeping its data home, and restart it. Exits 4 if it isn't installed. `hallway update` runs it with the new version. | <span class="ms ms--shipped">v2</span> |
| `hallway service start [--json]` | Start the installed service and wait until the dashboard answers; if it doesn't, print the last 20 lines of its logs. | <span class="ms ms--shipped">v2</span> |
| `hallway service stop [--force] [--json]` | Stop it until `hallway service start`, or your next login or boot, whichever comes first. It isn't disabled: use `hallway service uninstall` to keep it off. While Hallway is busy (see `hallway busy`) it refuses and exits 75; `--force` stops it anyway. | <span class="ms ms--shipped">v2</span> |
| `hallway service restart [--force] [--json]` | Restart the daemon's service (its definition rewritten first if it changed). Refuses while Hallway is busy, as `stop` does. | <span class="ms ms--v0">v0</span> |
| `hallway service status [--json]` | Whether the daemon's service is installed and running, whether the dashboard answers and as which version, the version installed, its log files, and anything wrong. Exits 0 when it runs and answers, 3 when it's installed but not running, 4 when it isn't installed. | <span class="ms ms--v0">v0</span> |
| `hallway service logs [-n N] [-f]` | The daemon's logs: the last 50 lines, or `N`; `-f` keeps printing. The same as `hallway logs daemon`. | <span class="ms ms--shipped">v2</span> |
| `hallway service uninstall [--json]` | Stop it and remove it. The data home and the logs stay. | <span class="ms ms--v0">v0</span> |
| `hallway busy [--json]` | Whether the running daemon is busy: setting up local domains from the dashboard, or starting, stopping or restarting an app. Exits 0 if not, 75 if it is, 3 if it isn't running. For scripts that restart Hallway. | <span class="ms ms--shipped">v2</span> |
| `hallway update [--check] [--to <version\|tag>] [--yes] [--force] [--json]` | Install the newest Hallway with the package manager it came from, restart the daemon on it, and roll back if it doesn't answer. `--check` only says what's available. Exits 5 when this install can't update itself (it prints what to run), 6 when it rolled back, 7 when the rollback failed too, 75 when Hallway is busy. See [Updating](/getting-started/installation/#updating). | <span class="ms ms--shipped">v2</span> |
| `hallway --version`, `hallway --help` | | <span class="ms ms--v0">v0</span> |

## Apps and discovery

| Command | Description | |
| --- | --- | --- |
| `hallway status [slug] [--json]` | Every app's state, address, port and 24-hour uptime. Works without the daemon (it reads the files and probes once), but is richer with it. | <span class="ms ms--v0">v0</span> |
| `hallway scan [--json]` | Look for listeners nobody has named, and print them with identity. | <span class="ms ms--v0">v0</span> |
| `hallway claim <port\|id> [--slug S] [--name N] [--expected E]` | Turn an observed listener into a declared app. | <span class="ms ms--v0">v0</span> |
| `hallway ignore <port\|id> [--by port\|process\|dir]` | Hide an observed listener. | <span class="ms ms--v0">v0</span> |
| `hallway lost [--json]` | What was running before the last reboot and isn't now. See [Lost at last reboot](/concepts/services/#lost-at-last-reboot). | <span class="ms ms--shipped">v1</span> |
| `hallway lost restart\|service <id\|port> [--slug S]` | Start one again: once, or as a service, the way `hallway run` would. Needs the daemon. | <span class="ms ms--shipped">v1</span> |
| `hallway lost dismiss <id\|port>` / `hallway lost dismiss --all` | Clear one, or the whole notice. | <span class="ms ms--shipped">v1</span> |
| `hallway app add <slug> [--port N] [--name N] [--expected E] [--health PATH]` | Declare an app (writes `apps/<slug>.yaml`); without `--port` it gets a free port from the assignment range. | <span class="ms ms--v0">v0</span> |
| `hallway app ls [--json]` | List the declared apps. | <span class="ms ms--v0">v0</span> |
| `hallway app edit <slug>` | Open the app's YAML in `$VISUAL` or `$EDITOR`. | <span class="ms ms--v0">v0</span> |
| `hallway app rm <slug>` | Remove an app: its file moves to `backups/removed/`, and its service is removed first if it has one. | <span class="ms ms--v0">v0</span> |

## Running servers

| Command | Description | |
| --- | --- | --- |
| `hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name N] -- <command...>` | Start a server as a user service (launchd, systemd, or a scheduled task on Windows) on a stable port, wait for it to listen, print its URL and exit. `$PORT` in the command (quote it: `'$PORT'`) becomes the app's port. See [hallway run](/agents/hallway-run/). | <span class="ms ms--shipped">v1</span> |
| `hallway stop <slug>` / `start <slug>` / `restart <slug>` | Stop, start or restart a managed app. An app's stop lasts until its start, across logins too. | <span class="ms ms--shipped">v1</span> |
| `hallway logs <slug> [-n N] [-f]` | Tail a managed app's logs (`--lines`, `--follow`). | <span class="ms ms--shipped">v1</span> |
| `hallway service add <slug> [-- <command...>]` | Keep a declared app running: at login, and restarted if it exits. | <span class="ms ms--shipped">v1</span> |
| `hallway service rm <slug>` | Stop managing it; the app stays declared. | <span class="ms ms--shipped">v1</span> |
| `hallway service regenerate [slug]` | Rewrite the generated services, e.g. after a Node upgrade broke an absolute path. | <span class="ms ms--shipped">v1</span> |

## Bookmarks

| Command | Description | |
| --- | --- | --- |
| `hallway bookmark add <group> <url> [--title T] [--description D]` | Add a link to a group (creating the group if needed). | <span class="ms ms--v0">v0</span> |
| `hallway bookmark ls [group] [--json]` | List groups and links. | <span class="ms ms--v0">v0</span> |
| `hallway bookmark rm <group> <url\|number>` | Remove a link, by its URL or its position in the list. | <span class="ms ms--v0">v0</span> |
| `hallway bookmark edit <group>` | Open the group's YAML in `$VISUAL` or `$EDITOR`. | <span class="ms ms--v0">v0</span> |

## Fronted mode

| Command | Description | |
| --- | --- | --- |
| `hallway setup [--trust user\|system\|none] [--domain BASE] [--port N] [--print] [--yes]` | Run Caddy for your apps, so they are at `https://<app>.localhost` (or under `BASE`). On a terminal it asks which [tier](/networking/fronted-mode/#three-tiers): `user` (User certificate) trusts its certificate for your account only, `system` (System-wide certificate) for every account, with sudo (needed for `--domain`, which implies it), `none` (No HTTPS) is plain HTTP and asks for nothing. Without a terminal, or with `--yes`, it keeps the current tier or takes the recommended one. Shows the plan and asks `Continue? [y/N]` before it runs anything; any privileged step runs through `sudo`. `--print` shows the plan and runs nothing; `--yes` doesn't ask (needed with no terminal). Run it again with another `--trust` to switch tier. `--port 4443` puts links on Caddy's own port when something else holds 443 (`--port 443` moves them back; see [Port 443 is already in use](/networking/setup-and-doctor/#port-443-is-already-in-use)). macOS and Linux only: on Windows it refuses and changes nothing; on macOS it needs an installed `hallway`, not npx. See [Setup](/networking/setup-and-doctor/). | <span class="ms ms--shipped">v1</span> |
| `hallway teardown [--uninstall-packages] [--print] [--yes]` | Undo setup and go back to `http://localhost:<port>` links. Asks first, like setup. `--uninstall-packages` also uninstalls Homebrew's Caddy and dnsmasq. | <span class="ms ms--shipped">v1</span> |

## Coding agents

| Command | Description | |
| --- | --- | --- |
| `hallway guide [--snippet]` | Print the agent guide (`AGENT-GUIDE.md`), or just the paragraph for an agent instruction file (`CLAUDE.md`, `AGENTS.md`). | <span class="ms ms--v0">v0</span> |
| `hallway mcp` | An MCP server on stdio: a bridge that forwards every message to the running daemon's `/mcp`, found on `config.yaml`'s port. Exits 1 with a message if the daemon isn't running. See [MCP server](/agents/mcp/). | <span class="ms ms--shipped">v2</span> |
| `hallway hook check-command` | A pre-tool-use hook (Claude Code's `PreToolUse` on Bash): reads the payload on stdin and denies a bare dev-server start, suggesting the `hallway run` for it. See [The dev-server hook](/agents/hook/). | <span class="ms ms--shipped">v2</span> |

## Thumbnails

| Command | Description | |
| --- | --- | --- |
| `hallway thumbs enable` | Screenshots of your apps on their doors: installs a browser (Chromium's headless shell, about 300 MB) into the data home, never anywhere else, and sets `thumbnails.mode: screenshot`. Healthy apps get a picture within a minute. | <span class="ms ms--shipped">v2</span> |
| `hallway thumbs disable` | Turn them off: sets `thumbnails.mode: favicon` and deletes the browser and the screenshots. | <span class="ms ms--shipped">v2</span> |
| `hallway thumbs refresh [slug]` | Take new screenshots now, of one app or every healthy one. Needs the daemon, which does the shooting. | <span class="ms ms--shipped">v2</span> |
| `hallway thumbs status` | The mode, whether a browser is installed and how big it is, and how many screenshots there are. | <span class="ms ms--shipped">v2</span> |

See [Thumbnails](/concepts/thumbnails/).

## Other

| Command | Description | |
| --- | --- | --- |
| `hallway doctor [--json] [--offline]` | Check this install (Node, how Hallway was installed, whether a newer version is out: `--offline` skips that), the daemon, the data home, the services and fronted mode, with suggested fixes. Read-only. See [doctor](/networking/setup-and-doctor/#hallway-doctor). | <span class="ms ms--v0">v0</span>; fronted-mode checks <span class="ms ms--shipped">v1</span> |

Environment variables are on [their own page](/reference/environment/).
