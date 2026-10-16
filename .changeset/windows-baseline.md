---
"hallway": patch
---

Windows, best effort: the daemon, dashboard, health checks, bookmarks, MCP and the CLI's file commands now run natively on Windows (no administrator rights). The port scanner and `hallway run` / `hallway service` aren't available there yet and say so; `hallway setup` refuses, since fronted mode is out of scope on Windows. On every OS, `hallway run` now records `cwd: ~/…` with the same home directory it is later expanded with.
