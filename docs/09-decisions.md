# 09 — Decision log

Format: decision, then why, then what was considered instead. Add new decisions at the end with the next number.
Decisions here supersede anything contradictory elsewhere; if you find a contradiction, fix the other document.

---

### D1 — Name: Hallway; package `hallway`; binary `hallway` (renamed from Spaghetti Junction)

- **Why "Hallway".** The pitch already called the product "the front door for everything you vibe-coded on a random
  port". A hallway is where all the doors are: every local app is a door off it, and the dashboard is the place you
  stand to see them all. The word is plain, easy to say and spell, a single word, and it describes the *cure* (a calm,
  tidy home where you know what is behind each door) rather than the mess.
- **npm:** `hallway` (unscoped) and `hall-way` were both free on 2026-10-16 (`registry.npmjs.org` returned 404 for
  each). The author is publishing a placeholder to reserve `hallway`.
- **Binary:** `hallway`, the same as the package. A short alias is optional; `hw` is proposed, not decided
  (Q-BINARY).

**History: the project was originally named Spaghetti Junction** (package `spaghetti-junction`, binary `sj`,
repository `edspencer/spaghetti-junction`, renamed to `edspencer/hallway` in October 2026).

- The original mental image was the author's machine as a spaghetti of servers on random ports, which the tool would
  untangle. "Spaghetti Junction" is the popular name of the Gravelly Hill Interchange (junction 6 of the M6 in
  Birmingham, UK), proverbially the most tangled road junction in Britain. A reverse proxy is a kind of junction, so
  the name described both the problem and the function, and it led to a British motorway-signage visual identity (the
  original D23).
- **Why it was renamed:** the name was too long and hyphenated, the author wanted a single word, and the `sj` binary
  was cryptic. It also named the mess rather than the tidy result.
- Names checked during the original naming (npm, 2026-10-14). `spaghetti-junction` was free. Taken: `spaghetti`,
  `colander`, `orzo`, `noodle`, `strand`, `strands`, `skein`, `twirl`, `tangle`, `untangle`, `switchboard`, `pasta`,
  `junction`, `interchange`, `localport`, `portmap`, `porthole`, `gravelly`, `al-dente`. Free but not chosen: `aldente`
  (it collides with a well-known macOS battery utility called AlDente), `trattoria`, `fusilli`, `forkful`, `matassa`,
  `localhub`.
- Names considered during the rename (npm, checked 2026-10-16). **Taken:** `porter`, `portico`, `concierge`, `foyer`,
  `lobby`, `roundup`, `corral`, `wrangler`, `muster`, `stray`, `flyover`, `slipway`, `signpost`, `fingerpost`,
  `satnav`, `beacon`. **Free and shortlisted:** `strays`, `pinfold`, `foundling`, `digory`, `otherwood`, `kenning`,
  `dewpond`, `gyratory`, `sliproad`. Hallway beat the shortlist because it is the most ordinary word on it, and it
  extends the "front door" phrasing the README already used.
- The origin stories (the road junction, the rename, and the hallway imagery in D23) are worth a short "Why the name"
  page on the future documentation site. See the documentation-site item in `08-roadmap.md`.

### D2 — A standalone, generic, open-source project

