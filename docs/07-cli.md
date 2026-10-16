# 07 — CLI reference

Binary: `hallway`. A short alias (`hw`) is proposed but not decided (Q-BINARY); this reference uses `hallway`
throughout. Exit codes: `0` success, `1` error, `2` usage error (usage printed). Every listing command supports
`--json` for agents and scripts. Milestone in brackets.

## Daemon

| Command | Description |
|---------|-------------|
| `hallway` / `hallway serve [--port N] [--quiet]` | Run the daemon in the foreground (the default command, as Local Review does). [v0] |
| `hallway open` | Open the dashboard in the default browser (fronted URL if fronted, else direct). [v0] |
| `hallway service install` | Generate and load `~/Library/LaunchAgents/hallway.daemon.plist` (RunAtLoad, KeepAlive). Idempotent. [v0] |
| `hallway service uninstall` | Unload and remove it. [v0] |
| `hallway service status` | Is the daemon job loaded / running / last exit code. [v0] |
| `hallway service restart` | `launchctl kickstart -k`. [v0] |
| `hallway --version`, `hallway --help` | [v0] |

## Status and discovery

| Command | Description |
|---------|-------------|
| `hallway status [slug] [--json]` | Table: slug · state · address · port · uptime 24 h · source. Works without the daemon (reads files, probes once) but is richer with it. [v0] |
| `hallway scan [--json]` | Run the scanner now and print observed listeners with identity. [v0] |
| `hallway claim <port\|observation-id> [--slug S] [--name N] [--expected E]` | Turn an observed listener into a declared app. [v0] |
| `hallway ignore <port\|observation-id> [--by port\|process\|dir]` | Hide an observed listener. [v0] |

## Apps

| Command | Description |
|---------|-------------|
| `hallway app add <slug> --port N [--name N] [--expected E] [--health PATH]` | Declare an app (writes `apps/<slug>.yaml`). [v0] |
| `hallway app ls [--json]` | List declared + discovered apps. [v0] |
| `hallway app edit <slug>` | Open the YAML in `$EDITOR`. [v0] |
| `hallway app rm <slug>` | Remove (moves the file to `backups/`; also removes its service if managed). [v0] |

## Services and ad-hoc runs

| Command | Description |
|---------|-------------|
| `hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name N] -- <cmd...>` | Start a server under launchd, wait for it to listen, print URL, exit. See `04`. [v1] |
| `hallway stop <slug>` / `hallway start <slug>` / `hallway restart <slug>` | Lifecycle of a managed app. [v1] |
| `hallway logs <slug> [--lines N] [--follow]` | Tail a managed app's logs. [v1] |
| `hallway service add <slug> [-- <cmd...>]` | Make a declared app a managed service (RunAtLoad + KeepAlive). [v1] |
| `hallway service rm <slug>` | Stop managing it (keeps the app declared). [v1] |
| `hallway service regenerate [slug]` | Rewrite plists (e.g. after a Node upgrade broke an absolute path). [v1] |

## Bookmarks

| Command | Description |
|---------|-------------|
| `hallway bookmark add <group> <url> [--title T] [--description D]` | [v0] |
| `hallway bookmark ls [--json]` | [v0] |
| `hallway bookmark rm <group> <url\|index>` | [v0] |
| `hallway bookmark edit <group>` | Open the group YAML in `$EDITOR`. [v0] |

## Networking

| Command | Description |
|---------|-------------|
| `hallway setup [--domain BASE] [--print]` | Privileged setup for fronted mode; prints each command before running it with `sudo`. See `03`. [v1] |
| `hallway teardown [--uninstall-packages]` | Reverse `hallway setup`. [v1] |
| `hallway doctor [--json]` | Read-only diagnostics with suggested fixes. See `03`. [v0 for daemon/data checks, v1 for networking] |

## Agents

| Command | Description |
|---------|-------------|
| `hallway guide [--snippet]` | Print the agent guide, or just the snippet for agent instruction files. [v0] |
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
