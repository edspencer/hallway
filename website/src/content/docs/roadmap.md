---
title: Roadmap
description: What ships in v0, v1 and v2, with the acceptance criteria each milestone is checked against.
---

Each milestone is useful on its own, and each is checked by **running the software** against the criteria below,
not by reading the code.

:::note[Where things stand]
Hallway is a detailed specification with the v0 implementation just starting. Nothing below has shipped. The
[specification](https://github.com/edspencer/hallway/blob/main/spec.md) in the repository is the source of truth
while the code catches up.
:::

## v0: The front page

**Scope:** the daemon; the dashboard; YAML config with live updates; health probes with state and 24-hour history;
the scanner with identity, claim and ignore; bookmarks; favicon tiles; the agent guide and `llms.txt`;
`hallway service install` for the daemon itself; `hallway doctor` for the daemon and data. **Direct mode only. No
sudo anywhere.**

Done when:

1. `npm i -g hallway && hallway service install` serves the dashboard at `http://localhost:4255`, still serving after
   logging out and in, and after a reboot.
2. Creating `apps/foo.yaml` with a `name` and `port` in an editor makes a card appear on an open dashboard within a
   second, without a reload. Editing and deleting the file are reflected the same way.
3. A syntactically broken `apps/foo.yaml` shows an error on that card (file, line, message) while every other card
   keeps working; the daemon doesn't crash; the file isn't modified.
4. Starting `python3 -m http.server 4567` in some directory makes it appear in the observed tray within one scan,
   labelled with that directory; **Claim** writes `apps/<slug>.yaml` with `port: 4567` and the card moves into Apps.
5. IDE and agent-tool helpers on ephemeral ports don't appear in the observed tray.
6. Stopping a server declared `expected: running` turns it `down` after two probe intervals; one declared
   `expected: adhoc` turns `stopped` instead.
7. Two worktrees of one repo running the same app on different ports show as `repo @ branch-a` and `repo @ branch-b`.
8. Bookmarks render as favicon chips in their groups, and editing a file updates the page live.
9. `/` focuses the filter; typing a unique match and pressing Enter opens it.
10. A request with `Host: evil.example` gets 403; a cross-origin `POST` gets 403 or 415.
11. `curl localhost:4255/llms.txt` returns the agent guide summary with the live data-home path and app list.
12. The page fully renders in under 200 ms from a warm daemon.

## v1: Fronting and services

**Scope:** `hallway run`, `stop`, `start`, `restart` and `logs`; managed launchd services for apps; Caddy through its
admin API; fronted mode on `*.localhost` with HTTPS; Host rewriting; the fallback page; `hallway setup` and
`teardown`; networking checks in `hallway doctor`; custom domains (dnsmasq and `/etc/resolver`); the "exposed"
indicator; "lost at last reboot"; log rotation.

Done when:

1. `hallway setup --print` prints every privileged command with an explanation and runs nothing; `hallway setup` runs
   them through `sudo`, and is safe to re-run.
2. After setup, `https://hallway.localhost` shows the dashboard with a trusted certificate in Chrome and Safari (and
   Firefox after the documented setting).
3. Declaring an app on port 5622 as `review` makes `https://review.localhost` work **with no sudo and no restart**,
   and an app that checks its `Host` header doesn't answer `403 forbidden host`.
4. A Vite or Astro dev server fronted at `https://<slug>.localhost` has working hot reload.
5. `hallway run demo -- npx vite --port $PORT --strictPort` returns within 30 seconds printing the URL; closing the
   terminal doesn't stop the server; after a reboot it is `stopped` and listed under "Lost at last reboot"; with
   `--persist` it is running again after a reboot.
6. A generated job's `PATH` starts with the resolved Node's `bin` directory and contains no per-shell or missing
   directories; `hallway doctor` flags a job that does.
7. Stopping the daemon makes `https://hallway.localhost` serve the fallback page, listing every app with working links.
8. With something else holding port 443, `hallway doctor` names the process and PID and suggests a fix, and
   `hallway setup` stops instead of fighting it.
9. `hallway setup --domain myname.internal` makes `https://myname.internal` and `https://review.myname.internal`
   work, with dnsmasq bound to loopback only. With a made-up TLD, `hallway doctor` warns and checks IANA's list.
10. `hallway setup --domain foo.local` is refused, with an explanation of the mDNS conflict.
11. `hallway teardown` leaves no LaunchDaemons, resolver file, drop-ins or trusted root behind, and the dashboard keeps
    working in direct mode.
12. A managed app writing 50 MB of logs ends up with rotated files no larger than the limit.

## v2: Agents and polish

**Scope:** the MCP server (Streamable HTTP at `/mcp`, and `hallway mcp` over stdio); optional screenshot thumbnails;
generated-card thumbnails; 7- and 90-day uptime from hourly rollups, with latency charts; `hallway hook
check-command`; Linux (systemd user units, a `*.localhost` resolution check, `setcap` for Caddy).

Done when:

1. An MCP client can `add_bookmark` and the dashboard shows it live, with the YAML file's comments preserved.
2. `declare_app` with a `service` block is rejected; no MCP tool can start a process.
3. `hallway thumbs enable` downloads a browser into the data home and healthy apps get screenshots;
   `hallway thumbs disable` removes it; the base install never depends on it.
4. The 90-day view renders from rollups only and stays fast with 30 apps.
5. On Linux, every v0 criterion passes with systemd user units in place of LaunchAgents.

## Later, unscheduled

- **Lazy start:** start a stopped service on the first request to its hostname.
- macOS notifications when an `expected: running` app goes down.
- Opt-in health checks for remote bookmarks.
- Docker and process-compose discovery adapters.
- A Homebrew tap.
- Importing bookmarks from Homepage, Dashy or Homer configs.
- Several base domains at once.

## Still open

Some decisions are deliberately left for implementation. Among them: how Caddy gets port 443 without a reconfigurable
root process (blocking for v1); whether a short `hw` alias ships; whether health history lives in SQLite or JSON
lines; whether the dashboard's default hostname is `hallway.localhost`. The full list is in the repository's
[open questions](https://github.com/edspencer/hallway/blob/main/docs/10-open-questions.md).
