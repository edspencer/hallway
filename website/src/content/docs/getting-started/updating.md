---
title: Updating
description: hallway update and its options, what it does to your apps, the busy check, the rollback, installs that can't update themselves, and the exit codes.
---

<span class="ms ms--shipped">v2</span> One command:

```sh
hallway update
```

**First, your apps.** `hallway update` says what it will do to them before it asks you anything. On macOS and Linux,
your managed apps keep running, but **the new version rewrites their jobs, and an app whose job comes out different
is restarted onto it.** On Windows each app's scheduled task runs through Hallway's own code, which Windows can't
replace while it's running, so the update stops your running apps while it installs, and starts them again
afterwards.

## What it does

`hallway update` **asks the registry for the latest version, checks whether Hallway is busy, asks you to confirm,
downloads the new version first (while the old one is still running), stops the service, installs, starts the new
version and waits until it answers.** If anything from the install on fails, it puts the old version back.

```
$ hallway update
Update Hallway 0.12.0 → 0.13.0? The service will restart.
```

It installs with the package manager you installed Hallway with (`npm install -g`, `pnpm add -g`, `bun add -g` or
`volta install`), and the new version rewrites and starts the daemon's service itself.

## Options

| Option | |
| --- | --- |
| `--check` | **Reports and changes nothing. It exits 0 whether or not there's an update; with `--json`, read `updateAvailable`.** |
| `--to <version\|tag>` | **A version or a dist-tag (`next`). It's the only way to move to a lower version.** |
| `--yes` | **Skips the question. Without a terminal (a script, cron), `--yes` is required, or `update` exits 2.** |
| `--force` | **Skips the busy check, and nothing else: the health check and the rollback still run.** |
| `--json` | One JSON document on stdout; prose on stderr. |

`hallway upgrade` does the same.

## Busy

**If Hallway is busy, `update` refuses with exit 75 before anything is stopped**, and says what's running: setting
up local domains from the dashboard, or starting, stopping or restarting an app. Wait, or use `--force`.
[`hallway busy`](/getting-started/running-as-a-service/#busy) asks the same question on its own.

## If the new version doesn't start

**`update` waits up to 30 seconds for the new version to answer. If it doesn't, it prints the last 20 lines of the
log, reinstalls the old version and checks that it answers: exit 6, "0.13.0 didn't start; 0.12.0 is running again."
If the old version doesn't come back either, it exits 7 and prints the commands to run by hand.** An app that doesn't
come back after the update is reported, but doesn't roll Hallway back.

## Without a service

If you run `hallway serve` yourself and it's answering, **`update` asks you to stop it first and exits 3**; stop it
(Ctrl-C in its terminal), run `hallway update` again, then start `hallway serve` again. With nothing running and no
service, it just installs the new version.

## Installs that can't update themselves

These exit 5 and print the right command instead:

| Install | What to run |
| --- | --- |
| **A managed install: if `HALLWAY_UPDATE_HINT` is set, `update` prints it and exits 5.** | Set it in the environment of an install something else manages (an Ansible role, a NixOS module), so nobody updates it by hand. |
| npx | **`npx hallway@latest` already runs the latest.** |
| A git checkout | `git pull && npm install && npm run build` |
| A global folder you can't write to | **The same command with `sudo`. Hallway never runs `sudo` itself.** |
| Yarn global, or a dependency of another project | Update it the way you installed it. |

## No automatic checks

**Hallway never checks for updates by itself. Only `update`, `update --check` and `doctor` ask the registry, and only
when you run them. `service status` repeats what the last of those found.** `hallway doctor --offline` doesn't ask.

## Run it from a terminal

Run `hallway update` from a terminal, not from inside something Hallway is running for you: the update restarts the
daemon, and on Windows it stops your running apps while it installs.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Updated, or already up to date. |
| `1` | It failed (the message says why). |
| `2` | A usage error, or no terminal without `--yes`. |
| `3` | A foreground `hallway serve` is still answering. |
| `5` | **This install can't update itself; the right command was printed.** |
| `6` | **The update failed and was rolled back; the old version is running again.** |
| `7` | **The update failed and couldn't be rolled back; a person is needed.** |
| `75` | **Busy.** |

## By hand

If you'd rather do it yourself:

```sh
npm i -g hallway@latest && hallway service install
```

`hallway service install` restarts the daemon onto the version you just installed, and restarts the forwarders
`hallway setup` installed on macOS if they're still running the old code. `hallway doctor` flags a daemon that's a
different version from its service. For what the service itself does, see
[Running as a service](/getting-started/running-as-a-service/).
