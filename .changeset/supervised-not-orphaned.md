---
"hallway": patch
---

A listener that launchd or systemd runs (a LaunchAgent, a `brew services` job, a systemd service) is no longer flagged
orphaned: Hallway shows what supervises it instead (`launchd: <label>`, `systemd: <unit>`) in the dashboard,
`hallway scan` and `--json`. A server started in `/`, your home directory or a package-manager prefix such as
`/opt/homebrew` is no longer named after that directory's git repository: it's named by its supervisor or executable.
The `exposed` and `orphaned` badges now explain themselves in a tooltip, and the drawer says which address it's bound
to.
