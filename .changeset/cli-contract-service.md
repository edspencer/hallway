---
"hallway": minor
---

The daemon's service commands follow the CLI contract shared by the author's local tools (D74):

- **New: `hallway service start` and `hallway service stop`.** `stop` stops the daemon until `hallway service start`
  or your next login or boot, whichever comes first, the way `systemctl --user stop` and `launchctl bootout` do. It
  doesn't disable the service: use `hallway service uninstall` to keep Hallway off. Stopping an app with
  `hallway stop <slug>` is unchanged and still lasts across logins.
- **New: `hallway service logs [-n N] [-f]`**, the daemon's logs. `hallway logs daemon` still works, and `-n` is now
  short for `--lines` everywhere.
- **Changed exit codes, if a script checks them:** `hallway service status` now exits **3** when the service is
  installed but not running (or the dashboard doesn't answer) and **4** when it isn't installed; it used to exit 0
  either way. `service start`, `stop`, `restart` and `logs` exit 4 when there's no service to act on (`restart` used
  to exit 1). With no unit file, `service status` exits 4 even where systemd's user instance can't be reached.
- **`--json`** on `service install`, `uninstall`, `start`, `stop` and `restart`: one JSON document on stdout, with
  what `service status --json` reports. `service status --json` adds `installedVersion`, `runningVersion`, `port`,
  `unit`, `log`, `logs` and `warnings`.
- **`--data-dir <dir>`** on every command: the data home for that run. `$HALLWAY_HOME` works as before.
