---
title: apps/<slug>.yaml
description: The format of a declared app - one file per app, named after its slug.
---

Each declared app is one file, `~/.hallway/apps/<slug>.yaml`. **The filename is the slug.**

The slug becomes a hostname label in fronted mode, so it must be a valid DNS label: lowercase letters, digits and
hyphens, starting and ending with a letter or digit, at most 63 characters
(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`). The dashboard's own label (`hallway` by default), `www` and `api` are
reserved.

## Minimal

```yaml
name: Slides
port: 4321
```

## Everything

```yaml
name: Slides
description: Quarterly review deck
port: 4321                      # REQUIRED. The port the app actually listens on. Never auto-changed.
host: 127.0.0.1                 # the upstream host; default 127.0.0.1

expected: running               # running | stopped | adhoc
                                #  running: should always be up; not responding = "down"
                                #  stopped: intentionally off; shown calmly as "stopped"
                                #  adhoc:   up sometimes; not responding = "stopped", not "down"

health:                         # optional; without it, Hallway probes GET /
  path: /api/health
  expectStatus: 200             # optional; default: any 2xx when path is given

proxy:                          # fronted mode only (v1)
  preserveHost: false           # default false: Host is rewritten to the upstream
  aliases: []                   # extra hostnames, e.g. [deck] → deck.<base>

service:                        # optional. Present = Hallway keeps it alive (launchd / systemd).
  command: ["npx", "astro", "dev", "--port", "4321"]   # an argv array, resolved to absolute paths
  cwd: ~/Code/slides
  env: {}                       # PORT and HOST are set automatically
  runAtLoad: true
  keepAlive: true

links:                          # optional deep links shown on the card
  - { label: Speaker notes, path: /notes }

project:                        # optional; filled in automatically when claimed
  dir: ~/Code/slides
  repo: https://github.com/example/slides

tags: [decks]
icon: auto                      # auto (favicon) | an emoji | a path to an image in the data home | a URL
```

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | | Display name. |
| `description` | | One line, shown in the detail drawer. |
| `port` | **Yes** | The port the app listens on. Hallway [never changes it](/guarantees/ports/). |
| `host` | | The upstream host, default `127.0.0.1`. |
| `expected` | | `running`, `stopped` or `adhoc`: decides whether "not listening" is `down` or `stopped`. See [Health states](/concepts/health/#stopped-on-purpose-is-not-down). |
| `health.path` | | Probe this path instead of `/`. |
| `health.expectStatus` | | The status that means healthy; default any 2xx. |
| `proxy.preserveHost` | | Pass the browser's `Host` through instead of rewriting it. See [Host-header rewriting](/networking/fronted-mode/#host-header-rewriting). <span class="ms">v1</span> |
| `proxy.aliases` | | Extra hostnames for the app. <span class="ms">v1</span> |
| `service` | | Makes the app a [managed service](/concepts/services/#managed-services). <span class="ms ms--v0">v0</span> |
| `service.command` | With `service` | The command as an argv array, not a shell string. |
| `service.cwd` | | Working directory. |
| `service.env` | | Extra environment variables. `PORT`, `HOST` and `HOSTNAME` are set for you. |
| `service.runAtLoad`, `service.keepAlive` | | Start at login; restart if it exits. |
| `links` | | Deep links on the card: `label` and `path`. |
| `project.dir`, `project.repo` | | Where the code lives. |
| `tags` | | Free-form tags, for filtering. |
| `icon` | | `auto` uses the app's favicon. |

## Validation

Hallway validates before it writes (rejecting bad slugs, ports outside 1–65535 and unknown values) and validates what
it reads. Two declared apps on the same port is a **warning**, not an error, because one of them may be `stopped`.

A file that fails to parse or validate keeps its last good version on the dashboard, with the error on its card.
Fix the file and the error clears.

## Removing an app

Delete it from the dashboard, with `hallway app rm`, through the API or MCP: the file is **moved to
`backups/`, never deleted**, so a mistake (yours or an agent's) is recoverable. Deleting the file yourself works
too; the card disappears.
