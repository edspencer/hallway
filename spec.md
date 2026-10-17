# Hallway — Specification

> The front door for everything you vibe-coded on a random port.

**Status:** released on npm since 2026-10-16 (0.3.1 at the time of writing), with all of v0 and v1 and most of v2 built (section 6, and
`AGENTS.md` for what is where). What remains is v2's real-Mac verification. This document set is written to be
handed to an implementing agent (or person) who was not present for any of the design discussion. Anything not written down here is lost, so
the spec errs heavily on the side of detail, rationale, and recording what was considered and rejected.

---

## 1. What it is, in one paragraph

Hallway is a small, always-on, local-only service for a developer's own machine. It keeps a live
directory of every web server the developer runs locally — the long-lived ones they installed on purpose, the
ad-hoc ones a coding agent spun up in a session that has since ended, and the unidentified ones it finds simply by
looking at what is listening. It shows them on a beautiful home-screen dashboard with health status, uptime history
and thumbnails; gives each one a memorable HTTPS hostname (`myapp.localhost`, or a custom domain) via a reverse
proxy instead of a port number nobody can remember; keeps the ones that should survive a reboot running as native
OS services; and doubles as a personal jumping-off page of bookmarks to remote things the developer always forgets
the URLs of. Its configuration is plain YAML on disk that a human, a text editor, or a coding agent can edit, with
the UI updating live; an MCP server provides the same operations as typed tools.

## 2. Why it should exist

Coding agents make it trivially cheap to build small web apps — dashboards, slide decks, viewers, internal tools.
Each one runs on some port. It is usually started inside an agent or terminal session, which later ends. The result,
observed directly on the author's machine while designing this:

- Six dev servers were listening on ports 4321, 4455, 4666, 4670, 4671 and 7333, between one and two weeks old.
- Three of them could not be identified from their command lines at all (`node dist/index.js`,
  `astro dev --port 4666 --host`) — only by inspecting each process's working directory.
- Three were the *same* dashboard running from three git worktrees of one repository; all three hardcode port 4666,
  so two had been manually moved to 4670 and 4671.
- A reboot later killed all six silently. Nothing restarted them, and nobody noticed for two days.

Separately, the author wants one page that links to the remote things they visit but can never remember the URL of
(production admin consoles, BI dashboards, status pages) — the role a home-lab dashboard plays on a home network.

Full background, goals, non-goals and prior art: [docs/01-background.md](docs/01-background.md).

## 3. Document map

Read in this order. Each file is self-contained enough to be read alone, but they build on each other.

| # | File | Contents |
|---|------|----------|
| 1 | [docs/01-background.md](docs/01-background.md) | Problem, motivating incident, audience, goals, non-goals, positioning, prior art |
| 2 | [docs/02-architecture.md](docs/02-architecture.md) | Process model, tech stack, data home layout, file formats, write path, live updates, HTTP API, security |
| 3 | [docs/03-networking.md](docs/03-networking.md) | Direct vs fronted mode, domain choice, Caddy, TLS, DNS, Host-header rewriting, privileged setup |
| 4 | [docs/04-apps-health-services.md](docs/04-apps-health-services.md) | The app model, three app sources, port scanning and identification, health states, probing, uptime storage, launchd services, `hallway run` |
| 5 | [docs/05-ui.md](docs/05-ui.md) | Dashboard design: layout, cards, uptime bars, thumbnails, bookmarks, keyboard, visual direction |
| 6 | [docs/06-agent-interface.md](docs/06-agent-interface.md) | Files-first agent integration, agent guide / llms.txt, MCP server design and tool list |
| 7 | [docs/07-cli.md](docs/07-cli.md) | Every CLI command, flags and exit codes |
| 8 | [docs/08-roadmap.md](docs/08-roadmap.md) | Milestones v0 / v1 / v2 / later, each with acceptance criteria |
| 9 | [docs/09-decisions.md](docs/09-decisions.md) | Decision log with rationale, plus alternatives considered and rejected |
| 10 | [docs/10-open-questions.md](docs/10-open-questions.md) | Unknowns, things to verify, decisions deliberately left open, TODOs |
| 11 | [docs/11-research-notes.md](docs/11-research-notes.md) | Verified facts with dates and sources: DNS/TLD rules, ICANN status, Caddy behaviour, macOS behaviour, prior-art status, sibling-project internals |

## 4. Key decisions at a glance

Full rationale for each is in [docs/09-decisions.md](docs/09-decisions.md).

