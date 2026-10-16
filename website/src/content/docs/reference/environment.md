---
title: Environment variables
description: The few environment variables Hallway reads, and the ones it sets for managed services.
---

Hallway needs **no environment variables** to work. Agents often run commands from shells that load no profile, and
launchd jobs and systemd units inherit no shell environment, so every default works with an empty environment. These are overrides.

## Read by Hallway

| Variable | Meaning |
| --- | --- |
| `HALLWAY_HOME` | The [data home](/reference/data-home/). Default `~/.hallway`. |
| `PORT` | The daemon's port for `hallway serve`. Default `4255`. `--port` does the same. |
| `VISUAL`, `EDITOR` | The editor `hallway app edit` and `hallway bookmark edit` open (`VISUAL` first; default `vi`). |
| `XDG_CONFIG_HOME` | Linux: where systemd user units go (`$XDG_CONFIG_HOME/systemd/user`; default `~/.config/systemd/user`). |
| `HALLWAY_DEV` | Development mode, for working on Hallway itself (the API runs next to Vite's dev server, as Local Review does). |

## Set by Hallway for managed services

<span class="ms ms--shipped">v1</span> Every [managed service](/concepts/services/) and every server started with [`hallway run`](/agents/hallway-run/)
gets:

| Variable | Value |
| --- | --- |
| `PORT` | The app's port. |
| `HOST` | The app's `host`, by default `127.0.0.1`, so the server isn't exposed to your network. |
| `HOSTNAME` | The same, for frameworks that read this instead. |
| `PATH` | Built from stable directories, with the service's own Node first. See [the PATH trap](/concepts/services/#the-path-trap). |

Anything in the app's `service.env` is added on top.
