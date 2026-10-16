# Instructions for agents working in this repository

## Where things stand

Hallway is **pre-release**. The repository holds a complete **specification** and the **start of the
implementation**: the package, build, CI and release machinery, the daemon core (`hallway serve` and `guide`, the data
home and its store, the watcher, event bus and SSE, the HTTP API, the agent guide and `llms.txt`, the security
middleware, the platform abstraction) and a placeholder dashboard. The prober, scanner, services and proxy are still
to be built, milestone by milestone; they plug into the core as providers (`server/providers.ts`, D35).

Nobody who took part in the design discussion will be available to answer questions, so the spec is deliberately
exhaustive: it records decisions, their rationale, the alternatives that were rejected, verified facts, and open
questions. Before changing behaviour, read, in order:

1. `spec.md` — the hub: summary, document map, key decisions, glossary, milestones.
2. `docs/01-background.md` … `docs/11-research-notes.md`, in numeric order.

The human-facing version of the development conventions, with setup, CI and pull-request expectations, is
[CONTRIBUTING.md](CONTRIBUTING.md). How releases work: [RELEASING.md](RELEASING.md).

## Working rules

- **The spec plus the decisions log are authoritative.** Where code exists, code and `docs/09-decisions.md` win over
  the rest of the spec; fix any contradiction you find. If you disagree with a decision, record the disagreement and
  your alternative in `docs/09-decisions.md` and raise it with the author rather than silently diverging.
- **Record new decisions** in `docs/09-decisions.md` (next number, with rationale and rejected alternatives).
- **Resolve open questions explicitly**: when you settle something in `docs/10-open-questions.md`, move the outcome
  into the decisions log or the relevant doc.
- **Verify before you rely.** Items marked unverified (Safari `*.localhost`, Caddy `--resume`/trust details, HMR
  through the proxy, hook formats, anything "unverified on macOS") must be checked by experiment, and the result
  written to `docs/11-research-notes.md` with the date.
- **Build in milestone order** (`docs/08-roadmap.md`). v0 must be useful on its own with no sudo and no DNS. Check each
  milestone's acceptance criteria by running the software, not by reading the code.
- **Visual design is core scope**, not polish (`docs/05-ui.md`). Iterate on the dashboard with real screenshots.
  Colours, typefaces and radii live only in `src/theme/tokens.css`, and the provisional mark in `src/brand/` and
  `public/favicon.svg`, so the identity can be swapped in one place (D28; Q-VISUAL-IDENTITY is still open).
- **Never require root in the daemon.** Privileged steps belong only in `hallway setup` / `hallway teardown`, printed
  before they run.
- **Localhost only.** The daemon binds 127.0.0.1 and rejects non-local `Host`/`Origin` headers
  (`server/security.ts`). Don't add a `--host` flag. The only escape hatch is the development-only
  `HALLWAY_DEV_BIND` / `HALLWAY_DEV_ALLOWED_HOSTS` pair (D31): environment only, never in `--help`, never in user docs.
- **macOS and Linux.** Everything OS-specific goes behind `server/platform/` (`darwin.ts`, `linux.ts`; D26); the rest
  of the server never branches on `process.platform`. Test both platforms' logic on every OS. Anything you can't run
  on macOS from where you are goes in `docs/11-research-notes.md` as "unverified on macOS".
- **Keep it generic.** Examples, defaults and docs must not assume any particular employer, machine, username or
  network. Use `example.com`, `myname.internal`, `~/Code/my-app` and similar placeholders.
- Follow the conventions of the author's sibling project Local Review (https://github.com/edspencer/local-review):
  stack, data-home layout, SSE pattern, security middleware, agent guide, release process. `docs/11-research-notes.md`
  summarises the relevant internals.
- **The docs website lives in `website/`** (its own npm project). The root typecheck, tests and npm package never
  include it; CI builds it in its own job.
- Personal, machine-specific rules go in a git-ignored `CLAUDE.local.md` next to this file.

## Layout

