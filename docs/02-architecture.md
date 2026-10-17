# 02 — Architecture

## Process model

```
                         ┌──────────────────────────── Hallway daemon (one Node process, user-level) ──────────────┐
                         │                                                                                         │
 browser ── direct ────▶ │  HTTP server on 127.0.0.1:<port>                                                        │
   │       mode          │    /            dashboard (React SPA)                                                  │
   │                     │    /api/*       JSON API                                                               │
   │                     │    /api/events  SSE stream of change events                                            │
   │                     │    /mcp         MCP (Streamable HTTP, stateless)          (v2, built: D50)             │
   │                     │    /llms.txt, /agent-guide.md                                                          │
   │                     │                                                                                         │
   │                     │  file watcher (chokidar) on the data home ──▶ in-process event bus ──▶ SSE             │
   │                     │  prober          (health checks every N seconds)        ──▶ state store               │
   │                     │  scanner         (lsof listening ports, identify)       ──▶ observed store            │
   │                     │  thumbnailer     (favicon/colour; screenshots opt-in)   ──▶ cache                     │
   │                     │  proxy-config generator ──▶ Caddy admin API / config file   (v1)                       │
   │                     │  service manager ──▶ launchctl (generated LaunchAgents)     (v1)                       │
   │                     └─────────────────────────────────────────────────────────────────────────────────────────┘
   │
   └── fronted mode ──▶ 127.0.0.1:443/80 ─(redirect)─▶ Caddy, as you, on :4443/:4480 ──▶ <slug>.<base> → 127.0.0.1:<app port>
                                                                                 └─▶ dashboard host → 127.0.0.1:<daemon port>

 CLI `hallway …` ── reads/writes the same files via the same write module; asks the daemon (HTTP) for live state.
 `hallway mcp`  ── stdio MCP bridge to the daemon.                                    (v2, built: D51)
```

Rules:

- **One daemon process, user-level, never root.** Anything privileged (binding loopback :443, writing
  `/etc/resolver`, trusting a CA) is done by separate, explicit, user-approved setup steps (`03-networking.md`).
- **The daemon is optional for correctness.** The YAML files are the truth. If the daemon is down, the CLI can still
  read and write config; the daemon reconciles on start.
