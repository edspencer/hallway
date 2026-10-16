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
  each). The author published a code-free placeholder, `hallway@0.0.1`, on 2026-10-16 to reserve it (D29).
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

- *Updated by D26:* systemd user units on Linux are implemented alongside launchd from v0, behind `server/platform/`.

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
- Run Caddy as a **dedicated job** (`hallway.caddy`), not Homebrew's service, to avoid hijacking a Caddy the user may
  already run. *Updated by D47:* it is a user-level job (LaunchAgent / systemd user unit), not a root LaunchDaemon.
- Push config through the **admin API** so adding an app never needs sudo.
- *Resolved by D47:* a root Caddy with an unauthenticated admin API would be a local privilege-escalation path, so
  Caddy runs as the user on high loopback ports, with a fixed root-owned redirect from 443/80.
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

- Node ≥ 22.13 (D37), TypeScript ESM, Hono, React, Vite, chokidar, `yaml`, `node --test`, changesets, npm provenance; data
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

- `hallway.daemon`, `hallway.caddy`, `hallway.dnsmasq`, `hallway.app.<slug>` (user-level), and `hallway.pf` (D47: the
  one LaunchDaemon, macOS's redirect). Makes them easy to find, audit and tear down, and impossible to confuse with
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

### D23 — Visual identity: the hallway (**approved as the working direction, D28; final sign-off pending**)

- **Status: approved as the direction to build against (2026-10-16, D28), not finalised.** It replaces the original
  D23 (British motorway signage), which the author approved but which only made sense under the old name.
  Implementers build against it and iterate with screenshots, but must not finalise branding (logo, display typeface,
  palette) until the author signs off (Q-VISUAL-IDENTITY).
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

### D25 — Licence: MIT (approved by the author, 2026-10-16)

- Matches the author's other open-source projects (Local Review, Paddock), so code and patterns can move between them
  freely. `LICENSE` is Local Review's, copyright Ed Spencer. Resolves Q-LICENSE.

### D26 — A platform abstraction, with Linux pulled forward from v2 (approved by the author, 2026-10-16)

- Everything OS-specific sits behind one interface in `server/platform/` (`darwin.ts`, `linux.ts`): the per-user
  service manager (launchd LaunchAgents / **systemd user units**), how listening sockets are listed (`lsof` /
  **`ss`, falling back to `/proc/net/tcp{,6}`**), and boot time (`sysctl kern.boottime` / `/proc/stat` `btime`).
  The rest of the server never branches on `process.platform`.
- **Linux is implemented alongside macOS from v0**, not deferred to v2, so every milestone can be built, run and
  checked end to end on a Linux development machine (where the implementing agents work). It also keeps the
  abstraction honest: two real implementations from the start, not one plus a guess.
- **macOS stays the primary platform.** Its implementation is written and unit-tested (both platforms' logic is
  tested on every OS, and CI runs on macOS too), but anything that can only be exercised on a real Mac — `launchctl`
  behaviour, `lsof` output on current macOS, LaunchAgent lifecycle across login/reboot — is listed as **"unverified on
  macOS"** in `11-research-notes.md` until someone runs it there.
- Linux scope follows Q-LINUX-SCOPE's leaning: systemd user units, a `*.localhost` resolution check, `setcap` for
  Caddy (v1). Custom-domain DNS on Linux (`systemd-resolved` / dnsmasq drop-in) is still v1 work.
- Updates D3 ("native launchd, systemd later") and `08-roadmap.md`.
- **Rejected:** macOS-only until v2 (nothing could be run end to end by the agents doing the building); separate
  per-OS code paths without an interface (scatters `process.platform` checks through the server).

### D27 — Ship the `hallway` binary only, for now (approved by the author, 2026-10-16)

- `package.json` declares one bin, `hallway`. Whether a short alias (`hw`) ships too is still open (Q-BINARY);
  adding it later is a one-line, non-breaking change, while removing a shipped alias would break scripts.

### D28 — The hallway identity (D23) is the approved working direction; tokens live in one place (2026-10-16)

- The author approved D23 as the direction to **build against**. Final sign-off on the logo, display typeface and
  palette is still open (Q-VISUAL-IDENTITY), so the identity must stay cheap to change:
  - every colour, typeface and radius is a CSS custom property in `src/theme/tokens.css` (dark-first, with a light
    variant under `prefers-color-scheme`); no other file hard-codes a colour;
  - the provisional mark (a door ajar with lamplight) lives only in `src/brand/Logo.tsx` and `public/favicon.svg`.
- No display font is bundled yet; the token names a warm serif with system fallbacks. Bundling one (OFL, licence
  checked) is part of the visual-identity work.

### D29 — Release machinery ported from Local Review; nothing published until a changeset says so (2026-10-16)

- `.changeset/`, `.github/workflows/release.yml` and `RELEASING.md` follow Local Review exactly: a changesets version
  PR, `verify-ci` (CI must be green on the exact commit), `publish-npm` over **npm trusted publishing (OIDC) with
  provenance** and no npm token, then the `v<version>` tag and GitHub Release.
- The npm side is set up: the author published a code-free placeholder, `hallway@0.0.1`, by hand on 2026-10-16 (a
  trusted publisher can only be attached to an existing package) and configured trusted publishing for
  `edspencer/hallway` / `release.yml`, with 2FA required and tokens disallowed. Publishing through the pipeline is
  authorised.
- **One addition to Local Review's workflow:** `package.json` starts at the unreleased version `0.0.0`, and the
  Release workflow never releases `0.0.0`. Without that guard, any push to `main` with no pending changesets would
  find no `v0.0.0` tag and try to publish. So nothing is published until a PR adds a changeset and the resulting
  version PR is merged; the first real release is planned as `0.1.0` once v0 works.
- **Rejected:** an `NPM_TOKEN` secret (no provenance guarantee; the sibling packages disallow tokens); `"private":
  true` until release (it would need a code change to release, and changesets treats private packages
  differently); an extra repository-variable switch on publishing (considered, then dropped: the `0.0.0` guard and
  the changesets flow already make every release a deliberate merge, as in Local Review).

### D30 — The documentation website lives in `website/` as its own project (2026-10-16)

- `website/` is a separate npm project (its own `package.json` and lockfile), as in Local Review. The root
  `tsconfig*.json`, `npm test`, the npm package's `files` and `smoke:pack` never include it; `check:nul` scans it
  (skipping its dependencies and build output).
- `ci.yml` has a `website` job that builds the site only when `website/**` changes, and passes with its steps
  skipped until the directory exists; `ci-passed` requires it. Whoever adds the site adapts that job's steps.
- Brings the "documentation website" item forward from "Later" in `08-roadmap.md`; it is being built in parallel
  with v0.

### D31 — Development-only overrides for the bind address and Host allowlist (2026-10-16)

- The daemon binds 127.0.0.1 and accepts only loopback `Host` headers (`02-architecture.md`, "Security model"),
  which makes it impossible to preview a development build through a reverse proxy on another machine, which is how
  a remote development machine typically exposes previews. So two **environment variables** relax it, for development
  only: `HALLWAY_DEV_BIND` (an address to bind instead of 127.0.0.1) and `HALLWAY_DEV_ALLOWED_HOSTS` (extra
  hostnames, comma-separated, that the Host/Origin check accepts).
- Constraints: environment only, **never a CLI flag**; never in `--help`, the agent guide or user docs (only
  `CONTRIBUTING.md`/`AGENTS.md`); unset by default; the daemon prints a warning on stderr while either is in effect;
  `smoke:pack` and the tests scrub them. Nothing about the production default changes.
- Local Review deliberately has no such override ("no `--host` flag"). Hallway has one only because its
  development often happens on remote machines; if that stops being true, delete it.
- **Rejected:** a `--host` flag (discoverable by users, contradicts the security model); tunnelling 127.0.0.1 through
  SSH for every preview (works, but not with the dev box's existing proxy).

### D32 — Validation is hand-rolled, with the schemas as data (resolves Q-VALIDATION, 2026-10-16)

- `server/store/schema.ts` describes each human-editable file as data (type, default, required, range, enum, a
  one-line doc, an optional extra rule). One small walker validates against it and fills in defaults; another
  renders the file-format reference in `AGENT-GUIDE.md` from the same descriptions, so the docs cannot drift from the
  validator. The daemon regenerates the reference whenever it renders the guide, and `test/guide.test.ts` fails if
  the committed copy is stale (`npm run sync:guide` rewrites it).
- Every problem carries a key path, which the store maps to a line and column through the `yaml` Document's ranges.
  Unknown keys are warnings (with a "did you mean" for near misses), never errors, and are kept on write.
- Defaults the spec left implicit: an app's `name` defaults to its slug (so the minimal file is `port:` alone, though
  the guide shows `name` too); `expected` defaults to `running`; a bookmark group's `title` defaults to its file name
  and `order` to 100; a link's `title` defaults to its URL's host name; `config.yaml` refuses a `version` above 1.
- **Rejected:** a schema library such as zod or ajv (a dependency for ~four small files, and its error messages and
  reference rendering would still need wrapping); JSON Schema files (no comments in the generated docs, and the line
  mapping is the same work).

### D33 — Write semantics: PUT replaces known keys, PATCH is a JSON merge patch, broken files are never written (2026-10-16)

- Every write edits the file as a `yaml` Document: a changed scalar keeps its comment and quoting, untouched keys
  keep their place, new keys go at the end, and short scalar lists are written inline (`tags: [ a, b ]`).
- `PUT` makes the file's **known** keys exactly the body's (absent or `null` removes them) and leaves keys the schema
  doesn't know alone, since they're the user's. `PATCH` is a JSON merge patch (RFC 7396): mappings merge, `null`
  removes a key, lists are replaced whole.
- API bodies with unknown keys are refused (400): a file may carry keys Hallway doesn't know, a request has no excuse,
  and a typo such as `expcted` would otherwise vanish silently.
- A write whose result wouldn't validate is refused (400, with the issues) and writes nothing. A file that fails to
  **parse** is never written (409, "fix the file by hand"); a file that parses but fails validation can be fixed by a
  write whose result validates.
- Concurrency: writes are serialised per file; `If-Match` (quoted, bare or weak, or `*`) gives 409 with the current
  ETag on a mismatch; `If-None-Match: *` makes a `PUT` create-only; and the file is re-read just before the rename,
  so a hand edit that lands mid-write wins (409) rather than being overwritten.
- **Rejected:** regenerating the whole file from the parsed object (loses comments); PATCH as JSON Patch (RFC 6902:
  more expressive, but awkward for agents and the dashboard alike).

### D34 — Deletes go to `backups/removed/`; snapshots before destructive writes (2026-10-16)

- `DELETE` moves the file to `backups/removed/<timestamp>/<its path in the data home>` (e.g.
  `backups/removed/2026-10-16T10-00-00Z/apps/foo.yaml`), never replacing anything, so restoring is a copy back.
  These are never pruned.
- Snapshots (`backups/<timestamp>/`) copy `config.yaml`, `ignore.yaml`, `apps/` and `bookmarks/`, on start, hourly,
  and before a delete or a replacing `PUT`; each only if something changed since the newest. Pruning is Local
  Review's: the newest 50, plus the first of each UTC day for 30 days.
- **Rejected:** a `.bak` beside the file (Local Review's per-file approach: it would clutter `apps/`, where every
  `*.yaml` is an app); unlinking (D16, "rename, never delete").

### D35 — Live data plugs in through providers; the core owns the files and the API (2026-10-16)

- The prober, uptime store, scanner, discovery adapters and thumbnailer are separate modules. Each registers a
  `StateProvider` (`server/providers.ts`): synchronous getters for an app's health, history and listener identity,
  the observed list, discovered apps and thumbnails, plus an async `scan()`. `/api/state` merges them into the slots
  defined in `shared/api.ts`; with no provider a slot is `unknown`, null or empty, and `daemon.providers` says which
  are running so the dashboard can say so rather than show grey. A provider that throws is skipped for that call.
- Producers emit `ServerEvent`s on the shared bus (`server/events.ts`); the SSE endpoint forwards them.
- `claim` and `ignore` are implemented in the core (they write `apps/` and `ignore.yaml`, which only the store may
  do) on top of the provider's `observation(id)`.
- **Rejected:** the core importing the scanner and prober directly (couples the milestones, and the modules are being
  built in parallel); pushing provider data into the store (it isn't file data and must not be persisted there).

### D36 — `config.yaml`'s port, and the files a new data home starts with (2026-10-16)

- The daemon's port is `--port`, else `$PORT`, else `port:` in `config.yaml`, else 4255. The data home is created and
  read before binding, so a broken `config.yaml` still starts the daemon (on the default) and shows its error.
- A new data home gets the directories, a `.gitignore` listing the machine-written directories (and `.*.tmp-*`), an
  `ignore.yaml` with empty lists, and a `config.yaml` that is `version: 1` followed by every setting **commented out**
  at its default, generated from the schema. Writing the defaults as live values would freeze them: a later release
  could never change a default for an existing user. None of these files is ever replaced once it exists.

### D37 — Uptime history in `node:sqlite`; Node ≥ 22.13 (2026-10-16; resolves Q-STORE and Q-NODE-MIN)

- Probe samples and hourly rollups live in `state/health.sqlite` through the built-in `node:sqlite`
  (`server/health/uptime.ts`): no dependency, and rollups, windows and pruning are a few lines of SQL.
- `node:sqlite` loads without a flag from **Node 22.13.0**; 22.5–22.12 need `--experimental-sqlite` and 22.0 doesn't
  have it (`11-research-notes.md`). So `engines.node` is raised from `>=22` to **`>=22.13`**, and CI adds a Node 22.13
  job so the floor stays tested (the `22` in the matrix resolves to the newest 22.x). Node 22 and 24 print an
  `ExperimentalWarning` when the module loads; the daemon drops that one warning and nothing else. If an older Node
  ignores `engines` (npm only warns), opening the store fails with a message naming the version needed.
- Settings: WAL, `synchronous = NORMAL` (one insert per probe; losing the last moment of samples in a power cut is
  fine).
- **Rejected:** JSONL day-files (the fallback, needed only if 22.0–22.12 had to be supported: rollups and pruning by
  hand); passing `--experimental-sqlite` (a flag in the bin's shebang or the service definition, for no gain);
  `better-sqlite3` (a native dependency to build on install).

### D38 — Scanner and prober details the spec left open (2026-10-16)

- **Listener source on Linux:** `ss -ltnpH` when it runs, else `/proc/net/tcp{,6}` + `/proc/<pid>/fd` (D26). Both are
  pure parsers with fixtures. Listeners whose owning process can't be seen are dropped (as `lsof` on macOS never shows
  them).
- **Project without markers:** when no `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`/`Gemfile`/`.git` is found
  above the cwd, the cwd itself is the project (so `python3 -m http.server` in a folder is labelled with that folder:
  v0 acceptance criterion 4), unless the cwd is `/` or the home directory. The walk never accepts `~` or `/` as a
  root, so a dotfiles repository in `~` doesn't claim everything under it.
- **Labels:** `repo @ branch` for every listener in a linked worktree, and for every listener whose repository has
  more than one checkout listening; otherwise the project name; otherwise `<process> :<port>`. `repo` is the main
  checkout's directory name, from `git rev-parse --git-common-dir`. A detached HEAD shows its short commit.
- **Observation id:** the first 16 hex characters of SHA-256 over project root (or cwd), port and the command with its
  executable reduced to a basename and whitespace collapsed. `observed.json` keeps records for 90 days after last seen.
- **Identity cache:** per PID, keyed also on the start time and command so a reused PID isn't confused with the old
  process, for 10 minutes; the HTTP sniff runs on every scan (titles change), at most 8 at once.
- **Orphans:** PPID 1 on both platforms; on Linux also a parent named `systemd` (the `systemd --user` subreaper).
  Under launchd a LaunchAgent is PPID 1 too, so "orphan" means "not attached to a session", not "lost".
- **Starting:** while a managed service is in its start grace period and not listening, its state is `unknown` with
  `starting: true`, so no new state is needed in `AppState`. Starting probes are not uptime samples.
- **Flap damping applies to any move away from `healthy`** (to `unhealthy`, `down` or `stopped`), counting consecutive
  non-healthy probes of any kind. Uptime samples record each probe's own (undamped) state.
- **Probe schedule:** each app has its own timer (interval × 0.9–1.1); the first round is spread over up to 2 s; a
  shared semaphore caps `probe.concurrency`. Going live (a dashboard connects) pulls every app's next probe in to
  within the live interval; live mode only ever speeds probing up (the shorter of the two intervals wins). A changed port or host resets an app to `unknown`; a changed `expected` keeps the state
  and re-probes at once.
- **Uptime bars:** 24 h = 48 × 30 min from samples; 7 d = 56 × 3 h and 90 d = 90 × 1 day (UTC days) from rollups, with
  the hour in progress computed from samples. A bar's colour is its worst state (down > unhealthy > healthy >
  stopped); no samples is `null` (no data). Uptime = healthy / (samples − stopped). Latency percentiles over 7 d and
  90 d are sample-weighted percentiles of the hourly ones (rollups don't keep raw latencies), so approximate.
- **Wiring (`server/live.ts`):** one `StateProvider` named `live` fills `appHealth`, `appHistory`, `appIdentity`,
  `observed`, `observation` and `scan` (D35). `observed()` re-applies the store's current `ignore.yaml` and declared
  ports to the latest scan, so a claim or an ignore takes effect at once rather than at the next scan; an `observed`
  event is emitted only when a scan changes the list. App and config events re-read the probe targets. "A dashboard is
  connected" is the bus having a subscriber besides `live` itself. The CLI's `serve` starts it after binding, and the
  first scan doesn't hold up start-up. The core's claim (`server/api.ts`) writes `host: ::1` for a listener bound to
  IPv6 loopback only, which would otherwise be probed on 127.0.0.1 and show as down.

### D39 — The v0 dashboard: how it gets its data, draws its doors and finds its pictures (2026-10-16)

- **Data:** one `GET /api/state` paints the page (index.html preloads it, so it starts alongside the scripts); then
  each SSE event refetches only what it names (`app`/`state`/`thumb` → `/api/apps/:slug`, `bookmarks` with a group →
  `/api/bookmarks`, `observed` → `/api/observed`). Events that touch page-wide data (`apps`, `config`, a stray file,
  `ignore.yaml`) refetch `/api/state`. Events arriving together are coalesced into one round. The stream reconnects
  with backoff (0.5 s → 30 s) and refetches everything on reconnect; the page also refreshes quietly every 5 minutes
  (the uptime bars move with no event) and when a tab hidden for over a minute comes back. Measured: fully painted in
  44–76 ms warm (`performance.mark('hallway:painted')`; `11-research-notes.md`).
- **No prober is not "unknown".** With `daemon.providers.health` false, doors are drawn closed in their own paint and
  say `◌ not checked`, the header says "Health checks off", and the tab title counts nothing. `◌ unknown` (a door in
  shadow, an outline) is kept for a prober that hasn't reached an app yet, as `05-ui.md` describes. Likewise the
  observed tray is hidden without a scanner, and the first-run page only offers "start a server and Hallway will find
  it" when a scanner is running.
- **Tier-1 thumbnails** (D13) are a provider (`server/thumbs/`, D35): `thumb(slug)` and a new slot,
  `bookmarkIcon(link)`. Lookups never block a request: what's known is answered at once, a missing or stale icon is
  fetched in the background (apps at start and when their file changes, bookmarks at start and when their group
  changes), cached in `cache/favicons/`, and announced with a `thumb` or `bookmarks` event. Fresh for 6 h (local
  apps) or 7 days (remote bookmarks); "nothing found" is retried after 10 min or a day. `icon:` picks the source:
  `auto` looks the site up, an `http(s)` URL is the image, a path is read from inside the data home only, and
  anything else (an emoji) is drawn as text by the dashboard.
  - Icons are served as inert images: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
    sandbox` and `nosniff`, because some are SVGs from other sites and the daemon's origin can write files.
  - `GET /api/bookmarks/:group/icon?url=` answers only for a URL in that group (never a general fetcher), with 204
    rather than 404 while there's no icon, so a chip asking isn't an error in the console.
  - **The dominant colour is picked in the browser**, from the icon drawn into a 24 px canvas (`src/lib/colour.ts`):
    the browser already decodes ICO, PNG and SVG, and the daemon then needs no image decoder (D13's "zero extra
    dependencies"). It is mixed 58–62 % into a warm neutral (`--hw-paint-mute`, `--hw-paint-strength`) so a bright
    brand colour never competes with the state colours. No icon: one of ten door paints, by a hash of the slug.
- **Additive API fields** (`shared/api.ts`): `AppView.thumb` (the thumbnail's ETag, or null, so the page doesn't ask
  for pictures that don't exist) and `DaemonInfo.hostname` (the header's name when `dashboard.title` isn't set).
- **Typefaces bundled:** Fraunces (nameplates, headings), Inter (text), JetBrains Mono (door numbers, figures), all
  SIL OFL 1.1 (licences checked in the `@fontsource-variable` packages), as devDependencies that Vite copies into
  `dist/web`, so the dashboard never asks the network for a font. Updates D28's "no display font is bundled yet";
  the choice of display face is still open with the rest of Q-VISUAL-IDENTITY.
- **Contrast:** the light theme's accent (`#a8641b`, 4.15:1) is never text: `--hw-accent-text` (`#8a5a14`, 5.6:1, as
  the website uses) is. The light state colours were darkened a little for margin. A test checks every text and
  state token at 4.5:1 or better on the page and on cards in both themes, that text never uses `--hw-accent`, and
  that `styles.css` contains no colour literal (D28).
- **Theme:** `data-theme` on `<html>`, set before the first paint by a small inline script from the last-seen
  `dashboard.theme` (kept in `localStorage`) and the system preference; `src/theme/theme.ts` follows the config and
  the system after that. tokens.css therefore has one dark and one light block, not a duplicated media query.
- **Copy stays plain** (`05-ui.md`): the door imagery is in the visuals only; tooltips and the drawer describe states
  in words ("Not answering, and it should be running").
- **Rejected:** server-side colour extraction (an image decoder in the daemon for a cosmetic); fetching favicons in
  the browser straight from each site (no cache, a request per page view to every bookmarked site, and remote origins
  in the page); a general `/api/favicon?url=` (a fetch-anything endpoint on a local daemon); a spinner while
  `/api/state` loads (the header is drawn at once and the page fills in well under 200 ms).

### D40 — systemd user units for Linux, and how launchd's keys map onto them (2026-10-16)

- Linux's managed services are systemd **user** units (D26) named `hallway-daemon.service` and
  `hallway-app-<slug>.service`, in `$XDG_CONFIG_HOME/systemd/user` (default `~/.config/systemd/user`). The launchd
  labels (`hallway.daemon`, `hallway.app.<slug>`, D19) map one to one by turning dots into hyphens; slugs have no
  dots, so the mapping can't collide. Hyphens rather than dots because systemd treats the part before the first `-` as
  a prefix: one drop-in directory, `hallway-.service.d/`, applies to every Hallway unit.
- The keys: `RunAtLoad` → `[Install] WantedBy=default.target` plus `systemctl --user enable`; `KeepAlive` →
  `Restart=always` (a `systemctl stop` is never undone by it); `ThrottleInterval 10` → `RestartSec=10`;
  `StandardOutPath`/`StandardErrorPath` → `StandardOutput=append:`/`StandardError=append:` on the same
  `logs/<slug>.out.log` / `.err.log` files. `%` is escaped everywhere, `$` in `ExecStart`, and arguments are quoted
  only when they need it.
- A unit starts with the user's systemd instance, i.e. at login. Running without a login session (and at boot) needs
  lingering (`loginctl enable-linger`), which is a one-off privileged choice for the user: `hallway service install`
  says so and `hallway doctor` warns while it's off. Hallway never enables it itself.
- The renderers (`server/platform/launchd.ts`, `systemd.ts`) are pure functions pinned by golden files
  (`test/fixtures/services/`); the lifecycle verbs go through a command runner that the tests mock, so both platforms
  are tested on both OSes. Where the tools exist, `systemd-analyze verify` and `plutil -lint` check the output too.
- **Rejected:** dotted unit names (`hallway.daemon.service`, legal, but no shared drop-in prefix); system units (need
  root, D3); `Restart=on-failure` for KeepAlive (launchd's KeepAlive restarts after a clean exit too).

### D41 — Stopping a managed service is durable; what start, stop and remove do to the YAML (2026-10-16)

- `hallway stop` must keep a job stopped across logins, not just until the next one: `expected: stopped` says so. A
  LaunchAgent in `~/Library/LaunchAgents` is loaded again at every login whatever `bootout` did, and an enabled systemd
  unit starts again too. So stop is **bootout + `launchctl disable`** on macOS and **stop + `systemctl --user
  disable`** on Linux, and start undoes it (`launchctl enable` before `bootstrap`; `enable`/`disable` per
  `runAtLoad` before `start`). This extends docs/04's lifecycle table, which had bootout alone.
- The YAML: start (and `hallway run`) set `expected: running` for a job that starts at login or restarts
  (`runAtLoad` or `keepAlive`), and `expected: adhoc` for one that does neither (a `hallway run` without `--persist`),
  so it reads as *stopped*, not *down*, after a reboot. Stop sets `expected: stopped`. Restart changes nothing.
  `hallway service rm` removes the job and the `service:` block and leaves the app declared; `hallway app rm` of a
  managed app removes its job first, then moves the file to `backups/removed/`.
- Each job leaves a manifest in `generated/services/<label>.json` (the resolved program, PATH, Node path and version,
  when it was generated), so `hallway doctor` can tell when the recorded Node has been uninstalled, and
  `hallway service regenerate` can say what it changed. The unit or plist also carries the Node version as a comment.
- `regenerate` rewrites every definition from the YAML and the current Node and PATH, restarts the jobs that were
  running onto the new definition, and leaves stopped ones stopped.
- **Rejected:** bootout alone (the job comes back at the next login, contradicting `expected: stopped`); deleting the
  plist on stop (loses the definition `start` needs, and the dashboard's "managed" badge).

### D42 — `$PORT` in a command, and the environment a job gets (2026-10-16)

- `$PORT`, `${PORT}`, `$HOST` and `${HOST}` in a `service.command`'s arguments are replaced with the app's values when
  the job is generated, by Hallway, the same on both platforms: launchd never expands variables in
  `ProgramArguments`, and systemd's `ExecStart` rules differ from a shell's. The YAML keeps the command as written
  (`["vite", "--port", "$PORT", "--strictPort"]`), so it stays right if the file is edited. The shell that runs
  `hallway run` would expand an unquoted `$PORT` itself (usually to nothing), so the docs say to quote it:
  `hallway run demo -- vite --port '$PORT' --strictPort`. Other variables are left alone.
- A job's environment is exactly: `PATH` (D45), `HOST` and `HOSTNAME` (the app's `host`, default `127.0.0.1`), then the
  app's `service.env` (which may override those, e.g. to listen elsewhere on purpose), then `PORT`, which is always
  the app's port. The daemon's job gets `PATH`, plus `HALLWAY_HOME` when the installing shell set one, and never
  `PORT`: its port comes from `config.yaml`.
- **Rejected:** wrapping every command in `sh -c` so the shell expands variables (adds a process, changes signal
  handling and quoting, and hides the real program from the PATH-trap resolution).

### D43 — Log rotation: copy, then truncate, in the daemon (resolves Q-LOG-ROTATION, 2026-10-16)

- The daemon checks every `*.log` in `logs/` (managed apps' and its own) every 15 s. A file above
  `services.logMaxBytes` is copied to `<file>.1` (older generations shift up to `services.logGenerations`; the oldest
  is dropped) and truncated in place, because launchd and systemd hold the file open for appending and a rename would
  leave them writing to the old name.
- Only the last `logMaxBytes` of the file are copied, starting at a line break, so a rotated file is never larger
  than the limit however much was written between two checks (v1 criterion 12). The cost: lines written between the
  copy and the truncation, and anything older than the limit within one check, are dropped.
- **Rejected:** `newsyslog` on macOS (needs root and a file in `/etc/newsyslog.d`, and nothing like it on Linux);
  signalling the process to reopen its logs (most dev servers don't handle that); rotating by rename.

### D44 — How the CLI finds the daemon, and what it does without one (2026-10-16)

- Commands that are richer with live data (`status`, `scan`, `claim`, `ignore`, `app ls`, `doctor`, `open`) look for the
  daemon at `127.0.0.1:<config.yaml port>` (default 4255) and check `/api/health` says Hallway. **Not `$PORT`**: in an
  agent's or a developer's shell, `$PORT` is usually some app's port (D36's `$PORT` is for `hallway serve` only).
- Without a daemon they do the work themselves, with the daemon's own modules: `status` probes each app once with the
  prober's probe and classification (no flap damping or history); `scan`, `claim` and `ignore` run the scanner once
  (`server/scanner/`) and claim through the API's `claimFile`; `ignore <port>` writes `ignore.yaml` directly. Writes always go through the store (D7) in the CLI's own process; a running daemon picks them
  up through its watcher. `bookmark ls` always reads the files, which are all there is to a bookmark.
- `hallway doctor` is read-only: on a machine where the data home doesn't exist yet it warns and creates nothing.
- **Rejected:** writing through the daemon's HTTP API whenever it's running (two code paths for every write, and the
  CLI must work without it anyway).

### D45 — `hallway run`'s details, and the PATH a job gets (2026-10-16)

- **Re-running.** `hallway run <slug>` with no command reuses the recorded one and the recorded `--persist` choice
  (`runAtLoad`/`keepAlive`), and restarts the job. With a command, `--persist` (or its absence) decides afresh. An
  existing app keeps its port; `--port` with a different number is refused (D17), and `--cwd` defaults to the current
  directory when a command is given, else the recorded one.
- **Refusals before anything starts:** the slug `daemon` (its logs would be the daemon's `logs/daemon.*.log`; the slug
  is still fine for an unmanaged app); a broken app file (never written over); a port that something Hallway didn't
  start is already listening on (it would fail to bind, or look as if it had come up); no command recorded or given.
- **Waiting.** Up to 30 s for a TCP connect to the app's host and port. If the job has exited (two status checks a
  second apart, so a job still being spawned isn't taken for dead) it stops early and reports the exit status. On
  failure it prints the last 30 lines of both logs and exits 1, and leaves the app declared (fix it and re-run).
- **PATH** (docs/04, "The PATH trap"): the resolved Node's own `bin` first (also for non-Node commands, so the job's
  child `node`/`npm`/`npx` match), then the current PATH minus per-shell directories (`fnm_multishells`, npx's
  `_npx` cache, `npm run`'s `node-gyp-bin`), relative entries and missing ones, then the usual system directories that
  exist. `command[0]` becomes the `realpath` of what `which` finds; a script whose `#!` line runs Node (`npx`, any
  `#!/usr/bin/env node` tool) is run as `<node> [its node flags] <script>`, as docs/04's template does; a bare `node`
  is the resolved Node.
- **Ports for new apps** (docs/04): the first port in `ports.assignRange` that no app declares, nothing answers on
  (IPv4 and IPv6 loopback) and that can be bound, skipping a short list of well-known ports in the range (Vite's
  5173/5174, PostgreSQL, Live Server, Prisma Studio, Kibana, AMQP, VNC, CouchDB, Local Review's 5622, …).
- **Verification without a service manager.** Machines without a systemd user instance (containers, CI runners) run
  the end-to-end tests and `smoke:pack` against `test/fixtures/fake-systemctl`, which reads the units Hallway writes
  and really runs them, detached. CI also runs `scripts/services-real.mjs` against the real launchd (macOS runner)
  and systemd (Ubuntu runner, lingering on); it refuses to run anywhere else, because it uses the real labels and
  service directories.

### D46 — The daemon records its port in `state/daemon.json` (2026-10-16)

Found by the v0 acceptance run: with a syntactically broken `config.yaml` the daemon keeps running on its last good
port, but the CLI, reading the same broken file, fell back to the default 4255 and reported "the daemon isn't
running" (while `hallway doctor`, in the same run, said the daemon keeps the last good version). The same happened
after `hallway serve --port <n>` or `$PORT`, and after `port:` was edited under a running daemon.

- On start, the daemon writes `state/daemon.json` (`pid`, `port`, `startedAt`) and removes it on a clean stop.
- The CLI still looks on config.yaml's port first (D44 unchanged), then on the recorded port if its process is alive.
  Either way `/api/health` must answer as Hallway, so a stale record or a reused pid can't mislead it.
- **Rejected:** parsing a broken `config.yaml` leniently for its `port:` line (doesn't help `--port`/`$PORT`, and
  guesses at a file the store has declared invalid); scanning listeners for a Hallway (slow, and the scanner's job).

### D47 — Fronted mode: Caddy runs as you; the only root parts are a fixed redirect, the trusted root and the resolver (2026-10-16; resolves Q-CADDY-UNPRIVILEGED, Q-CADDY-RESUME, Q-CADDY-TRUST, Q-HMR, Q-DASHBOARD-HOST)

- **Caddy is a user-level job** (`hallway.caddy`: a LaunchAgent / systemd user unit) on `127.0.0.1` and `[::1]`,
  ports `proxy.httpsPort` (4443) and `proxy.httpPort` (4480), started as `caddy run --config generated/caddy.json`.
  Its **admin API is a Unix socket in the data home with mode 0600** (`state/caddy/admin.sock`), never TCP. Since
  Caddy holds no privilege, whoever can reach its API (the user's own processes) gains nothing they didn't have.
- **The privileged parts are fixed jobs** that read nothing a user-level process can write later, installed once by
  `hallway setup` and removed by `hallway teardown` (`server/platform/fronting-*.ts`):
  - the redirect, loopback 443 → 4443 and 80 → 4480: on **macOS a pf anchor** (`com.apple/hallway`, loaded at boot by
    the `hallway.pf` LaunchDaemon running one `pfctl -E -a com.apple/hallway -f /etc/pf.anchors/hallway`; macOS's own
    `/etc/pf.conf` already evaluates `com.apple/*`, so it is never edited and OS updates that rewrite it don't matter);
    on **Linux an nftables table** (`inet hallway`, a nat `output` chain, applied at boot by
    `hallway-redirect.service`);
  - Hallway's CA root in the system trust store (and, on Linux, the user's NSS database, without sudo);
  - for a custom domain, the resolver: `/etc/resolver/<base>` with a `port` line (macOS), a `systemd-resolved` drop-in
    (Linux), pointing at **Hallway's own dnsmasq, also a user-level job** (`hallway.dnsmasq`) on `127.0.0.1:4253`.
- **No `--resume`** (Q-CADDY-RESUME): verified, an admin push is autosaved to `$XDG_CONFIG_HOME/caddy/autosave.json`
  and `--resume` then ignores `--config`. The daemon writes `generated/caddy.json` before every push, Caddy starts from
  that file, and pushes don't persist (`persist: false`), so there is one copy of the truth and routes come back after
  a reboot before the daemon does. The job's `XDG_*` point into `state/caddy/`.
- **Trust** (Q-CADDY-TRUST): Caddy's CA lives in the data home (`state/caddy/data/`); its own trust installation is off
  (`install_trust: false`) and `hallway setup` installs the root itself with printed commands (`security
  add-trusted-cert` into the System keychain; `update-ca-certificates` / `update-ca-trust`), so no `caddy trust` against
  a root instance is needed.
- **HMR** (Q-HMR): verified with Vite 8.3.4 through Caddy with Host rewritten: a real hot update, no reload, no
  `server.hmr.clientPort`.
- **Dashboard host** (Q-DASHBOARD-HOST): `hallway.localhost`, as the spec leaned, matching the product and binary; the
  apex for a custom domain. Bare `localhost` on 443 is too likely to collide, and `hall` saves little. Its label is a
  reserved slug (already enforced). The daemon gets the dashboard's Host unchanged (no rewrite on that route) and
  accepts it in fronted mode (`server/security.ts`), so `daemon.url` and write Origins are the real public ones.
- **`proxy.publicPort`** (default 443) is the HTTPS port in links. Setting it to `proxy.httpsPort` is fronted mode
  without any redirect (links carry `:4443`): useful where no redirect can be installed (a container, no systemd).
- Caddy **2.7 or later** (2.6.4 ignores the socket's `|0600` mode; verified). HTTP/3 is off (it would advertise the
  high UDP port in `Alt-Svc`). Every name gets an internal-CA certificate (`local_certs`), so `.test` and made-up TLDs
  never go to public ACME. HTTP → HTTPS is Hallway's own redirect, which knows the public port.
- **Rejected:**
  - a root Caddy with the admin API on TCP (any local process can reconfigure a root process: the escalation path);
  - a root Caddy with the API on a user-only Unix socket (the user's own processes, e.g. a malicious install script,
    still escalate);
  - a root Caddy with `admin off` and a privileged reload helper (sudo for every new app);
  - a user Caddy on `0.0.0.0:443` (macOS allows it unprivileged, but it exposes every app to the LAN, even with a
    `remote_ip` filter);
  - on Linux, `setcap cap_net_bind_service` on a Hallway-owned Caddy, which the roadmap had listed: whoever reaches the
    admin API could then bind any privileged port on any address, and every Caddy upgrade must re-apply it;
    `net.ipv4.ip_unprivileged_port_start` (machine-wide); `iptables` (nftables is the default backend on every
    current distribution, and a table of our own is cleaner to remove);
  - a root dnsmasq on :53 or a drop-in in Homebrew's dnsmasq (root for no reason; edits the user's dnsmasq), and
    `/etc/hosts` per app (sudo per app, no wildcards).
- **Unverified on macOS** until CI's macOS job or a real Mac runs them: pf `rdr` on `lo0` for locally originated
  connections, the anchor surviving a reload of `/etc/pf.conf` by another tool and an OS update, `pfctl -E`'s enable
  reference outliving the LaunchDaemon's process, `security add-trusted-cert` without a GUI prompt, the `port` line in
  `/etc/resolver/<base>`, Safari (Q-SAFARI-LOCALHOST). See `11-research-notes.md`.

### D48 — Setup, teardown and doctor for fronted mode; the dashboard's second address (2026-10-16)

- **Setup is a plan of printed steps** (`server/proxy/setup.ts`): facts are gathered read-only, the plan is a pure
  function of them (golden files for macOS and Linux), and `--print` prints it. Steps are `[Hallway]` (its own files
  and user-level jobs), `[you]` (`brew install caddy`/`dnsmasq` when missing and Homebrew is there) and `[sudo]` (each
  command shown exactly; a file to install as root is written to `generated/setup/` as the user first, shown, then
  copied with `sudo install`). Already root: no `sudo` prefix.
- **Idempotent by asking the real thing:** the root's fingerprint in the trust store; the installed files' exact text
  and a TLS handshake on 443 meeting Hallway's CA (tried with the old dashboard name too, since Caddy only answers for
  names it serves); `config.yaml` already set. A failed command stops the run; running setup again resumes.
- **Refused** before anything runs: `.local`; the 51 whole-TLD entries on Chromium's HSTS preload list (extracted
  2026-10-16: `.dev`, `.app`, `.page`, …); `.example` and `.invalid`; anything else on 80/443 or on Caddy's or dnsmasq's
  ports (named with PID and command; on macOS, where `lsof` can't see root's sockets, also a connection to 443 that
  doesn't meet Hallway's CA, plain HTTP included); a missing helper with no way to install it; on Linux, no systemd,
  `nft` or CA store. **Warned:** a delegated TLD, a made-up TLD (IANA's list, cached a week in `cache/iana-tlds.txt`;
  failing to fetch is itself a warning), Caddy older than 2.7, a listener on 2019. `--domain` needs two labels.
- **`hallway teardown`** removes only what it finds (resolver, dnsmasq job, redirect, trusted root, Caddy job), sets
  `mode: direct`, and has `--print` too. `--uninstall-packages` uninstalls Homebrew's `caddy`/`dnsmasq`; on Linux it
  only says to use the package manager. The CA stays in the data home, unused.
- **`hallway doctor`** in fronted mode (`server/proxy/doctor.ts`) checks Caddy (version, job, socket answering and
  private, running config = `generated/caddy.json`), who holds Caddy's ports and 80/443, a TLS handshake through the
  redirect that verifies against Hallway's root, the HTTP redirect, the root trusted, a Firefox note, `*.localhost`
  resolution (a warning: browsers resolve it themselves), and for a custom domain the TLD, dnsmasq (running, loopback
  only), the resolver file and resolution of `<base>` and a name under it.
- **The dashboard:** in fronted mode a card's address is the hostname, and the port is a quiet `:5622` link beside it
  that goes straight to `http://localhost:5622`, round the proxy (the door plate already shows the number). The API
  gains `AppView.directUrl` (always the direct address). Direct mode is unchanged.
- **The fallback page** (`generated/fallback.html`) is self-contained (the dashboard's tokens inlined, from a copy of
  `src/theme/tokens.css` that the Vite build puts in `dist/web/`), says which host isn't answering (the daemon, or which app and where Caddy
  looked), how to restart it, and lists every app.
- **Bus subscribers:** the daemon's own modules (prober, thumbnailer, proxy) subscribe as `internal`, and `bus.size`
  counts only the others (open dashboards). Before this, the thumbnailer's subscription made the prober think a
  dashboard was always open.
- **CI** runs it all for real (`scripts/fronted-real.mjs`, "Fronted mode (real …)" jobs on `ubuntu-latest` and
  `macos-latest`, with the runners' passwordless sudo): setup, the v1 criteria with `curl` and the system trust store,
  a squatter on 443, a custom domain, teardown leaving nothing behind.

### D50 — MCP: the SDK's stateless handler at `/mcp`; tools as thin wrappers over the store (2026-10-16)

- **Transport.** `/mcp` is served by the official MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`
  2.3.x, protocol revision 2026-07-28; versions and sources in `11-research-notes.md`) through its `createMcpHandler`,
  mounted with `app.all('/mcp')` in the daemon's Hono app behind `localOnly` (Host, Origin, JSON). The 2026 revision
  removed sessions and the GET stream, so the handler is **stateless**: a fresh `McpServer` per request (cheap: it only
  registers handlers), and 2025-era clients (the `initialize` handshake) are answered statelessly by the same
  factory. GET and DELETE on `/mcp` get 405, as the spec says. A daemon restart therefore breaks no client: there is
  no session to lose. The SDK v1 package (`@modelcontextprotocol/sdk`) was not used: v2 is the stable line, and the
  server package depends only on `zod` and the SDK's core (v1 pulled in Express, CORS, rate limiting and more).
- **Notifications.** Resources `hallway://state` and `hallway://apps/<slug>` (the optional part of `06`) are read from
  the same views as `/api/state` and `/api/apps/:slug`. The daemon's event bus drives `notifications/resources/updated`
  (and `resources/list_changed` on an `apps` event) through the handler's `notify`, delivered on a
  `subscriptions/listen` stream. `resources.subscribe` is advertised to **2026-era clients only**: a 2025-era client
  served statelessly has no stream to receive them on. The MCP endpoint subscribes to the bus as an
  **internal** listener (the flag D47's proxy introduced), which `EventBus.size` doesn't count, so an MCP server never
  looks like an open dashboard to the prober (D38's live mode).
- **Tools** are those of `06`, each a thin wrapper over `Store` (D7) and `views.ts`; claim and ignore share
  `claimObserved`/`ignoreObserved` with the HTTP API. Semantics the table left open:
  - `declare_app` **creates only** (`If-None-Match: *`): replacing an existing app could drop its `service:` block or
    change its port, which MCP must never do. So it takes no `etag`; an existing slug is a conflict pointing at
    `update_app`. It also accepts `host` and `icon` (harmless fields of the file format).
  - `update_app` is a JSON merge patch (D33). `service` in the patch (even `null`) is refused; `port` is refused unless
    it equals the current port (so echoing an app's config back is fine).
  - `remove_app` is refused for an app with a `service:` block (removing it would orphan the job; `hallway app rm`
    stops it first, D41).
  - `update_bookmark` (new `Store.updateBookmark`) merge-patches one link in place, keeping its position and comments.
  - Inputs are loose objects, so a `service` key reaches the handler and is refused with a reason (D10) rather than
    silently stripped by the schema; any other unknown key is refused by the store (D33).
  - Results are the written entity plus `etag` and `file`, as JSON text and `structuredContent`. Failures are tool
    errors (`isError`), prefixed `Conflict:` (with the current etag), `Invalid:` (with the issues) or `Refused:`.
- **Rejected:** sessions with the 2025-era SDK transport (state to lose on every daemon restart, and a GET stream the
  current spec has dropped); a hand-written JSON-RPC server (the SDK handles both eras, header validation and
  cancellation); `outputSchema` per tool (every result is already typed in `shared/api.ts`; schemas would duplicate them).

### D51 — `hallway mcp` is a byte-level bridge; `hallway hook check-command` denies with Claude Code's JSON (2026-10-16; resolves Q-HOOK)

- **The bridge** reads newline-delimited JSON-RPC on stdin and POSTs each message to the daemon's `/mcp`, writing back
  the JSON body or each event of an SSE response. It knows nothing about the tools, so it can't drift from them, and
  it works for both protocol eras. What it adds is what the HTTP binding asks of a client: `MCP-Protocol-Version`
  (from the request's `_meta`, else the version a 2025-era `initialize` negotiated), `Mcp-Method`, and `Mcp-Name`
  (Base64-sentinel-encoded when not header-safe); and stdio's `notifications/cancelled` becomes aborting that request's
  HTTP response. It finds the daemon as every command does (D44, D46); with none it exits 1 with a message saying how
  to start one (the MCP client shows it in its logs). If the daemon goes away later, each request gets a JSON-RPC
  error saying so, rather than hanging.
- **The hook** reads Claude Code's `PreToolUse` payload (`tool_input.command`; source and date in
  `11-research-notes.md`) and, for a command that starts a dev server directly, prints
  `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": …}}`
  and exits 0. The reason gives the `hallway run <slug> -- <command>` to use, with the slug from the working
  directory's name, `'$PORT'` added in the flag the tool needs (`--port '$PORT' --strictPort` for Vite, `-p` for
  Next, an argument for `http.server`), or a fixed port in the command replaced by `'$PORT'`.
- Detection splits the command line the way a shell would (quotes, `&&`, `;`, `|`, `&`, subshells, comments,
  redirections), strips wrappers (`VAR=x`, `env`, `nohup`, `timeout`, `exec`, `time`, `sudo`) and runners (`npx`,
  `pnpm exec`/`dlx`, `bunx`, `uv run`, `bundle exec`), then matches package scripts named like servers (`dev`,
  `start`, `serve`, `preview`, `watch`, `develop`, and `dev:web`-style variants) and a table of tools with their
  serving subcommands (so `vite build`, `next build`, `astro check` pass). `hallway …` itself, `--help`/`--version`
  and mentions inside strings pass. A payload it can't read is let through: a hook must never block work it doesn't
  understand. Known false positive: `npm start` in a package whose start script isn't a server.
- Never installed automatically (`06`); the guide and the website show the `settings.json` entry.
- **Rejected:** the SDK's client and server in the bridge (two protocol stacks to keep in step, for no gain over
  forwarding); exit code 2 with the reason on stderr (also honoured by Claude Code, but the JSON decision is the
  structured form and leaves stderr for real errors); blocking backgrounded starts only (a foreground `npm run dev`
  is the same orphan once the session ends).

### D52 — No token on `/mcp` (resolves Q-MCP-AUTH, 2026-10-16)

- `/mcp` has the same trust boundary as the rest of the daemon: 127.0.0.1 only, loopback `Host`, a local `Origin`
  when one is sent, JSON bodies (so a cross-site form post can't reach it). The MCP spec's own requirement for local
  servers is Origin validation against DNS rebinding, which this is. Anything that can reach loopback as this user can
  already edit the data home directly, which is everything MCP can do, and MCP can't start processes (D10, D53). A
  token would protect nothing those files don't already give away, and every client would need configuring with it.
- Revisit if MCP ever gains process control, or if the daemon ever listens beyond loopback.
- **Rejected:** a bearer token in `state/` (no protection, real friction); OAuth (the spec's authorisation flow is
  for remote servers).

### D53 — No `restart_app` (or any process control) in MCP (resolves Q-MCP-RESTART, 2026-10-16)

- v2's acceptance criterion is that **no MCP tool can start a process**; a restart starts one. The "middle ground"
  relied on the command coming from a file the user approved, but `apps/<slug>.yaml` is writable by any agent with
  file access (files first, D7), and `hallway service regenerate` rewrites the job from it, so "installed via the CLI"
  doesn't prove the user approved the command that would run. A KeepAlive job already restarts itself when it exits.
- An agent with a shell can run `hallway restart <slug>` under its own permission model, which is where the user
  decides what it may run. MCP stays a description layer: one simple invariant a user can rely on.
- **Rejected:** `restart_app` for services with `keepAlive` only, or only when the installed job matches the YAML
  (still starts a process; the check is subtle and easy to get wrong in a later change).

### D54 — "Lost at last reboot": what counts, where it's kept, and how it's started again (2026-10-16)

- **What counts as lost.** When `state/boot.json`'s boot time has moved on (D18), the lost set is every observation in
  `state/observed.json` that was **alive at the end of the previous boot** and **isn't listening now**. "Alive at the
  end" is "seen in the last scans before the boot": its `lastSeen` is before the new boot time, after the previous
  one, and within two scan intervals plus a minute of the newest such `lastSeen`. A server stopped by hand a day before
  the reboot was last seen long before that, so it isn't blamed on the reboot. One item per port (the latest
  observation). Declared apps are covered by the same records (the scanner records every listener, declared ports
  included); an app the scanner never recorded (scanning off, or its port ignored) is lost when the prober's last
  sample before the boot was `healthy` or `unhealthy` (`state/health.sqlite`, kept 48 h).
- **Not yet listening is not lost.** A service that starts at login can still be starting when the daemon's first scan
  runs (both start at login). If any such app isn't listening at the first scan, the daemon waits out
  `services.startGraceSeconds` and scans again before deciding. "Not listening" is the same id listening again, or, for
  an item with an app, anything answering on the app's port.
- **Kept in `state/lost.json`** until every item in it is dismissed (the file is then removed), so a daemon restart
  doesn't lose the notice; the next reboot **replaces** it (what the older notice listed was not alive before the newer
  boot, so it can't be "lost" by it, and merging two reboots' lists would make the banner's date wrong). `state/` stays
  safe to delete: losing the file loses only the notice.
- **Back is live, not a removal.** An item that is listening again (restarted by one of the actions, by hand, or by its
  job) stays listed as `● back` until dismissed, computed on every read from the latest scan and the prober, and
  announced with a `reboot` event when it changes. The banner counts what is still not running and turns calm when
  everything is back. Removing items as they come back would make the one-click action look as if it had deleted the
  row, and would hide what the reboot did.
- **The actions are `hallway run`** (`runApp`, the CLI's code path), so the process belongs to launchd or systemd,
  never the daemon: **Restart once** is `run` without `--persist` (an app that is already a service keeps its recorded
  choice); **Make it a service** is `run --persist` (start at login, restart on exit: `service add`'s settings). An item
  with no app yet is first registered as a claim would register it (its own port, D17; name, project directory,
  `expected: adhoc`) with the command and directory recorded while it was alive; the slug is the scanner's suggestion
  unless the request gives one. No command recorded, or a directory that no longer exists, is refused with a plain
  reason and nothing is written. The daemon gives the job the start grace period (`starting`, not `down`).
- **Not in MCP.** `get_status` reports the notice (read-only, with each item's directory, branch, command and whether
  it's back), and so do `llms.txt` and `/agent-guide.md`; the actions are HTTP routes for the dashboard and `hallway
  lost` for the terminal. No MCP tool starts a process (D10, D53).
- **Rejected:** comparing against everything seen since the previous boot (blames the reboot for servers stopped days
  earlier); keeping the notice only in memory (a daemon restart would lose it, and the daemon restarts after upgrades);
  restarting lost things automatically (the user may not want all of them, and some won't work any more); a
  `restart_lost` MCP tool (D53); a slug form on every row (the scanner's suggestion is what Claim pre-fills, and the API
  and `--slug` take another).

### D55 — The generated card, and which tier a door shows (2026-10-16)

- **The card** (`server/thumbs/card.ts`) is a drawing of one of the dashboard's doors: the slug's door paint (the same
  FNV hash and ten paints as `src/lib/colour.ts`), raised panels under an arch, the knob, and a brass plate carrying
  the address; on it the name (Fraunces), `repo @ branch` and a framework chip (JetBrains Mono), the last two from the
  scanner's identity. 320×200 drawn at 2×: a 640×400 PNG, the size a screenshot is stored at.
  - Rendered with `@resvg/resvg-js` (a runtime dependency: ~70 kB plus one native binary of ~4 MB for the platform)
    with **only the bundled fonts** (`loadSystemFonts: false`), so the bytes are the same on every machine; a test
    checks the text vanishes with no fonts, which proves nothing falls back to a system font.
  - **Fonts:** static, Latin-subset TrueType instances of the dashboard's own OFL faces (Fraunces SemiBold at opsz 48,
    Inter Medium, JetBrains Mono Regular), cut from the `@fontsource-variable` devDependencies by
    `scripts/card-fonts.py` and committed in `assets/fonts/` with their licences: 160 kB on disk, ~98 kB more tarball
    (836.1 → 933.8 kB). resvg wants plain TrueType and draws a variable font at its default instance, hence static.
    `assets/`, not `server/`: the package ships no source directories (`smoke:pack` checks).
  - Text is measured without a font parser: JetBrains Mono's advance is exactly 0.6 em, and names use a generous
    0.6 em average for Fraunces, cut with an ellipsis. Glyphs outside Latin draw as boxes (as in Local Review).
  - **Colours:** tokens.css isn't shipped, so the card carries a copy of the paints, lift, shade, lamplight, plate and
    ink; `test/thumbs-tiers.test.ts` fails if they drift from tokens.css, so D28's one source of truth holds.
  - Drawn lazily: the ETag is a hash of what the card shows (computed for every AppView without drawing), the PNG only
    when its bytes are asked for (never for a 304), then kept in memory per slug. ~10 ms a card.
- **Which tier** (`pickThumb`): `favicon` (the default) → the favicon, else none; `screenshot` → the screenshot, else
  the favicon, else none; `card` → the card. **A card is never a silent fallback for a missing favicon.** Judged with
  screenshots (`11-research-notes.md`, "Thumbnails"): a card on a door repeats the name printed right under it and
  shrinks its address to a plate too small to read, while the monogram door reads at a glance. So `card` is a mode
  you choose (uniform, labelled doors), and an app with no picture still has none.
- **How the dashboard draws each** (`AppView.thumbKind`, additive): a favicon as before (the small tile; its colour is
  the paint); a **screenshot as the door's glass**, set in the panels' frame clear of the knob, with the paint (picked
  from the screenshot) around it and the number plate on top; a **card as the whole door**, replacing the CSS one.
  The state filters (closed, boarded up) apply to the picture too. The drawer shows a screenshot as a preview and never
  a card (it already says everything a card says).
- **Rejected:** the card as the favicon-mode fallback (above); the card in the 32 px tile (illegible); opentype.js
  for measuring (a dependency for a few pixels of precision); reading tokens.css at run time (not shipped); system
  fonts (different bytes per machine, slow scans).

### D56 — Screenshots: a browser installed into the data home at run time, never a dependency (2026-10-16)

- `hallway thumbs enable` runs `npm install playwright-core@<pinned>` into `cache/browser/` (with its own package.json,
  so npm doesn't climb into a project above the data home), then that copy's `install --only-shell chromium` with
  `PLAYWRIGHT_BROWSERS_PATH=cache/browser/ms-playwright`, writes `installed.json`, and sets `thumbnails.mode:
  screenshot` through the store (comments kept). About 300 MB (measured on Linux: 278 MB of headless shell and ffmpeg,
  14 MB of playwright-core). The daemon `import()`s playwright-core from that path, so the package neither contains
  nor resolves it, and a base install never downloads a browser (v2 criterion 3; `smoke:pack` checks).
  - `disable` sets the mode back to `favicon` and deletes `cache/browser/` and `cache/thumbs/`; the daemon sees the
    config change, closes its browser and forgets its pictures. `refresh [slug]` asks the daemon
    (`POST /api/thumbs/refresh`, 409 when screenshots are off) and waits for the shots. `status` says what's installed.
  - npm is the one beside the running Node (where a global install puts it), else PATH's. Playwright's version is
    pinned in `server/thumbs/browser.ts`; an upgrade that bumps it needs `hallway thumbs enable` again (idempotent).
  - `cache/` because it's machine-written, git-ignored and regenerable: no change to the data home's layout.
- **Shooting** (`server/thumbs/shots.ts`): healthy apps only (declared or discovered, never bookmarks), one page at a
  time in one browser that closes after two idle minutes. 1280×800 at `deviceScaleFactor: 0.5`, so Chromium itself
  produces the ~640×400 PNG and the daemon needs no image library. `load`, then network idle, ten seconds in all; a
  page that never goes quiet is shot when time is up; one that refuses the connection isn't, and isn't tried again
  for 15 minutes unless asked. Due when there's none, the app's PID changed (both known), its address changed, or it's
  six hours old; checked every minute, on a `healthy` transition and on `refresh`. Stored as
  `cache/thumbs/<slug>.png` + `.json` (url, pid, takenAt, etag); a `thumb` event when one changes.
  - `--no-sandbox` only when the daemon runs as root (containers, CI); a normal user keeps Chromium's sandbox.
- **Rejected:** `playwright` as an optional peer dependency (npm 7+ installs peers by default, so most base installs
  would get it, and `npm i -g hallway` gives no place to add it by hand); an `optionalDependency` (always installed
  where it can be); `puppeteer` (downloads Chrome on install unless told not to); the system Chrome (not on every
  machine, differs per machine, and could drive the user's real profile); `sharp` or another decoder for downscaling
  (half-scale rendering does it for free).

### D57 — The 90-day view: no rollup scan on every read (2026-10-16)

- Measured with 30 apps and 90 days seeded through `UptimeStore` (`add` → `prune`: 340 k samples, 64.8 k rollups):
  one app's 90-day history took ~47 ms, 28 ms of it the `rollup(now)` each `history()` starts with, a correlated
  `NOT EXISTS` over every sample row that almost always finds nothing.
- `rollup` now remembers the hour it has rolled up to and does nothing until the clock reaches a new hour, then looks
  only at samples since. Samples are written as they're taken, so a finished hour never gains one (anything that ever
  back-fills must use a fresh store). The 7- and 90-day bars are built in one pass over the hour-ordered rows instead
  of a filter per bar. The 90-day view reads only rollups, plus the current hour's samples.
- Result: 6–7 ms for one app's 90 days in the store, ~2.3 ms warm through `GET /api/apps/:slug/history?window=90d`,
  ~160 ms for all 30 apps in a row; the drawer paints 90 days and the latency chart ~42 ms after the click.
  `test/uptime-perf.test.ts` holds it (generous limits: 100 ms one app, 2 s all thirty).
- **Rejected:** an index on `samples(ts)` (measured no faster, and every insert pays for it); caching whole history
  responses (invalidated by every probe, for no measurable gain); a daily rollup table (90 rows instead of 2,160, but a
  second table to keep consistent for a 6 ms read).

### D58 — Windows: supported where feasible, best effort (approved by the author, 2026-10-16; updates the non-goal in `01-background.md` and D26)

- The author asked on 2026-10-16 for Windows support to be explored and built as far as is sensible. Windows moves
  from **non-goal** to **supported where feasible, best effort**: macOS stays primary and Linux sits alongside it
  (D26); Windows comes third. It runs natively (not through WSL) and, like everything else, **never needs
  administrator rights** (the Windows twin of "never require root in the daemon").
- **Verified only on GitHub's hosted Windows runners** (`windows-latest`: Windows Server, an administrator account,
  no interactive desktop). Nobody building it has a Windows desktop, so anything that depends on one (a logged-in
  user's session, a real browser, behaviour without administrator rights) is listed as **"unverified on a real
  Windows desktop"** in `11-research-notes.md`.
- **Built in stages, each useful alone:**
  - **A (this decision):** a `win32` platform behind the same interface (`server/platform/win32.ts`). The daemon,
    dashboard, store, watcher, prober, uptime history, HTTP API, MCP, agent guide and the CLI's file commands run on
    Windows. Unit tests run on `windows-latest` (Node 22.13 and 24) and `smoke:pack` installs and runs the packed
    tarball there. Until stage B the scanner sees nothing, and until stage C `hallway run` and `hallway service`
    refuse with a message saying so; the platform says what it can't do rather than guessing.
  - **B:** the scanner on Windows (listeners, process info, boot time, the ephemeral range).
  - **C, if feasible:** managed services as per-user scheduled tasks.
- **Out of scope: fronted mode on Windows.** Its parts have no user-level equivalent: a 443/80 redirect means
  `netsh interface portproxy` (administrator, and it runs inside the IP Helper service), trusting a root means the
  machine certificate store, custom domains mean the hosts file or a DNS client policy, and Caddy's admin API is a Unix
  socket in the data home. `hallway setup` refuses before it looks for or writes anything (exit 1, with the reason);
  `hallway teardown` says there is nothing to undo. Apps keep their `http://localhost:<port>` addresses.
- **WSL2:** a Hallway installed inside a WSL distribution is a Linux install and sees that distribution's servers, not
  Windows'. That stays incidental, as before.
- **How the code stays honest:** `win32.ts` uses `path.win32`, and `darwin.ts`, `linux.ts`, `launchd.ts`, `systemd.ts`
  and the fronting recipes now use `path.posix`, so each platform's logic is tested on every OS (D26's rule), Windows
  included. The repository is checked out with LF line endings everywhere (`.gitattributes`): golden files, fixtures and
  `AGENT-GUIDE.md` are compared byte for byte, and the parsers split on `\n`. Data-home-relative names (the store's
  `file`, the watcher's event keys) are written with `/` on every OS. Tests that exercise something Windows genuinely
  lacks (POSIX exec bits and `#!` lines, Caddy's Unix socket) are skipped there with the reason (`onWindows()` in
  `test/fixture.ts`); nothing else is.
- **Rejected:** WSL-only support (a Hallway inside WSL can't see the Windows-side servers, which is the point; and it
  is just the Linux build); keeping Windows a non-goal (the platform layer already isolates the OS-specific parts, and
  most of the daemon is portable Node); `process.platform` checks scattered through the server (D26); fronted mode
  through an elevated helper service (a second, privileged component to install and keep secure, for one OS).

## Alternatives considered for the whole product

| Option | Why not |
|--------|---------|
| hotel (typicode) | Closest match but dormant since Oct 2023 (122 open issues). Borrow UX ideas only. |
| Homepage / Homer / Dashy / Heimdall | Hand-maintained YAML recreates the original problem; no discovery, fronting or services. |
| localias + a dashboard | Per-alias `/etc/hosts` edits (sudo each time), no wildcards, no persistence. |
| PM2 + dnsmasq + Caddy, hand-wired | A recipe, not a product; nothing ties registry, routing and dashboard together. |
| Coolify / Dokploy | Server PaaS; far too heavy. |
| launchd plists by hand | Verbose, error-prone (the PATH trap), no overview. |
