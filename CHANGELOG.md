# hallway

## 0.4.0

### Minor Changes

- [#25](https://github.com/edspencer/hallway/pull/25) [`ca5f3ae`](https://github.com/edspencer/hallway/commit/ca5f3ae25eb2a115647afe8fc221f27a34e3346a) Thanks [@edspencer](https://github.com/edspencer)! - Windows: the port scanner. Hallway now finds the web servers listening on a Windows machine, with each one's working directory (read without administrator rights), project, git branch and command line, so the observed tray, Claim and `hallway scan` / `claim` work there. A process whose directory can't be read (elevated, another user's, or 32-bit) shows its command line instead, on every OS.

### Patch Changes

- [#24](https://github.com/edspencer/hallway/pull/24) [`490f359`](https://github.com/edspencer/hallway/commit/490f35948dcd45697c1f2956b8241de485aa765e) Thanks [@edspencer](https://github.com/edspencer)! - On Linux, `hallway setup`'s advice when Caddy is missing asks for Caddy 2.7 or later (it said 2.8; 2.7 is the minimum it checks for).

- [#20](https://github.com/edspencer/hallway/pull/20) [`cc0e2e6`](https://github.com/edspencer/hallway/commit/cc0e2e63ff1f5b79430234e44848541cde4158be) Thanks [@edspencer](https://github.com/edspencer)! - Windows, best effort: the daemon, dashboard, health checks, bookmarks, MCP and the CLI's file commands now run natively on Windows (no administrator rights). The port scanner and `hallway run` / `hallway service` aren't available there yet and say so; `hallway setup` refuses, since fronted mode is out of scope on Windows. On every OS, `hallway run` now records `cwd: ~/…` with the same home directory it is later expanded with.

## 0.3.1

### Patch Changes

- [#21](https://github.com/edspencer/hallway/pull/21) [`7dfebc1`](https://github.com/edspencer/hallway/commit/7dfebc1a89a075f98d56aeadc661b36ef21a5e91) Thanks [@edspencer](https://github.com/edspencer)! - `hallway lost dismiss --all` works: it was refused with "unknown option --all", although `--help` lists it. (`hallway lost dismiss <id>` and the dashboard's Dismiss were unaffected.)

## 0.3.0

### Minor Changes

- [#17](https://github.com/edspencer/hallway/pull/17) [`41ce65a`](https://github.com/edspencer/hallway/commit/41ce65a35de5b9ce7dc38d3825ebb8f6cbc451b1) Thanks [@edspencer](https://github.com/edspencer)! - Lost at last reboot: after the machine restarts, Hallway lists the servers that were running before it and didn't come back.
  
  - **A banner at the top of the dashboard**: "Lost at last reboot (Mon 28 Sep 20:05): 6 apps". **Review** lists each one with where it ran from (`~/Code/my-app @ main`) and the command that started it.
  - **Restart once** starts it again the way `hallway run` does: on the port it had, owned by launchd or systemd rather than anyone's session. **Make it a service** also starts it at login and restarts it if it exits. **Dismiss** takes one off the list, or clears the whole notice. A server that wasn't an app yet becomes one (`apps/<slug>.yaml`) with the command and directory Hallway recorded while it was running.
  - Only what was running at the end of the last boot is listed: a server you stopped the day before isn't blamed on the reboot. Services that start at login get their start-up grace period before anything is called lost. Whatever comes back is marked **back** until you dismiss it.
  - The notice is kept in `state/lost.json`, so it survives Hallway restarting, until you dismiss it.
  - **`hallway lost`** lists the same from a terminal; `hallway lost restart <id>`, `hallway lost service <id>` and `hallway lost dismiss <id>` (or `--all`) act on it. It's in `/api/state` (`lost`), `GET /api/lost`, `llms.txt` and MCP's `get_status` too; MCP can read it but not restart anything.
  - A service the daemon starts (from the dashboard, or one of these actions) now shows `◐ starting` while it comes up, instead of `down`.

- [#18](https://github.com/edspencer/hallway/pull/18) [`807569c`](https://github.com/edspencer/hallway/commit/807569c175fc1e9ea516ce1031dc2683f28a7a40) Thanks [@edspencer](https://github.com/edspencer)! - Screenshots on the doors, generated cards, and a faster 90-day view.
  
  - **Screenshots, opt-in:** `hallway thumbs enable` installs a headless browser (Chromium's headless shell, about 300 MB) into the data home, never anywhere else, and turns screenshots on. Each healthy app's door gets a pane of glass showing the app itself, re-shot when the app restarts, every six hours, or with `hallway thumbs refresh [slug]`. The drawer shows it larger. `hallway thumbs disable` turns them off and deletes the browser and the pictures; `hallway thumbs status` shows what's installed. Bookmarks are never shot, and screenshots never leave your machine.
  - **The base install stays light:** Hallway doesn't depend on Playwright or any browser; `npm i -g hallway` downloads none.
  - **Generated cards:** `thumbnails.mode: card` draws every door as a card with the app's name, address, framework and `repo @ branch`, rendered on the daemon with bundled fonts, so it looks the same on every machine. `GET /api/apps/:slug/thumb` serves it as a 640×400 PNG.
  - **The 90-day uptime view is quicker:** one app's 90 days now take a few milliseconds instead of ~50, so the drawer stays snappy with dozens of apps.
  - `AppView.thumbKind` says whether an app's thumbnail is a favicon, a screenshot or a card; `POST /api/thumbs/refresh` re-shoots from the API.

## 0.2.0

### Minor Changes

- [#8](https://github.com/edspencer/hallway/pull/8) [`b20cfcd`](https://github.com/edspencer/hallway/commit/b20cfcd187b607095ea1fc95600ed5add8a85619) Thanks [@edspencer](https://github.com/edspencer)! - Fronted mode: every app at `https://<app>.localhost` (or under your own domain), and the dashboard at `https://hallway.localhost`.
  
  - `hallway setup` runs Caddy as you, as a user-level LaunchAgent or systemd user unit, on loopback ports 4443 and 4480. It then makes three privileged changes, each printed and run through `sudo`: it redirects ports 443 and 80 to Caddy (a pf anchor on macOS, an nftables table on Linux), trusts Hallway's local certificate authority, and switches `config.yaml` to `mode: fronted`.
    - `hallway setup --print` shows the whole plan and runs nothing.
    - Re-running it only fixes what's missing.
    - It refuses `.local`, real HSTS-preloaded TLDs such as `.dev`, and anything already holding port 443 or 80 (naming the process).
  - `hallway setup --domain myname.internal` serves apps under your own domain, through a user-level dnsmasq and a resolver entry for that domain only.
  - Caddy's admin API is a private Unix socket in your data home, and Caddy never runs as root, so it can't be used to escalate privileges.
  - New apps get a hostname as soon as their YAML file exists: no sudo, no restart.
  - The Host header is rewritten to the app's own address by default, so apps that defend against DNS rebinding still work; `proxy.preserveHost: true` opts out. Vite's hot reload works through the proxy.
  - When the daemon is down, `https://hallway.localhost` serves a static page listing every app. When an app is down, its hostname says which app isn't answering and how to start it.
  - `hallway teardown` undoes it all and goes back to `http://localhost:<port>` links.
  - `hallway doctor` checks fronted mode: Caddy, who holds ports 80/443, the redirect, the trusted certificate and name resolution.
  - In fronted mode, dashboard cards show the hostname, with the port as a direct link beside it.
  - New `config.yaml` settings: `proxy.httpsPort`, `proxy.httpPort`, `proxy.publicPort`, `proxy.caddy` and `domain.dnsPort`. Setting `proxy.publicPort` to `proxy.httpsPort` gives fronted mode with no redirect and no sudo; links then carry `:4443`.
  - Needs Caddy 2.7 or later. On macOS, `hallway setup` installs it with Homebrew; on Linux, use a release binary from caddyserver.com.

- [#15](https://github.com/edspencer/hallway/pull/15) [`2e1e392`](https://github.com/edspencer/hallway/commit/2e1e3928fd3994c8ba4ffa2208c6b6ef581f9ff6) Thanks [@edspencer](https://github.com/edspencer)! - Hallway for coding agents: an MCP server, and a hook that stops agents starting dev servers directly.
  
  - **MCP at `/mcp`** on the daemon's own port (Streamable HTTP, the 2026-07-28 protocol, with older clients served too). Register it with `claude mcp add --transport http hallway http://localhost:4255/mcp`; in fronted mode `https://hallway.localhost/mcp` works too.
    - Sixteen tools cover status, apps, observed listeners and bookmarks: `get_status`, `get_app`, `declare_app`, `update_app`, `claim_observed`, `add_bookmark` and the rest.
    - Every write goes through the same code as the dashboard and the API, so the YAML keeps its comments, the dashboard updates live, and an optional `etag` guards against overwriting someone else's edit.
    - The resources `hallway://state` and `hallway://apps/<slug>` announce changes.
  - **MCP never runs anything.** No tool starts, stops or installs a process: a `service` block is refused, and so is changing an app's port. Starting servers stays with `hallway run` in the shell.
  - **`hallway mcp`**: the same server over stdio, for clients that prefer it (`claude mcp add hallway -- hallway mcp`). It forwards to the running daemon, and says how to start one if there isn't one.
  - **`hallway hook check-command`**: an optional Claude Code `PreToolUse` hook for the Bash tool. When an agent tries `npm run dev`, `vite`, `astro dev`, `next dev`, `python -m http.server` and the like, it blocks the command and suggests the `hallway run` to use instead (`hallway run my-app -- vite --port '$PORT' --strictPort`). Builds, tests and everything else pass. Hallway never installs it: `hallway guide` shows the `settings.json` entry.
  - The localhost-only security applies to `/mcp` as to everything else: a foreign `Host` or `Origin` gets 403.

## 0.1.0

### Minor Changes

- [#9](https://github.com/edspencer/hallway/pull/9) [`71a13a5`](https://github.com/edspencer/hallway/commit/71a13a5424ee2444aa98107e2518e41b7e89a093) Thanks [@edspencer](https://github.com/edspencer)! - The first release: Hallway v0, "the front page". A local-only dashboard of every web server on your machine, on
  macOS and Linux.
  
  - **Install:** `npm i -g hallway`, then `hallway service install` to run the daemon as a LaunchAgent (macOS) or a
    systemd user unit (Linux), and `hallway open` (or browse to http://localhost:4255).
  - **A live directory:** declared apps (`~/.hallway/apps/<slug>.yaml`) appear as doors, and the page updates within
    a second when a file changes. A broken file shows its error on its own card; nothing else stops working.
  - **Health at a glance:** each app is probed and shown as healthy, unhealthy, down, stopped or unknown, with 24-hour
    uptime bars (and 7- and 90-day views in the drawer). `expected: adhoc` apps go calmly `stopped` when they're off;
    `expected: running` ones go `down`.
  - **Found running:** the port scanner lists listeners nobody has named, identified by project, directory and git
    branch (two worktrees show as `repo @ branch`), skipping IDE and tool helpers. **Claim** turns one into an app;
    **Ignore** hides it.
  - **Bookmarks:** groups of links (`~/.hallway/bookmarks/<group>.yaml`) as favicon chips.
  - **Managed servers:** `hallway run <slug> -- <command>` starts a server as a user service on a stable port, waits
    for it and prints its URL (`--persist` keeps it running at login); `stop`, `start`, `restart`, `logs`, and
    `hallway service add/rm/regenerate`, with log rotation.
  - **For agents:** an agent guide (`hallway guide`, `/agent-guide.md`), `/llms.txt` with this machine's live data, and
    a paragraph for your `CLAUDE.md` or `AGENTS.md` (`hallway guide --snippet`).
  - **The CLI:** `status`, `scan`, `claim`, `ignore`, `app add/ls/edit/rm`, `bookmark add/ls/rm/edit` and `doctor`, all
    working with or without the daemon running.
  
  Apps are linked as `http://localhost:<port>` (direct mode). HTTPS names such as `https://<slug>.localhost` (fronted
  mode, `hallway setup`) come in v1; the MCP server in v2. The daemon only ever listens on 127.0.0.1 and never needs
  root.
