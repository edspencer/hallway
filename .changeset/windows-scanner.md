---
"hallway": minor
---

Windows: the port scanner. Hallway now finds the web servers listening on a Windows machine, with each one's working directory (read without administrator rights), project, git branch and command line, so the observed tray, Claim and `hallway scan` / `claim` work there. A process whose directory can't be read (elevated, another user's, or 32-bit) shows its command line instead, on every OS.
