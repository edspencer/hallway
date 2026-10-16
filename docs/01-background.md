# 01 — Background

## The problem

Coding agents have made small web apps nearly free to build. A developer now accumulates many of them: a dashboard
for some data, a slide deck rendered by a static-site generator, a viewer for log files, a review tool, an internal
utility. Each is an HTTP server on some port.

The way they get started is the root of the mess. A typical sequence:

1. A coding-agent session (or a terminal tab) runs `npm run dev`, `vite`, `astro dev`, `next dev`, `python -m
   http.server`, or similar.
2. The server keeps running after the session ends. It is now parented to nothing the user can see.
3. Days later the user cannot remember that it exists, which port it is on, which project it belongs to, or what
   command started it.
4. A reboot kills it. Nothing restarts it. The user discovers this only when they next go looking.

There is a second, related need: a jumping-off page for **remote** destinations the developer visits regularly but
can never remember the URL of — production admin consoles, BI dashboards, status pages, documentation portals. On a
home network this is the role a home-lab dashboard plays. There is no equivalent for "my laptop".

## The motivating incident (anonymised)

Observed on the author's own machine (macOS) while designing this project:

- `lsof -nP -iTCP -sTCP:LISTEN` showed six Node dev servers on ports **4321, 4455, 4666, 4670, 4671, 7333**, started
  between one and two weeks earlier, each from a coding-agent session that had long since ended.
- The listening-port list was otherwise dominated by **dozens of IDE and agent-tool helper processes** (language
  servers and similar) on high ephemeral ports in the 49152–65535 range, all bound to 127.0.0.1. Any scanner must
  filter these out or it is useless (see `04-apps-health-services.md`).
- Three of the six had command lines that revealed nothing about what they were: `node dist/index.js` and
  `node ./node_modules/.bin/../astro/astro.js dev --port 4666 --host`. Identifying them required reading each
  process's **current working directory** (`lsof -a -p <pid> -d cwd -Fn`), then that directory's `package.json`,
  README and git state.
- Three were **the same dashboard** running from three different **git worktrees** of one repository. Every worktree
  carries an identical `"dev": "astro dev --port 4666 --host"` script, so they collide by construction; two had been
  pushed onto 4670 and 4671 by hand. They were distinguishable only by branch name.
- One app's build config bakes its own URL in (`site: "http://127.0.0.1:4321"`); another app's helper scripts and
  dev proxy hardcode `http://127.0.0.1:7333`. **Moving these to new ports would break them** — a direct input to the
  rule that Hallway must never silently reassign an app's existing port.
- The machine was later **rebooted**. All six died. Nothing restarted them, nothing noticed, and the user did not find
  out for two days. Once the processes are gone, their working directories are unrecoverable — so the only way to
  say afterwards "these six things were running and are now gone" is to have **recorded what was observed while it
  was alive**. That is a requirement, not a nice-to-have.

The inspiration for the solution is a home-lab network: a custom DNS server, apps reachable at memorable
subdomains, and a dashboard listing them. The goal is that experience, for one laptop, with as little setup as
possible.

## Audience

- An individual developer, on their own machine, running many small local web servers — especially one who uses
  coding agents heavily.
