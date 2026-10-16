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
- Without a daemon they read the files themselves: `status` probes each app once; `ignore <port>` writes
  `ignore.yaml` directly. Writes always go through the store (D7) in the CLI's own process; a running daemon picks them
  up through its watcher. `bookmark ls` always reads the files, which are all there is to a bookmark.
- `hallway doctor` is read-only: on a machine where the data home doesn't exist yet it warns and creates nothing.
- **Rejected:** writing through the daemon's HTTP API whenever it's running (two code paths for every write, and the
  CLI must work without it anyway).

### D45 — `hallway run`'s details, and the PATH a job gets (2026-10-16)

- **Re-running.** `hallway run <slug>` with no command reuses the recorded one and the recorded `--persist` choice
  (`runAtLoad`/`keepAlive`), and restarts the job. With a command, `--persist` (or its absence) decides afresh. An
  existing app keeps its port; `--port` with a different number is refused (D17), and `--cwd` defaults to the current
  directory when a command is given, else the recorded one.
- **Refusals before anything starts:** a broken app file (never written over); a port that something Hallway didn't
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

## Alternatives considered for the whole product

| Option | Why not |
|--------|---------|
| hotel (typicode) | Closest match but dormant since Oct 2023 (122 open issues). Borrow UX ideas only. |
| Homepage / Homer / Dashy / Heimdall | Hand-maintained YAML recreates the original problem; no discovery, fronting or services. |
| localias + a dashboard | Per-alias `/etc/hosts` edits (sudo each time), no wildcards, no persistence. |
| PM2 + dnsmasq + Caddy, hand-wired | A recipe, not a product; nothing ties registry, routing and dashboard together. |
| Coolify / Dokploy | Server PaaS; far too heavy. |
| launchd plists by hand | Verbose, error-prone (the PATH trap), no overview. |
