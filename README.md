# Spaghetti Junction

**The front door for everything you vibe-coded on a random port.**

Coding agents make small web apps nearly free to build — dashboards, decks, viewers, tools. Each one ends up on some
port, started in a session that has long since ended. Days later you can't remember what's running, where, or how it
got started; then a reboot quietly kills the lot.

Spaghetti Junction untangles that:

- **A live directory** of every local web server — the ones you registered *and* the ones it finds simply by looking
  at what's listening, identified by project, directory and git branch.
- **Health at a glance** — state and uptime history for each, calm when things are intentionally off, loud only when
  something that should be running isn't.
- **Memorable HTTPS hostnames** — `https://review.localhost` instead of `localhost:5622`, with no DNS setup by default.
- **Survives reboots** — the things you want kept alive run as native OS services.
- **Your jumping-off page** — groups of bookmarks to the remote things you can never remember the URL of.
- **Agent-friendly** — plain YAML files an agent can edit with the UI updating live, an agent guide, an MCP server, and
  one command (`sj run`) for an agent to start a server that won't become an orphan.

## Status

**Specification only — no code yet.** Start at [spec.md](spec.md).
