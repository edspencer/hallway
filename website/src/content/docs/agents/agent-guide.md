---
title: Agent guide and llms.txt
description: The guide Hallway prints for agents, the snippet for your instruction files, and the optional hook.
---

## The agent guide

<span class="ms ms--v0">v0</span> Hallway ships an agent guide, available three ways:

```sh
hallway guide                           # print it
curl http://localhost:4255/agent-guide.md
curl http://localhost:4255/llms.txt     # a summary; /llms-full.txt has everything
```

Like Local Review's, it is rendered with **live context**: the daemon's version and URL, the data home path, the mode
(direct or fronted) and base domain, and the slugs of the apps and bookmark groups that exist right now.

What it covers:

1. What Hallway is, in two sentences.
2. **The rule: never start a long-running server directly.** Use `hallway run <slug> -- <command>`, and why, with the
   framework flags.
3. How to register an existing server: the minimal `apps/<slug>.yaml`, or `hallway app add`.
4. How to add bookmarks.
5. How to check status: `hallway status --json` or `GET /api/state`, including what was lost at the last reboot.
6. The HTTP API, the MCP server and the optional hook, and that `hallway setup` and `teardown` are the user's to run
   (they install jobs, change certificate trust and may need sudo or a password dialog).
7. The file formats, generated from the same schema the validator uses, so the guide can't drift from the code.
8. [Etiquette](/agents/overview/#etiquette-for-agents): never change a port, never delete outside `apps/` and
   `bookmarks/`, prefer `adhoc` for throwaway servers, leave machine-written directories alone.

## The snippet for your instruction files

<span class="ms ms--v0">v0</span> Agents follow what their instruction files tell them. `hallway guide --snippet` prints this, for your `AGENTS.md`,
`CLAUDE.md` or equivalent:

> Never start a long-running dev or preview server directly (`npm run dev`, `vite`, `astro dev`, `next dev`,
> `python -m http.server`, …). Start it with `hallway run <slug> -- <command>`, which keeps it running outside this
> session on a stable port and prints its URL. Run `hallway guide` for details.

## The optional hook

<span class="ms ms--shipped">v2</span> For Claude Code, `hallway hook check-command` is a `PreToolUse` hook on its Bash tool. It
reads the hook's payload from stdin and, if the command starts a dev server directly, denies it with a message giving
the equivalent `hallway run` invocation. It is documented, never installed automatically: see
[The dev-server hook](/agents/hook/) for what it catches and how to add it.

## This site's llms.txt

This documentation site has its own [llms.txt](/llms.txt) and [llms-full.txt](/llms-full.txt), and every page is
available as Markdown at its URL with `.md` instead of the trailing slash (this page is
[/agents/agent-guide.md](/agents/agent-guide.md)).
