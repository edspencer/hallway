---
"hallway": minor
---

Fronted mode: every app at `https://<app>.localhost` (or under your own domain), and the dashboard at `https://hallway.localhost`.

- `hallway setup` runs Caddy as you, as a user-level LaunchAgent or systemd user unit, on loopback ports 4443 and 4480. It then makes three privileged changes, each printed and run through `sudo`: it redirects ports 443 and 80 to Caddy (a pf anchor on macOS, an nftables table on Linux), trusts Hallway's local certificate authority, and switches `config.yaml` to `mode: fronted`.
  - `hallway setup --print` shows the whole plan and runs nothing.
  - Re-running it only fixes what's missing.
  - It refuses `.local`, real HSTS-preloaded TLDs such as `.dev`, and anything already holding port 443 or 80 (naming the process).
- `hallway setup --domain myname.internal` serves apps under your own domain, through a user-level dnsmasq and a resolver entry for that domain only.
- Caddy's admin API is a private Unix socket in your data home, and Caddy never runs as root, so it can't be used to escalate privileges.
- New apps get a hostname as soon as their YAML file exists: no sudo, no restart.
- The Host header is rewritten to the app's own address by default, so apps that defend against DNS rebinding still work; `proxy.preserveHost: true` opts out. Vite's hot reload works through the proxy.
- When the daemon is down, `https://hallway.localhost` serves a static page listing every app. When an app is down, its hostname says which app isn't answering and how to start it.
- `hallway teardown` undoes it all and goes back to `http://localhost:<port>` links.
- `hallway doctor` checks fronted mode: Caddy, who holds ports 80/443, the redirect, the trusted certificate and name resolution.
- In fronted mode, dashboard cards show the hostname, with the port as a direct link beside it.
- New `config.yaml` settings: `proxy.httpsPort`, `proxy.httpPort`, `proxy.publicPort`, `proxy.caddy` and `domain.dnsPort`. Setting `proxy.publicPort` to `proxy.httpsPort` gives fronted mode with no redirect and no sudo; links then carry `:4443`.
- Needs Caddy 2.7 or later. On macOS, `hallway setup` installs it with Homebrew; on Linux, use a release binary from caddyserver.com.
