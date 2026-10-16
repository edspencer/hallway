---
title: Bookmarks and ignore files
description: The formats of bookmarks/<group-slug>.yaml and ignore.yaml.
---

## `bookmarks/<group-slug>.yaml`

<span class="ms ms--v0">v0</span> One file per bookmark group. The filename is the group's slug.

```yaml
title: Production
order: 10                       # groups sort by order, then title
collapsed: false
links:
  - title: Admin console
    url: https://admin.example.com
    description: Production admin
    icon: auto                  # auto = fetch the favicon once and cache it; or an emoji / image / URL
    tags: [prod]
  - title: BI dashboards
    url: https://bi.example.com
```

| Field | Meaning |
| --- | --- |
| `title` | The group's heading. |
| `order` | Sort key; groups sort by `order`, then `title`. |
| `collapsed` | Whether the group starts collapsed. Saved here, so it is the same in every browser. |
| `links[].title` | The chip's label. |
| `links[].url` | Where it goes. Required. |
| `links[].description` | Shown as a tooltip. |
| `links[].icon` | `auto` (the site's favicon, fetched once and cached), an emoji, an image in the data home, or a URL. Without one, a monogram on a colour derived from the hostname. |
| `links[].tags` | Free-form tags, for filtering. |

Bookmarks are inert: nothing is launched, and they are not health-checked. See [Bookmarks](/concepts/bookmarks/).

## `ignore.yaml`

<span class="ms ms--v0">v0</span> Observed listeners you never want to see. **Ignore** in the dashboard (or
`hallway ignore`) appends to it; you can edit it by hand.

```yaml
ports: [631]                            # never show these ports
processes: [rapportd, ControlCenter]    # never show listeners owned by these process names
dirs: []                                # never show listeners whose working directory is under these paths
```

This is on top of the scanner's own filters (ports below 1024, the ephemeral range, and known non-web daemons). See
[the scanner](/concepts/apps/#observed-listeners-the-scanner).