```
server/            the daemon and CLI (Node, TypeScript ESM, Hono)
  cli.ts           `hallway` entry point (the package's bin); args.ts parses its arguments
  index.ts         the HTTP app (createApp) and startServer: store + watcher + snapshots + HTTP
  api.ts           the /api routes, the SSE route, /llms.txt, /llms-full.txt, /agent-guide.md
  views.ts         what the API returns: files merged with provider data (shared/api.ts types)
  events.ts        the event bus (emit, per-key debounced emitSoon) and the SSE handler
  watcher.ts       chokidar on the data home → store.reloadPath → bus
  providers.ts     the seam for live data: registerStateProvider (health, history, identity, observed, …)
  guide.ts         renders AGENT-GUIDE.md (with its generated file reference), llms.txt, the snippet
  security.ts      loopback-only Host/Origin/Content-Type middleware
  config.ts        package root, data home ($HALLWAY_HOME, ~/.hallway) and its layout, ports, dev overrides
  port.ts          DEFAULT_PORT (4255 = HALL), alone so vite.config.ts can import it
  platform/        macOS (launchd, lsof) / Linux (systemd user units, ss) behind one interface
  store/           the one reader/writer of the YAML files: index.ts (Store), schema.ts (validation + reference),
                   yamldoc.ts (comment-preserving edits), safefs.ts (atomic writes), backups.ts, home.ts (layout)
  scanner/         observed listeners: list, filter, identify, record      (v0, not built yet)
  prober/          health probes, states, uptime samples                   (v0, not built yet)
shared/            types used by both server/ and src/ (no imports, no Node or DOM APIs): api.ts is the API contract
AGENT-GUIDE.md     the guide for coding agents (shipped; its file reference is generated: npm run sync:guide)
src/               the dashboard (React, built by Vite into dist/web)
  theme/tokens.css every colour, typeface and radius
  brand/           the provisional mark
public/            static files copied into dist/web (favicon.svg)
test/              node:test suites, run from source via tsx
scripts/           start, smoke:pack, check:nul, sync-guide
website/           the docs site (separate project; may not exist yet)
```

## Commands

```sh
npm install           # from a checkout (env -u NODE_ENV if your shell exports NODE_ENV=production)
npm run dev           # Vite with hot reload on :4255 + the daemon (tsx watch) on :4256, from source
npm start             # build if stale, then run the compiled CLI (`npm start -- --port 5050`, …)
npm run hallway -- <cmd>   # the CLI from source (tsx): any `hallway` command
npm test              # node:test, from source via tsx
npm run typecheck     # server + dashboard
npm run build         # dist/web (Vite) + dist/server, dist/shared (tsc)
npm run check:nul     # no raw NUL bytes in JS/TS sources
npm run sync:guide    # regenerate AGENT-GUIDE.md's file-format reference after changing server/store/schema.ts
npm run smoke:pack    # npm pack, install the tarball into a temp prefix, run it, check it serves
npm run changeset     # add a changeset for a user-facing change
```

Use a throwaway data home when trying things by hand: `HALLWAY_HOME=$(mktemp -d) npm start -- --port 5050`.

Run `npm test` and `npm run typecheck` before committing, and `npm run smoke:pack` when you change the build,
`package.json` (`files`, `bin`, dependencies) or anything the CLI reads at run time (`server/config.ts` paths).

## Conventions

- **CLI exit codes:** 0 success, 1 error, 2 usage error (with the usage printed). Throw `UsageError` (`server/args.ts`)
  for bad usage, a plain `Error` for anything else; `cli.ts` turns them into messages and exit codes. Set
  `process.exitCode`, never call `process.exit()` (it can cut off piped output).
- **No environment variable is required** for normal operation: launchd/systemd jobs and agents' non-login shells
  start with an empty environment. `$HALLWAY_HOME` and `$PORT` are overrides only.
- **The default port is one constant**, `DEFAULT_PORT` in `server/port.ts`; the CLI help, the startup line and
  `npm run dev` derive from it.
- **Server imports use `.js` extensions** (NodeNext); tests import `.ts` files directly. The build rewrites them.
- **Tests never touch a real data home**: use `tmpDir()` / `tmpStore()` from `test/fixture.ts` and pass
  `HALLWAY_HOME`. Give each test its own `EventBus` and `ProviderRegistry` rather than the daemon's singletons.
- **Only the store writes the human-editable files.** Anything that changes `apps/`, `bookmarks/`, `ignore.yaml` or
  `config.yaml` goes through `Store` (server/store/index.ts); new fields go into `schema.ts` (then
  `npm run sync:guide`). Live data never goes into those files: register a provider (server/providers.ts) and emit
  events on the bus.
- **Packaging:** the npm package is the compiled CLI (`bin: hallway` → `dist/server/cli.js`), `dist/shared` and the
  built dashboard (`dist/web`). Only what the daemon needs at run time is a `dependency`; React and anything else the
  dashboard bundles are `devDependencies`.
- **Changesets** for user-facing changes ([CONTRIBUTING.md](CONTRIBUTING.md#changesets)). A merged changeset leads to
  a real npm release once its version PR is merged ([RELEASING.md](RELEASING.md)); until v0 works, don't add one
  unless you've been asked to cut a release.
