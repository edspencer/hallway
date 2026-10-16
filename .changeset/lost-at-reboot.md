---
"hallway": minor
---

Lost at last reboot: after the machine restarts, Hallway lists the servers that were running before it and didn't come back.

- **A banner at the top of the dashboard**: "Lost at last reboot (Mon 28 Sep 20:05): 6 apps". **Review** lists each one with where it ran from (`~/Code/my-app @ main`) and the command that started it.
- **Restart once** starts it again the way `hallway run` does: on the port it had, owned by launchd or systemd rather than anyone's session. **Make it a service** also starts it at login and restarts it if it exits. **Dismiss** takes one off the list, or clears the whole notice. A server that wasn't an app yet becomes one (`apps/<slug>.yaml`) with the command and directory Hallway recorded while it was running.
- Only what was running at the end of the last boot is listed: a server you stopped the day before isn't blamed on the reboot. Services that start at login get their start-up grace period before anything is called lost. Whatever comes back is marked **back** until you dismiss it.
- The notice is kept in `state/lost.json`, so it survives Hallway restarting, until you dismiss it.
- **`hallway lost`** lists the same from a terminal; `hallway lost restart <id>`, `hallway lost service <id>` and `hallway lost dismiss <id>` (or `--all`) act on it. It's in `/api/state` (`lost`), `GET /api/lost`, `llms.txt` and MCP's `get_status` too; MCP can read it but not restart anything.
- A service the daemon starts (from the dashboard, or one of these actions) now shows `◐ starting` while it comes up, instead of `down`.
