---
title: Roadmap
description: What shipped in which release (v0, v1 and most of v2 are out, plus Windows best effort), what is left, and the acceptance criteria each milestone is checked against.
---

Each milestone is useful on its own, and each is checked by **running the software** against the criteria below,
not by reading the code.

:::note[Where things stand]
**v0 and v1 have shipped, and so has all of v2's software**, for macOS and Linux. What is left is v2's last
criterion: running everything on a real Mac. Fronted mode has run for real on Linux and on CI's macOS runners, but no
browser has been driven on a Mac yet, and nothing has been checked across a real reboot or a macOS update.

**Windows** is supported where feasible, best effort, since 0.4.0 and 0.5.0: everything but fronted mode. It has run
only on GitHub's hosted Windows runners, not yet on a real Windows desktop. See [Windows](#windows) below. The
[specification](https://github.com/edspencer/hallway/blob/main/spec.md) in the repository is the source of truth.
:::

## Releases

| Release | What it shipped |
| --- | --- |
| **0.1.0** | All of v0: the daemon, the dashboard, health and uptime, the scanner, bookmarks, the agent guide, `hallway doctor`. From v1, early: [`hallway run`](/agents/hallway-run/), `stop`, `start`, `restart` and `logs`, managed services for apps and log rotation. |
| **0.2.0** | The rest of v1's networking: [fronted mode](/networking/fronted-mode/) (`hallway setup` and `teardown`, Caddy, `https://<app>.localhost`), [custom domains](/networking/custom-domains/), the fallback page and doctor's networking checks. From v2: the [MCP server](/agents/mcp/) and the [dev-server hook](/agents/hook/). |
| **0.3.0** | The last of v1: [Lost at last reboot](/concepts/services/#lost-at-last-reboot). From v2: [screenshot thumbnails and generated cards](/concepts/thumbnails/), and a fast 90-day uptime view. |
| **0.3.1** | A fix: `hallway lost dismiss --all` was refused as an unknown option. |
| **0.4.0** | [Windows](#windows), best effort: the daemon, dashboard, health checks, bookmarks, MCP and the CLI's file commands run natively, and the [port scanner](/concepts/apps/#observed-listeners-the-scanner) finds Windows' listeners with each one's directory, project and branch, without administrator rights. `hallway setup` refuses on Windows: fronted mode is out of scope there. On every OS, a listener whose directory can't be read shows its command line instead. |
| **0.5.0** | Windows managed services: `hallway service install` and [`hallway run`](/agents/hallway-run/) work there, as [per-user scheduled tasks](/concepts/services/#windows) that start at logon. |

## v0: The front page

<span class="ms ms--v0">v0</span> **Released in 0.1.0.**

**Scope:** the daemon; the dashboard; YAML config with live updates; health probes with state and 24-hour history;
the scanner with identity, claim and ignore; bookmarks; favicon tiles; the agent guide and `llms.txt`;
`hallway service install` for the daemon itself; `hallway doctor` for the daemon and data. **Direct mode only. No
sudo anywhere.**

**Platforms:** macOS and Linux. On macOS the daemon is a LaunchAgent and the scanner uses `lsof`; on Linux it is a
systemd user unit (with lingering enabled if it should run without a login session) and the scanner uses `ss` or
`/proc`. Every criterion below was checked on Linux by running it. The macOS side is unit-tested and CI runs the real
launchd service job on a macOS runner. Criterion 1's "after logging out and in, and after a reboot" has not been run
on either OS.

Done when:

1. `npm i -g hallway && hallway service install` serves the dashboard at `http://localhost:4255`, still serving after
   logging out and in, and after a reboot (a LaunchAgent on macOS; a systemd user unit on Linux).
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

<span class="ms ms--shipped">v1</span> **Released**: the services half in 0.1.0, fronted mode and custom domains in
0.2.0, "Lost at last reboot" in 0.3.0.

**Scope:** `hallway run`, `stop`, `start`, `restart` and `logs`; managed services for apps (launchd on macOS, systemd
user units on Linux); Caddy through its admin API; fronted mode on `*.localhost` with HTTPS; Host rewriting; the
fallback page; `hallway setup` and `teardown`; networking checks in `hallway doctor`; custom domains (dnsmasq, and
`/etc/resolver` on macOS or a `systemd-resolved` drop-in on Linux); the "exposed" indicator; "lost at last reboot";
log rotation. Since then, `hallway setup` has [three tiers](/networking/fronted-mode/#three-tiers), two of which need
no administrator (No admin and No prompts), and on macOS launchd holds ports 443 and 80 instead of a pf redirect.

**How it was checked:** criteria 1–4 and 7–11 run for real on Linux and on CI's macOS runners (setup with real
`sudo`, a squatter on 443, a custom domain, teardown leaving nothing behind), with `curl` and the system trust store
standing in for a browser. "Lost at last reboot" was checked on Linux with a simulated reboot. **Not yet checked:**
Chrome, Safari and Firefox on a real Mac (criterion 2), and anything across a real reboot (criterion 5's reboot half).

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

<span class="ms ms--shipped">v2</span> **Released, except criterion 5**: the MCP server and the hook in 0.2.0;
screenshot thumbnails, generated cards and the fast 90-day view in 0.3.0.

**Scope:** the [MCP server](/agents/mcp/) (Streamable HTTP at `/mcp`, and `hallway mcp` over stdio);
[`hallway hook check-command`](/agents/hook/); optional [screenshot thumbnails](/concepts/thumbnails/)
(`hallway thumbs enable`); generated-card thumbnails (`thumbnails.mode: card`); 7- and 90-day uptime from hourly
rollups, with a latency chart. Linux support moved forward to v0 and v1.

Done when:

1. An MCP client can `add_bookmark` and the dashboard shows it live, with the YAML file's comments preserved. (Met.)
2. `declare_app` with a `service` block is rejected; no MCP tool can start a process. (Met.)
3. `hallway thumbs enable` downloads a browser into the data home and healthy apps get screenshots;
   `hallway thumbs disable` removes it; the base install never depends on it. (Met.)
4. The 90-day view renders from rollups only and stays fast with 30 apps. (Met.)
5. Every v0 and v1 criterion has been run on a real Mac, with nothing left marked unverified on macOS. **(Not yet.)**

## Windows

**Supported where feasible, best effort** (since 0.4.0). macOS comes first and Linux sits alongside it; Windows comes
third. Hallway runs natively there (not through WSL) and never asks for administrator rights.

- **What works:** the daemon, the dashboard, health checks and uptime, bookmarks, the
  [port scanner](/concepts/apps/#observed-listeners-the-scanner) (0.4.0), MCP, the agent guide, the CLI, and
  [managed services](/concepts/services/#windows) as per-user scheduled tasks that start at logon (0.5.0).
- **What doesn't:** [fronted mode](/networking/fronted-mode/). Its parts (ports 443 and 80, trusting a root
  certificate, a custom domain's resolver) have no user-level equivalent on Windows, so `hallway setup` refuses and
  apps keep their `http://localhost:<port>` addresses. Services don't run while you're logged off: Linux's lingering
  has no Windows equivalent without a stored password or administrator rights.
- **How it was checked:** unit tests, `smoke:pack`, the scanner (as an administrator and as a standard user) and real
  scheduled tasks all run in CI on GitHub's `windows-latest` runners. **Not yet checked on a real Windows desktop:** a
  real logon starting the tasks and a logoff stopping them, no console window flashing at logon, a standard user
  registering tasks, an interactive user's dev servers, `hallway open`, and non-English Windows.

## What is left

- **A run on a real Mac** (v2 criterion 5). Safari, Chrome and Apple's `curl` have accepted a root trusted for the
  user only (the No admin tier's way); still unverified there: Firefox, and Safari resolving `*.localhost`; services,
  the daemon and launchd's sockets on 443 and 80 coming back after a logout or a reboot (`RunAtLoad`), and "Lost at
  last reboot" after a real one. On Linux, a real reboot (with lingering on) hasn't been run either.
- **A run on a real Windows desktop**, for the [Windows](#windows) items above.
- **Service controls in the dashboard.** The detail drawer doesn't yet have start, stop and restart buttons or a live
  log tail; the CLI and the [HTTP API](/reference/http-api/) do.
- **Discovery adapters.** The interface for reading another tool's registry exists, but no adapter ships yet (see
  [Apps](/concepts/apps/#discovered-apps)).

## Later, unscheduled

- **Lazy start:** start a stopped service on the first request to its hostname.
- macOS notifications when an `expected: running` app goes down.
- Opt-in health checks for remote bookmarks.
- Docker and process-compose discovery adapters.
- A Homebrew tap.
- Importing bookmarks from Homepage, Dashy or Homer configs.
- Several base domains at once.

## Still open

A few decisions are still open, among them whether a short `hw` alias ships alongside `hallway`, and the final visual
identity (the hallway look is the working direction). The full list is in the repository's
[open questions](https://github.com/edspencer/hallway/blob/main/docs/10-open-questions.md).
