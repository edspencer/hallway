---
"hallway": minor
---

Screenshots on the doors, generated cards, and a faster 90-day view.

- **Screenshots, opt-in:** `hallway thumbs enable` installs a headless browser (Chromium's headless shell, about 300 MB) into the data home, never anywhere else, and turns screenshots on. Each healthy app's door gets a pane of glass showing the app itself, re-shot when the app restarts, every six hours, or with `hallway thumbs refresh [slug]`. The drawer shows it larger. `hallway thumbs disable` turns them off and deletes the browser and the pictures; `hallway thumbs status` shows what's installed. Bookmarks are never shot, and screenshots never leave your machine.
- **The base install stays light:** Hallway doesn't depend on Playwright or any browser; `npm i -g hallway` downloads none.
- **Generated cards:** `thumbnails.mode: card` draws every door as a card with the app's name, address, framework and `repo @ branch`, rendered on the daemon with bundled fonts, so it looks the same on every machine. `GET /api/apps/:slug/thumb` serves it as a 640×400 PNG.
- **The 90-day uptime view is quicker:** one app's 90 days now take a few milliseconds instead of ~50, so the drawer stays snappy with dozens of apps.
- `AppView.thumbKind` says whether an app's thumbnail is a favicon, a screenshot or a card; `POST /api/thumbs/refresh` re-shoots from the API.
