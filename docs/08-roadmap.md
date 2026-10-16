# 08 — Roadmap and acceptance criteria

Each milestone is shippable and useful on its own. Acceptance criteria are written to be checked by running the
thing, not by reading the code.

## v0 — The front page

> **Status: done, released as 0.1.0 (2026-10-16).** Every criterion below was checked by running the packed tarball
> on Linux (results and numbers: `11-research-notes.md`, "The v0 acceptance run"). Caveats, honestly: criterion 1's
> "after logging out and back in, and after a reboot" was not run: CI's real launchd and systemd jobs install the
> daemon, restart it and check it answers (systemd with lingering on), but never log out or reboot; and macOS has
> only been exercised on CI runners, so the items in `11-research-notes.md`, "Platform support (D26): unverified on
> macOS", still stand. v1's managed services (`hallway run`, `stop`/`start`/`restart`/`logs`,
> `hallway service add/rm/regenerate`, log rotation) shipped early, in the same release.

**Scope:** daemon; dashboard; YAML store with live updates; health probes with state and 24 h history; scanner with
identity, claim and ignore; bookmarks; favicon/colour thumbnails; agent guide and `llms.txt`; `hallway service install`
for the daemon itself; `hallway doctor` (daemon/data checks). **Direct mode only. No sudo anywhere.**

**Platforms (D26):** macOS and Linux, behind `server/platform/`. On Linux, `hallway service install` writes a systemd
user unit and the scanner uses `ss` (or `/proc`); on macOS, a LaunchAgent and `lsof`. Every criterion below is checked
on Linux by running it; macOS behaviour that can't be run from a Linux machine is implemented, unit-tested, and listed
as "unverified on macOS" in `11-research-notes.md` until it has been run on a Mac.

Acceptance criteria:

1. `npm i -g hallway && hallway service install` → `http://localhost:4255` serves the dashboard, and it is still
   serving after logging out and back in, and after a reboot (a LaunchAgent on macOS; a systemd user unit on Linux,
   with lingering enabled if it should run without a login session).
2. Creating `apps/foo.yaml` with `name` and `port` in an editor makes a card appear on an already-open dashboard
   within 1 s, without a reload. Editing and deleting the file are reflected the same way.
3. Writing a syntactically broken `apps/foo.yaml` shows an error on that card (file, line, message) while every other
   card keeps working; the daemon does not crash; the file is not modified.
4. Starting `python3 -m http.server 4567` in some directory makes it appear in the observed tray within one scan
   interval, labelled with that directory; clicking **Claim** writes `apps/<slug>.yaml` with `port: 4567` and the card
   moves into Apps.
5. IDE/agent helper listeners on ephemeral ports do not appear in the observed tray by default.
6. Stopping a server declared `expected: running` turns its card `down` (alarm) after two probe intervals; one
   declared `expected: adhoc` turns `stopped` (neutral) instead.
7. Two worktrees of one repo running the same app on different ports show as `repo @ branch-a` and `repo @ branch-b`.
8. Bookmarks from `bookmarks/*.yaml` render as favicon chips in their groups; editing a file updates the page live.
9. `/` focuses the filter; typing a unique match and pressing Enter opens it.
10. A request to the daemon with `Host: evil.example` gets 403; a cross-origin `POST` gets 403/415.
11. `curl localhost:4255/llms.txt` returns the agent guide summary with the live data-home path and app list.
12. The page fully renders in < 200 ms from a warm daemon on a laptop (measure).

## v1 — Fronting and services

**Scope:** `hallway run`, `hallway stop/start/restart/logs`, `hallway service add/rm/regenerate` (launchd for apps); Caddy
integration via admin API; fronted mode on `*.localhost` with HTTPS; Host rewriting; dashboard fallback page;
`hallway setup` / `hallway teardown`; networking checks in `hallway doctor`; custom-domain mode (dnsmasq + `/etc/resolver`); bind
address indicator; "Lost at last reboot"; log rotation. On Linux (D26): systemd user units for apps, a `*.localhost`
resolution check, an nftables redirect from 443/80 to the user's Caddy (D47; `setcap` was considered and rejected),
and custom-domain DNS via a `systemd-resolved` drop-in pointing at Hallway's user-level dnsmasq.

