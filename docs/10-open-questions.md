# 10 — Open questions, unknowns and TODOs

Each item has an ID referenced from other docs. When resolved, record the outcome in `09-decisions.md` (or the
relevant doc) and delete it here — or mark it **Resolved** with a one-line answer if the history is useful.

## Things to verify before relying on them

| ID | Question | Why it matters | How to check |
|----|----------|----------------|--------------|
| Q-SAFARI-LOCALHOST | Does Safari resolve `https://app.localhost` typed into the address bar? | D5 assumes `*.localhost` works with no DNS in all major browsers. The macOS system resolver handles it (verified), so Safari probably does. | Fronted mode exists (0.2.0), so this is now a check on a real Mac: run `hallway setup` and type the address into Safari. If it fails, the default must fall back to dnsmasq even for `.localhost`. |
| Q-SECURE-CONTEXT | **Resolved 2026-10-17:** yes. `http://localhost`, `http://app.localhost` and `http://a.b.localhost` are secure contexts in Chromium 156, Chrome 155, Firefox 157 and WebKit 27.2 (Playwright, Linux and macOS runners): `crypto.subtle`, service workers, `getUserMedia` all present; a LAN address is not. WebKit drops `Secure` cookies over plain HTTP even there (`11-research-notes.md`, D65). | | |
| Q-CADDY-RESUME | **Resolved 2026-10-16 (D47):** no `--resume`. An admin push autosaves to `$XDG_CONFIG_HOME/caddy/autosave.json` and `--resume` then ignores `--config`; Caddy starts from `generated/caddy.json` instead, with `persist: false`. | | |
| Q-CADDY-TRUST | **Resolved 2026-10-16 (D47):** Caddy runs as the user, its CA is in the data home, its own trust installation is off, and `hallway setup` installs the root itself (`security add-trusted-cert` / `update-ca-certificates`). The macOS command is unverified on a Mac (CI's macOS job runs it). | | |
| Q-HMR | **Resolved 2026-10-16 (D47) for Vite:** Vite 8.3.4 through Caddy with Host rewritten hot-updates with no reload and no `server.hmr.clientPort`. Astro (Vite underneath) not separately run. | | |
| Q-CADDY-UNPRIVILEGED | **Resolved 2026-10-16 (D47), revised 2026-10-17 (D65):** Caddy runs as the user on loopback 4443/4480 with its admin API on a 0600 Unix socket. 443/80 reach it through launchd's sockets on macOS (no root; the pf redirect, which another tool's `set skip on lo0` could disable, D64, is retired) and an nftables redirect on Linux (System-wide tier). Still unverified on a real Mac: the forwarders across logout/login and a reboot. | | |
| Q-HOOK | **Resolved 2026-10-16 (D51):** Claude Code's `PreToolUse` payload carries the command in `tool_input.command`; the hook denies with `hookSpecificOutput.permissionDecision: "deny"` and exits 0 (`11-research-notes.md`). Other agents' hook formats are unverified. | | |
| Q-NODE-MIN | **Resolved 2026-10-16 (D37):** `node:sqlite` needs no flag from **Node 22.13.0**; 22.0–22.12 can't load it without `--experimental-sqlite` (22.0 not at all). `engines.node` is now `>=22.13` and CI tests 22.13. | | |
| Q-USER-TRUST | **Mostly resolved 2026-10-17 (real Mac):** a root trusted only in the user's domain (`security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db`, no sudo) asked only for the user's Touch ID, and **Safari, Chrome and Apple's curl** then trusted a leaf it signed. Still open: Firefox (`enterprise_roots`), and whether the dialog appears when a LaunchAgent (the daemon) runs the command. | D65's "No admin" tier rests on it. | Firefox: trust the root for the user, load the page with `enterprise_roots` on. The daemon case: run it from a LaunchAgent. |
| Q-LAUNCHCTL | Confirm modern `launchctl bootstrap/bootout/kickstart/print` behaviour and output parsing on the current macOS. | Service management. | **Mostly settled (2026-10-16):** every verb, `print`'s parsing, KeepAlive and appending log files work on CI's `macos-latest` runner (`11-research-notes.md`, "Managed services on real launchd and systemd"). Still open: behaviour across logout/login and reboot, on a real Mac. |

## Design decisions deliberately left open

