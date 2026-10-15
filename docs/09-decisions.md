# 09 — Decision log

Format: decision, then why, then what was considered instead. Add new decisions at the end with the next number.
Decisions here supersede anything contradictory elsewhere; if you find a contradiction, fix the other document.

---

### D1 — Name: Spaghetti Junction; package `spaghetti-junction`; binary `sj`

- The author's mental image: their machine is a spaghetti of servers on random ports; this untangles it.
- "Spaghetti Junction" is the popular name for the Gravelly Hill Interchange in Birmingham, UK — proverbially the most
  tangled road junction in Britain. A reverse proxy *is* a junction, so the name describes the function as well as
  the problem, and suggests a visual identity (`05-ui.md`).
- npm availability checked 2026-10-14: `spaghetti-junction` free. Taken: `spaghetti`, `colander`, `orzo`, `noodle`,
  `strand`, `strands`, `skein`, `twirl`, `tangle`, `untangle`, `switchboard`, `pasta`, `junction`, `interchange`,
  `localport`, `portmap`, `porthole`, `gravelly`, `al-dente`. Free alternatives noted: `aldente` (but it collides with
  a well-known macOS battery utility called AlDente), `trattoria`, `fusilli`, `forkful`, `matassa`, `localhub`.
- `sj` is short to type; no `sj` command existed on the author's machine. Check for common collisions before
  publishing (Q-BINARY).

### D2 — A standalone, generic, open-source project

