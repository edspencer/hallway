---
title: The dev-server hook
description: "An optional Claude Code hook that stops an agent starting a dev server directly, and tells it the hallway run command to use instead."
---

<span class="ms ms--shipped">v2</span> Available since 0.2.0. Instruction files help, but agents still
reach for `npm run dev` out of habit, and every server started that way dies with the session. `hallway hook
check-command` is an optional Claude Code `PreToolUse` hook for
the Bash tool that catches those commands **before they run** and tells the agent the
[`hallway run`](/agents/hallway-run/) equivalent.

It is never installed automatically: you add it, and you can remove it.

## What it does

The hook reads Claude Code's payload on stdin. If the command starts a dev or preview server directly, it prints
Claude Code's JSON decision, a `deny` with a reason (`hookSpecificOutput.permissionDecision: "deny"`), and exits 0.
The agent sees the reason and can rerun the server the right way. Anything else gets no output, and the command runs
as normal.

It recognises the common dev-server commands, including `npm run dev`, `npm start`, `pnpm dev`, `yarn dev`,
`bun run dev`, `vite`, `astro dev`, `next dev`, `nuxi dev`, `ng serve`, `python -m http.server`,
`manage.py runserver`, `uvicorn`, `flask run`, `php -S`, `hugo server`, `jekyll serve` and `npx serve`. It still
finds them behind `cd dir &&`, `nohup … &`, environment assignments, and `npx`, `pnpm exec` or `uv run`.

| Command | Decision |
| --- | --- |
| `npm run dev` | Blocked: `hallway run my-app -- npm run dev` |
| `cd web && pnpm dev` | Blocked: `hallway run my-app -- pnpm dev` |
| `astro dev --port 4321` | Blocked: `hallway run my-app -- astro dev --port '$PORT'` |
| `PORT=3000 npx next dev` | Blocked: `hallway run my-app -- npx next dev -p '$PORT'` |
| `nohup python -m http.server 8000 &` | Blocked: `hallway run my-app -- python -m http.server '$PORT'` |
| `npm run build`, `npm test`, `npm install` | Allowed |
| `vite --help` | Allowed |
| `echo "npm run dev"` | Allowed (a mention inside a string or comment) |
| `hallway run my-app -- vite --port '$PORT'` | Allowed |

The suggested slug comes from the name of the working directory (here, `~/Code/my-app`), and a fixed port such as
`--port 3000` becomes `'$PORT'`, so the server listens on the port Hallway assigns. Anything the hook can't parse is
let through: it would rather miss a server than block a command it doesn't understand.

### The message the agent sees

For `vite --port 3000`, run in `~/Code/my-app`:

```text
Hallway: don't start a Vite dev server directly (`vite --port 3000`): it would die with this session and land on a port nobody can find.
Run it with Hallway instead, which keeps it running outside this session on a stable port and prints its URL:

    hallway run my-app -- vite --port '$PORT'

`hallway run my-app` again restarts it; `hallway status` lists what's running; `hallway logs my-app` shows its output.
```

When the command has no port flag for Hallway to rewrite, the message also says that the server must listen on
`$PORT`, and how to pass it.

## Installing it

Add this to `.claude/settings.json` in a project, for that project only, or to `~/.claude/settings.json`, for every
project:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "hallway hook check-command" }]
      }
    ]
  }
}
```

If the file already has a `hooks` section, add the entry to its `PreToolUse` list rather than replacing it. The
`hallway` binary must be on the `PATH` Claude Code runs hooks with.

## Removing it

Delete the entry from the settings file. Nothing else was installed, so there is nothing else to undo.

## Known false positives

`npm start` (and `yarn start`, and the like) is blocked even in a package whose `start` script isn't a server, since
the hook only sees the command, not the script. The agent can ask you to run it, or you can run it yourself.
