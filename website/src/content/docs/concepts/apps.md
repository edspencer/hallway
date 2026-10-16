---
title: "Apps: declared, discovered, observed"
description: Where every app on the dashboard comes from, how the scanner identifies unknown servers, and claiming.
---

An **app** is a local HTTP server Hallway knows about, identified by a **slug** such as `slides` or `data-api`
(lowercase letters, digits and hyphens; it becomes a hostname in [fronted mode](/concepts/modes/)).

Every app comes from exactly one of three sources, and the dashboard always shows which:

| Source | Where it comes from | Durable? | Editable in Hallway? |
| --- | --- | --- | --- |
| **Declared** <span class="ms ms--v0">v0</span> | A file, `apps/<slug>.yaml`, in the data home, written by you, your editor, an agent, the CLI, the API or MCP | Yes | Yes |
| **Discovered** (no adapter ships yet) | An adapter that reads another tool's registry | As durable as that registry | No, but it can be **adopted** into a declared app |
| **Observed** <span class="ms ms--v0">v0</span> | The port scanner: something is listening, and it is neither declared nor discovered | Remembered in `state/observed.json` | No, but it can be **claimed** or **ignored** |

When an observed listener's port matches a declared or discovered app, it is not shown twice: it *enriches* that app
with live detail (process ID, working directory, bind address, start time).

## Declared apps

The durable kind. The smallest possible declaration is a name and a port:

```yaml
# ~/.hallway/apps/slides.yaml
name: Slides
port: 4321
```

Everything else is optional: a description, what you expect of it (`expected`), a health-check path, deep links,
tags, an icon, proxy options, and a `service:` block if Hallway should keep it running. The full format is in
[apps/&lt;slug&gt;.yaml](/reference/app-yaml/).

A declared app can describe a server Hallway does *not* manage. If something already runs under its own launchd job,
declare it without a `service:` block and Hallway will front and monitor it without creating a second job:

```yaml
# apps/notes.yaml: already runs as its own launchd service
name: Notes
description: A notes app that manages its own service
port: 7233
expected: running
```

## Discovered apps

Some tools keep their own registry of servers and ports. A **discovery adapter** would read one, read-only, so those
apps appear without being declared twice, switching itself on only when its tool is present on the machine. **Adopt**
would turn a discovered app into a declared one you own.

**Not built yet.** The daemon has the place for adapters to plug in, and the API and dashboard already know the
`discovered` source, but no adapter ships in the current release. Candidates: the port registry of `pm`, the
dev-server wrapper in the author's other project [Paddock](https://github.com/edspencer/paddock), plain PM2, Docker's
published ports, and process-compose. Until then, every app on the dashboard is declared or observed.

## Observed listeners: the scanner

This is the feature that sells the project: *"Something has been listening on :4666 for nine days and you have
never named it. What is it?"*

Every two minutes (and on demand, with `hallway scan`), the scanner:

1. **Lists listening TCP sockets** with `lsof` on macOS, `ss` (falling back to `/proc`) on Linux, or `netstat` and
   `tasklist` on Windows. Without root it sees only your own processes, which is the intended scope. Windows doesn't
   expose a process's working directory, so there Hallway reads it from the process's own memory with one PowerShell
   call per scan, which needs no administrator rights for your own processes (elevated, other users' and 32-bit
   processes are out of reach). On any OS, a listener whose directory can't be read shows its command line in the
   observed tray instead, with a tooltip saying why.
2. **Filters out the noise.** On a typical development machine, IDE language servers and agent-tool helpers outnumber
   real dev servers about ten to one. Hallway skips ports below 1024, the ephemeral range 49152–65535 (where those
   helpers live), known non-web daemons (`postgres`, `redis-server`, `sshd` and the like), itself, Caddy, anything in
   `ignore.yaml`, and ports that belong to declared or discovered apps.
3. **Sniffs for HTTP.** It sends `GET /`. Anything that answers in HTTP, with any status, is a web app; Hallway keeps
   its status, `<title>` and favicon link. Non-HTTP listeners go into a collapsed "other listeners" group.
4. **Identifies it.** Command lines are often useless (`node dist/index.js`), so **the working directory is the
   primary clue**. From it Hallway walks up to the project root (the nearest `package.json`, `pyproject.toml`,
   `Cargo.toml`, `go.mod` or `.git`), takes a name and description from `package.json` or the README, reads the git
   branch and last commit, guesses the framework, notes the bind address, and checks the parent process: a parent of
   PID 1 (on Windows, a parent that is no longer running) with no service manager behind it means the session that
   started it is gone, so it is flagged **orphaned**. A process that launchd or systemd runs (a LaunchAgent, a `brew services` job, a systemd service) has PID 1 as its
   parent too, but it isn't orphaned: Hallway shows what supervises it instead, as `launchd: com.example.api` or
   `systemd: api.service`.

   Some directories say nothing about what runs in them: `/`, your home directory, a package manager's prefix such as
   `/opt/homebrew` (itself a git repository), or a system directory. A server started in one has no project, so
   Hallway names it by its supervisor's label or its executable (`api`, `my-server`), with the page's `<title>`
   alongside.
5. **Labels worktree siblings.** Several copies of one app running from different git worktrees show as
   `repo @ branch`, so they are no longer indistinguishable.
6. **Remembers.** Each observation is saved under a stable ID (a hash of project root, port and normalised command,
   since PIDs change on every restart), with when it was first and last seen.

That last step matters more than it looks. Once a process dies, its working directory can't be recovered. Recording
it *while it is alive* is the only way Hallway can later tell you what was
[lost at the last reboot](/concepts/services/#lost-at-last-reboot).

### Claim

**Claim** (a button in the dashboard, `hallway claim`, the API, or MCP) writes `apps/<slug>.yaml` from the
observation:

- the slug, suggested from the package name;
- `port`: the port it is already on. **Never a new one** (see [Your ports stay put](/guarantees/ports/));
- `expected: adhoc`;
- `project.dir`, from the observed working directory;
- the command that started it, as a **commented-out** `service:` block you can switch on later.

### Ignore

**Ignore** hides a listener for good, by port, by process name or by directory (you choose), by adding it to
[`ignore.yaml`](/reference/bookmarks-yaml/#ignoreyaml).

### Exposed

A listener marked **exposed** is listening on all network interfaces (`*:4321` or `0.0.0.0:4321`), not just on this
machine, so other devices on your network can reach it. That is sometimes what you want (testing on a phone), but a
dev server usually doesn't need it. If it isn't intended, bind it to `127.0.0.1`: most dev servers take a `--host`
option or a `HOST` variable. Hover over or focus the badge for the address it's bound to; the detail drawer shows it
too.

### Unfamiliar servers

Sometimes the scanner finds something you don't recognise. To find out what it is, from a terminal (replace `4321`
and `12345` with the port and the PID):

```sh
lsof -nP -iTCP:4321 -sTCP:LISTEN          # which process is listening, and its PID
ps -o pid,ppid,command -p 12345           # its full command line and its parent
lsof -a -p 12345 -d cwd                   # the directory it was started in
launchctl list | grep -i <name>           # macOS: is it a launchd job (a LaunchAgent, `brew services`)?
systemctl status 12345                    # Linux: the systemd unit it belongs to, if any
```

On macOS, `brew services list` shows the jobs Homebrew manages, and `~/Library/LaunchAgents` holds the definitions
of your own launchd jobs. A label there usually names the program that installed it. If it's something you want to
keep an eye on, claim it; if not, ignore it.