> **Status: built.** Fronted mode was released in 0.2.0 (D47, D48), "Lost at last reboot" in 0.3.0 (D54); managed
> services and log rotation shipped early, in 0.1.0. What is not yet checked: browsers on a real Mac, and anything
> across a real logout or reboot. One piece of v1's UI isn't built: the drawer's Start / Stop / Restart and log tail
> for managed services (`05-ui.md`; the API behind them is). Criterion by criterion (sections are in `11-research-notes.md`):
>
> | # | Result | Evidence |
> |---|--------|----------|
> | 1 | Met | CI's "Fronted mode (real …)" jobs run `setup` for real on Linux and macOS; re-running it reported the parts already done ("Fronted mode in CI"). `--print`'s plans are golden files in `test/setup.test.ts`. |
> | 2 | Partly | The certificate is trusted system-wide on both CI runners (`curl` with no `--cacert`; `security verify-cert` on macOS). **No browser has been driven on a Mac**: Chrome, Safari and Firefox are unchecked (Q-SAFARI-LOCALHOST). |
> | 3 | Met | `https://review.localhost` reached a strict app with Host rewritten, and an app declared while running was routed with no restart (CI, both OSes; by hand on Linux, "Fronted mode experiments"). |
> | 4 | Met on Linux | Vite 8 behind `https://vite.localhost:4443` in Chromium: hot update with no reload ("Fronted mode experiments"). Not tried on a Mac. |
> | 5 | Partly | `hallway run` and `--persist` (KeepAlive / `Restart=always` bringing a killed app back) on real launchd and systemd ("Managed services on real launchd and systemd"). "After a reboot … listed under Lost at last reboot" only in simulation ("Lost at last reboot, simulated"); no real reboot on either OS. |
> | 6 | Partly | The generated `PATH`: `test/services.test.ts` and `test/cli-services.test.ts` (a fake fnm layout; no `fnm_multishells` entry). `doctor`'s `job-path` check is built (`server/commands/doctor.ts`) but has no test feeding it a bad job. Not run on a Mac with fnm. |
> | 7 | Met | With the daemon stopped, the fallback page listed every app (CI, both OSes). |
> | 8 | Met | A squatter on 443 named by `doctor` with PID; `setup` stopped (CI, both OSes; by hand on Linux). |
> | 9 | Met | `https://myname.internal` and `https://review.myname.internal` through Hallway's dnsmasq (CI: `systemd-resolved` drop-in, `/etc/resolver`); the made-up-TLD warning against IANA's list: `test/setup.test.ts`. |
> | 10 | Met | `.local` refused (CI, both OSes; `test/setup.test.ts`). |
> | 11 | Met | Teardown left no anchor, LaunchDaemon, nftables table, resolver file, trusted root or job behind (CI run 38944433673, both OSes). |
> | 12 | Met | Copy-then-truncate rotation against real launchd and systemd log files, with a small limit (CI). |

Acceptance criteria:

1. `hallway setup --print` prints every privileged command with an explanation and executes nothing. `hallway setup` runs
   them, prompting via `sudo`, and is safe to re-run.
2. After `hallway setup`, `https://hallway.localhost` shows the dashboard with a trusted certificate in Chrome and
   Safari (and Firefox after the documented setting).
3. Declaring `apps/review.yaml` (Local Review on 5622) makes `https://review.localhost` work **with no sudo and no
   restart** — and Local Review does not answer `403 forbidden host` (Host rewrite works).
4. A Vite or Astro dev server fronted at `https://<slug>.localhost` has working hot reload (HMR websocket).
5. `hallway run demo -- npx vite --port $PORT --strictPort` returns within 30 s printing the URL; closing the terminal
   that ran it does not stop the server; after a reboot it is `stopped` and listed under "Lost at last reboot";
   with `--persist` it is running again after a reboot.
6. A generated plist's `PATH` starts with the resolved Node's `bin` directory and contains no per-shell
   version-manager directories (e.g. `fnm_multishells`) or non-existent entries; `hallway doctor` flags a plist that does.
7. Stopping the daemon makes `https://hallway.localhost` serve the fallback page listing all apps with working links.
8. With something else holding :443, `hallway doctor` names the process and PID and suggests a fix; `hallway setup` stops
   instead of fighting it.
9. `hallway setup --domain myname.internal` makes `https://myname.internal` and `https://review.myname.internal` work;
   `hallway doctor` reports dnsmasq bound to loopback only. With a made-up TLD instead, `hallway doctor` warns and checks the TLD
   against IANA's list.
10. `hallway setup --domain foo.local` is refused with an explanation of the mDNS conflict.
11. `hallway teardown` returns the machine to its prior state (no LaunchDaemons, resolver file, drop-ins or trusted root
    left behind) and the dashboard keeps working in direct mode.
12. A managed app writing 50 MB of logs ends up with rotated files no larger than the configured limit.

## v2 — Agents and polish

**Scope:** MCP (Streamable HTTP at `/mcp` + `hallway mcp` stdio); optional screenshot thumbnails; generated-card
thumbnails; 7 d / 90 d uptime from hourly rollups with latency charts; `hallway hook check-command`. (Linux support
moved forward to v0/v1: D26.)

> **Status: mostly built.** MCP and the dev-server hook were released in 0.2.0, screenshot thumbnails, generated cards
> and the fast 90-day view in 0.3.0 (D55–D57). Criteria 1–4 are met (1 and 2 on 2026-10-16: `11-research-notes.md`,
> "The v2 MCP acceptance run"; 3 and 4 the same day: "Thumbnails and the 90-day view"). Criterion 5, a real Mac, is
> what's left.

Acceptance criteria:

1. ✅ An MCP client can `add_bookmark` and the dashboard shows it live; it appears in the YAML file with comments in that
   file preserved.
2. ✅ `declare_app` with a `service` block is rejected; no MCP tool can start a process.
3. ✅ `hallway thumbs enable` downloads a browser into the data home and healthy apps get screenshots; `hallway thumbs disable`
   removes it; the base install never depends on it. (D56; `smoke:pack` checks the last part.)
4. ✅ The 90-day view renders from rollups only and stays fast with 30 apps. (D57; `test/uptime-perf.test.ts`.)
5. Every v0 and v1 criterion has been run on a real Mac, and nothing is left marked "unverified on macOS" in
   `11-research-notes.md`.

## Later (unscheduled ideas)

- Lazy start: a stopped managed app is started on first request to its hostname (puma-dev style); Caddy would route
  to the daemon, which starts the app and redirects.
- macOS notifications when an `expected: running` app goes down.
- Health checks for remote bookmarks (opt-in, per link).
- Docker / process-compose discovery adapters.
- A Homebrew tap.
- *(Brought forward: the documentation website is being built in `website/` alongside v0, D30.)* It should include a short **"Why the name"** origins page: the project's original name and why it was renamed (D1),
  and the hallway imagery behind the visual identity (D23).
- Import from Homepage/Dashy/Homer configs (bookmarks).
- Multiple base domains / aliases.
