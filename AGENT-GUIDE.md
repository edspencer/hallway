# Hallway: a guide for coding agents

<!-- live facts -->

## What Hallway is

Hallway is a small, always-on, local-only service that keeps a live directory of every web server running on this
machine, with health checks, on a dashboard at http://localhost:4255. Its configuration is plain YAML in a **data
home** (`~/.hallway` by default, or `$HALLWAY_HOME`) that you can read and edit directly: the dashboard picks up every
change within a second, exactly as if it had been made through the API.

## What this version does

On macOS and Linux: the dashboard, the YAML files, health checks with uptime history, the port scanner, bookmarks,
this guide, `hallway run` for managed servers, an MCP server (below) and an optional hook that stops agents starting
dev servers directly. In **direct mode** (the default) every app's address is `http://localhost:<port>`. In
**fronted mode**, which the user turns on with `hallway setup`, each app also gets `https://<slug>.localhost` (or
`<slug>.<base>` on their own domain). The live facts above (when this guide comes from a running daemon) say which
mode is on, and each app's `url` in `/api/state` is the address to give the user. Don't run `hallway setup` or `hallway teardown` yourself: they need sudo, so they're the
user's to run. Both show their plan and ask `Continue? [y/N]` in the terminal before they change anything; never pass
`--yes` for the user (it exists for scripts and CI).

On Windows (best effort) all of that works except fronted mode: `hallway run` makes a per-user scheduled task.

## The rule: don't leave servers running in your session

A dev or preview server started inside your session (`npm run dev`, `vite`, `astro dev`, `next dev`,
`python -m http.server`, …) is hard for the user to find once the session ends, and it dies silently on the next
reboot. So:

- Start long-running servers with **`hallway run <slug> -- <command>`**. The server is then owned by the operating
  system's service manager (launchd on macOS, systemd on Linux, Task Scheduler on Windows) rather than your session; it gets a stable port and a
  URL, which the command prints before exiting (exit 0; exit 1, with the last log lines, if it didn't come up within
  30 s). Pass the port through, **quoted** so your shell leaves it for Hallway to fill in:
  `hallway run my-app -- npx vite --port '$PORT' --strictPort` (without `--strictPort`, Vite silently moves to
  another port when its own is busy), `astro dev --port '$PORT'`, `next dev -p '$PORT'`,
  `python3 -m http.server '$PORT'`. `PORT` and `HOST=127.0.0.1` are in its environment too.
- It's not kept across reboots unless you add `--persist` (which makes it a real service: started at login,
  restarted if it exits). Leave that choice to the user.
- Then: `hallway logs <slug>` (`--follow` to keep watching), `hallway restart <slug>`, `hallway stop <slug>`.
  `hallway run <slug>` again, with no command, starts it again the same way.
- **If `hallway run` isn't available** (an old version; check `hallway --help`), start the server however you
  normally would, then **register it** (next section) so the user can find it on the dashboard. Use
  `expected: adhoc` for a server that won't always be running.

## Registering a server

Write one YAML file per app, `apps/<slug>.yaml` in the data home. The slug is the file name: lower-case letters,
digits and hyphens (`my-app`, not `My App`). The smallest useful file is two lines:

```yaml
name: My App
port: 5173
```

A fuller one:

```yaml
name: My App
description: The dashboard for the thing
port: 5173
expected: adhoc          # running (should always be up) | stopped (off on purpose) | adhoc (up sometimes)
health:
  path: /api/health      # optional: what to probe instead of GET /
links:
  - { label: API docs, path: /docs }
project:
  dir: ~/Code/my-app
tags: [tools]
```

- `port` is the port the server **already** listens on. Never pick a new port for an existing app, and never change
  the `port` of an app someone else declared.
- Use `expected: adhoc` for anything you start for a task and may not keep running, so it shows as *stopped*, calmly,
  when it's off, rather than *down*.
- Check your file landed: `curl -s http://localhost:4255/api/apps/<slug>`. If it has a mistake, the response's
  `problems` lists it with the line number, and the dashboard shows the error on the app's card. Hallway never
  rewrites a file it can't read; fix it and save again.
