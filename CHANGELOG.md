# hallway

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
