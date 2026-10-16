---
title: Installation
description: How Hallway will be installed once it is released (coming soon), and what it needs.
---

:::caution[Coming soon]
Hallway is **not released yet**. The npm name `hallway` is reserved with an empty placeholder, so the command below
installs nothing useful today. This page describes the intended install, so it is ready when v0 ships. Watch the
[GitHub repository](https://github.com/edspencer/hallway) to hear when that happens.
:::

## The intended install

<span class="ms ms--v0">v0</span> Two commands, once the package is published:

```sh
npm i -g hallway             # coming soon
hallway service install      # run the daemon at every login
```

`hallway service install` writes a launchd job, `~/Library/LaunchAgents/hallway.daemon.plist`, and loads it, so the
dashboard is always at `http://localhost:4255` without you starting anything. It is idempotent: run it again any time.
Undo it with `hallway service uninstall`.

To try Hallway without installing it as a service, run the daemon in the foreground instead:

```sh
hallway              # same as `hallway serve`; Ctrl-C to stop
hallway open         # open the dashboard in your browser
```

## Requirements

| | |
| --- | --- |
| **OS** | macOS first. Linux (systemd user units) is planned for v2. Windows is out of scope. |
| **Node** | 22 or later. |
| **Privileges** | None. The daemon never runs as root, and v0 never asks for sudo. |
| **For fronted mode** <span class="ms">v1</span> | [Caddy](https://caddyserver.com) (`hallway setup` offers to install it with Homebrew), and one guided sudo step. |
| **For custom domains** <span class="ms">v1</span> | dnsmasq, also via `hallway setup`. |

## Why port 4255?

The default dashboard port is **4255**, which spells **HALL** on a phone keypad, the same trick as Local Review's
5622 (LOCA). It stays clear of common dev-server defaults (Angular 4200, Astro 4321, Jekyll and Phoenix 4000), of
macOS's AirPlay Receiver on 5000 and 7000, and of the range Hallway assigns to new apps (5100–5999). Override it with
`--port <n>` or `$PORT`.

## Where things go

Everything Hallway knows lives in one directory, the **data home**: `~/.hallway`, or wherever `$HALLWAY_HOME` points.
See [The data home](/reference/data-home/). Nothing is written outside it except the launchd plists for the daemon
and any services you ask for, and, only during `hallway setup`, the files listed in
[Setup, teardown and doctor](/networking/setup-and-doctor/).
