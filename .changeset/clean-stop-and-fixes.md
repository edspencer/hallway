---
"hallway": patch
---

`hallway serve` (and so the daemon's service) now stops cleanly on SIGTERM and Ctrl-C, and on Windows when the service is stopped: it takes no new requests, lets an app start, stop or restart and a local-domains setup that's under way finish (up to 10 seconds), removes `runtime.json` and exits 0. Before, a stop cut that work off wherever it was.

A first `hallway service install` (or an app's first `service add` or `run`) that the service manager refuses no longer leaves its unit or plist behind, so `service status` says "not installed" (exit 4) rather than "installed but not running". A reinstall keeps the job that's there.

`hallway doctor`: fails the `unit` check, with a fix, when the Hallway the daemon's service runs has been removed; reports the port as free (or Hallway's) rather than saying nothing; prints `sudo loginctl enable-linger <user>` for lingering; and gives a fix when the service manager can't be asked.