| ID | Decision |
|----|----------|
| D1 | Name: **Hallway** (originally Spaghetti Junction; renamed October 2026); npm package `hallway` (unscoped, free as of 2026-10-16); CLI binary `hallway` (a short alias, `hw`, is proposed but not decided: Q-BINARY) |
| D2 | Standalone, generic, open-source project. Not a feature of any other tool. |
| D3 | It owns its own app registry and uses **native launchd** (systemd user units on Linux, D26) to keep services alive. No PM2. |
| D4 | **Caddy** is the reverse proxy and TLS terminator. Hallway generates Caddy's config; it does not proxy traffic itself. Caddy runs as the user (D47). |
| D5 | Default domain is **`localhost`** (`<slug>.localhost`): resolves to loopback with zero DNS setup and gets Caddy's local CA automatically. Custom domains are supported via dnsmasq + `/etc/resolver`; `.internal` (e.g. `myname.internal`) is the recommended custom choice. |
| D6 | **HTTPS is required** in fronted mode. |
| D7 | **YAML on disk is the source of truth.** The API, CLI and MCP are all wrappers around one write module. Hand edits are first-class. |
| D8 | MCP is served by **the same process and port** as the dashboard (`/mcp`, Streamable HTTP), plus a `hallway mcp` stdio bridge. |
| D9 | The proxy **rewrites the Host header to the upstream by default**, because well-behaved local apps reject foreign Host headers. Per-app opt-out. |
| D10 | MCP tools **describe** things; they do not launch arbitrary commands. |
| D11 | Three app sources: **declared**, **discovered**, **observed**. |
| D12 | "Stopped on purpose" is a distinct state from "down". |
| D13 | Thumbnails are tiered: favicon + colour tile (default) → real screenshots (opt-in) → generated card (fallback). |
| D14 | One YAML file per entity, not one big file. |
| D15 | Ship a useful **v0 with no DNS, no proxy and no sudo**: dashboard linking to `http://localhost:<port>`. |
| D16 | Tech stack and conventions mirror the author's existing open-source project Local Review (Node ≥ 22.13, TypeScript, Hono, React, Vite, chokidar, `yaml`). |
| D17 | Never reassign an existing app's port. |
| D18 | Record what the scanner observes while processes are alive, so losses can be reported after a reboot. |
| D19 | All launchd jobs use the `hallway.*` label prefix. |
| D20 | Default daemon port **4255** ("HALL" on a phone keypad). Was 7724 ("SPAG") under the old name. |
| D21 | **`hallway run`** is the one command agents use to start a server: launchd-owned, stable port, prints URL, exits. |
| D22 | The **tab title and favicon** show when something is down. |
| D23 | Visual identity: **the hallway** — each app is a numbered door; door states show health; bookmarks hang by the front door. **Approved as the working direction (D28); final logo/palette/typeface sign-off pending** (replaces the old motorway-signage identity). |
| D24 | Docs use `.internal` for every custom-domain example. |
| D25 | Licence: **MIT**. |
| D26 | OS specifics sit behind a **platform abstraction** (`server/platform/`); **Linux is supported from v0** alongside macOS (primary). Anything not yet run on a Mac is marked "unverified on macOS". |
| D27 | Only the `hallway` binary ships for now (the `hw` alias stays open: Q-BINARY). |
| D28 | The hallway identity is the working direction; every visual token lives in `src/theme/tokens.css` so it can be swapped. |
| D29 | Release machinery as Local Review's (changesets, trusted publishing, provenance). Nothing is published until a changeset is merged; `0.0.0` is never released. |
| D30 | The docs website lives in `website/` as its own project; root CI tolerates it and builds it in a separate job. |
| D31 | Development-only environment overrides for the bind address and Host allowlist (never flags, never documented to users). |
| D32 | Validation is hand-rolled, with the schemas as data; the agent guide's file reference is generated from them (resolves Q-VALIDATION). |
| D33 | Writes edit the YAML Document: PUT replaces known keys (unknown keys stay), PATCH is a JSON merge patch, a file that doesn't parse is never written. |
| D34 | Deletes go to `backups/removed/`; snapshots of the editable files before destructive writes and hourly. |
| D35 | Live data (health, history, observed, discovered, thumbnails) plugs into the core through `StateProvider`s and the event bus. |
| D36 | Daemon port: `--port`, `$PORT`, `config.yaml`, 4255. A new data home's `config.yaml` has every setting commented out at its default. |
| D37 | Uptime history in **`node:sqlite`** (`state/health.sqlite`); `engines.node` raised to **≥ 22.13**, the first 22.x that loads it without a flag. |
| D38 | Scanner and prober details: `/proc` fallback on Linux, cwd-as-project, `repo @ branch` rules, observation ids, damping of any move off `healthy`, uptime bar sizes. |
| D39 | The v0 dashboard: one `/api/state` paints it, SSE refetches what each event names; tier-1 favicons from `server/thumbs/` (colour picked in the browser); "not checked" when no prober runs; bundled OFL fonts; contrast-checked tokens. |
| D47 | Fronted mode: **Caddy runs as you** on loopback 4443/4480, its admin API a 0600 Unix socket; the only root parts are a fixed 443/80 redirect (pf on macOS, nftables on Linux), the trusted CA root and, for a custom domain, the resolver (to Hallway's user-level dnsmasq). No `--resume`: Caddy starts from `generated/caddy.json`. Dashboard at `hallway.localhost`. |
| D48 | `hallway setup`/`teardown` are printed plans (`--print` runs nothing), idempotent by checking the real thing; refusals (`.local`, HSTS TLDs, a held 443) and warnings; doctor's networking checks; cards show `:port` beside the hostname. |
| D54 | **Lost at last reboot:** what was seen in the last scans before the boot and isn't listening now, kept in `state/lost.json` until dismissed; Restart once / Make it a service are `hallway run` (never MCP). |
| D58 | **Windows: supported where feasible, best effort.** Native, no administrator rights, checked on CI's hosted runners; in stages (baseline, scanner, scheduled-task services); fronted mode out of scope there. |
| D63 | **Local domains are discoverable:** the startup banner (TTY only; `--quiet` stays one line), a dismissible dashboard panel (`dashboard.hints` in `config.yaml`), a header control showing doctor's networking checks once on, and doctor's `info` line. The dashboard reports; only `hallway setup` changes anything. |
| D66 | **Brand marks for doors with no favicon:** with `icon: auto` and no favicon, a curated registry (generated from the `simple-icons` devDependency, nothing at run time) is matched client-side against the process, command, supervisor label, name and, last, a well-known port; `icon: si:<slug>` picks one explicitly. The floating port plate on the door face is dropped: the address line already shows the port. |

## 5. Glossary

- **Daemon** — the long-running Hallway process. Serves the dashboard, JSON API, SSE event stream and MCP
  endpoint; runs the file watcher, prober, port scanner, thumbnailer and proxy-config generator.
- **Data home** — `~/.hallway` (override: `$HALLWAY_HOME`). Holds all config and state.
- **App** — a local HTTP server Hallway knows about. Identified by a **slug** (`[a-z0-9][a-z0-9-]*`).
- **Declared app** — an app with a YAML file in `apps/`. Durable; written by a human, an agent, the CLI, or MCP.
- **Discovered app** — an app read from an external registry by an adapter (e.g. another process manager's port
  registry). Read-only from Hallway's point of view.
- **Observed listener** — something found listening on a local TCP port by the scanner that is not a declared or
  discovered app. Shown so the user can **claim** it (turn it into a declared app) or **ignore** it.
- **Managed service** — a declared app that Hallway keeps running via a generated launchd job.
- **Bookmark** — a link to anything (usually remote). Bookmarks live in **groups**. Inert: nothing is launched.
- **Direct mode** — no proxy; the dashboard links to `http://localhost:<port>`.
- **Fronted mode** — Caddy serves each app at `https://<slug>.<base-domain>`.
- **Base domain** — the domain apps are served under. Default `localhost`.
- **Probe** — one health check of one app.
- **State** — an app's current health classification: `healthy`, `unhealthy`, `down`, `stopped`, `unknown`.

## 6. Milestones at a glance

Full scope and acceptance criteria: [docs/08-roadmap.md](docs/08-roadmap.md).

- **v0 — The front page.** Daemon + dashboard + YAML store + live updates + health probes + port scanner with claim
  flow + bookmarks + favicon tiles + agent guide + self-install as a launchd service (systemd user unit on Linux).
  Links use `http://localhost:<port>`. No sudo. macOS and Linux (D26). **Done: released as 0.1.0**, with v1's
  managed services (`hallway run`, `hallway service add`) brought forward into it.
- **v1 — Fronting and services.** `hallway run` and `hallway service add` (launchd jobs for apps), Caddy integration, HTTPS on
  `*.localhost`, `hallway setup` / `hallway doctor`, custom-domain mode (dnsmasq), "lost since reboot". **Built:**
  fronted mode released in 0.2.0 (D47, D48), "Lost at last reboot" in 0.3.0 (D54). Browsers on a real Mac and
  behaviour across a real reboot are not yet checked.
- **v2 — Agents and polish.** MCP server (HTTP + stdio), screenshot thumbnails, generated cards, 90-day uptime
  history with rollups and sparklines; everything verified on a real Mac. **Mostly built:** MCP and the dev-server
  hook released in 0.2.0, screenshot thumbnails, generated cards and the fast 90-day view in 0.3.0 (D55–D57). Still
  open: criterion 5, every v0 and v1 criterion run on a real Mac.

## 7. How to maintain this spec

- The spec is authoritative until code exists; after that, code plus `docs/09-decisions.md` are.
- When you make a decision the spec does not cover, add it to `docs/09-decisions.md` with its rationale.
- When you resolve an open question, move it out of `docs/10-open-questions.md` into the decisions log (or the
  relevant doc) and note what settled it.
- When you verify or falsify a claim marked *unverified*, update `docs/11-research-notes.md` with the date and how.
- Keep the project generic. Examples in docs must never assume a particular employer, machine or user.
