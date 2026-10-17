---
title: Contributing
description: How the project is organised, how to help while it is young, and how to work on this site.
---

Hallway is open source and developed in the open at
[github.com/edspencer/hallway](https://github.com/edspencer/hallway).

## Where things stand

The project began as an exhaustive specification, written so that someone who wasn't part of the design discussion
could build it. v0 and v1 are built and released, and so is v2 apart from its run on a real Mac (see the
[roadmap](/roadmap/)). Where code exists, **the code and the decision log are authoritative**, and the rest of the
spec explains why:

- [`spec.md`](https://github.com/edspencer/hallway/blob/main/spec.md): the summary, document map, key decisions,
  glossary and milestones;
- [`docs/`](https://github.com/edspencer/hallway/tree/main/docs): the background, architecture, networking, apps and
  health, the dashboard, the agent interface, the CLI, the roadmap, the decision log, the open questions and the
  research notes, in that order.

## Ways to help

- **Try the ideas against your own machine.** Does the scanner's filtering match what you see in
  `lsof -nP -iTCP -sTCP:LISTEN`? Is there a kind of server it would miss or mislabel? Open an issue.
- **Verify the unverified, especially on a Mac.** The
  [open questions](https://github.com/edspencer/hallway/blob/main/docs/10-open-questions.md) and the research notes'
  "unverified on macOS" list name what still needs checking by experiment: whether Safari resolves `*.localhost`,
  whether Firefox trusts the certificate after `hallway setup`, and whether services and launchd's sockets on 443
  and 80 come back after a logout or a reboot.
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
`website/src/sidebar.mjs`. Every feature a page describes is marked with the milestone it belongs to: lamplit once
it has shipped (<span class="ms ms--v0">v0</span>, <span class="ms ms--shipped">v1</span>,
<span class="ms ms--shipped">v2</span>), grey until then (<span class="ms">v2</span>). See `website/README.md` for
the rest.
