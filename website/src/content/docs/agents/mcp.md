---
title: MCP server
description: Typed tools for apps and bookmarks, served on the dashboard's own port - and why none of them launch anything.
---

<span class="ms ms--v0">v0</span> Available now (shipped early from v2). Hallway's MCP server gives agents typed tools
for reading what's running, describing apps and managing bookmarks. It is a convenience layer over the same store the
CLI, the HTTP API and your own hand edits go through: never a separate code path, and never the only way to do
something. An agent that can edit files or run `hallway` already has everything MCP offers, and more.

What it **isn't**: a process manager. No MCP tool starts, stops, restarts or installs anything (see
[Describe, never launch](#describe-never-launch)).

## Connecting

The server runs **in the daemon, on the daemon's own port**, at `/mcp`: `http://localhost:4255/mcp` by default. It
uses MCP's Streamable HTTP transport, so there is one service and one port to remember, and because it shares the
daemon's store and file watcher, every write through MCP shows up live on every open dashboard.

It speaks the 2026-07-28 protocol revision, which is stateless (each request stands alone), and also serves clients of
the 2025 revisions, which open with an `initialize` handshake, statelessly too.

With Claude Code, over HTTP:

```sh
claude mcp add --transport http hallway http://localhost:4255/mcp
```

If your daemon runs on another port (the `port` key in [config.yaml](/reference/config-yaml/)), use that in the URL.

In [fronted mode](/concepts/modes/), the dashboard's own address works too: `https://hallway.localhost/mcp`, or
`https://<base>/mcp` on a custom domain (`domain.dashboard` in config.yaml). The `localhost` URL keeps working in both
modes and doesn't depend on Caddy running, so it's the one to register.

### Over stdio

For clients that prefer to launch a stdio server, `hallway mcp` is a thin bridge: it forwards every message to the
running daemon's `/mcp` and writes the replies back, so the daemon stays the only writer. It finds the daemon on the
port in `config.yaml`, so it needs no URL.

```sh
claude mcp add hallway -- hallway mcp
```

### Other clients

Any MCP client that supports Streamable HTTP can connect to `http://localhost:4255/mcp` (or your daemon's port) with no
headers and no token. Clients that only launch stdio servers can run `hallway mcp` as the command, with no arguments.

## Tools

Reading:

| Tool | Input | Returns |
| --- | --- | --- |
| `get_status` | `{ filter? }` | Apps with state, URL and uptime; counts by state; how many listeners are observed |
| `list_apps` | `{ source?, state?, tag? }` | Apps with their config and live state |
| `get_app` | `{ slug }` | One app in full, with identity and recent history |
| `get_history` | `{ slug, window: '24h' \| '7d' \| '90d' }` | Uptime buckets and a latency summary |
| `list_observed` | `{}` | Observed listeners, with identity |
| `list_bookmarks` | `{ group? }` | Bookmark groups and their links |

Apps:

| Tool | Input | Effect |
| --- | --- | --- |
| `declare_app` | `{ slug, port, name?, description?, host?, expected?, health?, tags?, links?, icon? }` | Writes a new `apps/<slug>.yaml`. Creates only: fails if the app already exists |
| `update_app` | `{ slug, patch, etag? }` | Applies `patch` as a JSON merge patch (`null` removes a key; lists are replaced whole). Can't add a `service` block or change `port` |
| `remove_app` | `{ slug, etag? }` | Moves the file to `backups/removed/`. Refused for an app Hallway runs as a service: use `hallway app rm` |

Observed listeners:

| Tool | Input | Effect |
| --- | --- | --- |
| `claim_observed` | `{ id, slug, name?, expected? }` | The same as **Claim** in the dashboard: writes `apps/<slug>.yaml` from the observation |
| `ignore_observed` | `{ id, by: 'port' \| 'process' \| 'dir' }` | Adds it to `ignore.yaml` |

Bookmarks:

| Tool | Input | Effect |
| --- | --- | --- |
| `upsert_bookmark_group` | `{ group, title?, order?, collapsed?, etag? }` | Creates or updates a group |
| `add_bookmark` | `{ group, url, title?, description?, icon?, tags?, etag? }` | Adds a link |
| `update_bookmark` | `{ group, url \| index, patch, etag? }` | Edits a link, found by its URL or its position |
| `remove_bookmark` | `{ group, url \| index, etag? }` | Removes a link |
| `remove_bookmark_group` | `{ group, etag? }` | Moves the group's file to `backups/` |

## Writes, ETags and conflicts

Every write goes through the same store as the HTTP API, the CLI and the dashboard, so it is validated the same way,
written atomically, and keeps the **comments and key order** of the YAML file it edits. It returns the file's new
`etag`.

Pass that `etag` (or the one from an earlier read) to a later write for optimistic concurrency: if the file changed
in the meantime, whether by you in an editor, another agent or the dashboard, the write fails with a conflict and
changes nothing. Re-read, then try again. Without an `etag`, the write applies to whatever is there.

## Describe, never launch

Two data sets carry very different risks:

- **Bookmarks** are inert, so full create, update and delete is safe.
- **Apps** can be *described*: declared, edited, claimed, removed. But **no MCP tool starts, stops, restarts or
  installs a process.** A tool that registers "run this command" would be an arbitrary-code-execution surface for any
  agent that has the server configured, outside the shell's own permission prompts.

So:

- `declare_app` and `update_app` refuse a `service` block.
- `update_app` refuses to change `port`: apps hardcode their ports, so a changed port breaks things elsewhere (see
  [Your ports stay put](/guarantees/ports/)). Change it yourself if you really mean to.
- `remove_app` refuses an app Hallway runs as a service, because removing it would stop a process.
- `run`, `start`, `stop`, `restart`, `service`, `setup` and `teardown` are **CLI-only**, where you, or an agent in
  your shell under its own permission prompts, run them explicitly. An agent with a shell starts servers with
  [`hallway run`](/agents/hallway-run/).

A refusal comes back as a tool error that says why and names the shell command to use instead.

A `restart_app` tool, limited to services already installed through the CLI, was considered and rejected: it would
still start a process.

## Resources

Two resources carry the same data as the dashboard, as JSON:

| URI | Contents |
| --- | --- |
| `hallway://state` | Everything the dashboard shows: apps, bookmarks, observed listeners, problems |
| `hallway://apps/<slug>` | One app, as `get_app` returns it |

Clients of the 2026-07-28 revision can subscribe (`subscriptions/listen`) and receive
`notifications/resources/updated` whenever a resource changes, including after a hand edit to a file.

## Security

The [localhost security rules](/guarantees/localhost-security/) apply to `/mcp` exactly as to the rest of the daemon,
as MCP's own guidance for Streamable HTTP servers asks:

- The daemon listens on `127.0.0.1` only.
- A request whose `Host` or `Origin` isn't local gets `403`. This is what stops DNS rebinding and other web pages.
- Requests must be JSON (`Content-Type: application/json`).

There is **no auth token**. The trust boundary is the same as the data home's: anything running as you can already
edit `~/.hallway` directly, so a token would add friction without adding protection. That holds because MCP can't
start processes; it would be revisited if that ever changed.

## Troubleshooting

**The daemon isn't running.** The tools live in the daemon, so an HTTP client gets a connection error, and
`hallway mcp` exits with status 1 and a message saying so. Start the daemon with `hallway service install` (it then
runs at every login) or `hallway serve` (in the foreground), then reconnect or restart the MCP server in your client.
`hallway doctor` shows whether the daemon's service is installed and running.

**The daemon is on a different port.** The HTTP URL must use the daemon's port: check the `port` key in
`~/.hallway/config.yaml` and re-register with that URL. `hallway mcp` reads `config.yaml` itself, so it follows the
port without changes. (`$PORT` in your shell doesn't move it: that is usually some app's port, not Hallway's.)

**A write fails with a conflict.** The file changed since the `etag` you passed was read. Read it again and retry.
