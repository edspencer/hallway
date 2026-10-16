# Hallway

**The front door for everything you vibe-coded on a random port.**

Coding agents make small web apps nearly free to build — dashboards, decks, viewers, tools. Each one ends up on some
port, started in a session that has long since ended. Days later you can't remember what's running, where, or how it
got started; then a reboot quietly kills the lot.

Hallway gives them all a front door:

- **A live directory** of every local web server — the ones you registered *and* the ones it finds simply by looking
  at what's listening, identified by project, directory and git branch.
- **Health at a glance** — state and uptime history for each, calm when things are intentionally off, loud only when
  something that should be running isn't.
- **Memorable HTTPS hostnames** *(coming in v1)* — `https://review.localhost` instead of `localhost:5622`, with no
  DNS setup by default.
- **Survives reboots** — the things you want kept alive run as native OS services (launchd on macOS, systemd on
  Linux).
- **Your jumping-off page** — groups of bookmarks to the remote things you can never remember the URL of.
- **Agent-friendly** — plain YAML files an agent can edit with the UI updating live, an agent guide and `/llms.txt`,
  and one command (`hallway run`) for an agent to start a server that won't become an orphan. An MCP server is coming
  in v2.

![The Hallway dashboard: five apps as doors (healthy, down and stopped), two servers it found running, and two groups of bookmarks](https://raw.githubusercontent.com/edspencer/hallway/main/docs/media/dashboard.png)

<sub>Demo data on a throwaway data home: made-up apps, `example.com` bookmarks.</sub>

## Quick start

You need Node.js 22.13 or later, on macOS or Linux.

```sh
npm i -g hallway
hallway service install    # run the daemon as a LaunchAgent (macOS) or a systemd user unit (Linux)
hallway open               # or browse to http://localhost:4255
```

Hallway now lists every web server it finds listening on this machine. **Claim** one to give it a door (that writes
`~/.hallway/apps/<slug>.yaml`), or declare one yourself:

```sh
hallway app add my-app --port 5173     # or write ~/.hallway/apps/my-app.yaml: `name: My App` and `port: 5173`
hallway bookmark add production https://status.example.com --title "Status page"
hallway status                         # every app's state, address and uptime
hallway doctor                         # checks, with fixes
```

On Linux, run `loginctl enable-linger` once if the daemon should keep running when you're not logged in.

**For your coding agents**, paste this into `CLAUDE.md` or `AGENTS.md` (`hallway guide --snippet` prints it):

> Never start a long-running dev or preview server directly (`npm run dev`, `vite`, `astro dev`, `next dev`,
> `python -m http.server`, …). Start it with `hallway run <slug> -- <command>`, which keeps it running outside this
> session on a stable port and prints its URL. Run `hallway guide` for details.

An agent can also read `http://localhost:4255/llms.txt`: what this Hallway has, and how to register a server.

## Status

**v0, released as 0.1.0:** the dashboard, live YAML files, health checks with uptime history, the port scanner with
claim and ignore, bookmarks, the agent guide, `hallway service install` and `hallway doctor`, plus managed servers
(`hallway run`, `stop`, `start`, `restart`, `logs`, `service add`). Apps are linked as `http://localhost:<port>`
(direct mode). Next: **v1**, fronting (`https://<slug>.localhost` via Caddy, `hallway setup`, custom domains), then
**v2**, MCP and screenshot thumbnails ([docs/08-roadmap.md](docs/08-roadmap.md)). Everything has been run end to end
on Linux; on macOS it's tested on CI (including the real launchd jobs) but not yet run on a developer's Mac, so
reports are welcome. The design is in [spec.md](spec.md) and [docs/](docs/).

## Development quick start

You need Node.js 22.13 or later and git.

```sh
git clone https://github.com/edspencer/hallway.git
cd hallway
npm ci
npm run dev        # dashboard with hot reload on http://localhost:4255, daemon on :4256
```

Or build and run it the way an installed copy runs, with a throwaway data home:

```sh
HALLWAY_HOME=$(mktemp -d) npm start            # http://localhost:4255
curl http://localhost:4255/api/health          # {"ok":true,"version":"0.0.0"}
```

Checks, conventions and how to send a pull request: [CONTRIBUTING.md](CONTRIBUTING.md). Agents working on this repo:
[AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE).
