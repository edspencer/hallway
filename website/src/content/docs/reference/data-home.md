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

  state/                      # machine-written; never hand-edit; safe to delete
    health.sqlite             # probe samples and rollups
    observed.json             # last-known identity of every observed listener, first and last seen
    boot.json                 # the last boot time seen, to detect reboots
  cache/                      # machine-written; regenerable
    thumbs/<slug>.<hash>.png
    favicons/<slug>.<hash>.<ext>
  generated/                  # machine-written; regenerable
    caddy.json                # the last config pushed to Caddy (v1)
  logs/
    daemon.out.log, daemon.err.log
    <slug>.out.log, <slug>.err.log   # managed services (v1)
  backups/
    <ISO-timestamp>/          # snapshots of the editable files
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
- **Never destructive**: removing an app or a bookmark group moves its file into `backups/`. Hallway also snapshots
  the editable files into `backups/` on a schedule and before anything destructive.

## Keeping it in git

The data home can be a git repository if you want history, or to share bookmarks across machines through your
dotfiles. Hallway generates a `.gitignore` inside it that excludes `state/`, `cache/`, `generated/`, `logs/` and
`backups/`.

## Outside the data home

Hallway writes nowhere else, except:

- <span class="ms ms--v0">v0</span> `~/Library/LaunchAgents/hallway.daemon.plist`, when you run
  `hallway service install`;
- <span class="ms">v1</span> `~/Library/LaunchAgents/hallway.app.<slug>.plist` for managed services;
- <span class="ms">v1</span> during `hallway setup` only: `/Library/LaunchDaemons/hallway.*.plist`, the dnsmasq
  drop-in, and `/etc/resolver/<base>`. See [Setup](/networking/setup-and-doctor/).