- The problem is general to anyone building many small local apps, especially with coding agents.
- It must not depend on, or be a feature of, any other tool (including the author's own Paddock). It may *integrate*
  with others via optional discovery adapters.
- Public repository under the author's personal GitHub account; npm publish mirroring the author's Local Review
  (changesets, provenance).

### D3 — Own the registry; use native launchd; no PM2, no `pm`

- Once Hallway owns the app registry, fronting and service installation, a separate process manager is
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
- Run Caddy as a **dedicated LaunchDaemon** (`hallway.caddy`), not Homebrew's service, to avoid hijacking
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
- `hallway mcp` stdio bridge for clients that prefer stdio, forwarding to the daemon so there is one writer.
- **Rejected:** a separate MCP process/port (more to install and remember; two writers).

### D9 — Rewrite the Host header to the upstream by default

- Caddy preserves Host by default. Local apps that defend against DNS rebinding — Local Review (`403 forbidden
  host`), Vite's `allowedHosts`, others — reject a foreign Host, so fronting them unmodified fails immediately.
- `header_up Host {upstream_hostport}` by default; `X-Forwarded-Host`/`-Proto` still carry the public name;
  `proxy.preserveHost: true` opts out per app.

### D10 — MCP tools describe; they never launch

- A tool that registers "run this command" is arbitrary code execution for any agent with the MCP configured.
- Launching is CLI-only (`hallway run`, `hallway service add`), where the user (or an agent in the user's own shell, under its
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

### D19 — Hallway's own launchd jobs use unique, prefixed labels

- `hallway.daemon`, `hallway.caddy`, `hallway.dnsmasq` (if not using Homebrew's),
  `hallway.app.<slug>`. Makes them easy to find, audit and tear down, and impossible to confuse with
  user-created jobs.

### D20 — Default daemon port 4255 (approved by the author)

- "HALL" on a phone keypad (H=4, A=2, L=5, L=5), following Local Review's 5622 = "LOCA" convention. It is easy to
  remember and ties the port to the name.
- IANA has no individual registration for 4255. It lies inside the legacy block registration `vrml-multi-use`,
  4200–4299 ("VRML Multi User Systems", no transport protocol or date given), which is not a realistic conflict on a
  developer machine. It is also clear of the common dev-server defaults nearby (Angular 4200, Astro 4321, Jekyll and
  Phoenix 4000), of macOS's AirPlay Receiver ports (5000/7000), of the ephemeral range (49152–65535), and of
  `ports.assignRange` (5100–5999), so Hallway never assigns its own port to an app. Details in `11-research-notes.md`.
- `--port`/`$PORT` override it; `EADDRINUSE` gets a clear message.
- **History:** under the old name the default was **7724** ("SPAG"), which IANA registers to "Novell Snap-in Deep
  Freeze Control" (2008). Nothing was ever released on 7724, so there is no migration to handle.

### D21 — `hallway run` is the one command agents use to start servers (approved by the author)

- The successor to Paddock's `pm start`: registers the app, keeps or assigns a stable port, hands the process to
  launchd so it outlives the agent's session, waits until it is listening, prints the URL and exits. Not persistent
  across reboots unless `--persist`, but always remembered. Full behaviour in `04-apps-health-services.md`.
- Without a one-command alternative to `npm run dev`, agents keep creating orphans, so this is the habit-changing half
  of the product (paired with the agent guide snippet and optional hook in `06`).

### D22 — The tab title and favicon show trouble (approved by the author)

- `(N down) Hallway` and a status-marked favicon, live over SSE; only `down`/`unhealthy` count. A pinned tab
  becomes a passive monitor without any notification system. Details in `05-ui.md`.

### D23 — Visual identity: the hallway (**proposal, awaiting the author's approval**)

- **Status: proposed, not approved.** It replaces the original D23 (British motorway signage), which the author
  approved but which only made sense under the old name. Implementers should treat it as the working direction, and
  prototype against it with screenshots, but must not finalise branding (logo, display typeface, palette) until the
  author signs off (Q-VISUAL-IDENTITY).
- **The idea:** the dashboard is a calm, well-kept hallway. Each app is a **door** and its port is the **door
  number**. A door's state shows the app's health: **ajar** with light showing means healthy, **closed** means stopped
  on purpose, and **dark or boarded up** means down. Unclaimed listeners from the scanner are **noises behind doors you
  didn't know were there**. Bookmarks hang on a **key hook or coat rack by the front door**.
- **Moods to draw on,** without copying anyone's art: Discworld's L-space (every library connects to every other);
  the corridor of identical doors between worlds in Apple TV+'s *Dark Matter* (2024); and the Wood between the Worlds
  in *The Magician's Nephew*, with its identical pools, each leading to a different world, a drowsy place where you
  forget which pool is home. The last is the original problem exactly: many identical-looking servers, and nobody
  remembers which is which. Hallway's answer is to label every door.
- **Constraints:** never copy a franchise's actual imagery, characters, typography or logos. *Narnia* and *Aslan* are
  trademarks: they may appear in a backstory or origins page, never in the product's branding. Status must still be
  shown by colour, shape and text together (the door imagery adds to these and never replaces them).
- Details in `05-ui.md`.
- **Rejected:** keeping the motorway-signage identity (it depended on Spaghetti Junction, the road junction, and
  would be an orphaned metaphor under the new name); a departures-board/switchboard look (good, but generic); generic
  admin-template styling.

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
