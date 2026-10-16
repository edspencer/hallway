# Contributing to Hallway

Thanks for working on Hallway. This is the short guide for people: how to get it running, what CI checks and the
few rules that aren't up for negotiation. Coding agents working on this repo should read [AGENTS.md](AGENTS.md), the
agent-facing version of the same conventions (it's what `CLAUDE.md` loads).

Hallway is **pre-release**: the design is written down in full in [spec.md](spec.md) and [docs/](docs/), and the code
is being built milestone by milestone ([docs/08-roadmap.md](docs/08-roadmap.md)). Read the spec before changing
behaviour; decisions and their reasons are in [docs/09-decisions.md](docs/09-decisions.md).

## Setup

You need Node.js 22 or later (`.nvmrc` says 22) and git, on macOS or Linux.

```sh
git clone https://github.com/edspencer/hallway.git
cd hallway
npm ci
```

Then, depending on what you're doing:

```sh
npm run dev           # Vite with hot reload on :4255, proxying /api to the daemon (tsx watch) on :4256
npm start             # build what's stale, then run the compiled CLI (`npm start -- --port 5050`, …)
npm run hallway -- <cmd>   # any `hallway` command, from source
```

**Keep your real configuration out of it.** Point a development instance at a throwaway data home, e.g.
`HALLWAY_HOME=$(mktemp -d) npm start -- --port 5050`. `HALLWAY_WEB_PORT` / `HALLWAY_API_PORT` move `npm run dev`'s
ports, so it can run next to an installed Hallway.

If your shell exports `NODE_ENV=production`, `npm ci` skips the dev dependencies (TypeScript, Vite, tsx): unset it
(`env -u NODE_ENV npm ci`).

**Dependencies:** `package-lock.json` is written by npm 11. If you add or upgrade a dependency on Node 22 (which
ships npm 10), use npm 11 for it, e.g. `npx npm@11 install -D some-package`: npm 10 drops fields npm 11 writes, which
churns the lockfile.

### Previewing behind another machine's proxy (development only)

The daemon binds 127.0.0.1 and refuses any `Host` but loopback. To look at a development build through a reverse
proxy on another host (a remote dev box, say), two environment variables relax that, for development only:

```sh
HALLWAY_DEV_BIND=0.0.0.0 HALLWAY_DEV_ALLOWED_HOSTS=preview.example.com node dist/server/cli.js serve --port 5050
```

They are never CLI flags, never in `--help`, and the daemon prints a warning while they're in effect. Don't use them
anywhere but a throwaway development instance (decision D31 in [docs/09-decisions.md](docs/09-decisions.md)).

## Checks

CI runs all of these on Node 22 and 24, on Linux and macOS. Run them before you open a PR:

```sh
npm run check:nul     # no raw NUL bytes in JS/TS sources (they hide files from grep)
npm run typecheck     # server + dashboard
npm test              # node:test, from source via tsx
npm run build         # dist/web (Vite) + dist/server, dist/shared (tsc)
npm run smoke:pack    # npm pack, install the tarball into a temp prefix, run it as a user would
```

`smoke:pack` matters whenever you touch the build, `package.json` (`files`, `bin`, dependencies) or anything the CLI
reads at run time.

## The rules

These are what make Hallway safe to leave running. A PR that weakens one won't be merged, however useful the rest
of it is.

- **Localhost only.** The daemon binds 127.0.0.1 and rejects non-local `Host`/`Origin` headers
  (`server/security.ts`). The only exceptions are the development-only variables above.
- **The daemon never runs as root.** Privileged steps belong only in `hallway setup` / `hallway teardown`, and they
  print each command before running it.
- **Nothing reachable over HTTP or MCP launches a process.** Starting servers is CLI-only (D10).
- **YAML on disk is the source of truth.** Every write to the human-editable files goes through one module
  (`server/store/`); hand edits are first-class (D7).
- **Keep it generic.** Examples, defaults and docs never assume a particular employer, machine, username or network.
  Use `example.com`, `myname.internal`, `~/Code/my-app` and similar placeholders.
- **macOS and Linux both.** Anything OS-specific goes behind `server/platform/` (D26), with tests for both
  platforms.

## Pull requests

- Branch off `main` and open the PR against it. Keep it focused; a stack of small PRs beats one big one.
- Say what changed and how you checked it. CI has to be green.
- **UI changes need screenshots:** before and after, plus a nearby view that *shouldn't* have changed, so a reviewer
  can tell a fix from something that just disappeared. A GIF if there's motion or a sequence of states.
- **User-facing changes need a changeset** (below).
- **Design decisions go in the decisions log.** If you settle something the spec leaves open, or disagree with it,
  record it in `docs/09-decisions.md` (and resolve the item in `docs/10-open-questions.md`) in the same PR.

## Changesets

Versions and the changelog come from [changesets](https://github.com/changesets/changesets). If your PR changes
something a user of the npm package would notice (a feature, a fix, a changed default, a new CLI flag, a UI change),
add a changeset in the same PR:

```sh
npm run changeset     # pick patch / minor / major, write the summary for the changelog
git add .changeset && git commit -m "Add changeset"
```

That writes a small markdown file in `.changeset/`; you can also write or edit it by hand. Write the summary for
users, not reviewers: what they'll see, and what they need to do if something breaks. Before 1.0, a breaking change
is a minor bump. Changes nobody using the package would notice (tests, CI, refactors, contributor docs) don't need
one. `npx changeset status --verbose` shows what the next release would be.

You don't bump `version` or edit `CHANGELOG.md` yourself: the release workflow does both
([RELEASING.md](RELEASING.md)).

## Security

Please don't open a public issue for a vulnerability; see [SECURITY.md](SECURITY.md).
