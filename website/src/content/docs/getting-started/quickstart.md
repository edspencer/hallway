---
title: Quickstart
description: The first five minutes with Hallway.
---

Everything on this page works in the current release, on macOS and Linux, with no sudo, and on Windows (best effort)
with no administrator rights. For the details of installing (Node version, lingering on Linux, the scheduled task on
Windows), see [Installation](/getting-started/installation/).

## 1. Start it

```sh
npm i -g hallway
hallway service install      # run the daemon at every login
hallway open
```

The dashboard opens at `http://localhost:4255`. The page title is your machine's name.

## 2. Meet what is already running

You probably have servers running already. Within a couple of minutes the scanner lists them under
**Found running — not yet named**:

```text
:4666  dashboard · ~/Code/dashboard-wt-b @ feature/new-chart · up 9 days · orphaned
       [Claim]  [Ignore ▾]
```

For each one Hallway shows what it could work out: the project directory (from the process's working directory,
because command lines like `node dist/index.js` say nothing), the git branch, how long it has been up, the page
`<title>`, and **orphaned** if the session that started it has gone. Noise is filtered out: IDE and agent-tool
helpers on high ephemeral ports, databases, and system daemons never appear. See
[Apps](/concepts/apps/#observed-listeners-the-scanner).

**Claim** the ones you care about. Claiming writes a small file, `~/.hallway/apps/<slug>.yaml`, on the port the app
already uses (Hallway [never changes an app's port](/guarantees/ports/)), and the row becomes a card in **Apps**.
**Ignore** the rest, by port, by process name or by directory.

The same from a terminal:

```sh
hallway scan                    # what is listening, with identity
hallway claim 4666 --slug dashboard
hallway ignore 631 --by port
```

## 3. Add an app by hand

Any server you know about can be declared with one command or one file:

```sh
hallway app add slides --port 4321 --name "Slides"
```

or create `~/.hallway/apps/slides.yaml` in your editor:

```yaml
name: Slides
port: 4321
```

An open dashboard shows the new card within a second, without a reload. Edit or delete the file and the page follows.
If you break the YAML, that one card shows the file, line and error; everything else keeps working, and Hallway never
rewrites a file you broke.

## 4. Say which apps should be up

Each app says what you expect of it. Something that should always be up is `running`; if it stops answering it turns
**down**, the only alarming state. Something you only run sometimes is `adhoc` (claimed apps start that way), and
when it is off it shows as a calm, closed door instead:

```yaml
expected: running    # running | adhoc | stopped
```

See [Health states](/concepts/health/).

## 5. Hang up some bookmarks

Create `~/.hallway/bookmarks/production.yaml`:

```yaml
title: Production
links:
  - title: Admin console
    url: https://admin.example.com
  - title: Status page
    url: https://status.example.com
```

They appear as favicon chips under **Bookmarks**. See [Bookmarks](/concepts/bookmarks/).

## 6. Tell your agents

Add a short paragraph to your `AGENTS.md` or `CLAUDE.md` so agents stop leaving orphans behind:

```sh
hallway guide --snippet
```

See [Working with agents](/agents/overview/).

## Next

- [hallway run](/agents/hallway-run/): start a dev server that outlives the session, on a stable port.
- [Services and reboots](/concepts/services/): keep apps running across restarts, and see what the last reboot took
  down.
- [Fronted mode](/networking/fronted-mode/): `https://slides.localhost` instead of a port, after one
  `hallway setup` (macOS and Linux only).
- [Thumbnails](/concepts/thumbnails/): screenshots of your apps on their doors, or generated cards.
- The [MCP server](/agents/mcp/) and the [dev-server hook](/agents/hook/), for coding agents.
- The [CLI reference](/reference/cli/) and the [file formats](/reference/app-yaml/).
