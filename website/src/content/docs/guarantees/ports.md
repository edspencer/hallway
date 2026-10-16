---
title: Your ports stay put
description: Hallway never moves an app to a different port, because apps hardcode their own.
---

**Hallway never reassigns an existing app's port.** Claiming an observed server, declaring an app, running it with
`hallway run` or turning it into a service all keep the port it already uses.

## Why

Apps hardcode their own ports, in places Hallway can't see:

- a build config that bakes in the site's own URL (`site: "http://127.0.0.1:4321"`);
- helper scripts and a dev-server proxy that call `http://127.0.0.1:7333`;
- other apps, bookmarks and notes that point at the old address.

Both of the first two turned up in the incident that started this project. Moving those apps to "tidier" ports would
have broken them, so Hallway doesn't.

## What that looks like

- **Claim** writes the observed port into the app's file, never a new one.
- **MCP** refuses to change an app's `port` at all; change it yourself if you really mean to.
- **Two apps on one port** is shown as a warning, not fixed for you (one of them may be stopped on purpose).
- **Only brand-new apps get a port assigned**, from `ports.assignRange` (5100–5999 by default, which avoids AirPlay's
  5000), skipping ports that are declared, observed listening or well known. The assignment is written into the app's
  file, so it is stable from then on.
- **Vite users:** pass `--strictPort`, or Vite will quietly move itself when its port is busy. See
  [framework flags](/agents/hallway-run/#framework-flags).
