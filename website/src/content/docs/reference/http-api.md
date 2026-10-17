---
title: HTTP API
description: The daemon's JSON API and its live event stream.
---

The daemon serves a JSON API on its own port (`http://localhost:4255` by default). The dashboard, the CLI and the
MCP server all use it, and so can you. Every route is behind the
[localhost security rules](/guarantees/localhost-security/): writes must be `Content-Type: application/json`.

Every route below is in the current release. In fronted mode the same API is also reachable through
`https://hallway.localhost` (or your custom domain's apex).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | `{ ok: true, version }`: the daemon's own health. |
| `GET` | `/api/state` | Everything the dashboard needs, in one call: apps with live state, bookmarks, observed listeners, what was lost at the last reboot (`lost`), a config summary and any file errors. |
| `GET` | `/api/config` | The resolved `config.yaml`, with an ETag. |
| `GET` | `/api/apps` | Declared and discovered apps, with current state. |
| `GET` | `/api/apps/:slug` | One app: config, state, recent history, identity and file errors. |
| `PUT` | `/api/apps/:slug` | Create or replace a declared app (ETag / `If-Match`). |
| `PATCH` | `/api/apps/:slug` | Partial update, as a JSON merge patch (`null` removes a key). |
| `DELETE` | `/api/apps/:slug` | Remove a declared app (its file moves to `backups/removed/`; never hard-deleted). |
| `GET` | `/api/apps/:slug/history?window=24h\|7d\|90d` | Uptime buckets and latency figures. The 7- and 90-day windows come from hourly rollups. |
| `GET` | `/api/apps/:slug/thumb` | The thumbnail image, with an ETag: a favicon, a screenshot, or a generated 640×400 PNG card. The app's `thumbKind` says which. See [Thumbnails](/concepts/thumbnails/). |
| `POST` | `/api/thumbs/refresh` | Take new screenshots now: `{"slug": "..."}` for one app, `{}` for every healthy one. Answers `{"taken": n}` once they're done; 409 when screenshots are off. |
| `POST` | `/api/apps/:slug/service/:action` | `start`, `stop` or `restart` a managed service. |
| `GET` | `/api/apps/:slug/logs?lines=200` | The tail of a managed service's logs. |
| `GET` | `/api/bookmarks` | All bookmark groups. |
| `GET` | `/api/bookmarks/:group` | One group, with an ETag. |
| `PUT` / `PATCH` / `DELETE` | `/api/bookmarks/:group` | Create or replace, merge-patch, or remove a group (removing moves its file to `backups/removed/`). |
| `GET` | `/api/bookmarks/:group/icon?url=...` | The cached favicon of a link in that group (only for a URL that is in the group); 204 when there is none yet. |
| `GET` | `/api/observed` | Observed listeners, with identity. |
| `POST` | `/api/observed/:id/claim` | Body `{ slug, name?, expected? }`: writes `apps/<slug>.yaml` from the observation. |
| `POST` | `/api/observed/:id/ignore` | Add it to `ignore.yaml` (by port, process or directory). |
| `POST` | `/api/scan` | Run a scan now. |
| `GET` | `/api/lost` | [Lost at last reboot](/concepts/services/#lost-at-last-reboot): `{ lost }`, null when there's nothing. Also `lost` in `/api/state`. |
| `POST` | `/api/lost/:id/restart`, `/api/lost/:id/service` | Body `{}` or `{ "slug": "..." }`. Start it again, once or as a service, as `hallway run` would. Answers 200 even when it didn't come up, with `ok: false`, the reason and the last log lines. |
| `POST` | `/api/lost/:id/dismiss`, `/api/lost/dismiss` | Dismiss one, or the whole notice. |
| `GET` | `/api/fronting` | [Local domains](/networking/fronted-mode/): `{ fronting, checks, checkedAt }`. `fronting` (also in `/api/state`) says whether they can work on this platform, whether they're on, and the addresses; in fronted mode `checks` are `hallway doctor`'s networking checks, cached for a few seconds (`?fresh=1` runs them again). It never changes anything: turning them on is `hallway setup`. |
| `PATCH` | `/api/hints` | `{ "localDomains": false }` dismisses the dashboard's Local domains panel (`true` shows it again), in `config.yaml`. |
| `GET` | `/api/events` | The live event stream (below). |
| `GET` | `/llms.txt`, `/llms-full.txt`, `/agent-guide.md` | The [agent guide](/agents/agent-guide/), with live data. |
| `POST` | `/mcp` | The [MCP server](/agents/mcp/), Streamable HTTP and stateless. `GET` and `DELETE` get 405. |

## Concurrency

Reads return an `ETag` (a hash of the file's bytes). Writes may send `If-Match`; if the file has changed since, the
write gets `409 Conflict` and the caller should re-read.

## Live events

`GET /api/events` is a Server-Sent Events stream: a `hello` event first, then `change` events with incrementing IDs,
and a `: ping` comment every 25 seconds to keep the connection alive. Bursts of file writes are debounced (about
150 ms per item) into one event.

```ts
type ServerEvent =
  | { type: 'app'; slug: string; reason: 'config' | 'removed' | 'error' }
  | { type: 'apps'; reason: string }                        // the list changed
  | { type: 'state'; slug: string; state: AppState }        // health transitions only, not every probe
  | { type: 'bookmarks'; group?: string }
  | { type: 'observed'; reason: 'scan' | 'claimed' | 'ignored' | 'config' }
  | { type: 'thumb'; slug: string }                         // a favicon, screenshot or card changed
  | { type: 'config' }
  | { type: 'reboot'; lost: string[] };                     // the lost-at-reboot notice changed
```

Treat an event as a hint to refetch the affected resource, not as data: that is what the dashboard does.
