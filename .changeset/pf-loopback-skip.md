---
"hallway": patch
---

macOS fronted mode: when another tool has told pf to skip loopback (`set skip on lo0`), which leaves Hallway's 443/80 redirect installed but ignored, `hallway doctor` now says so (naming what enabled pf) with the fix, and `hallway setup` clears it with a printed sudo step (loading macOS's own `/etc/pf.conf` again, then the redirect) when that can't drop anyone else's rules. Setup's final check reports that cause instead of "nothing answered". Also quieter setup output: `brew install` runs without Homebrew's auto-update, cleanup and hints, and the expected "Boot-out failed: 3: No such process" from the first `launchctl bootout` is no longer shown.
