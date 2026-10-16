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
