---
'hallway': patch
---

Servers that listen on IPv6 loopback only, as Vite, Astro and Next do on a Mac (`localhost` is `::1` there), are no longer invisible. `hallway run`, the health prober, `start`/`restart` and `status` try 127.0.0.1 and ::1 and record which answered (`hallway run` prints it; the API has `health.address`), and in fronted mode Caddy dials `localhost:<port>`, reaching the app in whichever family it bound, so `https://<app>.localhost` works instead of showing "isn't answering". The fallback page and run's timeout no longer claim nothing was listening when only 127.0.0.1 was checked. Proxied apps now see `Host: localhost:<port>` rather than `127.0.0.1:<port>`.

Upgrading now restarts the running daemon: `npm i -g hallway@latest && hallway service install` restarts a daemon still running the old version, waits until the new one answers, and says so ("Restarted the daemon: 0.7.0 → 0.7.1."). `hallway service regenerate` and `hallway setup` do the same, forwarders left running by an older version are restarted too, and `hallway doctor` fails when the daemon's version differs from the CLI's (fix: `hallway service restart`). The check is in the new CLI, so it works for an upgrade from any earlier version.