- **The daemon never proxies app traffic.** Caddy does that (D4). The daemon only serves its own UI/API.
- **Never require environment variables for normal operation.** Agents usually invoke commands from non-login shells
  that source no profile (Paddock's `pm` needed a config file for exactly this reason), and launchd jobs inherit no
  shell environment at all. Defaults must work with an empty environment; `$HALLWAY_HOME` is an override,
  never a requirement.

## Tech stack

Mirror Local Review (D16). Keep dependencies minimal.

| Concern | Choice | Notes |
|---------|--------|-------|
| Runtime | Node ≥ 22.13 | 22.13 is the first 22.x where `node:sqlite` loads without a flag (D37, verified: `11-research-notes.md`). |
| Language | TypeScript, ESM | |
| HTTP | Hono + `@hono/node-server` | Including `hono/streaming` `streamSSE` for events. |
| UI | React + Vite | Built into `dist/web`, served statically by the daemon. |
| File watching | chokidar | |
| Config format | `yaml` package | Preserve comments on round-trip writes where possible (the `yaml` package's Document API supports this). |
| Health/uptime store | `node:sqlite` | `state/health.sqlite`; decided in D37 (was Q-STORE). |
| MCP | the official MCP TypeScript SDK (v2, `@modelcontextprotocol/server`) | Its stateless `createMcpHandler` mounted at `/mcp` in Hono; `hallway mcp` forwards stdio to it (D50, D51). |
| Image rendering | `@resvg/resvg-js` + `opentype.js` | Only for generated cards (v2), reusing Local Review's approach. |
| Screenshots | Playwright, **optional, lazily installed** | v2. Never a hard dependency. |
| Tests | `node --test` with tsx | As Local Review. |
| Release | changesets, npm publish with provenance | As Local Review. |

## Default port

- Single source of truth: a tiny `server/port.ts` that only exports `DEFAULT_PORT`, so the Vite config can import it
  without loading the server (Local Review's pattern).
- **`DEFAULT_PORT = 4255`** (decided, D20) — "HALL" on a phone keypad, echoing Local Review's 5622 = "LOCA". Put the
  mnemonic in the comment, as Local Review does, e.g. `// 4255 spells HALL on a phone keypad.` (The pre-rename
  default is recorded in D20.) IANA has no individual registration for 4255; it falls inside the legacy
  `vrml-multi-use` block (4200–4299), which is not a realistic conflict on a developer's machine. It also avoids
  common dev-server defaults (Angular 4200, Astro 4321).
- Never use 5000 or 7000: macOS's AirPlay Receiver listens there (Local Review moved off 5000 for exactly this).
- `--port <n>` and `$PORT` override. Fail with a clear message on `EADDRINUSE` / `EACCES`.

## Data home

`~/.hallway`, overridable with `$HALLWAY_HOME`. Resolve `~` explicitly (Local Review's
`expandHome`).

```
~/.hallway/
  config.yaml                 # global settings (human/agent-editable)
  apps/
    <slug>.yaml               # one declared app per file (human/agent-editable)
  bookmarks/
    <group-slug>.yaml         # one bookmark group per file (human/agent-editable)
  ignore.yaml                 # observed listeners the user chose to hide (human/agent-editable)
  state/                      # machine-written; never hand-edit; safe to delete
    health.sqlite             # probe samples + hourly rollups (node:sqlite, D37)
    observed.json             # last-known identity of every observed listener, with first/last seen
    boot.json                 # last seen boot time, to detect reboots
    lost.json                 # "Lost at last reboot": the notice, until it's dismissed (D54)
    daemon.json               # the running daemon's pid and port, where the CLI also looks for it (D46)
  cache/                      # machine-written; regenerable
    thumbs/<slug>.png, <slug>.json   # screenshots (opt-in, D56) and what was shot when, from which PID
    browser/                  # `hallway thumbs enable`: playwright-core and Chromium's headless shell (D56)
    favicons/<hash>.img, <hash>.json   # tier-1 icons for apps and bookmarks, and what was looked up (D39)
  generated/                  # machine-written; regenerable
    caddy.json                # last config pushed to Caddy (v1)
  logs/
    daemon.out.log, daemon.err.log
    <slug>.out.log, <slug>.err.log   # managed services (v1)
  backups/
    <ISO-timestamp>/          # periodic snapshots of the human-editable files (D34)
    removed/<ISO-timestamp>/  # files deleted through Hallway, at their original relative path (D34)
```

Principles:

- **Human-editable vs machine-written are separated by directory.** Everything outside `state/`, `cache/`,
  `generated/`, `logs/` and `backups/` is intended for people and agents to edit. Machine-written data is not YAML,
  so nobody is tempted to edit it.
- **One file per entity** (D14): agents writing concurrently touch different files; diffs are small; a broken file
  breaks one entity, not everything. Local Review uses `projects/<slug>/project.yaml` for the same reasons.
- **The data home can be a git repo** if the user wants history; `state/`, `cache/`, `generated/`, `logs/`, `backups/`
  should be listed in a generated `.gitignore` inside the data home.

## File formats

All files carry no `version` field per entity; `config.yaml` carries `version: 1` for the whole data home, so a
future migration can be detected. Unknown keys are preserved on write, reported as warnings, never deleted.

### `config.yaml`

```yaml
version: 1

port: 4255                      # daemon port (127.0.0.1 only)

mode: direct                    # direct | fronted   (fronted requires `hallway setup`, v1)

domain:
  base: localhost               # apps are served at <slug>.<base>
  dashboard: hallway.localhost  # where the dashboard lives in fronted mode.
                                # Default: "hallway.<base>" when base is "localhost";
                                # the bare apex "<base>" for any custom domain.
  tls: true                     # fronted mode is always HTTPS; kept explicit for clarity
  dnsPort: 4253                 # custom domains: Hallway's own dnsmasq, as you, on 127.0.0.1 (D47)

proxy:                          # fronted mode's Caddy, which runs as you (D47)
  caddy: null                   # the binary; default: `caddy` on PATH, else Homebrew's
  httpsPort: 4443               # Caddy's loopback ports; `hallway setup` redirects 443 and 80 to them
  httpPort: 4480
  publicPort: 443               # the HTTPS port in links; set it to httpsPort to go without the redirect

probe:
  intervalSeconds: 60
  liveIntervalSeconds: 15       # used while at least one dashboard is connected over SSE
  timeoutMs: 5000
  concurrency: 8
  failuresBeforeUnhealthy: 2    # flap damping (see 04)

ports:
  assignRange: [5100, 5999]     # for new apps that have no port yet; existing ports are never changed

services:                       # v1
  startGraceSeconds: 30         # "starting" before "not listening" counts as down
  logMaxBytes: 10485760         # rotate managed-service logs above this size
  logGenerations: 3

scan:
  enabled: true
  intervalSeconds: 120
  includeEphemeralPorts: false  # skip 49152–65535 (and Linux's ip_local_port_range) by default (IDE/tool helpers)
  minPort: 1024

thumbnails:
  mode: favicon                 # favicon | screenshot (after `hallway thumbs enable`) | card   (D55)

dashboard:
  title: null                   # defaults to the machine's hostname
  sections: [apps, observed, bookmarks]   # order and presence; remove one to hide it
  theme: auto                   # auto | dark | light
  hints:
    localDomains: true          # the "Local domains" panel (D63); the dashboard's Dismiss sets it false
```

### `apps/<slug>.yaml`

The slug is the filename. It becomes the hostname label in fronted mode, so it must be a valid DNS label:
`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`. Reserved slugs: the dashboard's label (`hallway` by default), `www`, `api`.

```yaml
name: Local Review
description: Review stacks of local commits before pushing
port: 5622                      # REQUIRED. The port the app actually listens on. Never auto-changed.
host: 127.0.0.1                 # upstream host; default 127.0.0.1

expected: running               # running | stopped | adhoc
                                #  running: should always be up; not responding = "down"
                                #  stopped: intentionally off; shown calmly as "stopped"
                                #  adhoc:   up sometimes; not responding = "stopped", not "down"

health:                         # optional; omitted = probe GET / (see 04)
  path: /api/health
  expectStatus: 200             # optional; default: any 2xx when path is given

proxy:                          # fronted mode only
  preserveHost: false           # default false: Host is rewritten to the upstream (D9)
  aliases: []                   # extra hostnames, e.g. [review] → review.<base>

service:                        # optional (v1). Present = Hallway keeps it alive via launchd.
  command: ["local-review", "serve", "--quiet"]   # argv array; resolved to absolute paths at generation time
  cwd: ~
  env: {}                       # PORT and HOST are injected automatically (see 04)
  runAtLoad: true
  keepAlive: true

links:                          # optional deep links shown on the card
  - { label: API, path: /api }

project:                        # optional; auto-filled when claimed from an observed listener
  dir: ~/Code/local-review
  repo: https://github.com/edspencer/local-review

tags: [tools]
icon: auto                      # auto (favicon) | emoji | path to an image in the data home | URL
```

### `bookmarks/<group-slug>.yaml`

```yaml
title: Production
order: 10                       # groups sort by order, then title
collapsed: false
links:
  - title: Admin console
    url: https://admin.example.com
    description: Production admin
    icon: auto                  # auto = fetch favicon once and cache; or emoji / image / URL
    tags: [prod]
  - title: BI dashboards
    url: https://bi.example.com
```

Bookmarks are inert. Whether to health-check remote bookmarks is open (Q-BOOKMARK-HEALTH); default is no.

### `ignore.yaml`

```yaml
ports: [631]                    # never show these ports
processes: [rapportd, ControlCenter]   # never show listeners owned by these process names
dirs: []                        # never show listeners whose cwd is under these paths
```

## The write path

One module (`server/store/`) owns every write to the human-editable files. The HTTP API, the CLI and MCP all call
it; nothing else writes those files.

- **Atomic writes:** write `<file>.tmp-<pid>`, then `rename`. The watcher ignores `*.tmp*` files (Local Review does the
  same).
- **Validate before writing.** Reject invalid slugs, ports outside 1–65535, unknown enum values. Validation is
  hand-rolled, with the schemas as data, and the agent guide's file reference is generated from them (D32). PUT and
  PATCH semantics: D33.
- **Optimistic concurrency** for API/MCP writes: reads return an ETag (hash of file bytes); writes may send
  `If-Match`; a mismatch returns 409 so the UI or agent can re-read. Local Review has the same idea
  (`ReviewConflictError`).
- **Preserve comments and key order** on round-trip edits where the `yaml` Document API allows.
- **External edits are first-class.** A file changed by an editor or agent is picked up by the watcher exactly like
  an API write.
- **Invalid files never crash the daemon.** If `apps/foo.yaml` fails to parse or validate, keep the last good version
  in memory, mark the entity with an error (file, line, message), show it in the UI, and keep serving everything
  else. Never overwrite a file the user broke.
- **Port conflict detection on write:** two declared apps claiming the same port is a validation warning shown in
  the UI (not an error — one may be `stopped`).

## Live updates

Copy Local Review's pattern exactly:

- chokidar watches the data home's editable files (`ignoreInitial: true`, ignore `*.tmp*`).
- Each change maps to a typed event; events are **debounced per key (~150 ms)** so a burst of writes becomes one push.
- An in-process emitter fans events out to subscribers.
- `GET /api/events` is an SSE stream: an initial `hello` event, then `change` events with incrementing ids, and a
  `: ping` comment heartbeat every 25 s.

Event types (initial set):

```ts
type ServerEvent =
  | { type: 'app'; slug: string; reason: 'config' | 'removed' | 'error' }
  | { type: 'apps'; reason: string }                        // list changed
  | { type: 'state'; slug: string; state: AppState }        // health transition only, not every probe
  | { type: 'bookmarks'; group?: string }
  | { type: 'observed'; reason: 'scan' | 'claimed' | 'ignored' | 'config' }
  | { type: 'thumb'; slug: string }
  | { type: 'config' }
  | { type: 'reboot'; lost: string[] };                     // v1: the "Lost at last reboot" notice changed (D54)
```

Reference implementation of the SSE endpoint, from Local Review's `server/index.ts` (MIT, same author):

```ts
app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    let id = 0;
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const unsub = subscribe((e) => { queue.push(JSON.stringify(e)); wake?.(); });
    stream.onAbort(() => { unsub(); wake?.(); });
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ t: Date.now() }) });
    while (!stream.aborted) {
      while (queue.length) await stream.writeSSE({ event: 'change', data: queue.shift()!, id: String(++id) });
      await new Promise<void>((res) => { wake = res; setTimeout(res, 25000); }); // heartbeat
      wake = null;
      if (!queue.length && !stream.aborted) await stream.write(': ping\n\n');
    }
    unsub();
  }),
);
```

The UI refetches the affected resource on each event rather than trusting the event payload as data. The
implemented types are `ServerEvent` in `shared/api.ts`; the bus and SSE handler are `server/events.ts`, the watcher
`server/watcher.ts`.

## HTTP API (initial)

All JSON. All under the security middleware below.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | `{ ok: true, version }` — the daemon's own health |
| GET | `/api/state` | Everything the dashboard needs in one call: apps merged with live state, bookmarks, observed listeners, config summary, errors |
| GET | `/api/apps` | Declared + discovered apps with current state |
| GET | `/api/apps/:slug` | One app, with config, state, recent history, identity, file errors |
| PUT | `/api/apps/:slug` | Create/replace a declared app (ETag/If-Match) |
| PATCH | `/api/apps/:slug` | Partial update |
| DELETE | `/api/apps/:slug` | Remove declared app (moves file to `backups/`, never hard-deletes) |
| GET | `/api/apps/:slug/history?window=24h\|7d\|90d` | Uptime buckets + latency series |
| GET | `/api/apps/:slug/thumb` | Thumbnail image, with ETag (its etag is also `thumb` on the AppView, and its tier `thumbKind`: favicon, screenshot or card) |
| POST | `/api/thumbs/refresh` | Re-shoot screenshots now: `{"slug"?}` → `{"taken": n}`; 409 when screenshots are off (D56) |
| POST | `/api/apps/:slug/service/:action` | `start`/`stop`/`restart` a managed service (v1) |
| GET | `/api/apps/:slug/logs?lines=200` | Tail of a managed service's logs (v1) |
| GET | `/api/bookmarks` | All groups |
| GET | `/api/bookmarks/:group/icon?url=` | A bookmark's favicon, for a URL in that group only; 204 while there's none (D39) |
| GET/PUT/PATCH/DELETE | `/api/bookmarks/:group` | One group; upsert; merge-patch; remove (moves the file to `backups/`) |
| GET | `/api/config` | The settings in force, with the file's ETag and problems |
| GET | `/api/observed` | Observed listeners with identity |
| POST | `/api/observed/:id/claim` | Body `{ slug, name?, expected? }` → writes `apps/<slug>.yaml` from the observation |
| POST | `/api/observed/:id/ignore` | Adds to `ignore.yaml` (by port, process, or dir) |
| POST | `/api/scan` | Trigger a scan now |
| GET | `/api/lost` | "Lost at last reboot" (v1, D54): `{ lost: LostNotice \| null }`, also `lost` in `/api/state` |
| POST | `/api/lost/:id/restart`, `/api/lost/:id/service` | Body `{}` or `{ slug }` → `hallway run` it again, once or as a service; answers `{ ok, slug, url, port, persist, reason?, tail?, lost }` |
| POST | `/api/lost/:id/dismiss`, `/api/lost/dismiss` | Dismiss one item, or the whole notice |
| GET | `/api/fronting` | Local domains (D63): `{ fronting, checks, checkedAt }`. `fronting` (also in `/api/state`) says whether fronted mode can work here, whether it's on and its addresses; `checks` are doctor's networking checks in fronted mode (null in direct), cached ~15 s; `?fresh=1` runs them again. Read-only: setup is `hallway setup` |
| PATCH | `/api/hints` | `{ "localDomains": false }`: dismiss (or show) a dashboard hint, in `config.yaml`'s `dashboard.hints`; nothing else in the file |
| GET | `/api/events` | SSE |
| GET | `/llms.txt`, `/llms-full.txt`, `/agent-guide.md` | Agent-facing docs (see `06`) |
| POST | `/mcp` | MCP Streamable HTTP (D50); GET and DELETE answer 405 |

The response types are in `shared/api.ts`. Writes return the entity and its `ETag`; errors are `{ error, issues?,
etag? }` with 400 (invalid), 404, 409 (stale `If-Match`, broken file, changed on disk, exists under
`If-None-Match: *`) or 503 (the provider for that slot isn't running). Live data (health, history, observed
listeners, discovered apps, thumbnails) comes from providers (D35).

Deleting moves to `backups/` rather than unlinking, so an agent mistake is recoverable (Local Review's examples
feature "renames, never deletes" for the same reason).

## Security model

Threat model: the daemon listens on loopback, but any web page the user visits can try to talk to it — via DNS
rebinding (a hostile domain that resolves to 127.0.0.1) or by sending a cross-site "simple" request. In v1 the
daemon can also start and stop launchd jobs, and in v2 it speaks MCP, so this matters.

- **Bind to `127.0.0.1` only.** Never `0.0.0.0`. (The one exception is a development-only environment override, never a flag: D31.)
- **Host allowlist.** Every request's `Host` must be `localhost`, `127.0.0.1` or `[::1]` (any port), **or the
  configured dashboard host** when in fronted mode. Anything else → 403. (Alternatively Caddy rewrites Host for the
  dashboard too; either way, the allowlist must be consistent with the proxy config — see `03-networking.md`.)
- **Writes must be `application/json`** (forcing a CORS preflight, which is never granted). If an `Origin` header is
  present on a write, it must be an allowed host. `DELETE` has no body and is exempt from the content-type rule but
  not from the Origin rule.
- **No CORS headers, ever.**
- **No authentication.** Anything running as the user can already edit the data home. `/mcp` has no token either
  (D52).

Reference implementation, from Local Review's `server/security.ts` (MIT, same author). Hallway's version
must additionally accept the configured dashboard host:

```ts
// DNS rebinding / CSRF: the server only listens on 127.0.0.1, but a web page could still reach it via a
// DNS name that resolves to 127.0.0.1 (rebinding) or by POSTing a "simple" cross-site request. So:
// - every request must carry a localhost Host header;
// - writes must be JSON (forces a CORS preflight, which we never grant) and, if the browser sends an Origin,
//   it must be localhost too.
export function isLocalHost(host: string | undefined | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}
export const localOnly: MiddlewareHandler = async (c, next) => {
  if (!isLocalHost(c.req.header('host'))) return c.json({ error: 'forbidden host' }, 403);
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && !isLocalOrigin(origin)) return c.json({ error: 'forbidden origin' }, 403);
    const ct = c.req.header('content-type') ?? '';
    if (c.req.method !== 'DELETE' && !/^application\/json\b/i.test(ct))
      return c.json({ error: 'expected Content-Type: application/json' }, 415);
  }
  await next();
};
```

**This same middleware is why the proxy must rewrite Host by default** — see D9 and `03-networking.md`. Local Review
itself would answer `403 forbidden host` to a request arriving as `review.localhost` with the Host preserved.

## Other conventions to copy from Local Review

- **`packageRoot()`**: find the package's own root by walking up from `import.meta.url` looking for a `package.json`
  whose `name` matches, rather than assuming a directory depth (works from source via tsx and from `dist/`).
- **Startup banner** printing the URL and data-home path.
- **`tildify`** when showing paths in the UI (`/Users/x/.hallway` → `~/.hallway`).
- **Automatic backups** of the editable files into `backups/<timestamp>/` on a schedule and before destructive
  operations.
- **Exit codes:** 0 success, 1 error, 2 usage error (print usage).
