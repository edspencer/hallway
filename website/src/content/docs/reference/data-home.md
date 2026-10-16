---
title: The data home
description: Where Hallway keeps everything - which files are yours to edit and which are machine-written.
---

Everything Hallway knows lives in one directory, the **data home**: `~/.hallway`, or wherever `$HALLWAY_HOME`
points. The override is optional: with an empty environment (as launchd jobs and many agent shells have), the default
just works.

```text
~/.hallway/
  config.yaml                 # global settings                          (yours to edit)
  apps/
    <slug>.yaml               # one declared app per file                (yours to edit)
  bookmarks/
    <group-slug>.yaml         # one bookmark group per file              (yours to edit)
  ignore.yaml                 # observed listeners you chose to hide     (yours to edit)

  state/                      # machine-written; never hand-edit
    daemon.json               # the running daemon's port, so the CLI can find it
    health.sqlite             # probe samples and hourly rollups
    observed.json             # last-known identity of every observed listener, first and last seen
    boot.json                 # the last boot time seen, to detect reboots
    lost.json                 # what the last reboot took down, until dismissed
    caddy/                    # fronted mode: Caddy's admin socket (admin.sock, mode 0600),
                              #   its local certificate authority and certificates (data/)
  cache/                      # machine-written; regenerable
    favicons/                 # apps' and bookmarks' favicons
    thumbs/<slug>.png, .json  # screenshots (after `hallway thumbs enable`)
    browser/                  # the headless browser screenshots use (about 300 MB)
    iana-tlds.txt             # IANA's TLD list, for custom-domain checks (a week)
  generated/                  # machine-written; regenerable
    caddy.json                # the configuration Caddy runs from (fronted mode)
    fallback.html             # the page Caddy serves when the daemon is down
    dnsmasq.conf              # custom domains only
    setup/                    # files `hallway setup` stages before installing them with sudo
  logs/
    daemon.out.log, daemon.err.log
    <slug>.out.log, <slug>.err.log   # managed services
  backups/
    <ISO-timestamp>/          # snapshots of the editable files
    removed/                  # files removed through Hallway
```

## Yours, and Hallway's

**What you edit and what Hallway writes are separated by directory.** Everything outside `state/`, `cache/`,
`generated/`, `logs/` and `backups/` is meant for people and agents to edit. The machine-written files are
deliberately not YAML, so nobody is tempted to edit them.

The formats: [config.yaml](/reference/config-yaml/), [apps/&lt;slug&gt;.yaml](/reference/app-yaml/),
[bookmarks and ignore.yaml](/reference/bookmarks-yaml/).

## One file per thing

Each app and each bookmark group is its own file. Agents writing at the same time touch different files, diffs stay
small, and a broken file breaks one card, not everything. (Local Review stores its projects the same way, for the
same reasons.)

## How writes happen

- **Atomically**: a temporary file, then a rename. The watcher ignores the temporary files.
- **Validated first**: bad slugs, out-of-range ports and unknown values are rejected before anything is written.
- **Safely concurrent**: API and MCP writes can send the ETag they read; if the file changed in between, the write is
  refused and the caller re-reads.
- **Live**: a change from anywhere (your editor, an agent, the CLI, the API) reaches every open dashboard within about
  a second.
- **Never destructive**: removing an app or a bookmark group moves its file into `backups/removed/`. Hallway also
  snapshots the editable files into `backups/` when the daemon starts, hourly while it runs (if anything changed), and
  before anything destructive.

Deleting `state/` loses history (uptime, what was observed, the lost-at-reboot notice) but nothing you wrote. In
fronted mode, though, `state/caddy/` holds the certificate authority your system trusts: delete it and you need
`hallway setup` again.

## Keeping it in git

The data home can be a git repository if you want history, or to share bookmarks across machines through your
dotfiles. Hallway generates a `.gitignore` inside it that excludes `state/`, `cache/`, `generated/`, `logs/` and
`backups/`.

## Outside the data home

Hallway writes nowhere else, except:

- <span class="ms ms--v0">v0</span> the daemon's service definition, when you run `hallway service install`:
  `~/Library/LaunchAgents/hallway.daemon.plist` on macOS, `~/.config/systemd/user/hallway-daemon.service` on Linux;
- <span class="ms ms--shipped">v1</span> one per managed service: `~/Library/LaunchAgents/hallway.app.<slug>.plist`
  on macOS, `~/.config/systemd/user/hallway-app-<slug>.service` on Linux;
- <span class="ms ms--shipped">v1</span> during `hallway setup` only: the user-level Caddy (and dnsmasq) jobs, and the
  privileged pieces it prints and runs through `sudo`: the 443/80 redirect, the trusted root certificate and, for a
  custom domain, the resolver entry. The full list is in
  [Setup](/networking/setup-and-doctor/#what-it-changes-outside-the-data-home); `hallway teardown` removes them.
- <span class="ms ms--shipped">v2</span> npm's own download cache (usually `~/.npm`), which the `npm install` behind
  `hallway thumbs enable` passes through. The browser itself goes into `cache/browser/`.
