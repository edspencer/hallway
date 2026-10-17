---
"hallway": minor
---

`hallway setup` and `hallway teardown` now ask before they change anything: they print the plan (what `--print` shows), say what will ask for what (sudo's password in the terminal and, on macOS, a separate Touch ID or password dialog for certificate trust settings), and ask `Continue? [y/N]`, defaulting to no. `--yes` skips the question; with no terminal and no `--yes` they refuse with a usage error (exit 2) before doing anything.
