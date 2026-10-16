---
title: Files first
description: How coding agents work with Hallway - plain YAML, live updates, one command to start servers, and MCP.
---

Hallway is built for the servers coding agents spin up. Its agent interface follows the author's sibling project
[Local Review](https://local-review.edspencer.net): **files first, MCP second**.

## Plain files are the interface

<span class="ms ms--v0">v0</span> Everything Hallway knows lives in small YAML files under `~/.hallway` ([the data home](/reference/data-home/)). An
agent that can read and write files can:

- **register a server** by writing `apps/<slug>.yaml` (a `name` and a `port` is enough);
- **add bookmarks** by editing `bookmarks/<group>.yaml`;
- **check what's running** with `hallway status --json` or `GET http://localhost:4255/api/state`.

A file watcher turns every edit into a live update, so the dashboard changes within a second, whether the edit came
from you, your editor, an agent, the CLI or the API. That works with every agent, needs no configuration, and makes a
hand edit behave exactly like an agent's.

The CLI, the HTTP API and the MCP server are all thin wrappers over **one write module** that validates and writes
those same files atomically. None of them is a separate path, and none is the only way to do something.

## The habit to change

The tooling can't fix the real problem alone: agents will keep running `npm run dev` unless told otherwise, and every
one of those becomes an orphan when the session ends. So Hallway gives agents:

1. <span class="ms">v1</span> **One command instead of `npm run dev`**: [`hallway run`](/agents/hallway-run/). It hands
   the server to launchd so it outlives the session, keeps a stable port, prints the URL and exits.
2. <span class="ms ms--v0">v0</span> **A guide and a snippet**: [`hallway guide`](/agents/agent-guide/) explains the
   rules, and `hallway guide --snippet` prints two sentences for your `AGENTS.md` or `CLAUDE.md`.
3. <span class="ms">v2</span> **An optional hook** that catches a bare dev-server start before it runs and suggests the
   `hallway run` equivalent.

## Etiquette for agents

These are in the agent guide too:

- Never change an existing app's `port`. Apps hardcode their ports in scripts and configs (see
  [Your ports stay put](/guarantees/ports/)).
- Never delete files outside `apps/` and `bookmarks/`. Removing an app through Hallway moves its file to `backups/`.
- Prefer `expected: adhoc` for throwaway servers, so they don't show as down when they stop.
- Don't touch `state/`, `cache/` or `generated/`: they're machine-written.

## MCP

<span class="ms">v2</span> For clients that prefer typed tools, an [MCP server](/agents/mcp/) runs on the same port as the dashboard. It can
describe apps and fully manage bookmarks, but by design it can't start, stop or install anything.
