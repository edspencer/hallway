# hallway

## 0.9.0

### Minor Changes

- [#50](https://github.com/edspencer/hallway/pull/50) [`2854dd3`](https://github.com/edspencer/hallway/commit/2854dd34ce57898513a5d9873f154aca507b99d8) Thanks [@edspencer](https://github.com/edspencer)! - When something else already holds port 443 or 80 (Rancher Desktop's Traefik, a Docker container, Colima, OrbStack, nginx…), `hallway setup` and the dashboard's Turn on now say so once, name the tool, and give its own fix (for Rancher Desktop: untick "Enable Traefik" in Preferences → Kubernetes), and say when it's reachable from your network. The dashboard no longer blames a cancelled Touch ID prompt for a stop that had nothing to do with it.
  
  To leave the other tool running, `hallway setup --port 4443` (or **Use port 4443 instead** in the dashboard) puts local domains on Caddy's own port: `https://hallway.localhost:4443`, `https://<app>.localhost:4443`, with every link Hallway gives following. `hallway setup --port 443` (or **Move to port 443** in the Local domains dialog) moves them back once 443 is free. `hallway doctor` names what holds 443/80 and which port links carry.

### Patch Changes

- [#52](https://github.com/edspencer/hallway/pull/52) [`eafc10a`](https://github.com/edspencer/hallway/commit/eafc10aad67d20e6fb9388edcc815339490661ee) Thanks [@edspencer](https://github.com/edspencer)! - `hallway setup` and `hallway doctor` now check that the certificate is trusted the way browsers check it (Apple's curl with no CA given on macOS; the system store or Chrome's NSS database on Linux), so a "Done" or an all-clear no longer hides a certificate error. After setup has trusted the certificate, it and the dashboard say to quit and reopen a browser that showed a warning before (Chrome can remember the old result). On a Mac whose organisation sets Chrome or Edge to ignore certificates you add (`CAPlatformIntegrationEnabled`), setup, the dashboard and doctor say so up front.

## 0.8.0

### Minor Changes

- [#48](https://github.com/edspencer/hallway/pull/48) [`a330928`](https://github.com/edspencer/hallway/commit/a330928a5fb63f480d9de1ef2527cf963140a3bc) Thanks [@edspencer](https://github.com/edspencer)! - Local domains, simpler to choose. The tiers have clearer names: **User certificate** (`--trust user`), **System-wide certificate** (`--trust system`) and **No HTTPS** (`--trust none`); the flags and `proxy.trust` values are unchanged. User certificate is now always the recommended tier, on macOS and Linux, admin or not: it never needs an administrator and the dashboard can turn it on. System-wide certificate is for custom domains, other accounts and tools that read only the system's certificates. The dashboard's Local domains panel and dialog are now a settings-style list: User certificate chosen and open with its address, what will ask and **Turn on**; the other two a line each until chosen. Turn on shows "Waiting for Touch ID…" on a Mac, the reason and the command to run instead if it stops, and the new address when it's done.

## 0.7.1

### Patch Changes

- [#45](https://github.com/edspencer/hallway/pull/45) [`1fcc4ce`](https://github.com/edspencer/hallway/commit/1fcc4ce40adabf187b943d5b3976db8a718affa7) Thanks [@edspencer](https://github.com/edspencer)! - Servers that listen on IPv6 loopback only, as Vite, Astro and Next do on a Mac (`localhost` is `::1` there), are no longer invisible. `hallway run`, the health prober, `start`/`restart` and `status` try 127.0.0.1 and ::1 and record which answered (`hallway run` prints it; the API has `health.address`), and in fronted mode Caddy dials `localhost:<port>`, reaching the app in whichever family it bound, so `https://<app>.localhost` works instead of showing "isn't answering". The fallback page and run's timeout no longer claim nothing was listening when only 127.0.0.1 was checked. Proxied apps now see `Host: localhost:<port>` rather than `127.0.0.1:<port>`.
  
  Upgrading now restarts the running daemon: `npm i -g hallway@latest && hallway service install` restarts a daemon still running the old version, waits until the new one answers, and says so ("Restarted the daemon: 0.7.0 → 0.7.1."). `hallway service regenerate` and `hallway setup` do the same, forwarders left running by an older version are restarted too, and `hallway doctor` fails when the daemon's version differs from the CLI's (fix: `hallway service restart`). The check is in the new CLI, so it works for an upgrade from any earlier version.

## 0.7.0

### Minor Changes

- [#43](https://github.com/edspencer/hallway/pull/43) [`7bea881`](https://github.com/edspencer/hallway/commit/7bea881cca8c2c648ec66ac67c7f2f158c0dd8e5) Thanks [@edspencer](https://github.com/edspencer)! - The dashboard's **Local domains** panel now offers setup's three tiers (No admin, System-wide, No prompts), the one recommended for your machine first, each with its address, what it will ask for and its `hallway setup --trust …` command to copy. No admin and No prompts have a **Turn on** button that runs setup from the dashboard after saying what will happen (on macOS, No admin asks once for your own Touch ID or password); System-wide still runs in a terminal. Once on, the header names the tier, e.g. `hallway.localhost · no admin`.

- [#42](https://github.com/edspencer/hallway/pull/42) [`c6bb5e5`](https://github.com/edspencer/hallway/commit/c6bb5e517aed479773da88c75e7d70c27a0c81e9) Thanks [@edspencer](https://github.com/edspencer)! - Local domains without admin rights. `hallway setup` now offers three tiers, asked on a terminal or chosen with `--trust`: **No admin** (`--trust user`) trusts Hallway's certificate for your account only, so on macOS it asks just for your own Touch ID or password and needs no administrator (on Linux it uses your NSS database, which Chrome reads, with no prompt; links carry `:4443`); **System-wide** (`--trust system`) is the setup you know, and the one custom domains need; **No prompts** (`--trust none`) serves plain `http://<app>.localhost` and asks for nothing. On macOS, launchd now holds loopback ports 443 and 80 for Hallway in every tier, with small forwarders handing connections to Caddy, so there is no pf redirect any more and nothing another tool's firewall rules can switch off. Re-running `hallway setup` (with any `--trust`) moves a Mac set up by an earlier version off its pf redirect; that removal needs sudo once. Switching tier removes what the old one added. `hallway doctor` checks each tier, every link Hallway gives follows the tier's scheme and port, and `config.yaml` records it as `proxy.trust` (and `proxy.scheme`). From `npx`, setup on macOS now asks you to install Hallway first, since the forwarders run it.

## 0.6.0

### Minor Changes

- [#38](https://github.com/edspencer/hallway/pull/38) [`c40e1c3`](https://github.com/edspencer/hallway/commit/c40e1c3eba7267fb5279ad42f7f492446ee795f6) Thanks [@edspencer](https://github.com/edspencer)! - Doors with no favicon now get a brand mark instead of a plain monogram, for apps the dashboard can recognise — Ollama, Postgres, Redis, Grafana and around 40 other self-hosted and developer tools — matched from the process name, the command line, the supervisor's label or (as a last resort) a well-known port. Set `icon: si:<slug>` on any app to pick one yourself. The floating port-number badge in the middle of each door is gone: the port already read in the address line underneath, and the badge wasn't a click target, so it only cost clicks.

- [#35](https://github.com/edspencer/hallway/pull/35) [`854dcd6`](https://github.com/edspencer/hallway/commit/854dcd678fa0122dccf43013d65f546546650224) Thanks [@edspencer](https://github.com/edspencer)! - Local domains are discoverable. `hallway` / `npx hallway` prints a HALLWAY banner on a terminal (no art or colour when piped, nothing extra with `--quiet`), the dashboard's address, and, while local domains are off, how to turn them on with `hallway setup`; from npx, how to keep it running. If Hallway is already running on the port, it says where and exits 0 instead of failing. The dashboard shows a dismissible **Local domains** panel in direct mode (dismissal is saved in `config.yaml` as `dashboard.hints.localDomains`), and a **Local domains** control in the header that brings it back or, once fronted mode is on, shows `hallway doctor`'s networking checks. `hallway doctor` says when local domains are off. New: `GET /api/fronting`, `PATCH /api/hints`, `fronting` in `/api/state`. Not on Windows, where `hallway setup` refuses.

- [#41](https://github.com/edspencer/hallway/pull/41) [`e47df12`](https://github.com/edspencer/hallway/commit/e47df1249937216b9975721898f3fbb8e6b06452) Thanks [@edspencer](https://github.com/edspencer)! - `hallway setup` and `hallway teardown` now ask before they change anything: they print the plan (what `--print` shows), say what will ask for what (sudo's password in the terminal and, on macOS, a separate Touch ID or password dialog for certificate trust settings), and ask `Continue? [y/N]`, defaulting to no. `--yes` skips the question; with no terminal and no `--yes` they refuse with a usage error (exit 2) before doing anything.

### Patch Changes

- [#36](https://github.com/edspencer/hallway/pull/36) [`eecdbf5`](https://github.com/edspencer/hallway/commit/eecdbf58f38459e6d3601547b48f183f6ec924b6) Thanks [@edspencer](https://github.com/edspencer)! - macOS fronted mode: when another tool has told pf to skip loopback (`set skip on lo0`), which leaves Hallway's 443/80 redirect installed but ignored, `hallway doctor` now says so (naming what enabled pf) with the fix, and `hallway setup` clears it with a printed sudo step (loading macOS's own `/etc/pf.conf` again, then the redirect) when that can't drop anyone else's rules. Setup's final check reports that cause instead of "nothing answered". Also quieter setup output: `brew install` runs without Homebrew's auto-update, cleanup and hints, and the expected "Boot-out failed: 3: No such process" from the first `launchctl bootout` is no longer shown.

## 0.5.2

### Patch Changes

- [#32](https://github.com/edspencer/hallway/pull/32) [`b849ae6`](https://github.com/edspencer/hallway/commit/b849ae69e2bc9209a7eed6f395fc951c3d26036a) Thanks [@edspencer](https://github.com/edspencer)! - A listener that launchd or systemd runs (a LaunchAgent, a `brew services` job, a systemd service) is no longer flagged
  orphaned: Hallway shows what supervises it instead (`launchd: <label>`, `systemd: <unit>`) in the dashboard,
  `hallway scan` and `--json`. A server started in `/`, your home directory or a package-manager prefix such as
  `/opt/homebrew` is no longer named after that directory's git repository: it's named by its supervisor or executable.
  The `exposed` and `orphaned` badges now explain themselves in a tooltip, and the drawer says which address it's bound
  to.

## 0.5.1

### Patch Changes

- [#31](https://github.com/edspencer/hallway/pull/31) [`0a76bde`](https://github.com/edspencer/hallway/commit/0a76bdeeb33c22ea87b3d7077f046a767363967a) Thanks [@edspencer](https://github.com/edspencer)! - `hallway service install` (and any other command that would write a job running Hallway itself: on Windows, every job) now refuses when Hallway is running from npx's cache, which npm can delete at any time, and says to `npm i -g hallway` first. `hallway doctor` warns about a job that already does, with the fix `npm i -g hallway && hallway service regenerate`. `npx hallway` in the foreground still works: it's the way to try Hallway, and `npm i -g hallway && hallway service install` the way to keep it.

## 0.5.0

### Minor Changes

- [#27](https://github.com/edspencer/hallway/pull/27) [`c7bc5f9`](https://github.com/edspencer/hallway/commit/c7bc5f922b47625f5852668d4c23847e94e0e478) Thanks [@edspencer](https://github.com/edspencer)! - Windows: managed services. `hallway service install` and `hallway run` now work on Windows. The daemon and each managed app become a per-user scheduled task that starts when you log on and runs `hallway supervise`, which writes the job's logs and restarts it when it exits. No administrator rights are needed. Commands are looked up the way cmd.exe does (`PATHEXT`), so `vite` finds `vite.cmd`.

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
