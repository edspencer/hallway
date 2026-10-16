---
title: CLI
description: Every planned hallway command, its flags and the milestone it ships in.
---

The binary is `hallway`. (A short alias, `hw`, has been proposed but not decided.) Every listing command takes
`--json` for agents and scripts.

**Exit codes:** `0` success, `1` error, `2` usage error (the usage is printed).

Each command is marked with the milestone it is planned for: <span class="ms ms--v0">v0</span>,
<span class="ms">v1</span> or <span class="ms">v2</span>.

## The daemon

| Command | Description | |
| --- | --- | --- |
| `hallway` / `hallway serve [--port N] [--quiet]` | Run the daemon in the foreground (the default command). | <span class="ms ms--v0">v0</span> |
| `hallway open` | Open the dashboard in your browser (the fronted URL in fronted mode). | <span class="ms ms--v0">v0</span> |
| `hallway service install` | Generate and load `~/Library/LaunchAgents/hallway.daemon.plist`, so the daemon runs at every login. Idempotent. | <span class="ms ms--v0">v0</span> |
| `hallway service uninstall` | Unload and remove it. | <span class="ms ms--v0">v0</span> |
| `hallway service status` | Whether the daemon's job is loaded and running, and its last exit code. | <span class="ms ms--v0">v0</span> |
| `hallway service restart` | Restart the daemon (`launchctl kickstart -k`). | <span class="ms ms--v0">v0</span> |
| `hallway --version`, `hallway --help` | | <span class="ms ms--v0">v0</span> |

## Status and discovery

| Command | Description | |
| --- | --- | --- |
| `hallway status [slug] [--json]` | A table of slug, state, address, port, 24-hour uptime and source. Works without the daemon (it reads the files and probes once), but is richer with it. | <span class="ms ms--v0">v0</span> |
| `hallway scan [--json]` | Run the scanner now and print the observed listeners, with identity. | <span class="ms ms--v0">v0</span> |
| `hallway claim <port\|observation-id> [--slug S] [--name N] [--expected E]` | Turn an observed listener into a declared app. | <span class="ms ms--v0">v0</span> |
| `hallway ignore <port\|observation-id> [--by port\|process\|dir]` | Hide an observed listener. | <span class="ms ms--v0">v0</span> |

## Apps

| Command | Description | |
| --- | --- | --- |
| `hallway app add <slug> --port N [--name N] [--expected E] [--health PATH]` | Declare an app (writes `apps/<slug>.yaml`). | <span class="ms ms--v0">v0</span> |
| `hallway app ls [--json]` | List declared and discovered apps. | <span class="ms ms--v0">v0</span> |
| `hallway app edit <slug>` | Open the app's YAML in `$EDITOR`. | <span class="ms ms--v0">v0</span> |
| `hallway app rm <slug>` | Remove an app: its file moves to `backups/`, and its service is removed if it has one. | <span class="ms ms--v0">v0</span> |

## Services and ad-hoc runs

| Command | Description | |
| --- | --- | --- |
| `hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name N] -- <cmd...>` | Start a server under launchd, wait for it to listen, print its URL and exit. See [hallway run](/agents/hallway-run/). | <span class="ms">v1</span> |
| `hallway stop <slug>` / `start <slug>` / `restart <slug>` | Stop, start or restart a managed app. | <span class="ms">v1</span> |
| `hallway logs <slug> [--lines N] [--follow]` | Tail a managed app's logs. | <span class="ms">v1</span> |
| `hallway service add <slug> [-- <cmd...>]` | Make a declared app a managed service (starts at login, restarted if it dies). | <span class="ms">v1</span> |
| `hallway service rm <slug>` | Stop managing it; the app stays declared. | <span class="ms">v1</span> |
| `hallway service regenerate [slug]` | Rewrite the launchd jobs, e.g. after a Node upgrade broke an absolute path. | <span class="ms">v1</span> |

## Bookmarks

| Command | Description | |
| --- | --- | --- |
| `hallway bookmark add <group> <url> [--title T] [--description D]` | Add a link to a group (creating the group if needed). | <span class="ms ms--v0">v0</span> |
| `hallway bookmark ls [--json]` | List groups and links. | <span class="ms ms--v0">v0</span> |
| `hallway bookmark rm <group> <url\|index>` | Remove a link. | <span class="ms ms--v0">v0</span> |
| `hallway bookmark edit <group>` | Open the group's YAML in `$EDITOR`. | <span class="ms ms--v0">v0</span> |

## Networking

| Command | Description | |
| --- | --- | --- |
| `hallway setup [--domain BASE] [--print]` | The one privileged step, for fronted mode. Prints each command before running it with `sudo`. See [Setup](/networking/setup-and-doctor/). | <span class="ms">v1</span> |
| `hallway teardown [--uninstall-packages]` | Reverse `hallway setup`. | <span class="ms">v1</span> |
| `hallway doctor [--json]` | Read-only diagnostics with suggested fixes. | <span class="ms ms--v0">v0</span> daemon and data checks; <span class="ms">v1</span> networking |

## Agents

| Command | Description | |
| --- | --- | --- |
| `hallway guide [--snippet]` | Print the agent guide, or just the snippet for agent instruction files. | <span class="ms ms--v0">v0</span> |
| `hallway mcp` | The stdio MCP bridge to the daemon. | <span class="ms">v2</span> |
| `hallway hook check-command` | Optional pre-tool-use hook: blocks bare dev-server starts. | <span class="ms">v2</span> |

## Thumbnails

| Command | Description | |
| --- | --- | --- |
| `hallway thumbs enable` / `disable` | Install or remove the optional headless browser for screenshot thumbnails, and switch `thumbnails.mode`. | <span class="ms">v2</span> |
| `hallway thumbs refresh [slug]` | Take new screenshots now. | <span class="ms">v2</span> |

Environment variables are on [their own page](/reference/environment/).