- Single user, single machine. macOS first (it is the author's platform); Linux second.
- Comfortable with a CLI and with editing YAML; does not want to maintain a hand-written dashboard config.

## Goals

Each goal should be testable. Milestone mapping is in `08-roadmap.md`.

- **G1 — Know what exists.** One page lists every local web server the user cares about, including ones nobody
  registered, with what each one is (name, project directory, git branch) and how to reach it.
- **G2 — Know its health.** Each app shows a current state and recent uptime history at a glance.
- **G3 — Never remember a port again.** Each app gets a stable, memorable URL. In fronted mode that is an HTTPS
  hostname; in direct mode it is at least one click from the dashboard.
- **G4 — Survive reboots.** Apps marked as services come back after a restart without the user doing anything, as
  does Hallway itself.
- **G5 — Zero-maintenance discovery.** Registering an app is one command or one small YAML file; unregistered
  listeners are surfaced automatically and can be claimed in one action. The dashboard never needs hand-editing to
  stay accurate.
- **G6 — Jumping-off page.** User-defined groups of bookmarks to arbitrary URLs, on the same page. User-specific,
  never baked into the app.
- **G7 — Agent-friendly.** A coding agent can read and change everything (apps, bookmarks) by editing files or via
  MCP, and the UI updates live. A coding agent has an easy, documented way to start a dev server *properly* so it does
  not become an orphan.
- **G8 — Beautiful.** The dashboard should be a pleasure to look at and fast to use — something you would set as a
  browser home page. This is an explicit requirement, not polish.
- **G9 — Simple to install.** `npm i -g hallway && hallway service install` gets the dashboard running
  permanently. Fronted mode adds one guided `hallway setup` step.
- **G10 — Generic.** Nothing specific to any one company, tool or user. Opinionated defaults; everything
  user-specific lives in the data home.

## Non-goals

- **Multi-user or shared/team use.** One person, one machine.
- **Remote access.** Nothing is exposed beyond loopback. No tunnels, no LAN sharing (see the bind-address notes in
  `03-networking.md`).
- **Production process management.** This is not a replacement for PM2, systemd or Kubernetes in production.
- **Container orchestration.** It may *front* a containerised app listening on a local port, but it does not run
  containers.
- **A general monitoring / alerting system.** Health is for "is my thing up?" at a glance. Notifications are a
  possible later feature, not a core one.
- **Windows parity.** Windows is supported where feasible, best effort (D58): the daemon, dashboard and CLI run
  natively, without administrator rights, but fronted mode is out of scope there and it is checked only on CI's hosted
  Windows runners. WSL2 is a Linux install and sees only its own servers.
- **Launching arbitrary commands via MCP.** See D10 in `09-decisions.md`.

## Positioning

> **The front door for everything you vibe-coded on a random port.**

The dashboard-and-bookmarks space is crowded (see prior art). Hallway's differentiators are:

1. **Self-populating.** It reads a live registry and *scans for listeners*, so the dashboard reflects reality without
   anyone maintaining it. Every comparable dashboard requires a hand-maintained config, which recreates the original
   problem ("I don't remember what I have").
2. **It remembers.** It records what it observed, so after a reboot it can say what was lost.
3. **It fronts.** Memorable HTTPS hostnames per app, with sane defaults that work with no DNS setup.
4. **It keeps things alive.** Native OS services, no extra process manager.
5. **Built for agent-spawned, ephemeral servers.** Files-first config an agent can edit, an agent guide, MCP, and a
   one-command way for an agent to start a server that will not become an orphan.

## Prior art

Status checked during design (dates in `11-research-notes.md`).

| Project | What it does | Why it is not the answer |
|---------|--------------|--------------------------|
| **hotel** (typicode/hotel) | Closest single-tool match: process manager + local domains + dashboard with start/stop/logs. ~10k stars. | Dormant: last push October 2023, 122 open issues. Good prior art for UX; not a foundation. |
| **localias** (peterldowns/localias) | Caddy-based local aliases (`app.test → :3000`), manages `/etc/hosts`, auto-trusts TLS, serves `.local` over mDNS. Active. | No wildcard subdomains, no boot persistence, explicitly no process management, no dashboard. |
| **Homepage / Homer / Dashy / Heimdall / Flame** | Home-lab dashboards: service tiles, bookmarks, widgets. | Hand-maintained YAML; no discovery; usually Docker-first; no proxying or process management. |
| **puma-dev** | `.test` domains with lazy app start, own resolver. | Ruby/Rack-centric. |
| **dnsmasq + Caddy (hand-rolled)** | The classic macOS recipe for wildcard local domains. | A recipe, not a product: no registry, no dashboard, no health. Hallway automates it. |
| **PM2** | Mature Node process manager with save/resurrect. | Its macOS boot integration has a history of reported failures; adds a second supervisor on top of launchd. See D3. |
| **process-compose / Overmind / Foreman** | Procfile/YAML dev runners. | Foreground dev tools; no boot persistence, no dashboard. |
| **Coolify / Dokploy / Dokku** | Self-hosted PaaS with dashboards and domains. | Far too heavy for a laptop; server/container-oriented. |
| **`pm` in Paddock** (the author's own) | A thin wrapper over PM2 plus a JSON port registry, so agents get stable ports for preview servers inside a Paddock dev box. | Built for a Linux container; depends on PM2; no DNS, proxy or dashboard. Its registry format is supported as an optional *discovered* source (see `04-apps-health-services.md`). |

## Related projects by the same author

Hallway should feel like a sibling of these, and borrow their conventions (see `02-architecture.md`):

- **Local Review** — `npm i -g local-review`, https://github.com/edspencer/local-review. A local-only web app for
  reviewing stacks of local commits. MIT. Its data-home layout, YAML-per-entity storage, chokidar → SSE live updates,
  loopback-only security middleware, agent guide / `llms.txt`, and release pipeline (changesets, npm provenance) are
  the template for this project. It is also one of the apps Hallway will front (default port 5622).
- **Paddock** — `@edspencer/paddock`, https://github.com/edspencer/paddock. A server for persistent coding-agent
  sessions, which the author runs as a launchd service. Its launchd plist is the template for service generation, and
  it is another app Hallway will front.
