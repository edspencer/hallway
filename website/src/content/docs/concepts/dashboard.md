---
title: The dashboard
description: The home screen, app cards, the observed tray, keyboard shortcuts and the hallway design.
---

The dashboard is meant to be **good enough to set as your browser's home page**. That is a requirement, not polish.
This page describes the design the <span class="ms ms--v0">v0</span> dashboard follows; the sketches are drawn in text
from that design, not screenshots.

## Principles

1. **A jumping-off point, not a control panel.** The main action is *go to the thing*.
2. **Instant.** Everything is local, so the whole page paints from one request in well under 200 ms. Live updates
   arrive over Server-Sent Events; there are no spinners on the main view.
3. **Calm.** Most of the time everything is fine or intentionally off, so the page is quiet. Only `down` is alarming.
4. **Dense but legible.** Many apps visible at once on a laptop screen.
5. **Keyboard-first.** It must be faster than remembering a URL.
6. **Never needs hand-maintenance** to stay accurate.

## Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ HALLWAY · my-laptop                        [ / filter…    ]  ● 9 up · 1 down │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Lost at last reboot (Mon 28 Sep 20:05): 6 apps   [Review] [Dismiss]   v1   │
├──────────────────────────────────────────────────────────────────────────────┤
│ APPS                                                                         │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│ │ [tile]       │ │ [tile]       │ │ [tile]       │ │ [tile]       │          │
│ │ Slides       │ │ Log viewer   │ │ Docs site    │ │ dash @ wip   │          │
│ │ :4321        │ │ :7333        │ │ :4455        │ │ :4670        │          │
│ │ ▮▮▮▮▮▮▮▮▮▮   │ │ ▮▮▮▮▮▮▮▯▮▮   │ │ ░░░░░░░░░░   │ │ ▮▮▮▮▮        │          │
│ │ ● 99.9% 12ms │ │ ● 98.1% 40ms │ │ ○ stopped    │ │ ● adhoc      │          │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘          │
├──────────────────────────────────────────────────────────────────────────────┤
│ FOUND RUNNING — NOT YET NAMED                                                │
│ :4666  dashboard · ~/Code/dashboard-wt-b @ feature/new-chart · up 9 days     │
│        orphaned   [Claim]  [Ignore ▾]                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ BOOKMARKS                                                                    │
│ Production   (◉ Admin console) (◉ BI dashboards) (◉ Status page)             │
│ Docs         (◉ API reference) (◉ Runbooks)                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Which sections appear, and in what order, is `dashboard.sections` in [`config.yaml`](/reference/config-yaml/). The
observed tray hides itself when empty, and so do bookmarks.

## App cards

Top to bottom:

- **A thumbnail**: the app's favicon on a tile of its own dominant colour, or a monogram when it has none. Opt in to
  real screenshots (<span class="ms ms--v0">v0</span>, `hallway thumbs enable`) and each healthy app's door gets a pane of glass showing the app
  itself, re-shot when the app restarts and every six hours. Or set `thumbnails.mode: card` and every door is drawn
  as a generated card with its name, address, framework and `repo @ branch`.
- **The name**, and for worktree siblings `repo @ branch` in smaller type.
- **The address**, the main click target: `localhost:4321` in direct mode, `slides.localhost` in fronted mode, with a
  copy button on hover.
- **The uptime bar** for the last 24 hours, with the uptime percentage and median latency.
- **The state**, as colour, shape and word: <span class="state state--healthy">● healthy</span>,
  <span class="state state--unhealthy">▲ unhealthy</span>, <span class="state state--down">■ down</span>,
  <span class="state state--stopped">○ stopped</span>, <span class="state state--unknown">◌ unknown</span>.
- **Badges, only when relevant**: `orphaned` (the session that started it has gone), `exposed` (bound to `0.0.0.0`,
  so reachable from your network), `managed` (a launchd or systemd service), its source, or a config error.

Click or Enter opens the app; ⌘/Ctrl-click opens a new tab. A secondary button opens the **detail drawer**: full
identity (directory, git branch and last commit, framework, PID, start time, the command that started it), uptime and
latency history, the YAML file with an "open in editor" link, deep links, any config error, and for managed services
(upcoming, <span class="ms">v1</span>) start, stop, restart and a live log tail. Until then, use `hallway stop`,
`start`, `restart` and `logs`.

## Keyboard

| Key | Action |
| --- | --- |
| `/` | Focus the filter (fuzzy over name, slug, host, port, directory, branch and bookmark titles) |
| `↑ ↓ ← →` | Move between cards and chips |
| `Enter` | Open; `⌘/Ctrl-Enter` opens a new tab |
| `c` | Copy the focused item's URL |
| `i` | Open the detail drawer |
| `Esc` | Clear the filter, or close the drawer |
| `?` | Show the shortcuts |

Type a filter that matches exactly one thing and press Enter to open it: faster than remembering a URL.

## Errors and empty states

- A broken YAML file shows its error **in place**, on the affected card (or as a banner for `config.yaml` and
  bookmark files), with the file, line and message. Never a blank page.
- With no apps declared yet, the page leads with the observed tray: *"We found 4 web servers running. Name the ones
  you care about."*
- With nothing running and nothing declared, it shows the two commands that matter and a link to the agent guide.

## The hallway

The visual design is a **calm, well-lit hallway**. Each app is a numbered **door**; its port is the brass **door
number**; its state shows in the door (ajar with lamplight for healthy, closed for stopped, dark for down). Unclaimed
listeners are noises behind doors you didn't know were there; bookmarks hang by the front door. The theme is
dark-first, a warm corridor at night with lamplight amber, with a daylit light theme.

The imagery always sits *on top of* plain labels: "Claim", "Ignore" and "Down" stay as they are, and nobody has to
decode a pun to read a state. [Why the name](/why-the-name/) tells where it comes from.

:::note[Working direction]
The hallway identity is approved as the working direction, not as final branding. The logo on this site is a
placeholder.
:::
