# 04 — Apps, discovery, health and services

## Three sources of apps (D11)

Do not model a single list. Every app on the dashboard comes from exactly one of these, and the UI makes the source
visible.

| Source | Where it comes from | Durable? | Editable here? |
|--------|---------------------|----------|----------------|
| **Declared** | `apps/<slug>.yaml` in the data home — written by a human, an editor, an agent, the CLI, the API or MCP | Yes | Yes |
| **Discovered** | An adapter reading another tool's registry (e.g. Paddock's `pm` port registry) | As durable as that registry | No — but can be **adopted** into a declared app |
| **Observed** | The port scanner: something is listening and is neither declared nor discovered | Remembered in `state/observed.json` | No — can be **claimed** (→ declared) or **ignored** |

Matching: an observed listener whose port matches a declared or discovered app is **not** shown separately; it
enriches that app (live PID, cwd, bind address, start time).

### Declared apps

Schema in `02-architecture.md`. The two apps the author will declare first, as concrete examples:

```yaml
# apps/paddock.yaml
name: Paddock
description: Persistent coding-agent sessions
port: 7233
expected: running            # already runs as its own launchd service; we only front and monitor it
```

```yaml
# apps/review.yaml
name: Local Review
description: Review stacks of local commits before pushing
port: 5622
expected: running
health: { path: /api/health }
service:
  command: ["local-review", "serve", "--quiet"]
```

Note the difference: Paddock already has its own launchd job, so Hallway must **not** create a second
one (no `service:` block); Local Review does not, so Hallway manages it.

### Discovered apps (adapters)

```ts
interface DiscoverySource {
  id: string;                         // e.g. "paddock-pm"
  detect(): Promise<boolean>;         // cheap check: is this source present on this machine?
  list(): Promise<DiscoveredApp[]>;   // { name, port, cwd?, command?, status?, url? }
}
```

Adapters are optional and enabled only when `detect()` succeeds (config can force on/off). Initial adapter:

