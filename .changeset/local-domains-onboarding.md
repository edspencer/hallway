---
'hallway': minor
---

Local domains are discoverable. `hallway` / `npx hallway` prints a HALLWAY banner on a terminal (no art or colour when piped, nothing extra with `--quiet`), the dashboard's address, and, while local domains are off, how to turn them on with `hallway setup`; from npx, how to keep it running. If Hallway is already running on the port, it says where and exits 0 instead of failing. The dashboard shows a dismissible **Local domains** panel in direct mode (dismissal is saved in `config.yaml` as `dashboard.hints.localDomains`), and a **Local domains** control in the header that brings it back or, once fronted mode is on, shows `hallway doctor`'s networking checks. `hallway doctor` says when local domains are off. New: `GET /api/fronting`, `PATCH /api/hints`, `fronting` in `/api/state`. Not on Windows, where `hallway setup` refuses.
