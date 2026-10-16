---
"hallway": minor
---

Hallway for coding agents: an MCP server, and a hook that stops agents starting dev servers directly.

- **MCP at `/mcp`** on the daemon's own port (Streamable HTTP, the 2026-07-28 protocol, with older clients served
  too). Register it with `claude mcp add --transport http hallway http://localhost:4255/mcp`. Sixteen tools cover
  status, apps, observed listeners and bookmarks: `get_status`, `get_app`, `declare_app`, `update_app`,
  `claim_observed`, `add_bookmark` and the rest. Every write goes through the same code as the dashboard and the
  API, so the YAML keeps its comments, the dashboard updates live, and an optional `etag` guards against overwriting
  someone else's edit. The resources `hallway://state` and `hallway://apps/<slug>` announce changes.
- **MCP never runs anything.** No tool starts, stops or installs a process: a `service` block is refused, and so is
  changing an app's port. Starting servers stays with `hallway run` in the shell.
- **`hallway mcp`**: the same server over stdio, for clients that prefer it (`claude mcp add hallway -- hallway mcp`).
  It forwards to the running daemon and says how to start one if there isn't one.
- **`hallway hook check-command`**: an optional Claude Code `PreToolUse` hook for the Bash tool. When an agent tries
  `npm run dev`, `vite`, `astro dev`, `next dev`, `python -m http.server` and the like, it blocks the command and
  suggests the `hallway run` to use instead (`hallway run my-app -- vite --port '$PORT' --strictPort`); builds, tests
  and everything else pass. Hallway never installs it: `hallway guide` shows the `settings.json` entry.
- The localhost-only security applies to `/mcp` as to everything else: a foreign `Host` or `Origin` gets 403.
