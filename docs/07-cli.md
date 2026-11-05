# 07 — CLI reference

Binary: `hallway`. A short alias (`hw`) is proposed but not decided (Q-BINARY); this reference uses `hallway`
throughout. Exit codes: `0` success, `1` error, `2` usage error (usage printed); the daemon's `service` commands add
`3` not running and `4` not installed (D74, the CLI contract's codes). Every listing command supports
`--json` for agents and scripts (`status`, `scan`, `lost`, `app ls`, `bookmark ls`, `doctor`, `service status`,
`service regenerate`; `run`, `claim`, `lost restart|service`, `app add`, `bookmark add` and the daemon's
`service install|uninstall|start|stop|restart` take it too). Every command takes `--data-dir <dir>`, the data home for
that run (over `$HALLWAY_HOME`, which it sets for what the command starts). The milestone
each belongs to is in brackets; as of 0.3.0 every command listed here is **built**, and `hallway --help` prints the
same list. The code is `server/cli.ts` (parsing in `server/args.ts`) and
`server/commands/`; the services behind them are `server/services/` and `server/platform/`.

Commands that are richer with live data look for the daemon on `127.0.0.1:<config.yaml port>` (default 4255; not
`$PORT`, D44) and fall back to the files when it isn't running. Every write goes through the store.

## Daemon

| Command | Description |
|---------|-------------|
| `hallway` / `hallway serve [--port N] [--quiet]` | Run the daemon in the foreground (the default command, as Local Review does). Stdout's first line is always `Hallway <version>: <url>` (the CLI contract's, D75), then `Data home: …`; when stderr is a terminal, a HALLWAY banner and the version go there just before (`server/banner.ts`, Local Review's approach: half-block art, colour by Node's rules, `NO_COLOR` respected, a one-line title on a narrow terminal); in fronted mode `Dashboard: https://hallway.localhost`; in direct mode where setup can work, a three-line hint that local domains are off and `hallway setup` turns them on; from npx's cache, how to keep it running. Not a terminal: the same lines without art or colour. `--quiet` (the service jobs): only `Hallway <version>: <url>`. If a Hallway daemon already answers on the port, it prints `Hallway is already running at <url>` and exits 0 (D63). SIGTERM, Ctrl-C (and Ctrl-Break on Windows) or the IPC message `stop` stop it cleanly: no new requests, the app operations and local-domains setup under way finish (up to 10 s; anything still running then is named in the log), `runtime.json` removed, exit 0; a second signal stops it at once with exit 1 (D77). [v0, **built**] |
| `hallway open` | Open the dashboard in the default browser (`open` / `xdg-open`; fronted URL if fronted, else direct). Exits 1 if nothing answers. [v0, **built**] |
| `hallway service install [--port N] [--json]` | Generate and load the daemon's job: `~/Library/LaunchAgents/hallway.daemon.plist` on macOS, `~/.config/systemd/user/hallway-daemon.service` on Linux (D40); starts at login, restarted if it exits. Runs the installed CLI with the Node that runs it (`node …/dist/server/cli.js serve --quiet`), passes `$HALLWAY_HOME` on if it's set, waits for the port and prints the URL. Refuses if something else holds the port, and if Hallway is running from npx's cache (or pnpm dlx's, bunx's: D61), which would break the service whenever the cache is pruned; `npx hallway` is for trying it in the foreground, `npm i -g hallway && hallway service install` for keeping it. Idempotent (re-running regenerates and restarts). After an upgrade (`npm i -g hallway@latest`) the job file is often unchanged, so a running daemon that answers as another version than the CLI is restarted anyway, and install waits until it answers as the new one and says so (`Restarted the daemon: 0.5.2 → 0.7.0.`); running forwarders another version started are restarted too (D69). On Linux it suggests `loginctl enable-linger` for running without a login session. [v0, **built**] |
| `hallway service install --refresh` | Rewrite the installed job in this version's format, from what it records (its data home; the port is config.yaml's), and restart it; exit 4 if it isn't installed. What `update` hands over through, run by the new version's CLI. `--port N` (on either) writes `port:` to config.yaml. A reinstall over a running daemon always restarts it, so it never leaves the old process serving (the CLI contract's §1; amends D70). [D76, **built**] |
| `hallway service uninstall [--json]` | Stop it and remove the definition; the data home and logs stay. [v0, **built**] |
| `hallway service start [--json]` | Start the installed job (the definition regenerated first if it changed), wait until the daemon answers as this version (30 s), else print its last 20 log lines and exit 1. Exit 4 if it isn't installed. [D74, **built**] |
| `hallway service stop [--force] [--json]` | Refused with exit 75 while the daemon is busy (`hallway busy`), unless `--force`, which prints `Overriding: …` and goes ahead (D75). Stop it until `service start` or the next login or boot: `systemctl --user stop` / `launchctl bootout` / the Windows supervisor's tree and `schtasks /End`, **without** disabling it (unlike an app's `hallway stop`, D41). `service uninstall` keeps it off. Waits until nothing answers. Exit 4 if it isn't installed. [D74, **built**] |
| `hallway service status [--json]` | Installed / loaded / running (pid) / last exit status / starts at login, whether the dashboard answers and as which version, the version the job runs, the recorded Node, the log files, and warnings (the job's Node or CLI gone, another version answering). Exits 0 when it runs and answers, 3 when it's installed but not running or not answering, 4 when it isn't installed (D74). [v0, **built**] |
| `hallway service restart [--force] [--json]` | Refused with exit 75 while the daemon is busy, as `stop` is (D75). `launchctl kickstart -k` / `systemctl --user restart` (the definition is regenerated first if it changed). Exit 4 if it isn't installed. [v0, **built**] |
| `hallway service logs [-n N] [-f]` | The daemon's logs, as `hallway logs daemon` shows them (the last 50 lines; `-f` keeps printing). Exit 4 if it isn't installed. [D74, **built**] |
| `hallway busy [--json]` | Ask the running daemon (found through `<home>/runtime.json`) whether it's busy: a local-domains setup the dashboard started, or app starts, stops and restarts it's running. Exits 0 if not, 75 if it is (`Hallway is busy: 1 local-domains setup is running.`), 3 if nothing answers. `--json`: `{ running, busy, url, version, counts }`. [D75, **built**] |
| `hallway update [--check] [--to V] [--yes] [--force] [--json]` | The CLI contract's §5, with `upgrade` a hidden alias: how it was installed (a checkout, npx's cache, `$HALLWAY_UPDATE_HINT`: exit 5 with what to run instead), the registry, can it write there (else exit 5 with the `sudo` command), the busy check (75 unless `--force`), the question (`--yes` without a terminal, else exit 2), both versions fetched, then the daemon's job stopped (on Windows, every running app's supervisor too: they run Hallway's code), the install, the new version's `service install --refresh` and its jobs rewritten (apps whose job changed restarted, the paused ones started again), and the daemon answering as the new version within 30 s, else a rollback (exit 6; 7 if that fails too). It says up front what happens to the apps. `--check` reports and changes nothing (exit 0 either way; scripts read `updateAvailable`), `--to` names a version or a dist-tag (the only way down). Writes `<home>/update-check.json`, which `service status` repeats. Without a service it installs and says to restart the `hallway serve`. [D76, **built**] |
| `hallway --version`, `hallway --help` | [v0, **built**] |

