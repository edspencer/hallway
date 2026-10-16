---
title: MCP server
description: Typed tools for apps and bookmarks, served on the dashboard's own port - and why none of them launch anything.
---

<span class="ms">v2</span> Hallway's MCP server is a typed convenience layer over the same write module the CLI and
API use. It is never a separate code path, and never the only way to do something.

## Connecting

The server runs **in the same process and on the same port** as the dashboard, at `/mcp`, using MCP's Streamable
HTTP transport: one service, one port to remember, and because it shares the file watcher, an MCP write lights up
every open dashboard for free.

For clients that prefer stdio, `hallway mcp` is a thin bridge that forwards to the daemon (so there is still only one
writer), and fails with a clear message if the daemon isn't running.

For example, with Claude Code (exact syntax checked when this ships):

```sh
claude mcp add --transport http hallway http://localhost:4255/mcp
# or, over stdio:
claude mcp add hallway -- hallway mcp
```

## Tools

| Tool | Input | Effect |
| --- | --- | --- |
| `get_status` | `{ filter? }` | Apps with state, URL and uptime; counts by state; how many observed |
| `list_apps` | `{ source?, state?, tag? }` | Apps with config and live state |
| `get_app` | `{ slug }` | Full detail, with identity and recent history |
| `declare_app` | `{ slug, name, port, description?, expected?, health?, tags?, links? }` | Write `apps/<slug>.yaml` (no `service:` block allowed) |
| `update_app` | `{ slug, patch, etag? }` | Patch any field except `service` and `port` |
| `remove_app` | `{ slug }` | Move the file to `backups/` (refused for managed services: use the CLI) |
| `list_observed` | `{}` | Observed listeners, with identity |
| `claim_observed` | `{ id, slug, name?, expected? }` | The same as **Claim** in the dashboard |
| `ignore_observed` | `{ id, by: 'port' \| 'process' \| 'dir' }` | Add to `ignore.yaml` |
| `list_bookmarks` | `{ group? }` | Groups and links |
| `upsert_bookmark_group` | `{ group, title?, order?, collapsed? }` | Create or update a group |
| `add_bookmark` | `{ group, title, url, description?, icon?, tags? }` | Add a link |
| `update_bookmark` | `{ group, url \| index, patch }` | Edit a link |
| `remove_bookmark` | `{ group, url \| index }` | Remove a link |
| `remove_bookmark_group` | `{ group }` | Move the group's file to `backups/` |
| `get_history` | `{ slug, window: '24h' \| '7d' \| '90d' }` | Uptime buckets and a latency summary |

Every write returns the written entity and its new ETag, and accepts an optional `etag` for optimistic concurrency:
if the file changed since you read it, the write fails and you re-read.

## Describe, never launch

Two data sets carry very different risks:

- **Bookmarks** are inert, so full create, update and delete is safe.
- **Apps** can be *described*: declared, edited, removed. But **no MCP tool starts, stops or installs a process.** A
  tool that registers "run this command" would be an arbitrary-code-execution surface for any agent that has the
  server configured.

So `run`, `start`, `stop`, `restart`, `service add` and `service rm`, `setup` and `teardown` are CLI-only, where you
(or an agent in your shell, under its own permission prompts) run them explicitly. Whether to allow restarting
services that were already installed through the CLI is an open question for v2.

## Security

The [localhost security rules](/guarantees/localhost-security/) apply to `/mcp` too: the `Host` and `Origin` must be
local, as MCP's own guidance for Streamable HTTP asks, to prevent DNS rebinding. There is no auth token, because
anything that can reach loopback as you can already edit the data home; that will be revisited if MCP ever gains
process control.
