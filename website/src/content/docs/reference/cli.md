---
title: CLI
description: "Every hallway command and its flags, as `hallway --help` lists them, with the milestone each belongs to."
---

The binary is `hallway`. (A short alias, `hw`, has been proposed but not decided.) Every listing command takes
`--json` for agents and scripts. `hallway --help` prints the same list, grouped the same way.

**Exit codes:** `0` success, `1` error, `2` usage error (the usage is printed).

Each command is marked with the milestone it belongs to. Everything on this page is in the current release.

## The daemon

| Command | Description | |
| --- | --- | --- |
| `hallway` / `hallway serve [--port N] [--quiet]` | Run the daemon in the foreground (the default command): the dashboard and API on `http://localhost:<port>`, 127.0.0.1 only. The port is `--port`, else `$PORT`, else `port:` in `config.yaml`, else 4255. On a terminal it starts with a banner, and says whether local domains are on (and how to turn them on) and, from `npx`, how to keep it running; `--quiet` (`-q`) prints just the "Hallway on <url>" line. If Hallway is already running on the port, it says where and exits 0. | <span class="ms ms--v0">v0</span> |
| `hallway open` | Open the dashboard in your browser (`https://hallway.localhost`, or your domain's, in fronted mode). | <span class="ms ms--v0">v0</span> |
| `hallway service install` | Generate and load the daemon's service, so it runs at every login: `~/Library/LaunchAgents/hallway.daemon.plist` on macOS, `~/.config/systemd/user/hallway-daemon.service` on Linux, the scheduled task `\hallway.daemon` on Windows (best effort; starts at logon). Idempotent. | <span class="ms ms--v0">v0</span> |
| `hallway service uninstall` | Unload and remove it. | <span class="ms ms--v0">v0</span> |
| `hallway service status [--json]` | Whether the daemon's job is loaded and running, and its last exit code. | <span class="ms ms--v0">v0</span> |
| `hallway service restart` | Restart the daemon's service. | <span class="ms ms--v0">v0</span> |
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
| `hallway stop <slug>` / `start <slug>` / `restart <slug>` | Stop, start or restart a managed app. | <span class="ms ms--shipped">v1</span> |
| `hallway logs <slug> [--lines N] [--follow]` | Tail a managed app's logs. | <span class="ms ms--shipped">v1</span> |
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
| `hallway setup [--domain BASE] [--print]` | Run Caddy for your apps, redirect ports 443 and 80 to it and trust its certificates, so apps are at `https://<app>.localhost` (or under `BASE`). Prints each step first; the privileged ones run through `sudo`. `--print` shows the plan and runs nothing. macOS and Linux only: on Windows it refuses and changes nothing. See [Setup](/networking/setup-and-doctor/). | <span class="ms ms--shipped">v1</span> |
| `hallway teardown [--uninstall-packages] [--print]` | Undo setup and go back to `http://localhost:<port>` links. `--uninstall-packages` also uninstalls Homebrew's Caddy and dnsmasq. | <span class="ms ms--shipped">v1</span> |

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
| `hallway doctor [--json]` | Check the daemon, the data home, the services and fronted mode, with suggested fixes. Read-only. See [doctor](/networking/setup-and-doctor/#hallway-doctor). | <span class="ms ms--v0">v0</span>; fronted-mode checks <span class="ms ms--shipped">v1</span> |

Environment variables are on [their own page](/reference/environment/).
