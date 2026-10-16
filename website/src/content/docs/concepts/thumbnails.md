---
title: Thumbnails
description: "The picture on each door: a favicon by default, opt-in screenshots (hallway thumbs enable), or generated cards."
---

Every app's door on the [dashboard](/concepts/dashboard/) carries a picture. Which kind is `thumbnails.mode` in
[`config.yaml`](/reference/config-yaml/):

| `thumbnails.mode` | The door shows |
| --- | --- |
| `favicon` (the default) | The app's favicon on a small tile; a monogram on a colour derived from the slug if it has none. |
| `screenshot` | A screenshot of the app as the door's pane of glass. An app with no screenshot yet falls back to its favicon. |
| `card` | Every door drawn as a generated card: the app's name, address, framework and `repo @ branch`. |

## Favicons

<span class="ms ms--v0">v0</span> The default needs nothing. Hallway fetches each app's favicon (and each bookmark's),
caches it in the data home (`cache/favicons/`), and paints the door with the icon's dominant colour.

## Screenshots

<span class="ms ms--shipped">v2</span> Screenshots are opt-in, because they need a browser:

```sh
hallway thumbs enable          # install the browser into the data home and turn screenshots on
hallway thumbs refresh         # take them again now (or: hallway thumbs refresh <slug>)
hallway thumbs status          # the mode, whether a browser is installed and its size, how many screenshots
hallway thumbs disable         # turn them off and delete the browser and the screenshots
```

`hallway thumbs enable` installs Chromium's headless shell (about 300 MB) into `cache/browser/` in the
[data home](/reference/data-home/), **never anywhere else**, and sets `thumbnails.mode: screenshot`. Hallway itself
doesn't depend on Playwright or any browser: `npm i -g hallway` downloads none. Run `enable` again after an upgrade
if Hallway says the browser is out of date; it is safe to repeat.

How screenshots behave:

- **Healthy apps only.** Declared apps that are `healthy` get one; bookmarks are never shot.
- **Kept fresh**: a new screenshot when there is none, when the app has restarted (its process ID changed) or its
  address changed, and when the last one is six hours old. `hallway thumbs refresh` (which needs the daemon running)
  takes them now.
- **Light**: one page at a time, in one headless browser that closes after two idle minutes. A page that never goes
  quiet is shot after ten seconds anyway.
- **Private**: screenshots are taken on your machine, stored in `cache/thumbs/`, and never leave it.
- The [detail drawer](/concepts/dashboard/#app-cards) shows the screenshot larger.

`hallway thumbs disable` sets the mode back to `favicon` and deletes `cache/browser/` and `cache/thumbs/`.

## Generated cards

<span class="ms ms--shipped">v2</span> With `thumbnails.mode: card`, every door is drawn as a card: the app's name,
its address on a brass plate, its framework and `repo @ branch`, on the door's own paint. The daemon renders it with
fonts bundled in the package, so it looks the same on every machine, and needs no browser.

```yaml
# config.yaml
thumbnails:
  mode: card
```

`card` is a look you choose for every door, not a fallback: in the other modes an app with no favicon keeps its
monogram. The drawer doesn't repeat the card, since it already shows everything a card says.

## From the API

`GET /api/apps/:slug/thumb` serves an app's picture with an ETag (a card as a 640×400 PNG), and each app in
`/api/state` has a `thumbKind` of `favicon`, `screenshot` or `card` saying which it is.
`POST /api/thumbs/refresh` takes new screenshots. See the [HTTP API](/reference/http-api/).