- Or do the same over HTTP: `curl -s -X PUT http://localhost:4255/api/apps/my-app -H 'Content-Type: application/json' -d '{"name":"My App","port":5173,"expected":"adhoc"}'`.

## Bookmarks

Links to anything (usually remote things the user can never remember the URL of) live in groups, one file per group:
`bookmarks/<group>.yaml`.

```yaml
title: Production
order: 10                # groups sort by order, then title
links:
  - title: Admin console
    url: https://admin.example.com
    description: Production admin
  - title: Status page
    url: https://status.example.com
```

To add a link, append to `links:` in the right file (keep the user's comments and order) or create a new group file.
Bookmarks are inert: Hallway never fetches anything from them except, perhaps, a favicon.

## Checking status

- `curl -s http://localhost:4255/api/state` returns everything the dashboard shows: each app's configuration, health
  (`healthy`, `unhealthy`, `down`, `stopped`, `unknown`), the listeners Hallway found that nobody has named yet
  (`observed`), bookmarks, and every problem in the data home's files.
- `curl -s http://localhost:4255/api/apps/<slug>` for one app.
- `hallway status --json` (or `hallway status <slug> --json`): the same, from the command line; it works without
  the daemon too, probing each app once.
- **After a reboot**, `lost` in `/api/state` (and `hallway lost`, or MCP's `get_status`) lists what was running
  before it and isn't now: each one's port, directory and branch, and the command that started it. If the user asks
  you to bring one back, `hallway lost restart <id>` starts it once the way `hallway run` would (`hallway lost service
  <id>` keeps it across reboots: ask first); `hallway lost dismiss <id>` clears it from the notice.

## The HTTP API

All JSON, on 127.0.0.1 only. Writes need `Content-Type: application/json`.

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/state` | Everything, in one call |
| GET | `/api/apps`, `/api/apps/<slug>` | Apps with their health; one app with its last 24 h |
| PUT | `/api/apps/<slug>` | Create or replace an app (the body is the file's contents as JSON) |
| PATCH | `/api/apps/<slug>` | Change some fields (a JSON merge patch: `null` removes a key) |
| DELETE | `/api/apps/<slug>` | Remove an app (the file moves to `backups/removed/`) |
| GET | `/api/apps/<slug>/history?window=24h` | Uptime and latency (`24h`, `7d`, `90d`) |
| GET, PUT, PATCH, DELETE | `/api/bookmarks/<group>` | The same, for a bookmark group (`GET /api/bookmarks` lists them all) |
| GET | `/api/observed` | Listeners nobody has named yet |
| GET | `/api/lost` | What was lost at the last reboot (`null` if nothing) |
| POST | `/api/lost/<id>/restart`, `/api/lost/<id>/service` | `{}` or `{"slug": "..."}`: start it again once, or as a service |
| POST | `/api/lost/<id>/dismiss`, `/api/lost/dismiss` | Clear one, or the whole notice |
| GET | `/api/fronting` | Local domains (`https://<app>.localhost`): on or off, and in fronted mode `hallway doctor`'s networking checks. Turning them on is `hallway setup`, for the user to run |
| POST | `/api/observed/<id>/claim` | `{"slug": "...", "name": "...", "expected": "adhoc"}`: turn one into an app |
| POST | `/api/observed/<id>/ignore` | `{"by": "port" \| "process" \| "dir"}`: hide it (adds to `ignore.yaml`) |
| GET | `/api/config` | The settings in force |
| GET | `/api/events` | Server-sent events: what changed, as it changes |

Every app and group comes with an `etag`. Send it back as `If-Match` on a write and the write fails with **409** if
the file changed since you read it (re-read and try again), rather than overwriting someone else's edit. A write that
would make the file invalid fails with **400** and lists the problems; nothing is written. Unknown keys in a request
body are refused; unknown keys already in a file are kept.

## MCP

If your client speaks MCP, the same operations are typed tools on the daemon's own port. Register it once (Claude
Code shown; other clients take the URL, transport Streamable HTTP; use the daemon's port if it isn't 4255):

```sh
claude mcp add --transport http hallway http://localhost:4255/mcp
# or, for clients that want stdio (a bridge to the running daemon):
claude mcp add hallway -- hallway mcp
```

In fronted mode the dashboard's own address works too: `https://hallway.localhost/mcp` (or `https://<base>/mcp` on a
custom domain; it's `domain.dashboard` in `config.yaml`). The `localhost` URL keeps working in both modes, and doesn't
depend on Caddy running, so prefer it.

| Tool | What it does |
|------|--------------|
| `get_status`, `list_apps`, `get_app`, `get_history` | Apps with their state, URL and uptime; one app in full; uptime bars for `24h`, `7d`, `90d` |
| `list_observed`, `claim_observed`, `ignore_observed` | Listeners nobody has named yet; name one (writes `apps/<slug>.yaml`) or hide it |
| `declare_app` | Create `apps/<slug>.yaml` (fails if it exists: use `update_app`) |
| `update_app`, `remove_app` | Merge-patch an app (`null` removes a key); move its file to `backups/removed/` |
| `list_bookmarks`, `upsert_bookmark_group`, `add_bookmark`, `update_bookmark`, `remove_bookmark`, `remove_bookmark_group` | Bookmarks, a link at a time or a group at a time |

Every write keeps the file's comments, returns its new `etag`, and takes an optional `etag`: pass the one you read and
the write fails with a conflict (and the current etag) if the file changed meanwhile. The resources
`hallway://state` and `hallway://apps/<slug>` say when they change.

**MCP never starts, stops or installs a process.** `declare_app` and `update_app` refuse a `service` block,
`update_app` refuses a different `port`, and `remove_app` refuses an app Hallway runs as a service. To run a server,
use `hallway run` in the shell, as above.

## The pre-tool-use hook

`hallway hook check-command` is an optional Claude Code `PreToolUse` hook for the Bash tool. When a command would
start a dev server directly (`npm run dev`, `pnpm dev`, `vite`, `astro dev`, `next dev`, `python -m http.server`, …),
it blocks it and says which `hallway run` to use instead; builds, tests, installs and `hallway run` itself pass. The
user installs it (Hallway never does), in `.claude/settings.json` or `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "hallway hook check-command" }] }
    ]
  }
}
```

If it blocks you, run the command it suggests. If it's wrong (a `start` script that isn't a server, say), tell the
user rather than working around it.

