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
- **The oldest Node 22 that loads `node:sqlite` without a flag is 22.13.0** (Q-NODE-MIN, D37). Checked with the
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
| `server/platform/darwin.ts`: LaunchAgents directory (`~/Library/LaunchAgents`) and `<label>.plist` naming | scaffold | Unit-tested on Linux and macOS CI; installed and loaded on CI's `macos-latest` runner by `scripts/services-real.mjs` (2026-10-16, below). Never on a developer's Mac. |
| The daemon binding 127.0.0.1 and serving the built dashboard on macOS | scaffold | CI (`macos-latest`) runs the tests and `smoke:pack`, which start the packed daemon and fetch from it. Not run interactively on a Mac. |
| The file watcher (chokidar 5) on macOS | v0 | chokidar 4+ dropped its `fsevents` backend and uses `fs.watch` per directory. Verified on Linux 2026-10-16 (create, edit, delete and a broken file in `apps/` arrive over SSE in 150–260 ms, including an editor-style save by rename; `test/events.test.ts` and a curl run against the daemon). On macOS only CI's `macos-latest` run of the same tests; not tried with real editors (atomic-rename saves from vim, VS Code) on a Mac. |
| `hallway service install` via `launchctl bootstrap gui/<uid>` | v0 | **Run against real launchd on CI's `macos-latest` runner, 2026-10-16** (see "Managed services on real launchd and systemd" below). Not yet on a developer's Mac, and not across a logout/login or reboot. |
| The launchd lifecycle: `enable`/`bootstrap`/`kickstart`/`kickstart -k`/`bootout`/`disable`/`print` and their exit codes | v1 | Same CI run: every verb ran for real and `print`'s `state = running` / `pid` were parsed. The bootstrap retry after a bootout ("5: Input/output error") never triggered there, so that path is only unit-tested. Exit codes 3/36/113 for "not loaded" are taken from launchctl's documented behaviour, not observed. |
| `disable` keeping a stopped job stopped at the next **login** (D41), and `RunAtLoad` starting a job at login | v1 | Unverified: CI can't log out and back in. |
| The PATH trap on a Mac with fnm (the per-shell `fnm_multishells` symlink resolved to the stable install) | v1 | The resolution is unit-tested with a fake fnm layout on both OSes; CI's runners don't use fnm. |
| `lsof -nP -iTCP -sTCP:LISTEN -F pcLn` parsing on current macOS | v0 | Built (`darwin.ts`, `parseLsofListeners`). Unit-tested against a **hand-written** fixture in the documented `-F` format (`test/fixtures/platform/lsof-listen.txt`); never captured on a Mac. The real-scan test (`test/scanner.test.ts`) runs lsof for real on CI's `macos-latest`, which checks that a server we start is found with its cwd, but not lsof's output for anyone else's processes. **That test passed on `macos-latest` with Node 22 and 24 on 2026-10-16** (PR #4): real `lsof -F pcLn`, `lsof -d cwd` and `ps -o …lstart…` output parsed, and the server found with its PID, cwd and project name. A CI runner is not a developer's Mac (no IDE helpers, Docker or AirPlay listeners), so this stays listed. |
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

## Managed services on real launchd and systemd (2026-10-16)

