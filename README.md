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
- **Memorable HTTPS hostnames** — `https://review.localhost` instead of `localhost:5622`, with no DNS setup by default.
- **Survives reboots** — the things you want kept alive run as native OS services.
- **Your jumping-off page** — groups of bookmarks to the remote things you can never remember the URL of.
- **Agent-friendly** — plain YAML files an agent can edit with the UI updating live, an agent guide, an MCP server, and
  one command (`hallway run`) for an agent to start a server that won't become an orphan.

## Status

**Pre-release — not on npm yet, and not usable day to day.** The design is complete ([spec.md](spec.md) and
[docs/](docs/)); the implementation has just started: the daemon skeleton and a placeholder dashboard exist, and the
features above arrive milestone by milestone ([docs/08-roadmap.md](docs/08-roadmap.md)). macOS and Linux.

## Development quick start

You need Node.js 22 or later and git.

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