- The problem is general to anyone building many small local apps, especially with coding agents.
- It must not depend on, or be a feature of, any other tool (including the author's own Paddock). It may *integrate*
  with others via optional discovery adapters.
- Public repository under the author's personal GitHub account; npm publish mirroring the author's Local Review
  (changesets, provenance).

### D3 — Own the registry; use native launchd; no PM2, no `pm`

- Once Spaghetti Junction owns the app registry, fronting and service installation, a separate process manager is
  redundant.
- launchd is the native, reliable way to survive reboots on macOS. PM2's macOS boot integration (`pm2 startup` +
  `pm2 save`/`resurrect`) has a history of reported failures (PM2 issues #4318, #5084), and it would be a second
  supervisor on top of launchd anyway.
- Removes a heavyweight dependency and anything Paddock-specific from a public project.
- **Rejected:** building on Paddock's `pm` (PM2 wrapper + JSON port registry) via a `~/bin/pm` wrapper with
  Caddy-config regeneration hooked onto `pm start/stop`; a LaunchAgent running `pm2 resurrect`. These were the first
  plan and were superseded by this decision. `pm`'s registry survives only as an optional discovery adapter.

### D4 — Caddy as reverse proxy and TLS terminator; the daemon generates its config

- Transparent WebSocket proxying (Vite/Astro HMR, WS-based apps), automatic local-CA TLS, HTTP→HTTPS redirects,
  zero-downtime reloads via an admin API, single static binary in Homebrew.
- The daemon stays unprivileged and never handles app traffic.
- Run Caddy as a **dedicated LaunchDaemon** (`spaghetti-junction.caddy`), not Homebrew's service, to avoid hijacking
  a Caddy the user may already run. Binding loopback :443 needs root on macOS (verified).
- Push config through the **admin API** so adding an app never needs sudo.
- **Not final:** a root Caddy with an unauthenticated admin API is a local privilege-escalation path. How Caddy gets
  :443 without that risk (leading candidate: user-level Caddy + pf redirect on `lo0`) is open and blocking for v1 —
  Q-CADDY-UNPRIVILEGED.
- **Rejected:** a Node reverse proxy inside the daemon (WebSocket upgrade handling, TLS, HTTP/2 — all reinvented);
  Traefik (designed around container labels, heavier); nginx (manual config, no automatic local TLS);
  **localias** as the base (no wildcard subdomains, no persistence, no process management).

### D5 — Default base domain `localhost`; custom domains supported

- `*.localhost` resolves to loopback on macOS with no configuration (verified), in Chromium and Firefox, and is
  reserved forever (RFC 6761). Caddy gives `.localhost` names local-CA certificates automatically. So the default
  fronted setup needs **no DNS server at all**.
- Custom domains are supported via dnsmasq + `/etc/resolver/<domain>`; **`.internal` is the recommended custom
  choice** (e.g. `myname.internal`) and is used in all examples (D24). The domain is a config value, so "which TLD is
  allowed?" becomes the user's choice with guidance, not a product decision. Made-up TLDs are allowed, with a warning.
- `.local` is refused (mDNS). Real delegated TLDs (`.dev`, `.app`, …) are refused or warned about (HSTS preload).
- **Rejected:** `.local` (mDNS conflict, no wildcards); `.test` as default (fine, but Caddy would try public ACME
  unless forced, and it needs dnsmasq); a fixed project-chosen domain.

### D6 — HTTPS is mandatory in fronted mode

- `http://<custom-host>` is not a secure context; secure-context APIs would silently break.
- With a locally trusted CA, even a made-up TLD that is later delegated and HSTS-preloaded still works locally.
- The author explicitly wants TLS.

### D7 — YAML on disk is the source of truth; one write module

- Proven by Local Review: agents and humans edit files; a watcher pushes changes to the UI; nothing to configure.
- API, CLI and MCP are thin wrappers over one validated, atomic write module.
- **Rejected:** MCP as the primary or only write path; a database for config.

### D8 — MCP served by the same process and port, plus a stdio bridge

- One service, one port, one launchd job; shares the write module and watcher, so MCP writes update the UI live.
- `sj mcp` stdio bridge for clients that prefer stdio, forwarding to the daemon so there is one writer.
- **Rejected:** a separate MCP process/port (more to install and remember; two writers).

### D9 — Rewrite the Host header to the upstream by default

- Caddy preserves Host by default. Local apps that defend against DNS rebinding — Local Review (`403 forbidden
  host`), Vite's `allowedHosts`, others — reject a foreign Host, so fronting them unmodified fails immediately.
- `header_up Host {upstream_hostport}` by default; `X-Forwarded-Host`/`-Proto` still carry the public name;
  `proxy.preserveHost: true` opts out per app.

### D10 — MCP tools describe; they never launch

- A tool that registers "run this command" is arbitrary code execution for any agent with the MCP configured.
- Launching is CLI-only (`sj run`, `sj service add`), where the user (or an agent in the user's own shell, under its
  own permission model) runs it explicitly.

### D11 — Three app sources: declared, discovered, observed

- Declared for durability; discovered to integrate with other tools; observed so the dashboard reflects reality
  without maintenance — the differentiator from every hand-configured dashboard.

### D12 — "Stopped on purpose" is not "down"

- Only apps the user says should be running can be `down`. `adhoc` and `stopped` apps that are not listening are
  shown calmly. Uptime % excludes stopped time.

### D13 — Tiered thumbnails: favicon tile → screenshots (opt-in) → generated card

- Favicon tiles are instant and dependency-free; screenshots are the most recognisable but need a ~hundreds-of-MB
  browser, so they are opt-in and lazily installed; generated cards reuse the sibling project's resvg pipeline.

### D14 — One YAML file per entity

- Concurrent agent writes touch different files; small diffs; a broken file breaks one entity; matches Local Review.
- **Rejected:** a single `apps.yaml` / `bookmarks.yaml`.

### D15 — v0 ships with no DNS, no proxy, no sudo

- The author's own words: the front page alone, linking to ports, "would be immensely valuable". It also de-risks
  the project: the hardest system-level work (v1) is not on the critical path to usefulness.

### D16 — Stack and conventions mirror Local Review

- Node ≥ 22, TypeScript ESM, Hono, React, Vite, chokidar, `yaml`, `node --test`, changesets, npm provenance; data
  home with env override; `packageRoot()`; single-export `port.ts` with a keypad mnemonic; SSE pattern; loopback
  security middleware; agent guide + `llms.txt`; backups; "rename, never delete".
- Consistency across the author's projects, and those patterns are already proven in production use.

### D17 — Never reassign an existing app's port

- Apps hardcode their own ports (helper scripts, dev proxies, baked-in site URLs). Claiming or declaring an app keeps
  its port; only brand-new apps get an assigned one.

### D18 — Record observations while processes are alive

- Once a process dies its working directory is unrecoverable, so "what was lost at reboot" is only answerable from a
  record taken earlier. `state/observed.json` keeps last-known identity.

### D19 — Spaghetti Junction's own launchd jobs use unique, prefixed labels

- `spaghetti-junction.daemon`, `spaghetti-junction.caddy`, `spaghetti-junction.dnsmasq` (if not using Homebrew's),
  `spaghetti-junction.app.<slug>`. Makes them easy to find, audit and tear down, and impossible to confuse with
  user-created jobs.

### D20 — Default daemon port 7724 (approved by the author)

- "SPAG" on a phone keypad, following Local Review's 5622 = "LOCA" convention; easy to remember, and it ties the port to
  the name.
- IANA registers 7724 to a 2008 enterprise endpoint product (Novell Snap-in Deep Freeze Control), not a realistic
  conflict on a developer machine. Avoids 5000/7000 (macOS AirPlay). `--port`/`$PORT` override it; `EADDRINUSE` gets a
  clear message.

### D21 — `sj run` is the one command agents use to start servers (approved by the author)

- The successor to Paddock's `pm start`: registers the app, keeps or assigns a stable port, hands the process to
  launchd so it outlives the agent's session, waits until it is listening, prints the URL and exits. Not persistent
  across reboots unless `--persist`, but always remembered. Full behaviour in `04-apps-health-services.md`.
- Without a one-command alternative to `npm run dev`, agents keep creating orphans, so this is the habit-changing half
  of the product (paired with the agent guide snippet and optional hook in `06`).

### D22 — The tab title and favicon show trouble (approved by the author)

- `(N down) Spaghetti Junction` and a status-marked favicon, live over SSE; only `down`/`unhealthy` count. A pinned tab
  becomes a passive monitor without any notification system. Details in `05-ui.md`.

### D23 — Visual identity: British motorway signage (approved by the author)

- Draws on the name (Gravelly Hill Interchange, M6 junction 6): blue sign panels, white rounded lettering, ports as
  junction-number plates, hostnames as destinations. Borrow the visual language, don't replicate signs, and use only
  freely licensed type. Details in `05-ui.md`.
- **Rejected:** a departures-board/switchboard look (good, but generic), and generic admin-template styling.

### D24 — Examples and the recommended custom domain use `.internal`

- The author has no attachment to a personal made-up TLD; `.internal` is ICANN-reserved for private use, never
  delegated, and gets Caddy's local CA automatically, so it is the simplest custom domain that is also correct.
- The *default* stays `localhost` (D5): it needs no dnsmasq, which `.internal` still does. `.internal` is the answer
  when someone wants their own namespace.

## Alternatives considered for the whole product

| Option | Why not |
|--------|---------|
| hotel (typicode) | Closest match but dormant since Oct 2023 (122 open issues). Borrow UX ideas only. |
| Homepage / Homer / Dashy / Heimdall | Hand-maintained YAML recreates the original problem; no discovery, fronting or services. |
| localias + a dashboard | Per-alias `/etc/hosts` edits (sudo each time), no wildcards, no persistence. |
| PM2 + dnsmasq + Caddy, hand-wired | A recipe, not a product; nothing ties registry, routing and dashboard together. |
| Coolify / Dokploy | Server PaaS; far too heavy. |
| launchd plists by hand | Verbose, error-prone (the PATH trap), no overview. |