## Etiquette

- Never change an existing app's `port`.
- Never delete files outside `apps/` and `bookmarks/`, and prefer `DELETE` over the API (it keeps a copy) to `rm`.
- Don't touch `state/`, `cache/`, `generated/`, `logs/` or `backups/`: they're machine-written.
- Keep the user's comments and key order when you edit a file by hand; edit the lines you mean to change and leave
  the rest alone. (The API does this for you.)
- Prefer `expected: adhoc` for throwaway servers.
- Don't write a `service:` block by hand. It asks Hallway to keep a command running, which is the user's decision;
  `hallway run` and `hallway service add` write it when they ask.

## For your agent instruction file

Suggest this paragraph to the user for their `CLAUDE.md`, `AGENTS.md` or similar (`hallway guide --snippet` prints
it):

> Never start a long-running dev or preview server directly (`npm run dev`, `vite`, `astro dev`, `next dev`,
> `python -m http.server`, …). Start it with `hallway run <slug> -- <command>`, which keeps it running outside this
> session on a stable port and prints its URL. Run `hallway guide` for details.

## File-format reference

<!-- BEGIN file-format reference: generated from server/store/schema.ts (npm run sync:guide) -->

### `apps/<slug>.yaml`

One app per file: `apps/<slug>.yaml`. The slug is the file name. The slug: lower-case letters, digits and hyphens; starts and ends with a letter or digit; at most 63 characters. Reserved: `www`, `api` and the dashboard's label (`hallway` by default).

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `name` | text | the slug | Display name. |
| `description` | text | `null` | One line about it. |
| `port` | number 1–65535 | **required** | The port the app actually listens on. Never changed by Hallway. |
| `host` | text | `127.0.0.1` | Where the app listens (the probe and proxy target). |
| `expected` | `running` \| `stopped` \| `adhoc` | `running` | `running`: should always be up (not responding is `down`). `stopped`: off on purpose. `adhoc`: up sometimes (not responding is `stopped`, not `down`). |
| `health` | mapping | absent | How to check it. Leave out to probe `GET /` (any status below 500 is healthy). |
| `health.path` | text | **required** | The path to `GET`, e.g. `/api/health`. |
| `health.expectStatus` | number 100–599 | any 2xx | The status that means healthy. |
| `proxy` | mapping |  | Fronted mode only (v1). |
| `proxy.preserveHost` | true/false | `false` | Pass the public Host header through instead of rewriting it to the upstream address. |
| `proxy.aliases` | list of text | `[]` | Extra names: `[review]` also serves it at `review.<base>`. |
| `service` | mapping | absent | Present: Hallway keeps it running as a native service (launchd / systemd). Write it with the CLI (`hallway run`, `hallway service add`), not by hand. |
| `service.command` | list of text | **required** | The command, as an argv array: `["npm", "run", "dev"]`. |
| `service.cwd` | text | `null` | The working directory (`~` allowed). |
| `service.env` | mapping of text | `{}` | Extra environment. `PORT` and `HOST` are set for you. |
| `service.runAtLoad` | true/false | `true` | Start it at login. |
| `service.keepAlive` | true/false | `true` | Restart it if it exits. |
| `links` | list of mappings | `[]` | Deep links shown on the card. |
| `links[].label` | text | **required** | The link text. |
| `links[].path` | text |  | A path on the app, e.g. `/api`. |
| `links[].url` | text |  | Or a full URL. |
| `project` | mapping | absent | Where its code lives. Filled in when it is claimed from the observed tray. |
| `project.dir` | text | `null` | The project directory (`~` allowed). |
| `project.repo` | text | `null` | The repository URL. |
| `tags` | list of text | `[]` | Free-form tags, for filtering. |
| `icon` | text | `auto` | `auto` (the site's favicon), an emoji, a path to an image in the data home, or an image URL. |

### `bookmarks/<group>.yaml`

One group of links per file: `bookmarks/<group>.yaml`. The group slug is the file name. The group slug follows the same rules as an app slug.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `title` | text | the group slug | The group's heading. |
| `order` | number | `100` | Groups sort by `order`, then `title`. |
| `collapsed` | true/false | `false` | Shown collapsed on the dashboard. |
| `links` | list of mappings | `[]` | The links, in order. |
| `links[].title` | text | the URL's host name | The link text. |
| `links[].url` | text | **required** | Where it goes. |
| `links[].description` | text | `null` | A tooltip. |
| `links[].icon` | text | `auto` | `auto` (the site's favicon), an emoji, a path to an image in the data home, or an image URL. |
| `links[].tags` | list of text | `[]` | Free-form tags, for filtering. |

### `ignore.yaml`

`ignore.yaml`: observed listeners to hide.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `ports` | list of number 1–65535 | `[]` | Never show these ports. |
| `processes` | list of text | `[]` | Never show listeners owned by these process names. |
| `dirs` | list of text | `[]` | Never show listeners whose working directory is under these paths (`~` allowed). |

### `config.yaml`

`config.yaml`: global settings. Every key is optional.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `version` | number 1–1 | `1` | The data home's format. Always `1` for now. |
| `port` | number 1–65535 | `4255` | The daemon's port (127.0.0.1 only). `--port` and `$PORT` override it. |
| `mode` | `direct` \| `fronted` | `direct` | `direct`: links go to `localhost:<port>`. `fronted`: Caddy serves `https://<slug>.<base>` (v1, needs `hallway setup`). |
| `domain` | mapping |  | Fronted mode's names. |
| `domain.base` | text | `localhost` | Apps are served at `<slug>.<base>`. (a host name) |
| `domain.dashboard` | text | `hallway.localhost` when `base` is `localhost`, else `<base>` | Where the dashboard is in fronted mode. (a host name) |
| `domain.tls` | true/false | `true` | Fronted mode is always HTTPS. |
| `domain.dnsPort` | number 1–65535 | `4253` | Custom domains only: the loopback port Hallway's own dnsmasq answers on (the resolver configuration points at it). |
| `proxy` | mapping |  | Fronted mode's Caddy (v1). Caddy runs as you on loopback ports above 1024; `hallway setup` redirects 443 and 80 to them. |
| `proxy.caddy` | text | `caddy` on your PATH, else Homebrew's | The Caddy binary. |
| `proxy.httpsPort` | number 1–65535 | `4443` | The loopback port Caddy serves HTTPS on. |
| `proxy.httpPort` | number 1–65535 | `4480` | The loopback port Caddy serves HTTP (a redirect to HTTPS) on. |
| `proxy.publicPort` | number 1–65535 | `443` | The HTTPS port in links: 443 once `hallway setup` has redirected it to `httpsPort`. Set it to `httpsPort` to use fronted mode with no setup (links then carry the port). |
| `probe` | mapping |  | Health checks. |
| `probe.intervalSeconds` | number ≥ 5 | `60` | Seconds between checks. |
| `probe.liveIntervalSeconds` | number ≥ 1 | `15` | Seconds between checks while a dashboard is open. |
| `probe.timeoutMs` | number ≥ 100 | `5000` | How long a check waits for an answer. |
| `probe.concurrency` | number ≥ 1 | `8` | Checks in flight at once. |
| `probe.failuresBeforeUnhealthy` | number ≥ 1 | `2` | Consecutive failures before an app leaves `healthy`. |
| `ports` | mapping |  | Port assignment. |
| `ports.assignRange` | list of number 1–65535 | `[5100, 5999]` | `[low, high]`: where new apps with no port get one. Existing ports are never changed. |
| `services` | mapping |  | Managed services (`hallway run`, `hallway service add`). |
| `services.startGraceSeconds` | number ≥ 0 | `30` | A service just started is `starting`, not `down`, for this long. |
| `services.logMaxBytes` | number ≥ 1024 | `10485760` | Rotate a service's log above this size. |
| `services.logGenerations` | number ≥ 1 | `3` | Rotated logs to keep. |
| `scan` | mapping |  | The port scanner. |
| `scan.enabled` | true/false | `true` | Look for unnamed listeners. |
| `scan.intervalSeconds` | number ≥ 10 | `120` | Seconds between scans. |
| `scan.includeEphemeralPorts` | true/false | `false` | Include ephemeral ports (49152–65535, and Linux's own range), where IDE and tool helpers listen. |
| `scan.minPort` | number 1–65535 | `1024` | Ignore ports below this. |
| `thumbnails` | mapping |  | The pictures on the doors. |
| `thumbnails.mode` | `favicon` \| `screenshot` \| `card` | `favicon` | `favicon`: the app's favicon on its door (a monogram if it has none). `screenshot`: a picture of each healthy app as the door's glass (run `hallway thumbs enable` first: it installs the browser). `card`: every door drawn as a generated card. |
| `dashboard` | mapping |  | The home page. |
| `dashboard.title` | text | the machine's host name | The page title. |
| `dashboard.sections` | list of `apps` \| `observed` \| `bookmarks` | `[apps, observed, bookmarks]` | Which sections to show, in order. |
| `dashboard.theme` | `auto` \| `dark` \| `light` | `auto` | `auto` follows the system. |
| `dashboard.hints` | mapping |  | One-off suggestions on the dashboard. Dismissing one there sets it to false here. |
| `dashboard.hints.localDomains` | true/false | `true` | The "Local domains" panel: how to turn on https://<app>.localhost (`hallway setup`). Shown only in direct mode, and never on Windows. |

Unknown keys are kept when Hallway writes a file, and reported as warnings. A file that fails to parse or validate is never overwritten: Hallway keeps using its last good version and shows the error (file, line, message) until it is fixed.

<!-- END file-format reference -->
