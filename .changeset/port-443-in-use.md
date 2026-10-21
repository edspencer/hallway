---
"hallway": minor
---

When something else already holds port 443 or 80 (Rancher Desktop's Traefik, a Docker container, Colima, OrbStack, nginx…), `hallway setup` and the dashboard's Turn on now say so once, name the tool, and give its own fix (for Rancher Desktop: untick "Enable Traefik" in Preferences → Kubernetes), and say when it's reachable from your network. The dashboard no longer blames a cancelled Touch ID prompt for a stop that had nothing to do with it.

To leave the other tool running, `hallway setup --port 4443` (or **Use port 4443 instead** in the dashboard) puts local domains on Caddy's own port: `https://hallway.localhost:4443`, `https://<app>.localhost:4443`, with every link Hallway gives following. `hallway setup --port 443` (or **Move to port 443** in the Local domains dialog) moves them back once 443 is free. `hallway doctor` names what holds 443/80 and which port links carry.