## Status and discovery

| Command | Description |
|---------|-------------|
| `hallway status [slug] [--json]` | Table: state mark · slug · state · address · port · uptime 24 h · source. With a slug, also the detail, file, process and problems; `--json` gives `{ daemon, apps, observed }` (or the one app's view). Works without the daemon (reads files, probes each app once) but is richer with it. [v0, **built**] |
| `hallway scan [--json]` | Run the scanner now and print observed listeners with identity (port, id, name, directory, command). [v0, **built**] |
| `hallway claim <port\|observation-id> [--slug S] [--name N] [--expected E]` | Turn an observed listener into a declared app; the slug defaults to the scanner's suggestion. [v0, **built**] |
| `hallway ignore <port\|observation-id> [--by port\|process\|dir]` | Hide an observed listener (default `--by port`; a port number needs no scan). [v0, **built**] |
| `hallway lost [--json]` | What was running before the last reboot and isn't now (D54): id, port, what, where (`dir @ branch`), command, and (with the daemon) whether it's back. Without the daemon it reads `state/lost.json`. [v1, **built**] |
| `hallway lost restart\|service <id\|port> [--slug S] [--json]` | Start one again through the daemon, as `hallway run` would: once, or as a service (at login, restarted if it exits). `--slug` names a new app. Needs the daemon (it holds what was recorded). [v1, **built**] |
| `hallway lost dismiss <id\|port>` / `hallway lost dismiss --all` | Clear one item, or the whole notice. Ids may be shortened to a unique prefix of four or more characters. [v1, **built**] |

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
| `hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name N] [--json] -- <cmd...>` | Start a server under launchd / systemd, wait for it to listen (30 s; on 127.0.0.1 or ::1, whichever it binds, D68), print its URL, the address it answered on and its log files, exit 0; or print why not and the last 30 log lines, exit 1. `$PORT` and `$HOST` in the command become the app's (quote them: `'$PORT'`, D42). Re-running with no command reuses the recorded one. On Windows, where every job runs `hallway supervise`, it refuses (as do `service add` and `lost service`) when Hallway runs from npx's cache (D61). See `04` and D45. [v1, **built**] |
| `hallway stop <slug>` / `hallway start <slug>` / `hallway restart <slug>` | Lifecycle of a managed app; `start` and `restart` wait for the port and print the URL. `stop` sets `expected: stopped` and keeps it stopped across logins; `start` sets `running` (or `adhoc` for a non-persistent `run`) (D41). [v1, **built**] |
| `hallway logs <slug> [--lines\|-n N] [--follow\|-f]` | The last N lines (default 50) of its `logs/<slug>.out.log` and `.err.log`, `tail`-style; `--follow` keeps printing, across rotations. `hallway logs daemon` shows the daemon's own (as `hallway service logs` does) (which is why an app called `daemon` can't be a managed service). [v1, **built**] |
| `hallway service add <slug> [-- <cmd...>]` | Make a declared app a managed service (RunAtLoad + KeepAlive). With a command, writes the `service:` block (cwd: the current directory); without, uses the one in the file. [v1, **built**] |
| `hallway service rm <slug>` | Stop managing it: the job is stopped and removed, and so is the `service:` block (the app stays declared). [v1, **built**] |
| `hallway service regenerate [slug] [--json]` | Rewrite the job definitions (apps' and the daemon's) from the YAML and the current Node and PATH, e.g. after a Node upgrade broke an absolute path; running jobs are restarted onto them, and so are a daemon or forwarder still running another version of Hallway (D69). Exits 1 if any couldn't be. [v1, **built**] |

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
| `hallway setup [--trust user\|system\|none] [--domain BASE] [--print] [--yes]` | Fronted mode, in one of three tiers (D65): `user` (User certificate) trusts Hallway's CA for your account only, `system` (System-wide certificate) for every account, `none` (No HTTPS) is plain HTTP; on a terminal with no `--trust` it asks, always recommending User certificate (D70; `--domain` means `system`). Runs Caddy as you (a user-level job), has 443/80 handed to it (macOS: launchd's sockets and forwarders, every tier; Linux: an nftables redirect, System-wide only, else links carry Caddy's port), trusts its CA as the tier says and switches `config.yaml` to `mode: fronted` with `proxy.trust`; re-running with another `--trust` switches tier and removes what the old one added; with `--domain`, also Hallway's dnsmasq and the resolver for that domain. Prints every step first, the privileged ones exactly as run through `sudo`; idempotent (skips what's in place). Before running anything it prints the plan, says what will ask for what (sudo's password; on macOS also the system's trust-settings dialog), and asks `Continue? [y/N]` (default no; no answer exits 1); `--yes` skips the question, and with no terminal and no `--yes` it's a usage error (exit 2), D67. `--print` prints the plan and runs nothing. Refuses `.local`, HSTS-preloaded TLDs, and anything holding 80/443 (named). Exits 1 if it refuses or a step fails. See `03`, D47, D48. [v1, **built**] |
| `hallway teardown [--uninstall-packages] [--print] [--yes]` | Reverse `hallway setup`: removes only what it finds (whatever the tier, and an older install's pf redirect) and sets `mode: direct`. Asks first, like setup (`--yes`). `--uninstall-packages` also uninstalls Homebrew's `caddy` and `dnsmasq`. [v1, **built**] |
| `hallway doctor [--json] [--offline]` | Read-only diagnostics with suggested fixes (it never creates the data home). The CLI contract's checks (D76): this Node against `engines`, how Hallway was installed, whether the daemon's job runs this install and the version that's answering, the port, linger, the data home, and whether a newer Hallway is out (it asks the registry, and writes the cache `service status` repeats; `--offline` skips it). `--json` matches the contract's `doctor.schema.json`: an info line is a pass with `"info": true`. Built: the data home, every file's errors and warnings (including two apps on one port), the daemon answering (or what else holds its port), the daemon being a different version from the CLI (D69), the daemon's service, lingering on Linux, every generated job's PATH (per-shell or missing entries) and program (a vanished Node, or Hallway run from npx's cache: D61), a forwarder still running another version's code (D69), jobs without an app and apps without a job, apps exposed on the network (from the daemon). In fronted mode, also the networking checks in `03` (Caddy, its socket and config, who holds 80/443, the redirect, the trusted root, name resolution, dnsmasq). Exits 1 if any check fails. See `03`. [v0 for daemon/data checks, v1 for networking; **built**] |

## Agents

| Command | Description |
|---------|-------------|
| `hallway guide [--snippet]` | Print the agent guide, or just the snippet for agent instruction files. [v0, **built**] |
| `hallway mcp` | stdio MCP server: a bridge to the running daemon's `/mcp`, so the daemon stays the one writer; exits 1 with instructions if there's no daemon (D51). [v2, **built**] |
| `hallway hook check-command` | Optional pre-tool-use hook (Claude Code's `PreToolUse` on `Bash`): reads the payload on stdin, denies a bare dev-server start with the equivalent `hallway run`, lets everything else through (D51). [v2, **built**] |

## Thumbnails

| Command | Description |
|---------|-------------|
| `hallway thumbs enable` | Install playwright-core and Chromium's headless shell into `cache/browser/` in the data home (about 300 MB; nothing outside the data home), then set `thumbnails.mode: screenshot`. Idempotent (D56). [v2, **built**] |
| `hallway thumbs disable` | Set `thumbnails.mode` back to `favicon` and delete the browser and the screenshots. [v2, **built**] |
| `hallway thumbs refresh [slug]` | Re-shoot now (one app, or every healthy one) through the running daemon: `POST /api/thumbs/refresh` with `{"slug"?}`, answering `{"taken": n}`, 409 when screenshots are off. [v2, **built**] |
| `hallway thumbs status` | The mode, whether a browser is installed (and its size), and how many screenshots there are. [v2, **built**] |

## Environment variables

| Variable | Meaning |
|----------|---------|
| `HALLWAY_HOME` | Data home (default `~/.hallway`) |
| `PORT` | Daemon port for `hallway serve` (default 4255) |
| `HALLWAY_UPDATE_HINT` | Set by whatever manages this install (Ansible, …): `hallway update` prints it and exits 5 rather than installing (D76) |
| `npm_config_registry` | The registry `update`, `update --check` and `doctor` ask (else `npm config get registry`) |
| `HALLWAY_DEV` | Development mode (API next to Vite's dev server port, as Local Review does) |

## HTTP routes behind the service commands

`GET /api/apps/:slug/logs?lines=200` (both logs' tails) and `POST /api/apps/:slug/service/start|stop|restart` (the
same lifecycle as the CLI, for the dashboard), and "Lost at last reboot"'s `POST /api/lost/:id/restart|service|dismiss`
and `POST /api/lost/dismiss` (D54). They are behind the same security middleware as every write; MCP has no
equivalent (D10).