- **Paddock `pm` registry** (the author's own tool; useful as a worked example). A JSON file:
  ```json
  { "version": 1,
    "ports": { "<name>": { "port": 5001, "cmd": "npm run dev", "cwd": "/path", "host": "localhost",
                           "updatedAt": "2026-08-04T12:00:00.000Z" } } }
  ```
  Path: `$PM_REGISTRY`, else the `PM_REGISTRY=` line in the KEY=VALUE file at `$PM_CONFIG` (default
  `/etc/paddock-servers/pm.env`), else `/var/lib/paddock-servers/ports.json`. Live status comes from `pm2 jlist`
  (a JSON array of `{ name, pid, pm2_env: { status, restart_time } }`; it is sometimes prefixed with log noise, so
  slice from the first `[`).

Later candidates: plain PM2 (`pm2 jlist`, port from `pm2_env.env.PORT` when present), Docker (`docker ps --format
json` published ports), `process-compose`.

### Observed listeners — the scanner

This is the feature that sells the project: *"Something has been listening on :4666 for nine days and you have never
named it — what is it?"*

**Algorithm** (every `scan.intervalSeconds`, default 120 s, and on demand):

1. **List listeners:** `lsof -nP -iTCP -sTCP:LISTEN -F pcLn` (machine-readable: PID, command, login, address).
   Merge IPv4/IPv6 entries for the same PID+port. Without root, `lsof` reliably sees only the current user's
   processes — that is the intended scope.
2. **Filter out noise** (this step is what makes it usable — on the author's machine, IDE and agent-tool helper
   processes outnumbered real dev servers roughly ten to one):
   - ports below `scan.minPort` (default 1024)
   - the ephemeral range **49152–65535**, unless `scan.includeEphemeralPorts` (language servers and tool helpers live
     there)
   - entries in `ignore.yaml` (ports, process names, directories)
   - a built-in list of known non-web daemons: `postgres`, `mysqld`, `redis-server`, `mongod`, `sshd`, `rapportd`,
     `ControlCenter`, `com.docker.*`, etc.
   - Hallway's own daemon and Caddy
   - ports belonging to declared/discovered apps (these enrich the app instead)
3. **HTTP sniff:** `GET /` with a 2 s timeout. If it speaks HTTP at all (any status), it is a web app; record status,
   `<title>`, and favicon link. If not, put it in a collapsed "other listeners" group, not the main list.
4. **Identify** — command lines are often useless (`node dist/index.js`), so the **working directory is the primary
   identifier**:
   - cwd: `lsof -a -p <pid> -d cwd -Fn`
   - full command: `ps -o command= -p <pid>`; start time: `ps -o lstart= -p <pid>`
   - parent: `ps -o ppid= -p <pid>` — PPID 1 means reparented to launchd (its launching session is gone: an orphan)
   - project root: walk up from cwd to the nearest `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `.git`
   - name/description: `package.json` `name`/`description`, else first README heading, else directory name
   - git: `git -C <dir> rev-parse --show-toplevel`, `--abbrev-ref HEAD`, `log -1 --format=%cI`; **worktree
     detection** by comparing `--git-dir` with `--git-common-dir` (they differ in a worktree; the common dir points at
     the parent repository)
   - framework guess from the command and dependencies (vite, astro, next, remix, sveltekit, express, fastify, hono,
     flask, django, rails…) — used for an icon and for service-command hints
   - bind address: `127.0.0.1`/`::1` vs `*` (exposed on the network)
5. **Label worktree siblings.** Several listeners from worktrees of the same repository are shown as `repo @ branch`
   so they are distinguishable (the motivating incident had three copies of one dashboard on 4666/4670/4671).
6. **Persist** to `state/observed.json`, keyed by a **stable observation id** = hash(project root + port + normalised
   command) — PIDs change on every restart. Store first-seen, last-seen, last PID, full identity. Cache identity per
   PID between scans; `lsof` is slow enough (hundreds of ms) that re-identifying everything every scan is wasteful.

**Claim** (UI button, `hallway claim`, API, MCP): writes `apps/<slug>.yaml` from the observation — slug suggested from
the package name, `port` = the observed port (**never a new one**), `expected: adhoc`, `project.dir`, and the
observed command as a *commented-out* `service:` block the user can enable.

**Ignore:** adds the port, process name or directory to `ignore.yaml` (the user chooses which).

### "Lost since reboot" (v1)

On daemon start, read the boot time (`sysctl -n kern.boottime` → `{ sec = …, usec = … } …`) and compare it with
`state/boot.json`. If the machine has rebooted, every observation that was alive before the boot and is not
listening now goes into a **"Lost at last reboot"** notice: what it was, where it ran from, the command that started
it, and one-click actions — *restart it once* (`hallway run`), *make it a service* (`hallway service add`), or *dismiss*. This is
only possible because observations are recorded while the processes are alive; once a process is gone its cwd cannot
be recovered.

## Health states (D12)

| State | Meaning | Visual tone |
|-------|---------|-------------|
| `healthy` | Responding as expected | calm, positive |
| `unhealthy` | Listening but failing: HTTP ≥ 500, health path not 2xx (or not `expectStatus`), or HTTP timeout | warning |
| `down` | Should be running (`expected: running`, or a managed service with keep-alive) and is not listening | alarm — the only red state |
| `stopped` | Not listening, and that is fine: `expected: stopped`, `expected: adhoc`, or a managed service the user stopped | neutral, quiet |
| `unknown` | Not probed yet / no data | neutral |

A managed service that was just started shows a transient **starting** sub-state for a grace period (default 30 s)
before "not listening" counts as `down`.

**The key rule: stopped-on-purpose is not down.** A dev deck you are not using today must not glow red. Only `down`
is alarming, and only apps the user said should be running can be `down`.

**Flap damping:** require 2 consecutive failed probes to leave `healthy`; 1 success to return. Emit a `state` event
only on transitions.

## Probing

Probe ladder for each declared/discovered app, every `probe.intervalSeconds` (default 60 s, ±10 % jitter, at most
`probe.concurrency` in flight):

1. **TCP connect** to `host:port` (1 s timeout). Refused/timeout → *not listening* → `down`, `stopped` or `starting`
   per the table above.
2. If `health.path` is set: `GET <path>`. Status matches `expectStatus` (default: any 2xx) → `healthy`; otherwise
   `unhealthy`.
3. Otherwise `GET /`: status < 500 → `healthy`. **3xx, 401 and 403 count as healthy** (an app behind a login
   redirect is up). ≥ 500 or HTTP timeout (`probe.timeoutMs`, default 5 s) → `unhealthy`.

Details:
- Do not follow redirects. Abort the body once headers arrive; latency = time to response headers.
- Send `Host: <host>:<port>` (the upstream, so apps with Host checks answer normally) and
  `User-Agent: hallway/<version>`.
- Use `GET`, not `HEAD` (some dev servers mishandle `HEAD`).
- While at least one dashboard is connected over SSE, probe faster (default every 15 s) so the page feels live.
- Probe the daemon's own health too, for the "is the fronting working" indicator in fronted mode: optionally probe
  through Caddy (`https://<slug>.<base>`) as well as direct, and show a distinct state if direct works but fronted
  does not (proxy problem, not app problem).

## Uptime storage

Store in `state/health.sqlite`, through `node:sqlite` (D37):

- **Samples** — one per probe: `(slug, ts, state, http_status, latency_ms)`. Retain **48 hours**.
- **Hourly rollups** — `(slug, hour, n_samples, n_healthy, n_unhealthy, n_down, n_stopped, latency_p50, latency_p95,
  latency_max)`. Retain **90 days**. Compute hourly; prune on the same schedule.
- At 60 s intervals that is 2,880 samples and 2,160 rollups per app — trivial.

Computation rules:
- **Uptime % excludes `stopped` time.** Being off on purpose is not downtime.
- **Periods when the daemon itself was not running are "no data"**, shown as gaps, never as down.
- Windows for the UI: 24 h (from samples), 7 d and 90 d (from rollups).

## Managed services (v1)

### Generating launchd jobs

`hallway service add <slug>` (requires a `service:` block, or flags that create one) generates
`~/Library/LaunchAgents/hallway.app.<slug>.plist` and loads it. The daemon itself uses the same generator
for `~/Library/LaunchAgents/hallway.daemon.plist` (`hallway service install`).

Template, derived from the plist the author already uses to run Paddock as a service:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>              <string>hallway.app.review</string>
    <key>ProgramArguments</key>
    <array>
      <string>/ABSOLUTE/PATH/TO/node</string>                <!-- resolved, never a shim -->
      <string>/ABSOLUTE/PATH/TO/local-review/dist/server/cli.js</string>
      <string>serve</string>
      <string>--quiet</string>
    </array>
    <key>RunAtLoad</key>          <true/>
    <key>KeepAlive</key>          <true/>
    <key>ThrottleInterval</key>   <integer>10</integer>
    <key>WorkingDirectory</key>   <string>/ABSOLUTE/CWD</string>
    <key>StandardOutPath</key>    <string>/ABSOLUTE/DATA_HOME/logs/review.out.log</string>
    <key>StandardErrorPath</key>  <string>/ABSOLUTE/DATA_HOME/logs/review.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>     <string>/stable/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>PORT</key>     <string>5622</string>
      <key>HOST</key>     <string>127.0.0.1</string>
      <key>HOSTNAME</key> <string>127.0.0.1</string>
    </dict>
  </dict>
</plist>
```

Lifecycle (use the modern `launchctl` verbs, `gui/<uid>` domain):

| Action | Command | YAML effect |
|--------|---------|-------------|
| install/start | `launchctl bootstrap gui/$UID <plist>` | `expected: running` |
| stop | `launchctl bootout gui/$UID/<label>` (unload, so KeepAlive does not resurrect it) | `expected: stopped` |
| restart | `launchctl kickstart -k gui/$UID/<label>` | — |
| status | `launchctl print gui/$UID/<label>` → parse `state`, `pid`, `last exit code` | — |
| remove | bootout + delete plist | remove `service:` block |

LaunchAgents start at **user login**, not at boot. That is the right behaviour for a laptop.

### The PATH trap (important)

launchd jobs inherit no shell environment, so `PATH` must be set explicitly. But naïvely capturing the current
shell's `PATH` is a latent bug: some version managers put **per-shell directories** on `PATH`. fnm, for example, adds
`~/.local/state/fnm_multishells/<pid>_<timestamp>/bin`, a symlink created for one terminal session. Copy that into a
plist and the service's only route to `node`/`npm`/`npx` is a leftover from a shell that closed long ago.

This was found in the plist that Paddock's own `paddock service install` generates (filed as
[edspencer/paddock#974](https://github.com/edspencer/paddock/issues/974)). On the author's machine the directory still
existed two months and two reboots later, so nothing had broken *yet*: fnm never cleans these up and has no command to
(95,810 of them had piled up). But with that one entry removed, `node`, `npm` and `npx` all failed to resolve on the
service's `PATH`. So:
- deleting it (the obvious cleanup) silently breaks every `#!/usr/bin/env node` tool the service spawns, while the
  service itself keeps running, because it was started via an absolute `node` path;
- if the installing shell had a different version selected than the absolute `node` path, child `node` invocations
  silently run a different version.

The generator must:
- resolve `command[0]` (and the Node binary, for Node scripts) to an **absolute, real path** (`realpath` of `which`),
  pointing at the version manager's stable install directory (e.g. `~/.local/share/fnm/node-versions/<v>/installation/bin`),
  not a shim;
- **put the resolved Node's own `bin` directory first** in `PATH`, so `node`/`npm`/`npx` always resolve, and resolve to
  the same Node that runs the service;
- build the rest of `PATH` from stable directories only, dropping per-shell patterns (`fnm_multishells`, etc.) and any
  entry that does not exist;
- record the resolved Node version, so `hallway doctor` can warn when that version has been uninstalled (the absolute path
  will break), and `hallway service regenerate <slug>` can fix it.

`hallway doctor` should also scan existing `hallway.*` plists for these problems.

### Ports and environment

- `PORT` and `HOST=127.0.0.1` (plus `HOSTNAME`) are injected. Frameworks that ignore `PORT` need flags; the docs and
  `hallway run` hints should cover the common ones: Vite `--port $PORT --strictPort` (**`--strictPort` matters**: without
  it Vite silently picks another port when the one it wants is busy, and the app "moves"), Astro `--port`, Next `-p`.
- **Never reassign an app's existing port.** Apps hardcode their own ports in helper scripts, dev-proxy configs and
  baked-in site URLs (both seen in the motivating incident). A claimed or declared app keeps the port it already uses.
- New apps with no port get one from `ports.assignRange` (default 5100–5999; avoids 5000 for AirPlay),
  skipping ports that are declared, observed listening, or well known. Assignment is stable: stored in the YAML.

### Logs

- launchd does **not** rotate `StandardOutPath`/`StandardErrorPath`; files grow forever (the author's existing service
  logs do). The daemon must rotate them: because launchd keeps the file descriptor open, *rename* does not work —
  copy then truncate in place when a file exceeds a size (default 10 MB), keeping N generations (Q-LOG-ROTATION).
- `hallway logs <slug> [--lines N] [--follow]` and `GET /api/apps/:slug/logs`.

## `hallway run` — the one command agents should use (v1)

`hallway run` replaces the ad-hoc `npm run dev` that creates orphans. It is the successor to Paddock's `pm start`.

```
hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name "Display name"] -- <command...>
```

1. Create or update `apps/<slug>.yaml`: `expected: adhoc` (or `running` with `--persist`), `service.command`,
   `service.cwd` (default: current directory), port (existing → keep; `--port` → pin; else assign stably).
2. Generate and bootstrap a launchd job, so the server is **owned by launchd, not by the agent's session**, and
   survives the session ending.
   - Without `--persist`: `RunAtLoad false`, `KeepAlive false`. It will not come back after a reboot, but it stays on
     the dashboard as `stopped` with a one-click restart, and appears under "Lost at last reboot".
   - With `--persist`: `RunAtLoad true`, `KeepAlive true` — a full service.
3. Wait until the port is listening (default timeout 30 s), then print the URL(s) and the log path and **exit 0**.
   If it does not come up, print the last 30 log lines and exit 1.
4. Re-running `hallway run <slug>` with no command reuses the recorded one (as `pm start` did).

Companion commands: `hallway stop <slug>`, `hallway restart <slug>`, `hallway logs <slug>`.

Because it returns promptly and prints the URL, an agent can use it inside a tool call without hanging.
