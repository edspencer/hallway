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
| The pf redirect: `rdr pass on lo0` for 443/80 → 4443/4480 in the `com.apple/hallway` anchor, loaded by the `hallway.pf` LaunchDaemon (`pfctl -E -a … -f …`); that it applies to connections from local processes; that it survives another tool reloading `/etc/pf.conf`, an OS update and a reboot; that `pfctl -E`'s enable reference outlives the process | v1 | Built (`server/platform/fronting-darwin.ts`), golden-tested. CI's macOS job runs setup for real; reboot and OS-update survival can't be checked there. |
| `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain` without a GUI prompt; `remove-trusted-cert` and `delete-certificate -Z` on teardown; Safari, Chrome and Firefox (with `security.enterprise_roots.enabled`) accepting the certificate | v1 | Built; CI's macOS job runs the commands and `security verify-cert`; no browser has been driven on a Mac. |
| `/etc/resolver/<base>` with a `port 4253` line reaching Hallway's dnsmasq; `killall -HUP mDNSResponder` | v1 | Built; CI's macOS job runs it. |
| Caddy and dnsmasq as LaunchAgents (`hallway.caddy`, `hallway.dnsmasq`); `brew install caddy`/`dnsmasq` from setup | v1 | Built on PR #7's launchd manager; CI's macOS job runs them. |
| Safari resolving `https://<app>.localhost` (Q-SAFARI-LOCALHOST) | v1 | Not checked. |

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
  `claude mcp add hallway -- hallway mcp`) is Claude Code's documented form, and was checked with a throwaway
  configuration (see the acceptance run below).
- **Claude Code `PreToolUse` hooks** (`https://code.claude.com/docs/en/hooks`, fetched 2026-10-16; resolves Q-HOOK):
  the payload is JSON on stdin with `session_id`, `cwd`, `hook_event_name: "PreToolUse"`, `tool_name: "Bash"` and
  `tool_input: { command, description, timeout, run_in_background }`. To block: either exit 2 with the reason on
  stderr, or exit 0 printing `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
  "permissionDecisionReason": "…"}}` (`allow`, `ask` and `defer` are the other decisions). Configured in
  `settings.json` under `hooks.PreToolUse[]` with `matcher: "Bash"` and `hooks: [{ "type": "command", "command": … }]`.
  *Reported from the docs*; the hook's own behaviour is tested with payloads of that shape. Other agents' hook formats
  (Codex, Gemini CLI, Cursor) are unverified.

## The v2 MCP acceptance run (2026-10-16, Linux)

