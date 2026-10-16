---
title: config.yaml
description: Global settings for the data home - the daemon port, mode, domain, probing, scanning and the dashboard.
---

`~/.hallway/config.yaml` holds the global settings. Every key is optional; the values below are the defaults. It is
the only file with a `version`, so a future format change can be detected and migrated.

```yaml
version: 1

port: 4255                      # the daemon's port (it listens on 127.0.0.1 only)

mode: direct                    # direct | fronted   (fronted needs `hallway setup`, v1)

domain:
  base: localhost               # apps are served at <slug>.<base>
  dashboard: hallway.localhost  # where the dashboard lives in fronted mode.
                                # Default: "hallway.<base>" when base is "localhost";
                                # the bare apex "<base>" for any custom domain.
  tls: true                     # fronted mode is always HTTPS; kept explicit for clarity

probe:
  intervalSeconds: 60
  liveIntervalSeconds: 15       # used while at least one dashboard is open
  timeoutMs: 5000
  concurrency: 8
  failuresBeforeUnhealthy: 2    # flap damping

ports:
  assignRange: [5100, 5999]     # for new apps with no port yet; existing ports are never changed

services:
  startGraceSeconds: 30         # "starting" before "not listening" counts as down
  logMaxBytes: 10485760         # rotate managed-service logs above this size
  logGenerations: 3

scan:
  enabled: true
  intervalSeconds: 120
  includeEphemeralPorts: false  # skip 49152–65535 by default (IDE and tool helpers live there)
  minPort: 1024

thumbnails:
  mode: favicon                 # favicon | screenshot (after `hallway thumbs enable`) | card

dashboard:
  title: null                   # defaults to the machine's hostname
  sections: [apps, observed, bookmarks]   # order and presence; remove one to hide it
  theme: auto                   # auto | dark | light
```

## Keys

| Key | Default | Meaning |
| --- | --- | --- |
| `port` | `4255` | The daemon's port. `--port` and `$PORT` override it. Never 5000 or 7000 (macOS's AirPlay Receiver). |
| `mode` | `direct` | `direct` links to `http://localhost:<port>`; `fronted` serves apps through Caddy. See [modes](/concepts/modes/). <span class="ms">v1</span> |
| `domain.base` | `localhost` | Base domain for fronted mode. See [Custom domains](/networking/custom-domains/). <span class="ms">v1</span> |
| `domain.dashboard` | `hallway.localhost` | The dashboard's hostname in fronted mode. <span class="ms">v1</span> |
| `probe.intervalSeconds` | `60` | Seconds between health probes (±10% jitter). |
| `probe.liveIntervalSeconds` | `15` | The interval while a dashboard is connected. |
| `probe.timeoutMs` | `5000` | An HTTP probe slower than this counts as unhealthy. |
| `probe.concurrency` | `8` | Probes in flight at once. |
| `probe.failuresBeforeUnhealthy` | `2` | Consecutive failures needed to leave `healthy`. |
| `ports.assignRange` | `[5100, 5999]` | Where new apps' ports come from. |
| `services.*` | | Grace period and log rotation for managed services. <span class="ms ms--v0">v0</span> |
| `scan.enabled` | `true` | Turn the port scanner off entirely. |
| `scan.intervalSeconds` | `120` | Seconds between scans. |
| `scan.includeEphemeralPorts` | `false` | Also show listeners on 49152–65535. |
| `scan.minPort` | `1024` | Ignore ports below this. |
| `thumbnails.mode` | `favicon` | The pictures on the doors. `favicon`: the app's favicon (a monogram if it has none). `screenshot`: a picture of each healthy app, as the door's glass; run `hallway thumbs enable` first, which installs the browser. `card`: every door drawn as a generated card with its name, address, framework and `repo @ branch`. |
| `dashboard.title` | hostname | The page title. |
| `dashboard.sections` | `[apps, observed, bookmarks]` | Which sections show, and in what order. |
| `dashboard.theme` | `auto` | `auto` follows the system; or force `dark` or `light`. |

## Rules for every file

These hold for `config.yaml` and every other editable file in the data home:

- **Unknown keys are preserved** when Hallway writes a file, and reported as warnings. They are never deleted.
- **Comments and key order are preserved** on round-trip edits wherever possible.
- **An invalid file never crashes the daemon.** Hallway keeps the last good version in memory, shows the error (file,
  line and message) in the dashboard, and keeps serving everything else. It never overwrites a file you broke.
