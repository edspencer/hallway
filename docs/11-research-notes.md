# 11 — Research notes

Facts gathered during design, with when and how they were established. "Verified" means checked directly (command
run, file read, page fetched); "reported" means taken from a secondary source. Re-verify anything time-sensitive.

## TLDs and reserved names

- **IANA root zone, checked 2026-09-30** (`https://data.iana.org/TLD/tlds-alpha-by-domain.txt`, header
  `# Version 2026093000`): 1,439 TLDs. `.dev` and `.app` **are** delegated. **Not** delegated: `.internal`, `.test`,
  `.local`, `.example`, `.invalid`, `.localhost`, `.home`, `.lan`. *Verified.*
- `.local` — reserved for multicast DNS by RFC 6762; macOS's mDNSResponder intercepts `.local` lookups, so unicast
  resolver configuration for `.local` is unreliable and wildcard resolution does not work. *Reported by multiple
  sources; consistent with long-standing macOS behaviour.*
- `.test`, `.example`, `.invalid`, `.localhost` — reserved by RFC 6761.
- `home.arpa` — RFC 8375, for home networks.
- `.internal` — reserved by ICANN for private use (2024).
- `.dev` and `.app` — real TLDs on the browser HSTS preload list; the historical "use `.dev` locally" pattern broke
  when `.dev` was delegated.

## ICANN 2026 new gTLD round

Relevant only to users who pick a made-up TLD (`03-networking.md`): it is why such TLDs get a warning and an IANA
check in `hallway doctor`. *Reported, from ICANN announcements and coverage; fetched 2026-09-30 and 2026-10-14.*

- Application window: 30 April – 12 August 2026.
- 1,616 applications proceeding (announced September 2026).
- **Reveal Day: 7 October 2026.** ICANN's announcement: 1,615 applications, including 333 brand, 16 community-based,
  15 geographic, 21 IDN and 9 variant applications. Published via the Application Publication and Statistics (APS)
  site, `https://newgtldprogram-aps.icann.org/applications`.
- Replacement period 8–21 October 2026; **String Confirmation Day 17 November 2026** (final string list and contention
  sets); prioritisation draw expected in the first half of 2027. Delegations follow evaluation, i.e. years out.
- The Reveal Day **contention-sets CSV** (`https://newgtldprogram.icann.org/en/application-rounds/round2/reveal-day-contention-sets.csv`)
  lists only *contested* strings, so it cannot show whether an uncontested (e.g. brand) string was applied for. Use the
  APS site or the String Confirmation Day list for that.

Sources:
- https://www.icann.org/en/announcements/details/icann-reveals-2026-round-applications-for-new-generic-top-level-domains-07-10-2026-en
- https://www.icann.org/en/announcements/details/icann-2026-round-closes-with-more-than-1600-new-gtld-applications-13-08-2026-en
- https://newgtldprogram.icann.org/en/application-rounds/round2
- https://icannwiki.org/New_gTLD_Program_(2026)

## macOS behaviour (Darwin 27, author's machine)

- **`*.localhost` resolves with no configuration.** `dscacheutil -q host -a name foo.localhost` and
  `… a.b.localhost` return `127.0.0.1` / `::1`; `curl http://foo.localhost:<port>/` reached a local server
  (HTTP 200). *Verified 2026-10-14.*
- **Resolver files cover the apex.** With an existing `/etc/resolver/<two-label-domain>` file, `scutil --dns` listed
  the domain as its own resolver and the apex itself resolved through it. *Verified 2026-09-30.*
- **Unprivileged low-port binding:** as a normal user, `listen(444, '127.0.0.1')` → `EACCES`;
  `listen(446, '::1')` → `EACCES`; `listen(445, '0.0.0.0')` → OK. So loopback :443 needs root; wildcard :443 does not
  (but exposes it to the network). *Verified 2026-10-14.*
- **Ports 80/443 already in use** on the author's machine by an `ssh` process owned by the user — a container-runtime
  VM's port forward. *Verified 2026-10-14.*
- **IANA port registry, checked 2026-10-16**
  (`https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv`):
  there is **no individual registration for 4255**, and none for any port from 4250 to 4260. 4255 does fall inside the
  legacy block registration `vrml-multi-use`, **4200–4299** ("VRML Multi User Systems", assignee Mitra, with no
  transport protocol or registration date). *Verified.* Chosen as the default (D20): a 1990s-era block registration is
  not a realistic conflict on a developer machine. Nearby dev-server defaults to stay clear of: Angular CLI 4200, Astro
  4321, Jekyll and Phoenix 4000. *Reported (well-known defaults).* The pre-rename default and its IANA entry are
  recorded in D20.
