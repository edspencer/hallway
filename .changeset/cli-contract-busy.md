---
"hallway": minor
---

The CLI contract's busy check, and `serve`'s first line.

- **`serve`'s first line on stdout is now `Hallway <version>: <url>`**, for example `Hallway 0.12.0: http://localhost:4255`. It used to be `Hallway on <url>`. **If a script waits for `Hallway on`, change it to match the new line.** `Data home: …` still comes straight after it, and `--quiet` still prints only that first line. On a terminal the HALLWAY banner now goes to stderr, just before it, so it looks the same as before.
- **`hallway busy [--json]`** asks the running daemon whether it's busy: setting up local domains from the dashboard, or starting, stopping or restarting an app. It exits 0 if not, 75 if it is, and 3 if nothing is running. The daemon answers it at `GET /api/busy`, with counts only.
- **`hallway service stop` and `service restart` now refuse with exit 75 while the daemon is busy**, and say what it's doing. Add `--force` to go ahead anyway: it prints the same reason, prefixed `Overriding:`.
- The daemon now writes `~/.hallway/runtime.json` (its pid, port, URL and version) in place of `state/daemon.json`.
- On macOS, stopping a service now waits until launchd has finished unloading it. This stops a `restart` straight after from failing with `Input/output error` (error 5).
