---
title: config.yaml
description: Global settings for the data home - the daemon port, mode, domain, proxy, probing, services, scanning, thumbnails and the dashboard.
---

`~/.hallway/config.yaml` holds the global settings. Every key is optional; the values below are the defaults. It is
the only file with a `version`, so a future format change can be detected and migrated.

```yaml
version: 1

port: 4255                      # the daemon's port (it listens on 127.0.0.1 only)

mode: direct                    # direct | fronted   (`hallway setup` switches it to fronted)

domain:
  base: localhost               # apps are served at <slug>.<base>
  dashboard: hallway.localhost  # where the dashboard lives in fronted mode.
                                # Default: "hallway.localhost" when base is "localhost";
                                # the bare apex "<base>" for any custom domain.
  tls: true                     # kept for clarity; plain HTTP is proxy.scheme: http
  dnsPort: 4253                 # custom domains only: where Hallway's own dnsmasq answers

proxy:
  caddy: null                   # the Caddy binary; default: `caddy` on your PATH, else Homebrew's
  httpsPort: 4443               # the loopback port Caddy serves HTTPS on (as you)
  httpPort: 4480                # the loopback port Caddy serves HTTP on (a redirect to HTTPS)
  publicPort: 443               # the port in links (setup sets 4443/4480 on Linux for the user/none tiers)
  trust: null                   # user | system | none: the tier `hallway setup` set up (written by setup)
  scheme: https                 # https | http (the none tier)

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
  hints:
    localDomains: true          # the "Local domains" panel; Dismiss on the dashboard sets it false
```

## Keys

| Key | Default | Meaning |
| --- | --- | --- |
| `port` | `4255` | The daemon's port. `--port` and `$PORT` override it. Never 5000 or 7000 (macOS's AirPlay Receiver). |
| `version` | `1` | The data home's format. Always `1` for now; a file written by a newer Hallway is reported, not misread. |
| `mode` | `direct` | `direct` links to `http://localhost:<port>`; `fronted` serves apps through Caddy at `https://<slug>.<base>` (or as the tier says: `proxy.scheme`, `proxy.publicPort`). Set by `hallway setup` and `hallway teardown`, rather than by hand. See [modes](/concepts/modes/). <span class="ms ms--shipped">v1</span> |
| `domain.base` | `localhost` | Base domain for fronted mode. See [Custom domains](/networking/custom-domains/). <span class="ms ms--shipped">v1</span> |
| `domain.dashboard` | `hallway.localhost`, or `<base>` | The dashboard's hostname in fronted mode. Its first label is then a reserved slug. <span class="ms ms--shipped">v1</span> |
| `domain.tls` | `true` | Kept for clarity; whether links are HTTPS is `proxy.scheme`. <span class="ms ms--shipped">v1</span> |
| `domain.dnsPort` | `4253` | Custom domains only: the loopback port Hallway's own dnsmasq answers on; the resolver entry points at it. <span class="ms ms--shipped">v1</span> |
| `proxy.caddy` | `caddy` on your `PATH`, else Homebrew's | The Caddy binary (2.7 or later). <span class="ms ms--shipped">v1</span> |
| `proxy.httpsPort` | `4443` | The loopback port Caddy, running as you, serves HTTPS on. <span class="ms ms--shipped">v1</span> |
| `proxy.httpPort` | `4480` | The loopback port Caddy serves HTTP on: a redirect to HTTPS, or the apps themselves with `scheme: http`. <span class="ms ms--shipped">v1</span> |
| `proxy.publicPort` | `443` | The port in links: 443 (or 80 with `scheme: http`), which `hallway setup` hands to Caddy's ports. On Linux, setup sets it to `httpsPort` (No admin) or `httpPort` (No prompts), since nothing holds 443 or 80 there, and links then carry the port. See [Fronted mode](/networking/fronted-mode/#three-tiers). <span class="ms ms--shipped">v1</span> |
| `proxy.trust` | none | The [tier](/networking/fronted-mode/#three-tiers) `hallway setup` set up, written by setup: `user` trusts Hallway's certificate for your account only (no admin), `system` for every account (admin; custom domains need it), `none` serves plain HTTP. A setup from before the tiers counts as `system`. Change it by running `hallway setup --trust …`, not by hand. <span class="ms ms--shipped">v1</span> |
| `proxy.scheme` | `https` | The scheme in links. `http` is the `none` tier: Caddy serves plain HTTP and redirects nothing. Written by setup. <span class="ms ms--shipped">v1</span> |
| `probe.intervalSeconds` | `60` | Seconds between health probes (±10% jitter). |
| `probe.liveIntervalSeconds` | `15` | The interval while a dashboard is connected. |
| `probe.timeoutMs` | `5000` | An HTTP probe slower than this counts as unhealthy. |
| `probe.concurrency` | `8` | Probes in flight at once. |
| `probe.failuresBeforeUnhealthy` | `2` | Consecutive failures needed to leave `healthy`. |
| `ports.assignRange` | `[5100, 5999]` | Where new apps' ports come from. |
| `services.startGraceSeconds` | `30` | A service just started is `starting`, not `down`, for this long. Also how long "Lost at last reboot" waits for login services. <span class="ms ms--shipped">v1</span> |
| `services.logMaxBytes` | `10485760` | Rotate a service's log above this size (10 MB). <span class="ms ms--shipped">v1</span> |
| `services.logGenerations` | `3` | Rotated logs to keep. <span class="ms ms--shipped">v1</span> |
| `scan.enabled` | `true` | Turn the port scanner off entirely. |
| `scan.intervalSeconds` | `120` | Seconds between scans. |
| `scan.includeEphemeralPorts` | `false` | Also show listeners on 49152–65535. |
| `scan.minPort` | `1024` | Ignore ports below this. |
| `thumbnails.mode` | `favicon` | The pictures on the doors. `favicon`: the app's favicon (a monogram if it has none). `screenshot`: a picture of each healthy app, as the door's glass; run `hallway thumbs enable` first, which installs the browser and sets this. `card`: every door drawn as a generated card with its name, address, framework and `repo @ branch`. See [Thumbnails](/concepts/thumbnails/). <span class="ms ms--shipped">v2</span> |
| `dashboard.title` | hostname | The page title. |
| `dashboard.sections` | `[apps, observed, bookmarks]` | Which sections show, and in what order. |
| `dashboard.theme` | `auto` | `auto` follows the system; or force `dark` or `light`. |
| `dashboard.hints.localDomains` | `true` | The dashboard's "Local domains" panel, shown in direct mode (never on Windows). **Dismiss** sets it to `false` here, so it stays dismissed in every browser; the header's **Local domains** button brings it back. |

## Rules for every file

These hold for `config.yaml` and every other editable file in the data home:

- **Unknown keys are preserved** when Hallway writes a file, and reported as warnings. They are never deleted.
- **Comments and key order are preserved** on round-trip edits wherever possible.
- **An invalid file never crashes the daemon.** Hallway keeps the last good version in memory, shows the error (file,
  line and message) in the dashboard, and keeps serving everything else. It never overwrites a file you broke.