- **AirPlay Receiver** listens on 5000 and 7000. *Reported; the reason Local Review moved its default off 5000.*
- **`lsof` noise:** on the author's machine, listening sockets from IDE language servers and agent-tool helpers on
  ephemeral ports (49152–65535, loopback) outnumbered dev servers roughly ten to one. *Verified 2026-09-16.*
- **Orphan identification:** dev servers' command lines were often relative (`node dist/index.js`); the reliable
  identifier was the process cwd via `lsof -a -p <pid> -d cwd -Fn`, then `package.json`/README/git. Worktree siblings
  were distinguishable only by branch. After a reboot the cwd of dead processes was unrecoverable; they could only be
  matched afterwards by cross-referencing build-cache mtimes, inconclusively. *Verified 2026-09-30.*
- `node:sqlite` works without a flag on Node v24.15.0 (SQLite 3.51.3). *Verified 2026-10-14.*
- `node:sqlite` also works without a flag on **Node v22.23.3** (SQLite 3.51.3), on Linux: `new DatabaseSync(':memory:')`
  and `select sqlite_version()` succeed, and Node prints `ExperimentalWarning: SQLite is an experimental feature`. The
  daemon would want to silence that warning (or accept it in the log) if Q-STORE picks SQLite. Earlier 22.x releases
  are still unchecked (Q-NODE-MIN). *Verified 2026-10-16.*
- **The oldest Node 22 that loads `node:sqlite` without a flag is 22.13.0** (Q-NODE-MIN, D32). Checked with the
  official `linux-x64` builds from nodejs.org, running `require('node:sqlite')`, `new DatabaseSync(':memory:')` and
  `select sqlite_version()`: **22.0.0**, **22.5.0** and **22.12.0** fail with `ERR_UNKNOWN_BUILTIN_MODULE` (22.5–22.12
  have it only behind `--experimental-sqlite`; 22.0 not at all); **22.13.0** works (SQLite 3.47.2) and prints the same
  `ExperimentalWarning`. The whole test suite, uptime store included, also passes on 22.13.0. The daemon drops that
  one warning while loading the module (`server/health/uptime.ts`, `loadSqlite`). *Verified 2026-10-16.*

## Names, npm and binary collisions

- **Update, 2026-10-16 (later the same day):** `npm view hallway` lists versions `0.0.0-stage` and `0.0.1`, with
  `latest` = `0.0.1`: the author's code-free placeholder (D29, `RELEASING.md`). *Verified.*

*Checked 2026-10-16 against `https://registry.npmjs.org/<name>` (404 = free).* The pre-rename naming record (2026-10-14)
is in D1.

- **Free:** `hallway`, `hall-way`; also the shortlisted alternatives `strays`, `pinfold`, `foundling`, `digory`,
  `otherwood`, `kenning`, `dewpond`, `gyratory`, `sliproad`. *Verified.* The author is publishing a placeholder to
  reserve `hallway`; it was still unpublished at the time of this check.
- **Taken:** `porter`, `portico`, `concierge`, `foyer`, `lobby`, `roundup`, `corral`, `wrangler`, `muster`, `stray`,
  `flyover`, `slipway`, `signpost`, `fingerpost`, `satnav`, `beacon`. *Verified.*
- **Short-alias candidate `hw` (Q-BINARY):**
  - Homebrew: no formula installs an executable named `hw`, `hallway` or `hwy` (searched the executables index
    `https://formulae.brew.sh/api/internal/executables.txt`, 8,521 formulae). *Verified.*
  - Debian stable: no package ships a file named `hw` (packages.debian.org contents search, exact filename). *Verified.*
  - npm: a package named `hw` exists (v0.0.3, created 2015, last modified 2022) and declares an `hw` bin. It is a
    personal package with about one download a week, so a real collision is very unlikely, but a user who has it
    installed globally would get a bin conflict. *Verified.*
  - Not found as a command on a stock Linux box. **Not checked:** a stock macOS install, or popular shell-framework
    aliases (e.g. Oh My Zsh plugins). Check both before shipping the alias.
  - `hwy` is also an npm web framework (no bin); `hall` is an npm router package (no bin). Neither was pursued.

## Platform support (D26): unverified on macOS

Hallway is developed and run end to end on Linux; macOS is the primary platform but its code paths can only be
unit-tested from there. Each item below is implemented (or will be, at the milestone shown) but **has not been run on
a Mac**. Move an item out of this list, with the date and how, once it has been. Tests that pass on CI's
`macos-latest` runner count only for what they actually exercise.

