# 10 — Open questions, unknowns and TODOs

Each item has an ID referenced from other docs. When resolved, record the outcome in `09-decisions.md` (or the
relevant doc) and delete it here — or mark it **Resolved** with a one-line answer if the history is useful.

## Things to verify before relying on them

| ID | Question | Why it matters | How to check |
|----|----------|----------------|--------------|
| Q-SAFARI-LOCALHOST | Does Safari resolve `https://app.localhost` typed into the address bar? | D5 assumes `*.localhost` works with no DNS in all major browsers. The macOS system resolver handles it (verified), so Safari probably does. | Try it once fronted mode exists. If not, the default must fall back to dnsmasq even for `.localhost`. |
| Q-SECURE-CONTEXT | Do Chrome/Firefox/Safari treat `http://*.localhost` as a secure context? | Only matters if anyone runs fronted mode without TLS (not planned). | `window.isSecureContext` in each browser. |
| Q-CADDY-RESUME | Exact semantics of `caddy run --resume` with admin-API-pushed config: where autosave lives when Caddy runs as root, and whether a `--config` file is still needed. | Routes must survive reboot before the user-level daemon starts. | Caddy docs + experiment. |
| Q-CADDY-TRUST | How to run `caddy trust` against a root-run instance whose CA lives in root's data dir (`--address localhost:2019`?). | Trusted HTTPS is the whole point of fronted mode. | Caddy docs + experiment. |
| Q-HMR | Do Vite and Astro HMR websockets work through Caddy on :443 with Host rewritten? Is `server.hmr.clientPort: 443` needed? | v1 acceptance criterion 4. | Experiment; document per-framework fixes. |
| Q-CADDY-UNPRIVILEGED | **Blocking for v1.** How to front on :443 without a root Caddy whose unauthenticated admin API lets any local process escalate (see the security caveat in `03-networking.md`). Leading option: user-level Caddy on high loopback ports + a one-time pf `rdr` on `lo0`. Others: admin API on a permission-restricted Unix socket; `admin off` + privileged reload helper; wildcard bind + `remote_ip` filter (rejected: exposes to LAN). | A root process that any local process can reconfigure is a privilege-escalation path. | Experiment with pf on current macOS (persistence across reboots and OS updates; anchor files); write up the trade-off as a decision. |
| Q-HOOK | Current Claude Code (and other agents') pre-tool-use hook payload format and blocking convention. | For `sj hook check-command`. | Agent docs at implementation time. |
| Q-NODE-MIN | Minimum Node version for `node:sqlite` without flags. Verified working on Node 24.15; Node 22 behaviour unverified. | Engines field and storage choice (Q-STORE). | Test on the oldest supported Node 22.x. |
| Q-LAUNCHCTL | Confirm modern `launchctl bootstrap/bootout/kickstart/print` behaviour and output parsing on the current macOS. | Service management. | Experiment. |

## Design decisions deliberately left open

| ID | Question | Current leaning |
|----|----------|-----------------|
| Q-STORE | Health samples/rollups in `node:sqlite` or JSONL? | `node:sqlite` if Q-NODE-MIN allows: rollups and pruning are trivial in SQL, and no dependency. JSONL day-files otherwise. |
| Q-PORT | Daemon default port. Proposed **7724** ("SPAG" on a keypad, echoing Local Review's 5622 = "LOCA"). | Check IANA's registry and common dev-tool defaults for conflicts. Never 5000/7000 (AirPlay). |
| Q-DASHBOARD-HOST | Default dashboard hostname in `localhost` mode: `junction.localhost` (current spec), `sj.localhost`, or bare `localhost`? | `junction.localhost`. Bare `localhost` on :443 may collide with other tools. |
| Q-VALIDATION | Hand-rolled validation or a small schema library? | Hand-rolled (Local Review style) unless the schema grows; the agent-guide file reference should be generated from whatever is chosen. |
| Q-BOOKMARK-HEALTH | Health-check remote bookmarks? | Off by default; maybe opt-in per link later. Remote checks leak timing/traffic and often hit auth walls. |
| Q-MCP-AUTH | Should `/mcp` require a token? | No for v2 (same trust boundary as the data home). Revisit if MCP ever gains process control. |
| Q-MCP-RESTART | Allow MCP `restart_app` for services already installed via CLI? | Plausible middle ground; decide when v2 starts. |
| Q-LOG-ROTATION | Rotate managed-service logs in the daemon (copy + truncate) or via macOS `newsyslog`? | Daemon-side: no root, portable to Linux. |
| Q-BINARY | Is `sj` a safe binary name (collisions with other popular CLIs)? | Ship both `sj` and `spaghetti-junction` binaries so users can drop `sj` if it collides. |
| Q-LICENSE | Licence. | MIT, matching the author's other projects. Author to confirm when creating the GitHub repo. |
| Q-LINUX-SCOPE | How much Linux in v2: systemd user units, `systemd-resolved` for custom domains, `setcap` for Caddy? | All three; macOS remains primary. |
| Q-PROBE-AUTH | Apps whose `/` requires auth headers or client certs. | 3xx/401/403 already count as healthy; allow a `health.headers` map if needed. |
| Q-IPV6 | Listeners bound only to `::1`. | Probe and proxy to the address actually bound (scanner records it). |
| Q-SYNC | Sharing bookmarks across machines. | Out of scope; the data home can live in a dotfiles repo (generated `.gitignore` excludes state). |

## Author's personal follow-ups (not product work)

- The author intends to use a personal pseudo-TLD for their own install. As of 2026-10-14 it was not in IANA's root
  zone and not in ICANN's 2026-round Reveal Day contention sets (which only cover *contested* strings, so this is weak
  evidence). Check the full applied-for list after **String Confirmation Day, 17 November 2026**. Not blocking: with
  HTTPS and a resolver file, even a later delegation would not break the local setup (see `03-networking.md`).

## Project-setup TODOs

- [ ] Create the public GitHub repository; push this spec.
- [ ] Decide licence (Q-LICENSE) and add `LICENSE`.
- [ ] `package.json` with `name: spaghetti-junction`, `bin: { sj, spaghetti-junction }`, `engines.node`, `files`,
      `publishConfig: { access: public, provenance: true }` (copy Local Review's shape).
- [ ] CI: typecheck, tests, a "no NUL bytes in source" check (Paddock has one after raw NUL bytes once hid source files
      from grep), pack smoke test (Local Review has `smoke:pack`).
- [ ] changesets + release workflow with npm provenance.
- [ ] Consider an `AI-DECLARATION.md` and `SECURITY.md` like Local Review's.
- [ ] README with the pitch ("The front door for everything you vibe-coded on a random port"), a screenshot/GIF, and a
      30-second quick start.
- [ ] Reserve the npm name early (publish a 0.0.x placeholder) if there is any risk of it being taken.
