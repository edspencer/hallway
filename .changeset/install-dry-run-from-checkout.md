---
"hallway": minor
---

`hallway service install --dry-run` prints the service file it would write (the systemd unit, the LaunchAgent, or the scheduled task's job) and writes nothing, not even the data home; with `--json` it's one document with `dryRun: true` and the `unit` text.

`hallway service install` now refuses to run from a source checkout (a git clone or an `npm link`, rather than an installed package), because the service would run whatever the checkout last built. **A script that installed the service from a checkout now gets exit 1 with a message saying so; add `--from-checkout` to keep doing it on purpose.** `service install --refresh` (and so `hallway update`) keeps a service that already runs a checkout.

On Linux, `hallway service install` checks lingering and, only when it's off, prints `sudo loginctl enable-linger <user>` to run once (it never runs sudo itself).