| Item | Milestone | Status |
|------|-----------|--------|
| `server/platform/darwin.ts`: LaunchAgents directory (`~/Library/LaunchAgents`) and `<label>.plist` naming | scaffold | Unit-tested on Linux and macOS CI; never installed on a Mac. |
| The daemon binding 127.0.0.1 and serving the built dashboard on macOS | scaffold | CI (`macos-latest`) runs the tests and `smoke:pack`, which start the packed daemon and fetch from it. Not run interactively on a Mac. |
| `hallway service install` via `launchctl bootstrap gui/<uid>` | v0 | Not built yet. |
| `lsof -nP -iTCP -sTCP:LISTEN -F pcLn` parsing on current macOS | v0 | Built (`darwin.ts`, `parseLsofListeners`). Unit-tested against a **hand-written** fixture in the documented `-F` format (`test/fixtures/platform/lsof-listen.txt`); never captured on a Mac. The real-scan test (`test/scanner.test.ts`) runs lsof for real on CI's `macos-latest`, which checks that a server we start is found with its cwd, but not lsof's output for anyone else's processes. |
| cwd via `lsof -a -p <pids> -d cwd -Fn` (batched: one call for every PID) | v0 | Built; hand-written fixture; exercised by the same CI test. |
| `ps -o pid=,ppid=,lstart=,command= -p <pids>` under `LC_ALL=C` (start time parsed as local time; argv recovered by splitting `command` on spaces, which is lossy for arguments containing a space) | v0 | Built; hand-written fixture; exercised by the same CI test. |
| Orphans as PPID 1 (a LaunchAgent is PPID 1 too, so it also counts as one) | v0 | Built; unverified. |
| Boot time from `sysctl -n kern.boottime` | v1 | Parser built and unit-tested against a hand-written fixture (`{ sec = …, usec = … } …`); recorded in `state/boot.json` from v0. Never run on a Mac. |

## The scanner on Linux

- **`/proc` works as the listener source without `ss`.** On a Debian 12 container with no `iproute2` (so no `ss`) and
  no `lsof`, the scanner fell back to `/proc/net/tcp{,6}` (LISTEN rows are `st` `0A`; addresses are little-endian hex
  words) and found each socket's owner by matching `socket:[<inode>]` links under `/proc/<pid>/fd`: about 30 ms for
  the whole machine. `/proc/<pid>/cwd`, `cmdline` and `stat` (ppid; start time = `btime` + field 22 / `CLK_TCK`, which
  was 100) gave the identity. With real servers started in temp directories (`python3 -m http.server 4567` in a folder
  with no project files, and one small Node server in each of two git worktrees of one repository, on 4670 and 4671),
  the scan reported the python server labelled with its directory and the two worktrees as `dash @ feature-a` and
  `dash @ branch-b`, with the right cwd, `orphan: true` (started with `setsid`, so adopted by PID 1) and loopback
  binds; a Node helper on 51234 was dropped as ephemeral and a raw TCP listener on 4590 went to "other".
  *Verified 2026-10-16.*
- Sockets whose owner can't be found (another user's process, without root; or another network namespace's) have no
  PID, and the scanner drops them, which matches what `lsof` shows on macOS without root.
- The `ss -ltnpH` parser is tested against a hand-written fixture only on that machine; the real-scan test exercises
  it for real on CI's `ubuntu-latest`, which has `ss`.

## Caddy

*From https://caddyserver.com/docs/automatic-https, fetched 2026-10-14.*