| ID | Question | Current leaning |
|----|----------|-----------------|
| Q-NO-ADMIN | **Resolved 2026-10-17 (D65, accepted and built):** three tiers (No prompts / No admin / System-wide), launchd's `Sockets` for 443/80 on macOS in every tier with Node forwarders handing them to Caddy (the pf redirect retired; a native helper deferred), user-domain trust for No admin. What's still unverified on a real Mac is listed in D65. | |
| Q-STORE | **Resolved 2026-10-16 (D37):** `node:sqlite`, in `state/health.sqlite`. | |
| Q-DASHBOARD-HOST | **Resolved 2026-10-16 (D47):** `hallway.localhost` (the apex for a custom domain). | |
| Q-VALIDATION | Hand-rolled validation or a small schema library? | **Resolved (D32):** hand-rolled, with the schemas as data in `server/store/schema.ts`; the agent guide's file-format reference is generated from them. |
| Q-BOOKMARK-HEALTH | Health-check remote bookmarks? | Off by default; maybe opt-in per link later. Remote checks leak timing/traffic and often hit auth walls. |
| Q-MCP-AUTH | **Resolved (D52):** no token; `/mcp` is loopback-only with Host and Origin checks, the same trust boundary as the data home. Revisit if MCP ever gains process control. | |
| Q-MCP-RESTART | **Resolved (D53):** no. A restart starts a process, which v2 criterion 2 rules out, and the YAML a restart would run is agent-writable. | |
| Q-LOG-ROTATION | Rotate managed-service logs in the daemon (copy + truncate) or via macOS `newsyslog`? | **Resolved (D43):** daemon-side copy + truncate, keeping only the last `logMaxBytes` so no rotated file exceeds the limit. |
| Q-BINARY | Should a short alias ship alongside the `hallway` binary, and if so which? | **Proposed: `hw`, awaiting the author's call.** For now only `hallway` ships (D27). No Homebrew formula or Debian package installs an `hw` executable; an obscure npm package of that name does declare an `hw` bin (see `11-research-notes.md`). Still to check: stock macOS and common shell-framework aliases. If the alias ships, `hallway` stays primary in every doc and message, and the alias is listed only in `--help` and the CLI reference. If not, ship `hallway` alone. |
| Q-LINUX-SCOPE | How much Linux, and when? | **Resolved by D26 and D47:** Linux from v0 behind a platform abstraction; for fronted mode an nftables redirect (not `setcap`), the system CA store plus the user's NSS database, and custom domains through a `systemd-resolved` drop-in pointing at Hallway's user-level dnsmasq. Resolvers other than systemd-resolved are not supported by `hallway setup` (it says how to point one at dnsmasq). |
| Q-PROBE-AUTH | Apps whose `/` requires auth headers or client certs. | 3xx/401/403 already count as healthy; allow a `health.headers` map if needed. |
| Q-IPV6 | **Resolved 2026-10-18 (D68):** a loopback or wildcard `host:` means either family. The prober, `hallway run` and every port check try 127.0.0.1 and ::1 and record which answered; Caddy dials `localhost:<port>`, which it tries in both families per connection. | |
| Q-VISUAL-IDENTITY | Final sign-off on the hallway identity (D23, `05-ui.md`): logo, display typeface, palette. | The direction is **approved as the working direction** (D28); build against it with every token in `src/theme/tokens.css`. Final logo, display typeface and palette still await the author. |
| Q-SYNC | Sharing bookmarks across machines. | Out of scope; the data home can live in a dotfiles repo (generated `.gitignore` excludes state). |

## Project-setup TODOs

- [x] Create the public GitHub repository and push this spec: https://github.com/edspencer/hallway (renamed from the
      original repository; see D1).
- [x] Decide licence and add `LICENSE`: MIT (D25; resolves Q-LICENSE).
- [x] `package.json` with `name: hallway`, `bin: { hallway }` (D27; plus `hw` if Q-BINARY approves it),
      `engines.node`, `files`, `publishConfig: { access: public, provenance: true }` (Local Review's shape).
- [x] CI: typecheck, tests, build, a "no NUL bytes in source" check (`npm run check:nul`), pack smoke test
      (`npm run smoke:pack`), on Node 22/24 × Linux/macOS, plus a placeholder docs-site job (D30).
- [x] changesets + release workflow with npm provenance and trusted publishing (D29). The first real release,
      `0.1.0`, went out on 2026-10-16, followed by 0.2.0 and 0.3.0 the same day.
- [x] `AI-DECLARATION.md`, `SECURITY.md` and `CONTRIBUTING.md`, adapted from Local Review's.
- [ ] README with the pitch ("The front door for everything you vibe-coded on a random port"), a screenshot/GIF, and a
      30-second quick start. *(Pitch and a development quick start are in; the screenshot/GIF and a user quick start
      wait for v0.)*
- [ ] What's left in `RELEASING.md`, "Maintainer settings" (author only): `npm deprecate hallway@0.0.1` (and
      `0.0.0-stage`); optionally a `CI passed` ruleset and private vulnerability reporting. (Actions may now create
      and approve pull requests: done, as the three version PRs show.)
- [x] Reserve the npm name `hallway` early: the author published the placeholder `hallway@0.0.1` on 2026-10-16 and
      configured trusted publishing (D29, `RELEASING.md`).
- [x] Give the documentation website a short "Why the name" origins page: the original name, why it was renamed,
      and the hallway imagery (D1, D23). Done in `website/src/content/docs/why-the-name.md` (2026-10-16).
