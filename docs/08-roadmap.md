# 08 — Roadmap and acceptance criteria

Each milestone is shippable and useful on its own. Acceptance criteria are written to be checked by running the
thing, not by reading the code.

## v0 — The front page

**Scope:** daemon; dashboard; YAML store with live updates; health probes with state and 24 h history; scanner with
identity, claim and ignore; bookmarks; favicon/colour thumbnails; agent guide and `llms.txt`; `sj service install`
for the daemon itself; `sj doctor` (daemon/data checks). **Direct mode only. No sudo anywhere.**

Acceptance criteria:

1. `npm i -g spaghetti-junction && sj service install` → `http://localhost:7724` serves the dashboard, and it is still
   serving after logging out and back in, and after a reboot.
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
11. `curl localhost:7724/llms.txt` returns the agent guide summary with the live data-home path and app list.
12. The page fully renders in < 200 ms from a warm daemon on a laptop (measure).

## v1 — Fronting and services

**Scope:** `sj run`, `sj stop/start/restart/logs`, `sj service add/rm/regenerate` (launchd for apps); Caddy
integration via admin API; fronted mode on `*.localhost` with HTTPS; Host rewriting; dashboard fallback page;
`sj setup` / `sj teardown`; networking checks in `sj doctor`; custom-domain mode (dnsmasq + `/etc/resolver`); bind
address indicator; "Lost at last reboot"; log rotation.

Acceptance criteria:

1. `sj setup --print` prints every privileged command with an explanation and executes nothing. `sj setup` runs
   them, prompting via `sudo`, and is safe to re-run.
2. After `sj setup`, `https://junction.localhost` shows the dashboard with a trusted certificate in Chrome and
   Safari (and Firefox after the documented setting).
3. Declaring `apps/review.yaml` (Local Review on 5622) makes `https://review.localhost` work **with no sudo and no
   restart** — and Local Review does not answer `403 forbidden host` (Host rewrite works).
4. A Vite or Astro dev server fronted at `https://<slug>.localhost` has working hot reload (HMR websocket).
5. `sj run demo -- npx vite --port $PORT --strictPort` returns within 30 s printing the URL; closing the terminal
   that ran it does not stop the server; after a reboot it is `stopped` and listed under "Lost at last reboot";
   with `--persist` it is running again after a reboot.
6. A generated plist contains no ephemeral version-manager directories in `PATH`; `sj doctor` flags one that does.
7. Stopping the daemon makes `https://junction.localhost` serve the fallback page listing all apps with working links.
8. With something else holding :443, `sj doctor` names the process and PID and suggests a fix; `sj setup` stops
   instead of fighting it.
9. `sj setup --domain firstname.lastname` makes `https://firstname.lastname` and `https://review.firstname.lastname`
   work; `sj doctor` reports dnsmasq bound to loopback only and checks the TLD against IANA's list.
10. `sj setup --domain foo.local` is refused with an explanation of the mDNS conflict.
11. `sj teardown` returns the machine to its prior state (no LaunchDaemons, resolver file, drop-ins or trusted root
    left behind) and the dashboard keeps working in direct mode.
12. A managed app writing 50 MB of logs ends up with rotated files no larger than the configured limit.

## v2 — Agents and polish

**Scope:** MCP (Streamable HTTP at `/mcp` + `sj mcp` stdio); optional screenshot thumbnails; generated-card
thumbnails; 7 d / 90 d uptime from hourly rollups with latency charts; `sj hook check-command`; Linux support
(systemd user units, `*.localhost` resolution check, `setcap` for Caddy).

Acceptance criteria:

1. An MCP client can `add_bookmark` and the dashboard shows it live; it appears in the YAML file with comments in that
   file preserved.
2. `declare_app` with a `service` block is rejected; no MCP tool can start a process.
3. `sj thumbs enable` downloads a browser into the data home and healthy apps get screenshots; `sj thumbs disable`
   removes it; the base install never depends on it.
4. The 90-day view renders from rollups only and stays fast with 30 apps.
5. On Linux, v0 criteria 1–12 pass with systemd user units in place of LaunchAgents.

## Later (unscheduled ideas)

- Lazy start: a stopped managed app is started on first request to its hostname (puma-dev style); Caddy would route
  to the daemon, which starts the app and redirects.
- macOS notifications when an `expected: running` app goes down.
- Health checks for remote bookmarks (opt-in, per link).
- Docker / process-compose discovery adapters.
- A Homebrew tap; a documentation website (Local Review has one).
- Import from Homepage/Dashy/Homer configs (bookmarks).
- Multiple base domains / aliases.
