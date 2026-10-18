---
"hallway": minor
---

Local domains, simpler to choose. The tiers have clearer names: **User certificate** (`--trust user`), **System-wide certificate** (`--trust system`) and **No HTTPS** (`--trust none`); the flags and `proxy.trust` values are unchanged. User certificate is now always the recommended tier, on macOS and Linux, admin or not: it never needs an administrator and the dashboard can turn it on. System-wide certificate is for custom domains, other accounts and tools that read only the system's certificates. The dashboard's Local domains panel and dialog are now a settings-style list: User certificate chosen and open with its address, what will ask and **Turn on**; the other two a line each until chosen. Turn on shows "Waiting for Touch ID…" on a Mac, the reason and the command to run instead if it stops, and the new address when it's done.
