---
title: Bookmarks
description: Groups of links to the remote things you always forget the URL of, hung by the front door.
---

<span class="ms ms--v0">v0</span> Bookmarks are links to anything, usually remote: production admin consoles, BI
dashboards, status pages, documentation portals. They make the dashboard a jumping-off page, the role a home-lab
dashboard plays on a home network.

In the hallway they hang **on a key hook by the front door**: small favicon chips in labelled groups, lighter than
the app cards because there is nothing behind them to check.

## One file per group

Each group is a file, `~/.hallway/bookmarks/<group-slug>.yaml`:

```yaml
title: Production
order: 10              # groups sort by order, then title
collapsed: false
links:
  - title: Admin console
    url: https://admin.example.com
    description: Production admin       # shown as a tooltip
    icon: auto                          # fetch the favicon once and cache it
    tags: [prod]
  - title: BI dashboards
    url: https://bi.example.com
```

Full format: [Bookmarks and ignore files](/reference/bookmarks-yaml/).

From the CLI:

```sh
hallway bookmark add production https://status.example.com --title "Status page"
hallway bookmark ls
hallway bookmark rm production https://status.example.com
hallway bookmark edit production       # opens the YAML in $EDITOR
```

## How they behave

- **Inert.** Nothing is launched, and remote bookmarks are not health-checked (remote checks would leak traffic and
  mostly hit login walls). Opt-in checks per link are an idea for later.
- **Favicon-led.** Each link's favicon is fetched once and cached. Without one, it gets a monogram on a colour derived
  from the hostname. You pattern-match on logos here, not status.
- **Collapsible.** A group's collapsed state is saved in its file, so it is the same in every browser.
- **Files are the truth.** You can add and edit links inline in the dashboard, but that only writes the YAML.
- **Yours.** Bookmarks are user-specific and never baked into Hallway. The data home can live in a dotfiles repo if
  you want them on several machines.
