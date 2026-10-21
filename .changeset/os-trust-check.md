---
"hallway": patch
---

`hallway setup` and `hallway doctor` now check that the certificate is trusted the way browsers check it (Apple's curl with no CA given on macOS; the system store or Chrome's NSS database on Linux), so a "Done" or an all-clear no longer hides a certificate error. After setup has trusted the certificate, it and the dashboard say to quit and reopen a browser that showed a warning before (Chrome can remember the old result). On a Mac whose organisation sets Chrome or Edge to ignore certificates you add (`CAPlatformIntegrationEnabled`), setup, the dashboard and doctor say so up front.
