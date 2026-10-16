---
title: HTTP API
description: The daemon's JSON API and its live event stream.
---

The daemon serves a JSON API on its own port (`http://localhost:4255` by default). The dashboard, the CLI and the
MCP server all use it, and so can you. Every route is behind the
[localhost security rules](/guarantees/localhost-security/): writes must be `Content-Type: application/json`.

All routes are in <span class="ms ms--v0">v0</span>, available now, unless marked.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | `{ ok: true, version }`: the daemon's own health. |
| `GET` | `/api/state` | Everything the dashboard needs, in one call: apps with live state, bookmarks, observed listeners, a config summary and any file errors. |
| `GET` | `/api/apps` | Declared and discovered apps, with current state. |
| `GET` | `/api/apps/:slug` | One app: config, state, recent history, identity and file errors. |
| `PUT` | `/api/apps/:slug` | Create or replace a declared app (ETag / `If-Match`). |
| `PATCH` | `/api/apps/:slug` | Partial update. |
| `DELETE` | `/api/apps/:slug` | Remove a declared app (its file moves to `backups/`; never hard-deleted). |
| `GET` | `/api/apps/:slug/history?window=24h\|7d\|90d` | Uptime buckets and latency figures. |
| `GET` | `/api/apps/:slug/thumb` | The thumbnail image, with an ETag. The app's `thumbKind` says which it is: `favicon`, `screenshot` or `card`. |
| `POST` | `/api/thumbs/refresh` | Take new screenshots now: `{"slug": "..."}` for one app, `{}` for every healthy one. Answers `{"taken": n}` once they're done; 409 when screenshots are off. |
| `POST` | `/api/apps/:slug/service/:action` | `start`, `stop` or `restart` a managed service. |
| `GET` | `/api/apps/:slug/logs?lines=200` | The tail of a managed service's logs. |
| `GET` | `/api/bookmarks` | All bookmark groups. |
| `PUT` / `DELETE` | `/api/bookmarks/:group` | Create, replace or remove a group. |
| `GET` | `/api/observed` | Observed listeners, with identity. |
| `POST` | `/api/observed/:id/claim` | Body `{ slug, name?, expected? }`: writes `apps/<slug>.yaml` from the observation. |
| `POST` | `/api/observed/:id/ignore` | Add it to `ignore.yaml` (by port, process or directory). |
| `POST` | `/api/scan` | Run a scan now. |
| `GET` | `/api/events` | The live event stream (below). |
| `GET` | `/llms.txt`, `/llms-full.txt`, `/agent-guide.md` | The [agent guide](/agents/agent-guide/), with live data. |
| `*` | `/mcp` | The [MCP server](/agents/mcp/), Streamable HTTP. |

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
  | { type: 'observed'; reason: 'scan' | 'claimed' | 'ignored' }
  | { type: 'thumb'; slug: string }
  | { type: 'config' }
  | { type: 'reboot'; lost: string[] };                     // v1
```

Treat an event as a hint to refetch the affected resource, not as data: that is what the dashboard does.