Run against the packed tarball installed into a throwaway prefix, with a throwaway `HOME` and `HALLWAY_HOME`, the
daemon under a process manager (`hallway serve`, D31's development bind so a browser on the LAN could watch it):

1. **Criterion 1: met.** An SDK client (`@modelcontextprotocol/client` 2.3.1) over Streamable HTTP called
   `add_bookmark` on a group file holding four comments (a file header, a trailing comment on `title:`, one above a
   link). The dashboard, open in a browser beforehand, showed the new link without reloading (a marker set on
   `window` survived), and the file kept all four comments. The same through the installed `hallway mcp` over stdio,
   in the 2026-07-28 era, and over HTTP in both eras.
2. **Criterion 2: met.** `declare_app` with a `service` block was refused and wrote nothing; `update_app` with a new
   `port` was refused. The tool list (16 tools) has nothing that runs, starts, stops or installs a process.
3. **Security:** a POST to `/mcp` with `Host: evil.example.com` or `Origin: http://evil.example.com` got 403; with
   `Content-Type: text/plain`, 415; a GET, 405; the same request with a loopback Host, 200.
4. **Notifications:** a `subscriptions/listen` stream for `hallway://apps/my-app`, opened through `hallway mcp`,
   heard `notifications/resources/updated` within 1.5 s of the file being edited by hand.
5. **Claude Code** 2.1.292, with a throwaway `HOME` and `CLAUDE_CONFIG_DIR` and no credentials:
   `claude mcp add --transport http hallway http://localhost:<port>/mcp` and `claude mcp add hallway-stdio -- hallway
   mcp` were accepted, and `claude mcp list` reported both "✔ Connected". Not run: the hook inside a real Claude Code
   session (it would need a model; tested with payloads of the documented shape). On macOS: unverified, though
   nothing in either is platform-specific.
## "Lost at last reboot", simulated (2026-10-16, Linux)

Run from a build under a process manager (D31's development bind, so a browser on the LAN could drive it), with a
throwaway `HOME` and `HALLWAY_HOME` and `test/fixtures/fake-systemctl` first on `PATH`, so `hallway run`'s jobs really
ran (detached, under the fake's supervisor) without touching a real systemd. `scan.minPort: 7400` kept the machine's
other listeners out.

1. Five demo servers (`python3 -m http.server`): two worktrees of one repository (`dashboard @ main`,
   `dashboard @ feature/new-chart`), `docs-site`, `api`, and `notes` started with `hallway run`. The scanner recorded
   all five in `state/observed.json`.
2. The reboot: the daemon stopped, four servers killed (`api` left running as the control), `state/boot.json`'s boot
   time moved two days before the machine's real one and every `lastSeen` five minutes before it, then the daemon
   started again. The banner said "Lost at last reboot (Mon 17 Aug 12:08): 4 apps"; `api` was correctly absent (still
   listening). Review listed each with `~/Code/… @ branch` and its command.
3. **Restart once** on `docs-site` (no app yet) wrote `apps/docs-site.yaml` on port 7403 with the recorded command and
   started it (`runAtLoad: false`): the row turned `● back` and the door appeared. **Make it a service** on the feature
   worktree did the same with `runAtLoad`/`keepAlive: true` and `expected: running`. A daemon restart kept the notice
   (`state/lost.json`). **Dismiss** removed one row; with the rest back, the banner turned calm ("all 3 are back");
   the banner's Dismiss removed it and `state/lost.json`.
4. A second simulated reboot with `docs-site`'s directory moved away: Restart once was refused under the row, "docs-site
   ran in ~/Code/docs-site, which doesn't exist any more…", and nothing was written. `hallway lost` listed the three
   items with their ids, directories and commands.
5. A start-at-login service that isn't listening yet holds the decision back by `services.startGraceSeconds`, as
   designed (D54): the notice appeared about 30 s after the daemon started, not at once.

Found on the way: `prober.markStarting` was never called, so a freshly started service read `down` until its first
good probe. The daemon now calls it for the starts it makes itself (the lost actions, `POST
/api/apps/:slug/service/start|restart`); a `hallway run` from the CLI, in another process, still doesn't tell the
daemon. **Unverified:** a real reboot, on either OS; anything on macOS.

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

### Fronted mode experiments (D47), Linux, 2026-10-16

Run on a Debian 12 container (no systemd, no `ss`), unprivileged where it matters (`setpriv` to uid 65534 and to an
arbitrary uid with no passwd entry), with throwaway `HOME`, `XDG_*` and data homes, never touching ports 80/443.
Caddy **2.11.7** (the release binary), Node 22.23.3. *Verified* unless marked.

- **Caddy as an ordinary user on high loopback ports:** listening on `127.0.0.1:4443`, `[::1]:4443` and the same on
  4480 works with no privilege.
- **Admin API on a Unix socket:** `"admin": {"listen": "unix//<dir>/admin.sock|0600"}` creates the socket with mode
  `srw-------`; `POST /load` and `GET /config/` work over it (`curl --unix-socket`, and Node's `http.request({socketPath})`).
  Caddy logs "admin endpoint on open interface; host checking disabled" for a socket, which is expected (no browser can
  reach a Unix socket). **Caddy 2.6.4 does not understand the `|0600` suffix** (no socket appears at that path),
  **2.7.6 does** (mode 600), as do 2.8.4 and 2.11.7. All four accept the generated config in `caddy validate`, so
  validate alone doesn't catch 2.6. Minimum: 2.7.
- **Autosave and `--resume` (Q-CADDY-RESUME):** with `persist` on, a pushed config is written to
  `$XDG_CONFIG_HOME/caddy/autosave.json`. `caddy run --config X --resume` then logs "--config and --resume flags were
  used together; ignoring --config and resuming from last configuration" and serves the autosave. With
  `"admin": {"config": {"persist": false}}` no autosave is written. `$XDG_DATA_HOME/caddy/instance.uuid` is written
  regardless of the configured storage.
- **The local CA:** with `pki.certificate_authorities.local.name` set to `Hallway Local CA`, the root is
  `CN=Hallway Local CA - 2026 ECC Root`, valid ten years, in `<storage>/pki/authorities/local/root.crt` (mode 0600 in a
  0700 directory); leaves are issued by `Hallway Local CA - ECC Intermediate` for exactly the requested name and last
  12 hours. `install_trust: false` makes Caddy log "root certificate trust store installation disabled" instead of
  trying to install it (which, unprivileged on Linux, means trying `sudo`). An internal-issuer automation policy with
  no subjects covers every name.
- **Host rewrite (D9):** `headers.request.set.Host = ["{http.reverse_proxy.upstream.hostport}"]` makes the upstream see
  `Host: 127.0.0.1:<port>`, with `X-Forwarded-Host: <name>:<port>`, `X-Forwarded-Proto: https`, `X-Forwarded-For`
  (`127.0.0.1`, or `::1` over IPv6). A strict app that 403s foreign Hosts answers 200 that way and 403 with the Host
  preserved.
- **Fallback:** an `errors` route of `rewrite` to `/fallback.html` plus `file_server` with
  `status_code: "{http.error.status_code}"` serves the page with status 502 when the upstream refuses the connection.
- **HTTP → HTTPS:** Caddy's automatic redirect pointed at `https://<host>/…` with no port even with `https_port` 4443,
  so Hallway turns it off and adds its own `static_response` 308 to the public port.
- **HMR through the proxy (Q-HMR):** a Vite 8.3.4 dev server on `127.0.0.1:5902` behind
  `https://vite.localhost:4443`, Host rewritten, loaded in Chromium (Playwright): the client connected its websocket
  to `wss://vite.localhost:4443/?token=…` ("[vite] connected."); editing an imported module produced "[vite] hot
  updated: /text.js via /main.js" and the new text, and a marker set on `window` beforehand survived (no reload). No
  `server.hmr.clientPort` or `allowedHosts` setting was needed.
- **End to end with the daemon:** a throwaway data home in fronted mode (`proxy.publicPort: 4443`), the daemon from
  source and Caddy started from the `generated/caddy.json` the daemon wrote: `https://<app>.localhost:4443` reached each
  app; an app file created while both ran was routed 1.5 s later with no restart (criterion 3); with the daemon killed,
  `https://hallway.localhost:4443` served the fallback page (502) listing every app (criterion 7); a cross-origin-safe
  write from `Origin: https://hallway.localhost:4443` through Caddy was accepted; `hallway doctor` named a `python3`
  process (with PID and command) squatting on `proxy.httpPort`, and `hallway setup` stopped before doing anything.
- **dnsmasq unprivileged:** dnsmasq 2.90 (Debian 12's `dnsmasq-base`, libraries extracted into a temp directory), run
  as an arbitrary uid with the generated config (`port=4253`, `listen-address=127.0.0.1`, `bind-interfaces`,
  `no-resolv`, `address=/myname.internal/127.0.0.1` and `::1`): A for `myname.internal`, `app.myname.internal` and
  `a.b.myname.internal` → 127.0.0.1, AAAA → ::1, `example.com` → REFUSED. It needs no root on a port above 1024.
- **HSTS preload list:** Chromium's `net/http/transport_security_state_static.json` (fetched 2026-10-16) has 51
  whole-TLD entries with `include_subdomains` (listed in `server/proxy/tld.ts`). **IANA's TLD list** was at version
  `2026101600`.
- Not possible on that machine (no systemd, no `CAP_NET_ADMIN`, and the rule not to touch 80/443): the nftables
  redirect, the system trust store, `systemd-resolved`. CI's Linux job runs those (below).

### Fronted mode in CI, 2026-10-16

`scripts/fronted-real.mjs` in the "Fronted mode (real …)" jobs runs `hallway setup` for real with the runners'
passwordless sudo. **ubuntu-latest** (first run, PR #8): setup installed the nftables table and unit, trusted the root
system-wide (curl with no `--cacert` accepted `https://hallway.localhost`), started Caddy as a systemd user unit; the
strict app answered through `https://review.localhost` with Host rewritten; a newly declared app was routed with no
restart; re-running setup reported the parts already done; doctor's networking checks passed; with the daemon
stopped the fallback listed every app. A later run (38939015729) also passed the custom domain (`systemd-resolved`
drop-in to Hallway's dnsmasq; `https://review.myname.internal` with the system trust store), `.local` refused, and
teardown leaving no file, nftables table, trusted root or job behind.

**macos-latest** (Apple silicon, macOS 26 "Tahoe" bottles), run 38939015729, 2026-10-16. *Verified on a real (CI)
Mac:*
- setup installed Caddy 2.11.7 itself with `brew install caddy` (and later `brew install dnsmasq`, 2.93);
- `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain <root.crt>` ran headless,
  with no authorisation prompt, and `/usr/bin/curl` then accepted `https://hallway.localhost` with no `--cacert`;
- the pf anchor `com.apple/hallway`, loaded by `launchctl bootstrap system /Library/LaunchDaemons/hallway.pf.plist`
  (`pfctl -E -a com.apple/hallway -f …`), **redirects locally originated connections to 127.0.0.1:443 and :80** to
  Caddy on 4443/4480: the dashboard, a strict app with Host rewritten, and an app declared afterwards all answered
  through `https://<name>.localhost`;
- Caddy and dnsmasq ran as LaunchAgents; doctor's checks all passed; with the daemon stopped the fallback listed every
  app;
- **`/etc/resolver/myname.internal` with `nameserver 127.0.0.1` and `port 4253` works**: `https://myname.internal`
  and `https://review.myname.internal` resolved and answered, and other names still resolved. (Homebrew's dnsmasq
  caveat says resolver overrides to 127.0.0.1 on a non-53 port don't work on current macOS; on this runner they did.
  Worth re-checking on a desktop Mac, where mDNSResponder may behave differently.)
- `.local` was refused.
- It then **hung in teardown**: the untrust step ran `security remove-trusted-cert -d`, which edits the admin trust
  settings and can wait for an authorisation prompt even as root. Teardown now only runs `security delete-certificate
  -Z <sha1>`, every command setup and teardown run has a 5-minute timeout, and the CI script times out each call.
- Run 38943464360 then failed setup's own final check on macOS ("nothing answered" on 443 and 80) right after
  `launchctl bootstrap`: the LaunchDaemon's `pfctl` can load the anchor a moment after `bootstrap` returns (and the
  CI's root squatter on 443 was being killed by a pattern, not its pid). Setup's check now waits up to 15 s for the
  redirect. **Run 38944433673 (commit 8c556dc) passed every check on both runners**, macOS included: setup, the
  squatter refused, idempotent re-run, doctor, the fallback, the custom domain, `.local` refused, and teardown leaving
  nothing behind (no anchor, LaunchDaemon, resolver file, keychain certificate or LaunchAgent).

### Fronted mode on a real Mac: pf skipping loopback (D64), 2026-10-17

The first run of fronted mode on a desktop Mac (the author's laptop, Hallway 0.5.2; macOS's version wasn't
recorded). `hallway setup` succeeded at every step but its final check: "✗ https://hallway.localhost: nothing
answered"; doctor: "✗ nothing answers on 127.0.0.1:443: the redirect from 443 to 4443 isn't in place". *Verified on
that Mac:*

- pf was enabled; the main ruleset was stock (`rdr-anchor "com.apple/*"` present); `sudo pfctl -a com.apple/hallway
  -s nat` listed all four rdr rules; the `hallway.pf` LaunchDaemon had exited 0.
- Caddy was fine: `curl --resolve hallway.localhost:4443:127.0.0.1 https://hallway.localhost:4443/` → 200, while
  `nc 127.0.0.1 443` was refused.
- **`sudo pfctl -s Interfaces -v` showed `lo0 (skip)`.** With the skip flag set, pf doesn't evaluate any rule on that
  interface, so every lo0 rule (all of Hallway's) is dead. Stock macOS doesn't set it. `sudo pfctl -s References`
  held a token from a process named `pfd`, its pid long gone, enabled about 67 days earlier, at boot: some
  third-party tool had loaded a ruleset with `set skip on lo0` then. (`set skip on lo0` is in OpenBSD's example
  pf.conf and in many VPN kill-switch and firewall-app rulesets.)
- **Fix:** `sudo pfctl -f /etc/pf.conf` (loading a main ruleset resets the skip flags; the main ruleset was stock, so
  nothing else changed), then `sudo launchctl kickstart -k system/hallway.pf`; 443 answered.
- **Unverified:** whether the skip comes back after a reboot (if the tool behind `pfd` runs at every boot, it will,
  and doctor then says so); whether the `kickstart` is needed at all after the reload (the anchor's rules may survive a
  reload of `com.apple`; it's cheap, so setup and doctor's fix keep it); which tool `pfd` was.
- **Output formats used by the parsers** (`server/platform/fronting-darwin.ts`, fixtures in `test/fixtures/platform/`):
  `pfctl -s Interfaces -v` prints one interface per line, `lo0 (skip)` for a skipped one (pf's OpenBSD heritage);
  `pfctl -s References` (macOS only) prints `TOKENS:`, then a `PID  Process Name  TOKEN  TIMESTAMP` table; the stock
  main ruleset is `nat-anchor`/`rdr-anchor "com.apple/*" all` in `-s nat` and `scrub-anchor "com.apple/*" all
  fragment reassemble`, `anchor "com.apple/*" all` in `-s rules`. The interface and References fixtures are
  reconstructed from that run and from published examples, not captured byte for byte: CI's macOS job checks the
  parsers against the real pfctl (below).
- **CI** (`scripts/fronted-real.mjs`, macOS only): after setup passes, it loads macOS's own pf.conf with
  `set skip on lo0` in front (`(echo 'set skip on lo0'; cat /etc/pf.conf) | sudo pfctl -f -`), checks that 443 stops
  answering and doctor's `redirect` line names the skip with the fix, runs `hallway setup` (which must clear it), then
  sets the skip again and runs doctor's fix as printed. **Run 39037620811 (macos-latest) passed all three:** the real
  `pfctl -s Interfaces -v` output parsed (`lo0 (skip)`), the main ruleset was judged stock, setup's step cleared the
  skip and 443 answered, and so did the printed fix. No enabler was named there (only pfctl references on a runner),
  so the References parser is still checked only against the reconstructed fixture.
- **From the same run, smaller:** Homebrew's auto-update and hints buried setup's steps (setup now runs `brew install`
  with `HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1`), and the first
  `launchctl bootout system/hallway.pf` printed "Boot-out failed: 3: No such process" (expected: nothing was loaded
  yet; now quiet).

### Fronted mode without admin rights (D65, accepted and built: see "The tiers as built" below), 2026-10-17

The question: can fronted mode work on a Mac where the user isn't an admin (an MDM-managed work Mac that grants
admin only for minutes at a time)? Today `hallway setup` needs admin twice: the pf redirect, and trusting the root
in the System keychain. Run on GitHub's runners from the scratch branch `exp/no-admin-fronting` (never merged; the
scripts are in `experiments/no-admin/` there), runs 39037424530, 39039221534, 39039581511 and 39039930886:
**macos-latest** = macOS 26.6.2 (25G83), Apple silicon VM, user `runner` (uid 501, logged in at the console, so
`gui/501` exists), Caddy 2.11.7 from Homebrew, Node 24; **ubuntu-latest** = Ubuntu 24.04.5, kernel 6.17, systemd 255.
Everything below ran as the ordinary user unless it says sudo. *Verified* unless marked.

**1. Low ports without root.**
- macOS, Node as the user: `127.0.0.1:443` EACCES, `[::1]:443` EACCES, `127.0.0.1:80` EACCES, `[::1]:80` EACCES,
  `127.0.0.1:1023` EACCES, `127.0.0.1:1024` OK; **`0.0.0.0:443`, `[::]:443`, `0.0.0.0:80` OK**. The same as the
  author's machine in 2026-10-14 (above): since Mojave the reserved-port check is skipped only for the wildcard
  address. (The same test with Caddy was inconclusive: the throwaway Caddyfile never logged a listener in either
  case, a harness problem, not a finding; Node's result is the kernel's.)
- **A wildcard listener can't be confined to loopback.** `IP_BOUND_IF` = lo0 on a `0.0.0.0` listener, probed with a
  SYN injected through a `feth` pair (so it arrives on another interface, as a LAN packet would): **SYN-ACK**, the same
  as a plain wildcard listener; the `127.0.0.1` listener answered RST. So "bind `0.0.0.0:443` and filter" stays
  rejected (D47): the socket is open to the network whatever the process does after `accept`.
- **launchd binds loopback 443 and 80 for a LaunchAgent, with no sudo.** A LaunchAgent in `~/Library/LaunchAgents`,
  bootstrapped into `gui/501` by the user, with a `Sockets` dictionary asking for `127.0.0.1:443`, `::1:443` and
  `127.0.0.1:80`: `launchctl bootstrap` exit 0; `sudo lsof` shows **`launchd` (PID 1, root) listening on exactly
  those three**; the job's process (as the user) gets them with `launch_activate_socket(3)` and served HTTP on each
  (`curl http://127.0.0.1:443/`, `http://[::1]:443/`, `http://127.0.0.1:80/`). The runner's own address
  (`192.168.64.x:443`) got no answer. launchd creates the sockets as root for the agent, so the kernel's check never
  sees the user. (Prior art: puma-dev's `-install` uses the same `Sockets` key, but on `0.0.0.0`, which needs no
  privilege anyway.)
- **Caddy serves TLS on launchd's sockets.** A LaunchAgent with those three sockets runs a shim that calls
  `launch_activate_socket`, moves the fds to 3, 4, 5 (clearing close-on-exec) and `exec`s `caddy run`, whose config
  listens on `fd/3`, `fd/4` (TLS) and `fd/5` (HTTP). `curl --cacert <root> https://hallway.localhost/` and
  `https://app.localhost/` (over `::1`) answered with Caddy's response **on port 443, with no redirect and no sudo**;
  `http://hallway.localhost/` gave Hallway's 308 to `https://hallway.localhost/`. Two traps: Caddy refuses to start
  if HTTP/3 is on (`network 'fd' cannot handle HTTP/3`; Hallway already sets `protocols: [h1, h2]`), and the fds
  launchd returns can already sit on 3–5 with close-on-exec set, so the shim must `dup` them away first. (The shim
  was Python with `ctypes` here; macOS ships no interpreter that can call `launch_activate_socket` without the
  Command Line Tools, so a product needs a tiny native helper or one of the two below.)
- **Without a native shim**, Caddy on `127.0.0.1:4443` as today, 20 new TLS connections each with `curl`:
  - direct to `https://hallway.localhost:4443/`: 13.3 ms per connection;
  - **inetd mode, `Wait` false**: launchd accepts on `127.0.0.1:443` and runs `/usr/bin/nc 127.0.0.1 4443` per
    connection, its stdin/stdout the client: 20/20, **27.2 ms** per connection (TLS stays end to end; Caddy sees the
    real SNI). Only request/response tested: a long-lived WebSocket and half-close through `nc` are *unverified*;
  - **inetd mode, `Wait` true**: launchd passes the listening socket as fd 0 to one long-lived process; Node's
    `server.listen({ fd: 0 })` accepts on it (`address()` reports `127.0.0.1:443`) and pipes each connection to 4443:
    20/20, **17.3 ms**, then 11.3 ms on a second burst, same PID, `runs = 1`. One socket per job, though: three
    addresses is three Node processes.
- **Conflicts.** A second agent asking for the same `127.0.0.1:443`: `bootstrap` still exits 0 and the job sits
  "not running"; nothing reports the clash, so doctor's TLS handshake that checks Hallway's CA is what catches it. A
  user process already on `0.0.0.0:443` did *not* stop launchd binding `127.0.0.1:443`, and loopback connections went
  to the more specific socket (launchd's). Something already on `127.0.0.1:443` itself (Docker Desktop and friends)
  is *unverified* (expected `EADDRINUSE`).
- Linux: `net.ipv4.ip_unprivileged_port_start` is **1024** on ubuntu-latest, set in no `sysctl.d` file (the kernel
  default); Node as the user gets EACCES on `127.0.0.1:443`, `[::1]:443`, **`0.0.0.0:443`** and `127.0.0.1:80`. A
  **systemd user socket unit** with `ListenStream=127.0.0.1:443`: "Failed to create listening socket
  (127.0.0.1:443): Permission denied", result `resources` (the user manager runs as the user; unlike launchd it binds
  nothing on the user's behalf). *Reported:* no mainstream desktop distribution lowers the sysctl by default; container
  runtimes set it to 0 inside containers, which is no evidence about hosts. Lowering it is machine-wide and root (D47
  already rejected it).

**2. Trusting the root for the user only.**
- The authorisation rights (`security authorizationdb read`, macOS 26.6): `com.apple.trust-settings.user` is
  **`entitled-session-owner-or-authenticate-session-owner`** ("For modifying per-user Trust Settings"), while
  `com.apple.trust-settings.admin` is `entitled` or **`authenticate-admin`**. So
  `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db <root.crt>`, no sudo, needs the
  logged-in user's *own* password (or Touch ID), never an admin's.
- Run headless, it **waits for that dialog and never returns** (killed after 30 s and after 90 s; no trust settings
  written). SecurityAgent's window, read with System Events, says "You are making changes to your Certificate Trust
  Settings. Enter your password to allow this." with a password field. Answering it on CI wasn't possible: the
  runner's password is unknown and can't be reset (`sysadminctl`: "Operation is not permitted without secure token
  unlock"). So: **no admin, one prompt of the user's own** is verified; that the user-domain trust then satisfies
  Safari, Chrome, Apple's curl and `node --use-system-ca` is *unverified on a real Mac* (*reported*: Safari and Chrome
  use the system's trust evaluation, which honours user trust settings; Firefox imports OS-trusted roots with
  `security.enterprise_roots.enabled`, the default on macOS in current releases). Hallway must never run this from a
  job with no GUI session (it hangs), and its timeout matters.
- Before trust, as a control: `security verify-cert -p ssl -s hallway.localhost` on the leaf says "Unable to find at
  least 2 signed certificate timestamps" (the CT check fails first for an unknown root), Apple's curl `(60)`, Chrome
  `ERR_CERT_AUTHORITY_INVALID`, WebKit "certificate … is invalid", Firefox `SEC_ERROR_UNKNOWN_ISSUER` with or without
  `enterprise_roots`.
- `security remove-trusted-cert` (user domain) on a root with no trust settings exits 1 at once; `delete-certificate
  -Z` from the login keychain, no sudo, exit 0. Whether removing *real* user trust settings prompts too is
  *unverified* (it edits the same right, so expect the same dialog).
- *Reported, unverified:* MDM can push trusted roots, but there is no documented restriction that blocks a user from
  trusting a root in their own domain; corporate TLS-inspection or endpoint tools may still flag it.

**3. No certificate at all: secure context of `http://*.localhost`** (Q-SECURE-CONTEXT). A page served on
`0.0.0.0:<port>`, loaded by Playwright's engines (Chromium 156, Firefox 157, WebKit 27.2) and Google Chrome 155, on
both runners:

| Origin | `isSecureContext` | `crypto.subtle` | service worker registers | `getUserMedia`, clipboard | a `Secure` cookie set over http |
|---|---|---|---|---|---|
| `http://localhost:<p>`, `http://127.0.0.1:<p>` | true everywhere | yes | yes | present | kept (Chromium, Chrome, Firefox); **dropped (WebKit)** |
| `http://app.localhost:<p>`, `http://a.b.localhost:<p>` | **true everywhere** | yes | yes | present | the same: **dropped in WebKit** |
| `http://<LAN address>:<p>` (control) | false everywhere | undefined | no API | absent | dropped |

Every engine resolved `app.localhost` and `a.b.localhost` to loopback by itself (WebKit on Linux through
systemd-resolved's `nss-myhostname`; on macOS through the system resolver). So plain HTTP on `*.localhost` keeps the
secure-context APIs; what it loses is `Secure` cookies in Safari's engine (apps whose auth cookies are `Secure` won't
log in there), `__Secure-`/`__Host-` cookies with them, and anything that insists on `https:` (OAuth redirect URIs
registered as https, apps that build `https://` absolute URLs). `.localhost` names aren't on the HSTS preload list,
so nothing forces HTTPS. Custom domains get none of this: `http://app.myname.internal` is not a secure context.

**4. A publicly trusted certificate.** *Reported, not run.* No CA issues for `.localhost` or `.internal` (not
public names; Caddy never tries). A domain the user owns works: a wildcard `*.dev.example.com` from Let's Encrypt over
**DNS-01** (HTTP-01 can't reach 127.0.0.1), with public `A 127.0.0.1` / `AAAA ::1` records for `*.dev.example.com`, so
no resolver file and no trust prompt, and browsers, curl and Node all trust it. The costs: a domain; a DNS provider
API token in the data home; a Caddy **built with that provider's module** (`xcaddy` or caddyserver.com's download
builder; Homebrew's `caddy` has none), which Hallway would then manage; only the wildcard name in CT logs (apps'
names don't leak, unlike per-name certificates); and **DNS-rebinding protection**: resolvers that drop public answers
pointing into 127.0.0.0/8 or private ranges (dnsmasq's `stop-dns-rebind`, OpenWrt's and pfSense's defaults, some
corporate resolvers) make the names fail to resolve on those networks, so it can't be the default. A shared,
Hallway-owned domain with one wildcard certificate and its key shipped in the package is **not an option**: the
CA/Browser Forum Baseline Requirements (4.9.1.1) oblige the CA to revoke a certificate whose private key is
compromised or "publicly distributed in a software package", within 24 hours to 5 days. The workable form of that idea
is plex.direct's: a service that issues each installation its own certificate under its own subdomain, which is a
hosted service Hallway would have to run (out of scope).

#### The same, verified on a real Mac (2026-10-17)

Run by the author on his own Mac (current macOS, not MDM-managed, his user an admin, but nothing run with sudo).
*Verified on a real Mac:*

- **User-domain trust works, with Touch ID only.** A throwaway CA (openssl: RSA 2048, `CA:TRUE`, `keyCertSign`) and a
  leaf for `trust-test.localhost` (SAN, `serverAuth`) it signed, served by Caddy on `127.0.0.1:8443` with
  `auto_https off`. `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ca.crt`, no
  sudo, asked only for **Touch ID**, the user's own (no administrator name and password; to a person it reads as
  "changing system settings"). Then Apple's `/usr/bin/curl` reached the page with exit 0, and **Safari and Chrome
  both loaded it with no warning**. Firefox wasn't installed, so `enterprise_roots` with a user-domain root is still
  unverified. Resolves Q-USER-TRUST for Safari, Chrome and Apple's curl.
- **launchd's `Sockets` on a privileged loopback port, for a user LaunchAgent.** A LaunchAgent in
  `~/Library/LaunchAgents` with `Sockets` → `127.0.0.1:444` and `inetdCompatibility` `Wait` false running
  `/usr/bin/printf`, loaded with `launchctl bootstrap gui/$(id -u)`, no sudo and no prompt:
  `curl http://127.0.0.1:444/` → "launchd works"; the same port on the Mac's en0 address → refused (curl exit 7).
  `lsof` without sudo listed nothing (the socket is root's, launchd's). Port 444 because the pf redirect from today's
  setup intercepts 443 on loopback; the reserved-port rule is the same for every port below 1024. No "Background Items
  Added" notification was mentioned (whether one appeared is unknown).
- Not covered: persistence across logout/login and reboot, 443 and 80 themselves, `[::1]`, Docker or similar already
  holding `127.0.0.1:443`, an MDM-managed Mac.
- **Caddy binds :80 unless told not to.** Caddy given its own certificate (a manual `tls`) still starts the HTTP→HTTPS
  redirect on port 80 and, as the user, fails with EACCES unless `auto_https off` (or an `http_port`) is set. Hallway's
  generated config sets `http_port` and does its own redirect (D47), so it isn't affected; anything hand-written for
  the no-admin design must do the same.
- **zsh's paste handling.** With oh-my-zsh's `url-quote-magic`, pasting multi-line commands escaped `;`, `>` and `(`
  that followed URLs, breaking them. Commands Hallway prints for copying should avoid shell metacharacters right after
  a URL, or say to run them in bash (D65).

### The tiers as built (D65), 2026-10-17

The author chose option 2 (Node forwarders). What was run while building it, on Linux (Debian 12 container, no
systemd: `test/fixtures/fake-systemctl` ran the user units; Caddy 2.11.2 release binary; `certutil` 3.87 from
Debian's `libnss3-tools`, unpacked into a temp directory; a throwaway `HOME` and data home). *Verified:*

- **No prompts** (`--trust none`): setup with no prompt at all; Caddy serves plain HTTP on 4480 only (no HTTPS server,
  no CA made); `http://review.localhost:4480` reached a strict app with Host rewritten (`X-Forwarded-Host:
  review.localhost:4480`); `/api/state` gave every app `http://<slug>.localhost:4480`; doctor: plain HTTP answers, and
  the Safari `Secure`-cookie note.
- **No admin** (`--trust user`): setup made `~/.pki/nssdb` itself (`certutil -N --empty-password`; Chrome hadn't run)
  and added the root, no sudo; `https://review.localhost:4443` with `--cacert <root>`; `http://…:4480` → 308 to
  `https://…:4443`; doctor: "trusted for your account (your NSS database)" and the info line on who else won't trust it.
  Caddy was *not* restarted between tiers (same pid): the new config went over the admin socket.
- **Switching** none → user → none removed the NSS entry; teardown from user removed the NSS entry and Caddy's job
  and cleared `proxy.trust`/`proxy.scheme`/`proxy.publicPort`.
- **The forwarder** (`hallway forward 4480 --listen 5280`, as launchd runs it but on a port instead of fd 0) in front
  of Caddy (plain HTTP) in front of a Vite 8 dev server: in Chromium (Playwright), `[vite] connected.`; after 20 s
  idle, editing an imported module hot-updated the page (the text changed, a marker set on `window` survived: no
  reload). The unit tests drive the pipe through a WebSocket upgrade, half-close, a 32 MB transfer to a paused reader
  (the upstream is made to wait: backpressure), a refused upstream (said once, still accepting) and a client reset.

**CI's macOS runner (macos-latest), run 39051974164, 2026-10-17, passed every check:** 0.6.0's System-wide setup from
npm (pf anchor, `hallway.pf`, System keychain), then this build's `setup --trust system`: the pf files and rules gone,
the four forwarders loaded, `https://hallway.localhost` answering throughout and after, on `127.0.0.1` and `[::1]`
(443 and 80); doctor named 0.6.0's pf redirect as left over before the move. Then the v1 criteria with launchd's
sockets; pf loaded with `set skip on lo0` and 443 still answered; a TLS connection to 443 idle for 30 s, then a request,
answered; the custom domain; No admin as a plan; No prompts for real (`http://review.localhost` through the forwarder on
80, nothing on 443); teardown leaving no forwarder, pf file or trust. One bug it found: once launchd had started the
forwarders, `lsof` showed `node` on 443/80 and setup refused to run again; it now recognises its own `cli.js forward`.

*Not run here, so unverified until CI's macOS job or a real Mac (the macOS job now covers what isn't listed below):* everything launchd does with the forwarders' plists
(`Sockets` with inetd `Wait`, the fd 0 handover to Node, on 443 and 80, `127.0.0.1` and `::1`), and the macOS trust
steps. CI's "Fronted mode (real launchd, keychain)" job runs all of it except the No admin trust step (a Touch ID
dialog nobody can answer on a runner), including migrating from 0.6.0's pf redirect. **Still unverified on a real
Mac** (the list in D65): the No admin trust step run by setup; Safari and Chrome through the forwarders; Vite HMR
through launchd → forwarder → Caddy; the forwarders after logout/login and a reboot; removing real user trust settings
(may prompt); Firefox's `enterprise_roots` with a user-domain root; setup's trust dialog when the daemon (a
LaunchAgent) runs it; Docker Desktop or similar already on `127.0.0.1:443`; MDM blocking user LaunchAgents with
`Sockets`, and the "Background Items Added" notification.

### Loopback in both families (D68), Linux, 2026-10-18

The author's real-Mac run of 0.7.0: Vite 8 started by `hallway run hmr -- npx vite --port '$PORT' --strictPort` logged
`Local: http://localhost:5100/` and listened on `[::1]:5100` only (Node on macOS resolves `localhost` to ::1 first, and
Vite binds what it resolves to). Hallway checked 127.0.0.1 only, everywhere. Experiments here (Node 22.23, Caddy
2.11.7 release binary, `/etc/hosts` with `127.0.0.1 localhost` and `::1 localhost`):

- **Caddy, upstream `localhost:<port>`**, a plain HTTP route per app, with servers on `::1` only, `127.0.0.1` only and
  both: all three answered 200 through Caddy in ~4 ms (no Happy Eyeballs delay: a refused connection on loopback fails
  at once, and Go's dialer moves straight to the next address); `{http.reverse_proxy.upstream.hostport}` is
  `localhost:<port>`, so that's the `Host` the app sees; the dual-stack server was reached on `::1` (the resolver's
  order); a port with nothing on it in either family gave 502, so the fallback page still shows. Changing the upstream
  back to `127.0.0.1:<port>` makes the `::1`-only route 502: `test/proxy.test.ts` pins both ways with the real Caddy
  where CI installs one (the Linux fronted-mode job).
- **Node's `fetch('http://localhost:<port>/')`** reached a `::1`-only and a `127.0.0.1`-only server alike
  (`autoSelectFamily`, on by default since Node 20, tries every resolved address); so thumbnails use `localhost`.
- **`hallway run`** with a `::1`-only server (fake-systemctl, `test/cli-services.test.ts`) comes up at once and prints
  `(listening on [::1]:<port>)`; `status --json` reports `health.address: "::1"`.
- **Unverified on macOS:** Caddy's resolver on a Mac (release builds are CGO-free; Go on darwin resolves through the
  system's libSystem calls). CI's macOS fronted-mode job now checks a `::1`-only app at `https://hmr.localhost`
  (`scripts/fronted-real.mjs`), which covers it on a runner; a real Mac with Vite is still to do.

## Windows (D58), GitHub's hosted runners, 2026-10-16

Everything here was seen on `windows-latest` (Windows Server 2025, an administrator account, no interactive desktop),
Node 22.13, 22 and 24. **Nothing has been run on a real Windows desktop**; each item says what that leaves open.

**Stage A, the baseline (PR "Windows: decision, CI baseline"):**

- The first unmodified run: 60-odd failures in four families. (1) `UnsupportedPlatformError` wherever the scanner,
  services or CLI asked for the platform. (2) CRLF: Git for Windows checks out with `core.autocrlf=true`, so every
  golden file, fixture and `AGENT-GUIDE.md` read back with `\r\n` (the guide's section finder failed, and the lsof
  fixture's process names ended in `\r`). Fixed for every checkout with `.gitattributes` (`* text=auto eol=lf`), not
  by tolerating CR in the parsers. (3) Paths: tests that wrote POSIX expectations (`/home/someone/.hallway`), and code
  that built POSIX-only things with the native `path` (launchd and systemd files, the fronting recipes). (4) The PATH
  trap and service specs: POSIX exec bits and `#!` lines, which Windows doesn't have.
- `fs.accessSync(p, X_OK)` is `F_OK` on Windows, and an executable is `.exe`/`.cmd` by `PATHEXT`, not by mode bits:
  `server/services/resolve.ts` is POSIX-only as written. Its tests are skipped on Windows until managed services
  exist there (stage C).
- `os.tmpdir()` is under the home directory on Windows (`C:\Users\<user>\AppData\Local\Temp`), and it's an 8.3 short
  name (`RUNNER~1`) where git and the OS report the long one. Two consequences: tests that assumed a temp path is
  never shown as `~\…` were wrong; and **a real bug**: `hallway run` wrote `cwd: ~/…` with this process's home but the
  job's spec expanded it with the `Services` home, which differ in tests (and could with `$HOME` overrides). Fixed:
  both use `Services.homeDir`. The test fixture now uses `fs.realpathSync.native`, which expands short names.
- git prints `C:/Users/…` (forward slashes) from `rev-parse --show-toplevel`; `identify.ts` now `path.resolve`s it.
- The watcher's event keys were `file:bookmarks\g.yaml` on Windows; the store's names use `/`. Keys use `/` now.
- `npm` is `npm.cmd`, which `execFile` refuses without a shell (Node's 2024 fix for CVE-2024-27980). `smoke:pack`
  runs npm's own script (`$npm_execpath`) with the running Node instead. A global install with `--prefix` puts the
  shim at `<prefix>\hallway.cmd` and the package at `<prefix>\node_modules\hallway` (no `bin\` or `lib\`).
- Killing a process started through a `.cmd` shim kills `cmd.exe` and leaves Node running; `smoke:pack` starts the
  daemon with `node …\dist\server\cli.js` there.
- Unix sockets: `net.Server.listen(<path>)` on Windows wants a named pipe (`\\.\pipe\…`); a path in the data home
  fails with `EACCES`. Caddy's admin socket is therefore one more reason fronted mode is out of scope (D58).
- Result: 428 tests pass on Windows, 13 are skipped with their reason (`onWindows()`), and `smoke:pack` packs,
  installs, runs `--version`, `--help`, `guide`, serves (health, state, the watcher, `llms.txt`, the dashboard and its
  assets, the Host check), and checks that `run`, `service install` and `setup` refuse with the reason.
- Unverified on a real Windows desktop: `hallway open` (`rundll32 url.dll,FileProtocolHandler <url>`; there's no
  browser on the runner); boot time from `os.uptime()` across sleep and Fast Startup (a "shutdown" with Fast Startup on
  is a hibernation, so the boot time doesn't move and nothing would be reported lost).

**Stage B, the scanner (D59; PR "Windows: the scanner"):**

- Captured on the runner (`scripts/capture-win32.mjs`, kept as `test/fixtures/platform/win32-*`): netstat lists 25
  IPv4 and 21 IPv6 listening rows on a fresh runner. Among them are `System` (PID 4) on 80, 445, 5985, 5986 and 47001
  (HTTP.sys: WinRM and friends), `sshd` on 22, `svchost` on 3389, MSMQ on 1801 and 2103–2107, and the usual service
  hosts on 49664 and up. Everything below 1024, in the ephemeral range, or a known service host is filtered out, so
  the tray on a fresh runner is empty apart from what a test starts. `netsh … dynamicport tcp` gives 49152 + 16384,
  IANA's range.
- Listing (two netstats and a tasklist, in parallel) takes about 0.35 s.
- One PowerShell call (Win32_Process plus the PEB reader, compiled with `Add-Type`) took 13.5 s the first time on one
  fresh runner and 4.1 s on another; after that it takes 0.55–0.6 s. The first call pays for .NET, CIM and the C#
  compile, so the first scan after a daemon start on Windows is slow, and the rest aren't. (The call's timeout is 30 s.)
- **The working directory without administrator rights, verified:** CI's "Scanner (real Windows, standard user)" job
  creates a local account that is only in `Users`, grants it the batch-logon right, and runs
  `scripts/scanner-real-win.mjs` as that account through a one-off scheduled task.
  - Its own listener was found, named `node`, with the right working directory, command line and parent.
  - Of the other 13 listeners (SYSTEM's, services' and the administrator's processes), all 13 were described, and
    none had a working directory. That is the intended behaviour: it can't read them, and nothing failed.
  - As the runner's administrator (elevated), 10 of those 13 had one.
- Things that tripped the job up along the way, for whoever touches it next:
  - `net user <name> <password> /add` stops to ask a question when the password is over 14 characters.
  - `New-LocalUser` creates an account in no group at all.
  - A task with a stored password is a batch logon, a right only administrators have by default (granted with
    `secedit`).
  - `schtasks /Run` returns while the task is still `Ready` (last result 0x41303, "has not run yet"), so the script
    waits for the verdict line, not for the task's state.
- Unverified on a real Windows desktop: an interactive user's dev servers, which is the same token situation as this
  test, though not run as such; 32-bit (WOW64) processes, which are skipped and report no directory; and a
  non-English Windows, where the parsers deliberately use columns and addresses rather than words. That last point is
  tested only against a synthetic German sample.
- Also unverified there: servers started from an *elevated* terminal (their PEB is out of reach of a non-elevated
  daemon, so the tray shows the command line instead), and WSL's servers (their listeners show up as `wslrelay` or
  `wsl`, with no Windows directory).

**Stage C, managed services (D60):**

- CI's "Services (real Task Scheduler)" job (`scripts/services-real.mjs`, the same script as the launchd and systemd
  jobs) passed on its first run on `windows-latest`. It covered:
  - `service install` registering `\hallway.daemon` and the daemon answering;
  - `service restart`;
  - `hallway run` and its logs;
  - stop (task disabled, port closed), start and restart;
  - `--persist` bringing an app back after its process was killed (pid 7236 → 3032, through the supervisor's 10 s
    restart);
  - log rotation while the job writes: rotated 65 512 bytes; the live file was 20 bytes after the truncation, so
    the supervisor's append-mode handle writes at the new end;
  - regenerate, doctor, and removal leaving no task and no files.
- The runner's account has an interactive session, so `InteractiveToken` tasks run on `/Run`.
- **Found by that run:** doctor split a job's PATH on `:`, which cut every `C:\…` entry in two and warned about all
  of them. It now uses the OS's delimiter, and the script asserts there are no PATH warnings.
- npm on Windows puts three files per bin in its prefix: `vite` (a `#!/bin/sh` script), `vite.cmd` and `vite.ps1`.
  Looking `vite` up without `PATHEXT` finds the sh script, which Windows can't run. Hallway looks names up with
  `PATHEXT`, as cmd.exe does, and runs a `.cmd` through `cmd.exe /d /s /c` (Node refuses to spawn one without a shell
  since the CVE-2024-27980 fix).
- Unverified on a real Windows desktop:
  - a real logon starting the tasks (the runner has no logon to test with), and a logoff stopping them;
  - `conhost --headless` showing no window (the runner has no visible desktop);
  - a standard user registering tasks: the runner is an administrator. A standard user may register tasks for
    themselves by default, but that's untested here.

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

## Thumbnails and the 90-day view (v2 criteria 3 and 4), Linux, 2026-10-16

- **Setup:** the daemon from this branch under a throwaway `HOME` and `HALLWAY_HOME`, with six generic demo apps on
  loopback (five healthy, one down; two with favicons), the scanner off.
- **The card as the no-favicon fallback, judged on screenshots:** with cards on the four favicon-less doors the
  dashboard read worse: each card repeated the name printed beneath its door, and the address plate shrank to about
  7 px at door size. Enlarging the plate's type made the card readable as an image on its own (the API's 640×400
  PNG), but not better than the monogram door in the grid. Outcome: cards are `thumbnails.mode: card`, never an
  automatic fallback (D55). The card renders in ~10 ms; the same model gives the same PNG bytes every time.
- **`hallway thumbs enable` (criterion 3):** 26 s on this box. npm put playwright-core 1.64.1 (14 MB) in
  `cache/browser/node_modules/`, and its installer put `chromium_headless_shell-1248` and `ffmpeg-1013` (278 MB
  together; ffmpeg comes along even with `--only-shell`) in `cache/browser/ms-playwright/`; nothing appeared in the
  real home's `~/.cache/ms-playwright`. The running daemon saw the config change, and `hallway thumbs refresh` shot
  all five healthy apps in 3 s (PNGs of 3–9 kB at 640×400); the down app kept its monogram. The doors showed the
  screenshots as glass in both themes. `hallway thumbs disable` reported "Deleted the browser (304 MB)", the daemon
  switched the doors back to favicons and monograms without a restart, and no Chromium process was left.
  *Verified on Linux; unverified on macOS* (Playwright's installer and `deviceScaleFactor: 0.5` are cross-platform,
  but the run hasn't been done on a Mac).
- **The base install (criterion 3):** `npm pack` went from 836.1 kB to 933.8 kB (1.4 → 1.6 MB unpacked; the three
  font files are 160 kB). Installed into a throwaway prefix: no playwright, playwright-core or puppeteer in
  `node_modules`, no browser directory anywhere under the prefix; `@resvg/resvg-js` adds 68 kB and its 4.2 MB native
  binary for the platform. The installed package served a card in card mode in 10 ms. `smoke:pack` now asserts the
  no-browser part.
- **The 90-day view (criterion 4):** 30 apps and 90 days seeded through `UptimeStore.add` (four samples an hour back
  to 48 h, then one a minute: 340 k samples), then `prune` (4.7 s, rolling up 64.8 k hours). Before D57: 90 days for
  one app 45–54 ms (28 ms of it the rollup scan every `history()` starts with), all 30 in a row 1.25 s; 7 days 29 ms;
  24 h 31 ms. After: 90 days 6–7 ms, all 30 160–175 ms; 7 days 0.7 ms; 24 h 3.5 ms. Through the daemon,
  `GET /api/apps/app-7/history?window=90d` (21.5 kB) took 24 ms cold and 2.3 ms warm; `/api/state` with 30 apps
  45 ms warm. In Chromium over the LAN proxy, clicking "90 days" in the drawer to 90 painted bars and the latency
  chart took 40–43 ms (six apps). *Verified.*

## Supervised vs orphaned, and listeners in non-project directories (D62), 2026-10-16

- **The report:** 0.5.0 on a real Mac marked three listeners **orphaned**: a LaunchAgent running from its own project
  directory, a `brew services` job (cwd `/opt/homebrew`, named "Homebrew @ stable" after the prefix's own git
  repository), and a launchd job started in `/` that answered HTTP on `*`. All three have PPID 1 because launchd runs
  them, which is also where a true orphan ends up.
- **macOS, `launchctl list`:** run as the user, it prints `PID\tStatus\tLabel` under a header, with `-` for a loaded job
  that isn't running. On GitHub's macOS runner (macos-latest, arm64), a LaunchAgent loaded with `launchctl bootstrap
  gui/<uid>` appeared in it with its PID, and `hallway scan --json` reported the listener as
  `supervisor: { manager: 'launchd', label: 'com.example.hallway-supervised' }`, `orphaned: false`
  (`scripts/supervisors-real.mjs`). *Verified on GitHub's macOS runner; unverified on a real Mac* (a desktop login
  session, `brew services` jobs and apps launched from the Dock, whose labels are `application.<bundle id>.<n>.<n>`).
  Whether `launchctl list` from a process outside the Aqua session (an SSH login, say) lists the gui domain's jobs is
  unverified too; the daemon runs as a LaunchAgent in that session, so its own scans are the case that matters.
- **A shell trap found on the way:** `sh -c 'cd dir && node server &'` on macOS backgrounds the whole `&&` list as a
  subshell, which stays alive as node's parent, so the process is *not* an orphan, and Hallway correctly said so.
  `cd dir; node server &` gives a real one (PPID 1 once the shell exits).
- **Linux, `/proc/<pid>/cgroup`:** on GitHub's Ubuntu runner, with lingering on, a listener started by
  `systemd-run --user --unit=hallway-supervised-check.service` was reported `supervisor: systemd:
  hallway-supervised-check.service`, `orphaned: false`. Its parent was the user manager (PID 1161), the subreaper the
  old rule counted as an orphan's parent. A server whose shell exited inside `systemd-run --user --scope` (as a terminal
  leaves one) was `orphaned: true` with no supervisor. *Verified.*
- **Linux without systemd (this development box, a container whose PID 1 is `tini`, cgroup `0::/`, read-only
  cgroupfs):** a fake unit couldn't be made here. A double-forked server (PPID 1) was reported `orphaned: true,
  supervisor: null` by the built CLI, so a machine without systemd behaves as before. *Verified.*
- **Windows:** unchanged (D62): no supervisor lookup; orphaned means the parent has exited.
