---
title: Contributing
description: How the project is organised, how to help while it is young, and how to work on this site.
---

Hallway is open source and developed in the open at
[github.com/edspencer/hallway](https://github.com/edspencer/hallway).

## Where things stand

The project began as an exhaustive specification, written so that someone who wasn't part of the design discussion
could build it. Implementation of v0 is starting. Until the code exists, **the spec is authoritative**:

- [`spec.md`](https://github.com/edspencer/hallway/blob/main/spec.md): the summary, document map, key decisions,
  glossary and milestones;
- [`docs/`](https://github.com/edspencer/hallway/tree/main/docs): the background, architecture, networking, apps and
  health, the dashboard, the agent interface, the CLI, the roadmap, the decision log, the open questions and the
  research notes, in that order.

## Ways to help

- **Try the ideas against your own machine.** Does the scanner's filtering match what you see in
  `lsof -nP -iTCP -sTCP:LISTEN`? Is there a kind of server it would miss or mislabel? Open an issue.
- **Verify the unverified.** The [open questions](https://github.com/edspencer/hallway/blob/main/docs/10-open-questions.md)
  list things that must be checked by experiment before Hallway relies on them, such as whether Safari resolves
  `*.localhost`, and whether hot reload works through the proxy.
- **Disagree in writing.** If you think a decision is wrong, record your alternative and the reasoning in an issue or
  a PR to `docs/09-decisions.md`, rather than quietly building something different.

## Ground rules

- **Never require root in the daemon.** Privileged steps belong only in `hallway setup` and `hallway teardown`, and
  are printed before they run.
- **Keep it generic.** Examples, defaults and docs must not assume any particular employer, machine, username or
  network: use `example.com`, `myname.internal`, `~/Code/my-app` and similar.
- **Build in milestone order**, and check each milestone by running it.
- **The dashboard's visual design is core scope**, not polish.

The project follows the conventions of its sibling, [Local Review](https://github.com/edspencer/local-review): the
stack, the data home layout, live updates, security middleware, the agent guide and the release process.

## Working on this site

This site lives in the repository's `website/` directory: [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build), built and deployed on its own, separate from the app.

```sh
cd website
npm install
npm run dev                            # local dev server
npm run build && npm run check-links   # what CI runs
```

Pages are Markdown under `website/src/content/docs/`, and the sidebar is maintained by hand in
`website/src/sidebar.mjs`. Every feature a page describes is marked with its milestone
(<span class="ms ms--v0">v0</span>, <span class="ms">v1</span>, <span class="ms">v2</span>) until it ships. See
`website/README.md` for the rest.
