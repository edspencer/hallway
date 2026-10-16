# 06 — Agent interface

## Files first, MCP second (D7)

The author's sibling project Local Review has **no MCP server at all**. Its agent interface is:

- plain YAML files in a documented data home, which agents read and edit directly;
- a file watcher that turns any edit into an SSE push, so the UI updates live;
- an agent guide (`AGENT-GUIDE.md`, printed by `local-review guide`) and `/llms.txt`, `/llms-full.txt`,
  `/agent-guide.md` endpoints that include live data (version, data-home path, current projects).

That pattern works with every agent, needs no configuration, and makes a hand edit in a text editor behave exactly
like an agent write. Hallway adopts it as the **primary** interface. MCP (v2) is a typed convenience layer
over the *same* write module — never a separate code path, and never the only way to do something.

## Agent guide

Ship `AGENT-GUIDE.md` in the package (implemented: `server/guide.ts`). Expose it as `hallway guide`,
`GET /agent-guide.md`, and summarised in `GET /llms.txt` / `GET /llms-full.txt`. Like Local Review, render live context into it: daemon version and URL, data
home path, mode (direct/fronted) and base domain, and the current app and bookmark-group slugs.

Contents (outline):

1. What Hallway is, in two sentences.
2. **Rule: never start a long-running server directly.** Use `hallway run <slug> -- <command>` (v1). Explain why: the
   server is then owned by launchd, not your session; it gets a stable port and a URL; the user can find it later.
   Include framework flag hints (`vite --port $PORT --strictPort`, `astro dev --port $PORT`, `next dev -p $PORT`).
3. How to register an existing server: write `apps/<slug>.yaml` (show the minimal file: `name`, `port`) or
   `hallway app add`.
4. How to add bookmarks: write/edit `bookmarks/<group>.yaml`.
5. How to check status: `hallway status --json` or `GET /api/state`.
6. File-format reference (generated from the same schema the validator uses, so it cannot drift).
7. Etiquette: never change an existing app's `port`; never delete files outside `apps/` and `bookmarks/`; prefer
   `expected: adhoc` for throwaway servers; do not touch `state/`, `cache/`, `generated/`.

## Changing agent habits

The tooling cannot fix the habit on its own: agents will keep running `npm run dev` unless told otherwise. Provide:

- **A snippet for users' agent instruction files** (`CLAUDE.md`, `AGENTS.md`, etc.), printed by
  `hallway guide --snippet`:
  > Never start a long-running dev or preview server directly (`npm run dev`, `vite`, `astro dev`, `next dev`,
  > `python -m http.server`, …). Start it with `hallway run <slug> -- <command>`, which keeps it running outside this
  > session on a stable port and prints its URL. Run `hallway guide` for details.
- **An optional pre-tool-use hook** for agents that support them (e.g. Claude Code's `PreToolUse` hook on the `Bash`
  tool): `hallway hook check-command` reads the hook payload from stdin, and if the command looks like a bare dev-server
  start, blocks it with a message suggesting the equivalent `hallway run` invocation. Document how to install it; never
  install it automatically. Built (D51): it prints Claude Code's `permissionDecision: "deny"` JSON; the payload
  format and convention are recorded in `11-research-notes.md`.

## MCP server (v2, D8; built: D50–D53)

### Transport and hosting

- **Same process and port as the dashboard**, mounted at `/mcp`, using MCP's Streamable HTTP transport. One service,
  one launchd job, one port to remember; and it shares the write module and file watcher, so an MCP write lights up
  every open dashboard for free.
- **`hallway mcp`**: a stdio MCP server for clients that prefer stdio. It is a thin bridge that forwards to the daemon's
  HTTP API (so there is one writer), and fails with a clear message if the daemon is not running.
- The security middleware applies to `/mcp` too: Host and Origin must be local (the MCP Streamable HTTP guidance
  itself calls for Origin validation to prevent DNS rebinding). JSON-RPC requests are `application/json`, so they
  already satisfy the content-type rule.
- No auth token (anything that can reach loopback as this user can already edit the data home): D52.

Client registration (Claude Code's syntax; other clients take the URL `http://localhost:4255/mcp`, Streamable HTTP):

```sh
claude mcp add --transport http hallway http://localhost:4255/mcp
# or, stdio:
claude mcp add hallway -- hallway mcp
```

### Tools

Two data sets, very different risk:

- **Bookmarks** are inert — full CRUD is safe.
- **Apps** can be *described* via MCP (D10). Nothing in MCP v1 starts, stops or installs a process, because a tool
  that registers "run this command" is an arbitrary-code-execution surface reachable by any agent with the MCP
  configured.

| Tool | Input | Effect |
|------|-------|--------|
| `get_status` | `{ filter?: string }` | Apps with state, URL, uptime %; counts by state; observed count |
| `list_apps` | `{ source?, state?, tag? }` | Apps with config + live state |
| `get_app` | `{ slug }` | Full detail incl. identity and recent history summary |
| `declare_app` | `{ slug, name?, port, description?, host?, expected?, health?, tags?, links?, icon? }` | Create `apps/<slug>.yaml` (create only; no `service:` block allowed) |
| `update_app` | `{ slug, patch, etag? }` | Merge-patch fields except `service` and `port` (refused; see `04`) |
| `remove_app` | `{ slug, etag? }` | Move the file to `backups/removed/` (refused for managed services — use the CLI) |
| `list_observed` | `{}` | Observed listeners with identity |
| `claim_observed` | `{ id, slug, name?, expected? }` | Same as the UI's Claim |
| `ignore_observed` | `{ id, by: 'port'\|'process'\|'dir' }` | Append to `ignore.yaml` |
| `list_bookmarks` | `{ group? }` | Groups and links |
| `upsert_bookmark_group` | `{ group, title?, order?, collapsed?, etag? }` | Create/update a group file |
| `add_bookmark` | `{ group, url, title?, description?, icon?, tags?, etag? }` | Append a link |
| `update_bookmark` | `{ group, url \| index, patch, etag? }` | Merge-patch a link in place |
| `remove_bookmark` | `{ group, url \| index, etag? }` | Remove a link |
| `remove_bookmark_group` | `{ group, etag? }` | Move the group file to `backups/removed/` |
| `get_history` | `{ slug, window: '24h'\|'7d'\|'90d' }` | Uptime buckets + latency summary |

Every write tool returns the written entity and its new ETag, and accepts an optional `etag` for optimistic
concurrency (409-equivalent error on mismatch).

Resources `hallway://state` and `hallway://apps/<slug>` are exposed too, with change notifications driven by the same
event bus (2026-era clients, on a `subscriptions/listen` stream: D50).

**Deliberately excluded from MCP:** `run`, `start`, `stop`, `restart`, `service add/remove`, `setup`, `teardown`.
A middle ground — allowing `restart_app` only for services *already* installed via the CLI — was considered and
rejected (D53): a restart starts a process, and the YAML it would run is agent-writable.
