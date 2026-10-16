# hallway

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