- Names that never get public ACME certificates (served from Caddy's local CA): `localhost`, and anything under
  `.localhost`, `.local`, `.internal`, `.home.arpa`; IP addresses. Every other name qualifies for public ACME — so
  **`.test` and made-up TLDs need the internal issuer forced** (`local_certs` global option or `tls internal`).
- Automatic HTTPS redirects HTTP → HTTPS.
- On first use Caddy tries to install its root into the system trust store; this is best-effort and may fail when
  running as an unprivileged service; `caddy trust` retries (needs privileges); `caddy untrust` removes it;
  `skip_install_trust` disables it.
- Homebrew versions on 2026-09-30: **caddy 2.11.4**, **dnsmasq 2.93**. *Verified (`brew info`).*

## Prior art status (checked 2026-09-16 via GitHub API / npm)

| Project | Last push | Stars | Notes |
|---------|-----------|-------|-------|
| typicode/hotel | 2023-10-23 | ~10k | 122 open issues; dashboard at `hotel.localhost`; `hotel add 'npm start'` |
| peterldowns/localias | 2025-11-07 | ~1.5k | Caddy + `/etc/hosts`; TLS auto-trust; `.local` via mDNS; **no wildcards, no boot persistence, no process management** (from its README) |
| Unitech/pm2 | 2026-09-04 | ~43k | v7.0.4 on npm; launchd startup issues #4318, #5084 |

## The author's sibling projects (public, MIT)

### Local Review — https://github.com/edspencer/local-review (npm `local-review`, v0.9.0 when read)

Read 2026-10-14. Relevant internals:

- **Dependencies:** `hono`, `@hono/node-server`, `chokidar`, `yaml`, `@resvg/resvg-js`, `opentype.js`. Dev: React 19,
  Vite, TypeScript, tsx, Playwright, changesets, concurrently.
- **`server/port.ts`:** only `export const DEFAULT_PORT = 5622;` — "5622 spells LOCA on a phone keypad. (It was 5000
  until 0.2.0, which clashes with the macOS AirPlay Receiver.)"
- **`server/config.ts`:** `packageRoot()` walks up to its own `package.json`; data home
  `$LOCAL_REVIEW_HOME || ~/.local-review` with `projects/<slug>/{project.yaml, prs/, reviews/, assets/}`,
  `backups/<ISO>/`, `examples/`; `SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/`.
- **`server/events.ts`:** chokidar watch of `projects/` (`ignoreInitial`, depth 3, ignores `*.tmp`), path → typed
  event mapping, **150 ms per-key debounce**, in-process subscriber set, plus git-state polling.
- **`server/index.ts`:** Hono app; `app.use('*', localOnly)`; `/api/events` via `streamSSE` (hello event, `change`
  events with ids, 25 s heartbeat); `/api/health` → `{ ok: true }`; `/llms.txt`, `/llms-full.txt`,
  `/agent-guide.md` rendered with live data; thumbnails at `/api/projects/:project/thumb.svg` with ETag/304; serves
  `dist/web` statically; binds `127.0.0.1` only.
- **`server/security.ts`:** `localOnly` middleware — Host must be `localhost`/`127.0.0.1`/`[::1]`; non-GET writes
  must be JSON (or a specific image type for uploads); Origin, if present, must be local. **This is why fronting
  needs Host rewriting (D9).**
- **`server/stackviz.ts`:** `svgToPng()` via resvg with bundled Inter / JetBrains Mono fonts and system fonts
  disabled for deterministic output.
- **CLI:** default command `serve`; `--port`/`$PORT`; friendly `EADDRINUSE`/`EACCES` messages; exit 2 on usage
  errors. No service-install command and **no MCP**.

### Paddock — https://github.com/edspencer/paddock (npm `@edspencer/paddock`)

- Runs on the author's machine as a user LaunchAgent with `RunAtLoad`, `KeepAlive`, `ThrottleInterval 10`, absolute
  `node` path, `WorkingDirectory`, `StandardOutPath`/`StandardErrorPath` and an explicit `PATH` — the template for
  service generation. That `PATH` contains a per-shell `fnm_multishells/<pid>_<ts>/bin` directory: the **PATH trap**
  described in `04`. Paddock generates the plist in `packages/server/src/cli/service/launchd.ts` (`renderPlist`),
  taking `pathEnv` verbatim from `process.env.PATH` at install time (`cli/paddock.ts`; default in `cli/service/spec.ts`).
  Checked 2026-10-15 (fnm 1.39.0): the multishell directory still existed (a symlink to the same Node version as the
  plist's absolute `node`), 95,810 multishell directories had accumulated, fnm offers no clean/prune command, and with
  that entry removed `node`/`npm`/`npx` did not resolve on the plist's `PATH`. Filed as
  [edspencer/paddock#974](https://github.com/edspencer/paddock/issues/974).
- Listens on 7233 locally.
- `scripts/pm` (vendored in the repo; installed as `/usr/local/bin/pm` in its dev-box image): a CommonJS Node script
  wrapping PM2 with a JSON port registry. Commands `start/stop/restart/rm/status [--json]/logs/ports`. Assigns stable
  ports from 5001–5999; injects `PORT` and `HOST=0.0.0.0`; scrubs production-data env vars and refuses commands
  referencing production data paths; writes the registry atomically (tmp + rename); config resolution env → KEY=VALUE
  file (`$PM_CONFIG`, default `/etc/paddock-servers/pm.env`) → default. Registry format in `04`.
