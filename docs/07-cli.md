# 07 — CLI reference

Binary: `sj` (also installed as `spaghetti-junction`). Exit codes: `0` success, `1` error, `2` usage error (usage
printed). Every listing command supports `--json` for agents and scripts. Milestone in brackets.

## Daemon

| Command | Description |
|---------|-------------|
| `sj` / `sj serve [--port N] [--quiet]` | Run the daemon in the foreground (the default command, as Local Review does). [v0] |
| `sj open` | Open the dashboard in the default browser (fronted URL if fronted, else direct). [v0] |
| `sj service install` | Generate and load `~/Library/LaunchAgents/spaghetti-junction.daemon.plist` (RunAtLoad, KeepAlive). Idempotent. [v0] |
| `sj service uninstall` | Unload and remove it. [v0] |
| `sj service status` | Is the daemon job loaded / running / last exit code. [v0] |
| `sj service restart` | `launchctl kickstart -k`. [v0] |
| `sj --version`, `sj --help` | [v0] |

## Status and discovery

| Command | Description |
|---------|-------------|
| `sj status [slug] [--json]` | Table: slug · state · address · port · uptime 24 h · source. Works without the daemon (reads files, probes once) but is richer with it. [v0] |
| `sj scan [--json]` | Run the scanner now and print observed listeners with identity. [v0] |
| `sj claim <port\|observation-id> [--slug S] [--name N] [--expected E]` | Turn an observed listener into a declared app. [v0] |
| `sj ignore <port\|observation-id> [--by port\|process\|dir]` | Hide an observed listener. [v0] |

## Apps

| Command | Description |
|---------|-------------|
| `sj app add <slug> --port N [--name N] [--expected E] [--health PATH]` | Declare an app (writes `apps/<slug>.yaml`). [v0] |
| `sj app ls [--json]` | List declared + discovered apps. [v0] |
| `sj app edit <slug>` | Open the YAML in `$EDITOR`. [v0] |
| `sj app rm <slug>` | Remove (moves the file to `backups/`; also removes its service if managed). [v0] |

## Services and ad-hoc runs

| Command | Description |
|---------|-------------|
| `sj run <slug> [--cwd DIR] [--port N] [--persist] [--name N] -- <cmd...>` | Start a server under launchd, wait for it to listen, print URL, exit. See `04`. [v1] |
| `sj stop <slug>` / `sj start <slug>` / `sj restart <slug>` | Lifecycle of a managed app. [v1] |
| `sj logs <slug> [--lines N] [--follow]` | Tail a managed app's logs. [v1] |
| `sj service add <slug> [-- <cmd...>]` | Make a declared app a managed service (RunAtLoad + KeepAlive). [v1] |
| `sj service rm <slug>` | Stop managing it (keeps the app declared). [v1] |
| `sj service regenerate [slug]` | Rewrite plists (e.g. after a Node upgrade broke an absolute path). [v1] |

## Bookmarks

| Command | Description |
|---------|-------------|
| `sj bookmark add <group> <url> [--title T] [--description D]` | [v0] |
| `sj bookmark ls [--json]` | [v0] |
| `sj bookmark rm <group> <url\|index>` | [v0] |
| `sj bookmark edit <group>` | Open the group YAML in `$EDITOR`. [v0] |

## Networking

| Command | Description |
|---------|-------------|
| `sj setup [--domain BASE] [--print]` | Privileged setup for fronted mode; prints each command before running it with `sudo`. See `03`. [v1] |
| `sj teardown [--uninstall-packages]` | Reverse `sj setup`. [v1] |
| `sj doctor [--json]` | Read-only diagnostics with suggested fixes. See `03`. [v0 for daemon/data checks, v1 for networking] |

## Agents

| Command | Description |
|---------|-------------|
| `sj guide [--snippet]` | Print the agent guide, or just the snippet for agent instruction files. [v0] |
| `sj mcp` | stdio MCP bridge to the daemon. [v2] |
| `sj hook check-command` | Optional pre-tool-use hook helper; blocks bare dev-server starts. [v2] |

## Thumbnails

| Command | Description |
|---------|-------------|
| `sj thumbs enable` / `disable` | Install/remove the optional headless browser and switch `thumbnails.mode`. [v2] |
| `sj thumbs refresh [slug]` | Re-shoot now. [v2] |

## Environment variables

| Variable | Meaning |
|----------|---------|
| `SPAGHETTI_JUNCTION_HOME` | Data home (default `~/.spaghetti-junction`) |
| `PORT` | Daemon port for `sj serve` (default 7724, proposed) |
| `SPAGHETTI_JUNCTION_DEV` | Development mode (API next to Vite's dev server port, as Local Review does) |
