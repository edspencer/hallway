---
title: hallway run
description: The one command agents should use to start a dev server, so it never becomes an orphan.
---

<span class="ms">v1</span> `hallway run` replaces the ad-hoc `npm run dev` that leaves orphaned servers behind.

```sh
hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name "Display name"] -- <command...>
```

For example:

```sh
hallway run slides -- npx astro dev --port $PORT
hallway run docs --persist -- npx vite --port $PORT --strictPort
```

Hallway sets `PORT` to the app's port in the server's environment.

:::note[Detail to settle]
Written unquoted as above, `$PORT` would be expanded by your own shell before Hallway sees it. Exactly how the port
reaches the command line (quoting `'$PORT'`, or Hallway substituting it) is decided during v1; the examples follow
the spec for now.
:::

## What it does

1. **Registers the app.** It creates or updates `apps/<slug>.yaml` with the command, the working directory (default:
   where you ran it) and the port: the app's existing port if it has one, the one you pinned with `--port`, or else a
   stable one assigned from 5100–5999. The app is `expected: adhoc`, or `running` with `--persist`.
2. **Hands the server to launchd**, so it is owned by launchd, **not by your session**, and survives the session
   ending.
   - Without `--persist`, it won't come back after a reboot, but it stays on the dashboard as `stopped` with a
     one-click restart, and appears under [Lost at last reboot](/concepts/services/#lost-at-last-reboot).
   - With `--persist`, it is a full service that starts at login and restarts if it crashes.
3. **Waits until the port is listening** (up to 30 seconds), then **prints the URL and the log path, and exits 0**.
   If the server doesn't come up, it prints the last 30 lines of its log and exits 1.

Because it returns promptly and prints the URL, an agent can run it inside a tool call without hanging.

Run it again with no command to reuse the recorded one:

```sh
hallway run slides
```

Companions:

```sh
hallway stop slides
hallway restart slides
hallway logs slides --follow
```

## Framework flags

Hallway sets `PORT` and `HOST=127.0.0.1` in the server's environment. Frameworks that don't read `PORT` need a flag:

| Framework | Command |
| --- | --- |
| Vite | `npx vite --port $PORT --strictPort` |
| Astro | `npx astro dev --port $PORT` |
| Next.js | `npx next dev -p $PORT` |

Always pass `--strictPort` to Vite. Without it, Vite quietly takes another port when its own is busy, and the app
moves away from the URL Hallway printed.

## Why launchd, and why not PM2

launchd is how macOS itself keeps things running, and it is reliable across reboots. A second process manager (PM2,
or the `pm` wrapper this command succeeds) would be one more supervisor on top of launchd, with its own history of
boot-integration problems. See [Services and reboots](/concepts/services/).

## Why it's CLI-only

`hallway run` executes a command. That is safe in your shell, or in an agent's shell under that agent's own
permission prompts. It is deliberately **not** available over [MCP](/agents/mcp/), where any agent with the server
configured could use it to run arbitrary code.
