---
"hallway": minor
---

Windows: managed services. `hallway service install` and `hallway run` now work on Windows. The daemon and each managed app become a per-user scheduled task that starts when you log on and runs `hallway supervise`, which writes the job's logs and restarts it when it exits. No administrator rights are needed. Commands are looked up the way cmd.exe does (`PATHEXT`), so `vite` finds `vite.cmd`.