Run by `scripts/services-real.mjs` in CI (the `Services (real launchd)` / `Services (real systemd)` jobs of PR #7):
`macos-latest` (launchd, `gui/501`) and `ubuntu-latest` (systemd's user instance, after `loginctl enable-linger`;
`XDG_RUNTIME_DIR=/run/user/<uid>`). Each installs the daemon as a service, restarts it, runs an app with
`hallway run`, stops, starts and restarts it, runs a `--persist` app and kills it, checks log rotation, regenerates,
runs `doctor`, and removes everything. Observed:

- **Both pass end to end.** The generated plist and unit load and run as written; the PATH and program resolution work
  on both runners; `doctor` reports no problems.
- **KeepAlive / `Restart=always`:** a `SIGKILL`ed persistent app came back with a new pid in about 10 s on both
  (launchd's ThrottleInterval 10, systemd's RestartSec=10).
- **`launchctl kickstart -k` on the daemon** took about 10 s to answer again on macOS, against under a second with
  `systemctl --user restart`; probably ThrottleInterval applying to the restart. Fine for a restart command, but worth
  knowing when timing out: `hallway service restart` waits 15 s.
- **Copy-then-truncate rotation works with both service managers' log files:** after the daemon rotated a 300 KB
  `StandardOutPath` / `StandardOutput=append:` file (limit 64 KiB), the rotated copy was 65,500 bytes and the next
  writes landed at the start of the truncated file (20 bytes, not a sparse file at the old offset). So launchd opens
  `StandardOutPath` for appending, as systemd's `append:` does.
- **Validators:** `plutil -lint` accepts the golden plists (`macos-latest`), `systemd-analyze verify --user` accepts
  the generated units (`ubuntu-latest`); `test/services.test.ts`.
- **Not covered by CI:** behaviour across logout/login and reboot (RunAtLoad, a `disable`d job staying stopped,
  lingering at boot), and Macs with a version manager's shims.

The development box these were built on has no systemd at all (PID 1 is `tini` in a container): there the end-to-end
tests and `smoke:pack` use `test/fixtures/fake-systemctl`, which runs the generated units for real, detached.

## The v0 acceptance run (2026-10-16)

The twelve v0 criteria (docs/08-roadmap.md), checked by installing the package the way a user would: `npm pack` of
`main`, `npm i -g` of the tarball into a temporary prefix with a throwaway `HOME`, and the daemon from that install
(`hallway serve`) on a Linux container with no systemd, driven with curl, the CLI and Chromium (Playwright). Demo
apps were `python3 -m http.server` processes in temp directories; bookmarks were `example.com` links.

| # | Result | Evidence |
|---|--------|----------|
| 1 | Not testable here (no systemd in the container; no logout/reboot anywhere) | CI's "Services (real systemd)" (lingering on) and "Services (real launchd)" jobs run `hallway service install`, `restart`, `doctor` (daemon answering, service running) against the real service managers. Neither logs out or reboots. |
| 2 | Pass | With the page open: `apps/foo.yaml` created → card in 216 ms; renamed → 191 ms; deleted → gone in 289 ms (MutationObserver timestamps against the write times). |
| 3 | Pass | `port: 58 02` plus a bad nested mapping: that card shows `apps/foo.yaml:2` and the YAML message, the other card stays healthy, `/api/health` still answers, the file's md5 unchanged. A broken `config.yaml` shows in the problems banner with file:line:col. |
| 4 | Pass | `python3 -m http.server 4567` in `/tmp/…/scratch-notes` appeared as `scratch-notes` with that directory; **Claim** wrote `apps/scratch-notes.yaml` with `port: 4567` and the card moved to Apps. |
| 5 | Pass after a fix | A Node helper listening on port 0 got 40903 from Linux's `ip_local_port_range` (32768–60999) and **was shown**: the filter only knew IANA's 49152–65535. Fixed (`Platform.ephemeralPorts()`); re-run: hidden. |
| 6 | Pass | With the dashboard open (15 s live interval): the `adhoc` app went `stopped` 18 s after its server was killed, the `running` one `down` at 24 s (two probe intervals). |
| 7 | Pass | Two worktrees of one made-up repo on 5811 / 5812: `notes @ branch-a`, `notes @ branch-b` (tray, `hallway scan`, and the claimed cards). |
| 8 | Pass | Two groups (one by `hallway bookmark add`, one hand-written) render as chips in order; appending a link by hand showed on the open page in 191 ms. `example.com` has no favicon, so the chips are monograms (the documented fallback). |
| 9 | Pass | `/` focuses the filter; typing `scratch-notes` gave "1 match · Enter opens it"; Enter navigated to `http://localhost:4567/`. |
| 10 | Pass | `Host: evil.example` → 403 on `/` and `/api/state`; cross-origin JSON `POST` → 403; `text/plain` `POST` → 415; cross-origin form `POST` → 403. |
| 11 | Pass | `/llms.txt` lists the live URL, the data-home path, every app (slug, name, port, expected, URL) and the bookmark groups. |
| 12 | Pass | `performance.getEntriesByName('hallway:painted')` over ten warm reloads of `http://localhost:<port>/` (5 apps, 13 observed, 2 groups): **37–61 ms**, median about 52 ms. A container, not a laptop. |

Found along the way and fixed in the same PR: the observed tray kept the last scan forever after `scan.enabled: false`
(and the first-run screen still promised that a started server would be found); with a broken `config.yaml` the CLI
couldn't find the running daemon and said it wasn't running (D46: `state/daemon.json`); `hallway doctor | head`
died with an EPIPE stack trace; a claimed worktree's card repeated `repo @ branch` under its name; the "Reconnecting…"
pill, shown over stale states while the daemon is stopped, didn't say why. The page reconnects by itself when the
daemon returns (within the 30 s backoff cap). Unhappy paths that already behaved: a fresh data home's first-run
screen, every CLI command with no daemon (`status` probes once, `claim`/`ignore`/`scan` work from the files and one
scan, `open` explains), usage errors exiting 2 with the usage, two apps on one port (a warning on both cards and in
`doctor`), and a 100-character name and description (ellipsis on the card, wrapped in the drawer). *Verified on Linux
(Chromium); unverified on macOS.*

## MCP and agent hooks (2026-10-16)

- **MCP TypeScript SDK.** *Verified* on npm and in the installed packages: v2 is the stable line, split into
  `@modelcontextprotocol/server` **2.3.1** (depends only on `zod` ^4.2 and `@modelcontextprotocol/core`),
  `@modelcontextprotocol/client` 2.3.1, and adapters (`@modelcontextprotocol/hono` 2.0.2, `/node`, `/express`). The v1
  package `@modelcontextprotocol/sdk` is at 1.32.1 and depends on Express, CORS, Hono, `jose`, rate limiting and more.
  v2 implements protocol revision **2026-07-28**. Hallway uses `createMcpHandler(factory, options)`, which returns a
  web-standard `{ fetch, close, notify, bus }`: one server instance per request, `legacy: 'stateless'` (the default)
  answering 2025-era traffic statelessly, `responseMode: 'auto'` (a JSON body unless the handler emits a related
  message first, then SSE). The factory receives `{ era: 'legacy' | 'modern' }`. The Hono adapter package wasn't
  needed: `c.req.raw` is already a web `Request`. TypeScript 7 needs `types: ["node"]`, which `tsconfig.server.json` already has.
- **Streamable HTTP in 2026-07-28** (`https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http`,
  fetched 2026-10-16): every message is its own POST; **no sessions and no GET stream** (servers answer GET and
  DELETE with 405 and ignore `Mcp-Session-Id`); the answer is a JSON object or a request-scoped SSE stream; long-lived
  change notifications arrive on the SSE response of a `subscriptions/listen` request (which replaces
  `resources/subscribe`); clients send `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` (`params.name`/`uri`,
  Base64 in a `=?base64?…?=` sentinel when not header-safe), which servers check against the body (`-32020
  HeaderMismatch`); closing the response stream cancels the request. "Servers **MUST** validate the `Origin` header
  … If the `Origin` header is present and invalid, servers **MUST** respond with HTTP 403"; local servers "SHOULD
  bind only to localhost". *Verified by reading the spec.*
- **Both eras checked against Hallway** with the SDK's own client (`test/mcp.test.ts`, `test/mcp-bridge.test.ts`): its
  default `versionNegotiation: 'legacy'` negotiates `2025-11-25` through `initialize`; `{ mode: 'auto' }` uses
  2026-07-28 and `subscriptions/listen`. `resources.subscribe` has to be in the server's capabilities for a listen
  filter's `resourceSubscriptions` to be honoured (the SDK drops them otherwise, silently). *Verified.*
- **`claude mcp add`** syntax used in the docs (`claude mcp add --transport http hallway http://localhost:4255/mcp`;
  `claude mcp add hallway -- hallway mcp`) is Claude Code's documented form. Not run against this box's real Claude
  configuration (a box rule); the end-to-end checks used the SDK client over HTTP and over a real `hallway mcp`.
- **Claude Code `PreToolUse` hooks** (`https://code.claude.com/docs/en/hooks`, fetched 2026-10-16; resolves Q-HOOK):
  the payload is JSON on stdin with `session_id`, `cwd`, `hook_event_name: "PreToolUse"`, `tool_name: "Bash"` and
  `tool_input: { command, description, timeout, run_in_background }`. To block: either exit 2 with the reason on
  stderr, or exit 0 printing `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
  "permissionDecisionReason": "…"}}` (`allow`, `ask` and `defer` are the other decisions). Configured in
  `settings.json` under `hooks.PreToolUse[]` with `matcher: "Bash"` and `hooks: [{ "type": "command", "command": … }]`.
  *Reported from the docs*; the hook's own behaviour is tested with payloads of that shape. Other agents' hook formats
  (Codex, Gemini CLI, Cursor) are unverified.

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

## The dashboard (v0)

- **Render time, measured 2026-10-16** on Linux (Chromium via Playwright on the same machine as the daemon, loading
  `http://localhost:<port>/` directly, nine apps with 24 h history, three bookmark groups, five observed
  listeners; staged live data). `performance.mark('hallway:painted')`, set on the frame after the first render with
  data: **44–76 ms** over seven warm loads (median about 64 ms), 135 ms on the first, cold load. `GET /api/state`
  answers in about 4 ms (74 KB). One `/api/state` request per load: the `<link rel="preload">` is reused.
  Acceptance criterion 12 asks for under 200 ms. *Verified on Linux; unverified on macOS and in Safari.*
- **Live update latency, measured 2026-10-16:** a new `apps/<slug>.yaml` written with the page open appeared as a
  card 200 ms later (criterion 2 asks for 1 s): the watcher's 150 ms debounce plus one `/api/apps/:slug`. *Verified on
  Linux.*
- **With the real scanner and prober (after PR #4), 2026-10-16, Linux:** declared `expected: running` apps with nothing
  listening show `■ down` ("connection refused"), `expected: adhoc` ones `○ stopped` (criterion 6); two git worktrees
  of one made-up repo serving on 6103 and 6104 show as `dashboard @ main` and `dashboard @ feature-a` (criterion 7); a
  real `python3 -m http.server 6203` appeared in the tray labelled with its directory, and **Claim** wrote
  `apps/scratch-photos.yaml` (`port: 6203`, the commented-out `service:` block); the door appeared and went healthy
  1.6 s later (criterion 4). Fresh uptime bars render as outlines with the first real bucket at the end. *Verified.*
- **Unverified:** the dashboard has only been driven in Chromium. Safari and Firefox (the canvas favicon, `:has()`,
  `color-mix()`, `backdrop-filter`) are unverified; all four are supported in current releases of both.
