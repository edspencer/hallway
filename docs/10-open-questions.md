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
| Q-HOOK | Current Claude Code (and other agents') pre-tool-use hook payload format and blocking convention. | For `hallway hook check-command`. | Agent docs at implementation time. |
| Q-NODE-MIN | Minimum Node version for `node:sqlite` without flags. Verified working on Node 24.15; Node 22 behaviour unverified. | Engines field and storage choice (Q-STORE). | Test on the oldest supported Node 22.x. |
| Q-LAUNCHCTL | Confirm modern `launchctl bootstrap/bootout/kickstart/print` behaviour and output parsing on the current macOS. | Service management. | Experiment. |

## Design decisions deliberately left open

| ID | Question | Current leaning |
|----|----------|-----------------|
| Q-STORE | Health samples/rollups in `node:sqlite` or JSONL? | `node:sqlite` if Q-NODE-MIN allows: rollups and pruning are trivial in SQL, and no dependency. JSONL day-files otherwise. |
| Q-DASHBOARD-HOST | Default dashboard hostname in `localhost` mode: `hallway.localhost` (current spec), a shorter `hall.localhost`, or bare `localhost`? | `hallway.localhost`: it matches the product and binary name. Bare `localhost` on :443 may collide with other tools. Whichever is chosen is a reserved app slug. |
| Q-VALIDATION | Hand-rolled validation or a small schema library? | Hand-rolled (Local Review style) unless the schema grows; the agent-guide file reference should be generated from whatever is chosen. |
| Q-BOOKMARK-HEALTH | Health-check remote bookmarks? | Off by default; maybe opt-in per link later. Remote checks leak timing/traffic and often hit auth walls. |
| Q-MCP-AUTH | Should `/mcp` require a token? | No for v2 (same trust boundary as the data home). Revisit if MCP ever gains process control. |
| Q-MCP-RESTART | Allow MCP `restart_app` for services already installed via CLI? | Plausible middle ground; decide when v2 starts. |
| Q-LOG-ROTATION | Rotate managed-service logs in the daemon (copy + truncate) or via macOS `newsyslog`? | Daemon-side: no root, portable to Linux. |
| Q-BINARY | Should a short alias ship alongside the `hallway` binary, and if so which? | **Proposed: `hw`, awaiting the author's call.** No Homebrew formula or Debian package installs an `hw` executable; an obscure npm package of that name does declare an `hw` bin (see `11-research-notes.md`). Still to check: stock macOS and common shell-framework aliases. If the alias ships, `hallway` stays primary in every doc and message, and the alias is listed only in `--help` and the CLI reference. If not, ship `hallway` alone. |
| Q-LICENSE | Licence. | MIT, matching the author's other projects. Author to confirm when creating the GitHub repo. |
| Q-LINUX-SCOPE | How much Linux in v2: systemd user units, `systemd-resolved` for custom domains, `setcap` for Caddy? | All three; macOS remains primary. |
| Q-PROBE-AUTH | Apps whose `/` requires auth headers or client certs. | 3xx/401/403 already count as healthy; allow a `health.headers` map if needed. |
| Q-IPV6 | Listeners bound only to `::1`. | Probe and proxy to the address actually bound (scanner records it). |
| Q-VISUAL-IDENTITY | Approve, amend or replace the proposed hallway identity (D23, `05-ui.md`)? | **Awaiting the author.** Prototype against it; don't finalise logo, display typeface or palette until approved. |
| Q-SYNC | Sharing bookmarks across machines. | Out of scope; the data home can live in a dotfiles repo (generated `.gitignore` excludes state). |

## Project-setup TODOs

- [x] Create the public GitHub repository and push this spec: https://github.com/edspencer/hallway (renamed from the
      original repository; see D1).
- [ ] Decide licence (Q-LICENSE) and add `LICENSE`.
- [ ] `package.json` with `name: hallway`, `bin: { hallway }` (plus `hw` if Q-BINARY approves it), `engines.node`,
      `files`, `publishConfig: { access: public, provenance: true }` (copy Local Review's shape).
- [ ] CI: typecheck, tests, a "no NUL bytes in source" check (Paddock has one after raw NUL bytes once hid source files
      from grep), pack smoke test (Local Review has `smoke:pack`).
- [ ] changesets + release workflow with npm provenance.
- [ ] Consider an `AI-DECLARATION.md` and `SECURITY.md` like Local Review's.
- [ ] README with the pitch ("The front door for everything you vibe-coded on a random port"), a screenshot/GIF, and a
      30-second quick start.
- [ ] Reserve the npm name `hallway` early (publish a 0.0.x placeholder). The author is doing this; it was still
      unpublished on 2026-10-16.
- [ ] When the documentation website exists (`08-roadmap.md`, "Later"), give it a short "Why the name" origins page:
      the original name, why it was renamed, and the hallway imagery (D1, D23).
