# Hallway documentation site

The [Astro](https://astro.build) 7 + [Starlight](https://starlight.astro.build) 0.42 documentation site for Hallway,
to be served at **https://hallway.edspencer.net**. It needs Node 22.12 or later.

It is a copy of [Local Review's docs site](https://github.com/edspencer/local-review/tree/main/website) (same stack,
structure and deployment), with Hallway's content and the proposed hallway visual identity. See
[CLAUDE.md](CLAUDE.md) for where it differs from Local Review's and why.

A standalone package: it is not part of the root `hallway` package, so it never affects the app's build, tests or npm
tarball.

## Develop

```bash
cd website
npm install
npm run dev                         # local dev server
npm run build && npm run preview    # build + preview the built site
npm run check-links                 # after a build: every internal link and #fragment resolves
```

## Structure

- `src/pages/index.astro` and `src/components/landing/`: the marketing landing page at `/` (outside Starlight). Its
  copy is all in `src/components/landing/copy.ts`; its illustrations are real captures of the dashboard on staged demo data
  (`Shot.astro`, `src/assets/shots/`; see "Screenshots" below), and HTML/CSS mock-ups (`Mock.astro`) for the two a
  dashboard capture can't show (a terminal and an address bar). Each is tagged as which it is.
- `src/content/docs/`: the documentation pages (`.md` / `.mdx`, Starlight frontmatter).
- `src/sidebar.mjs`: the hand-maintained sidebar (read by `astro.config.mjs` and by the llms.txt routes).
- `astro.config.mjs`: site config.
- `src/site.mjs`: site constants (URL, repo, tagline, the default port, the install command) and the analytics
  snippet.
- `src/styles/tokens.css`: **every colour and font**, in one place. To try a different palette or typeface, edit only
  this file.
- `src/components/Banner.astro`: the banner on every docs page (what has shipped; what the v0 / v1 / v2 badges mean).
- `src/pages/llms.txt.ts`, `src/pages/llms-full.txt.ts`, `src/pages/[...slug].md.ts`: `/llms.txt`, `/llms-full.txt`
  and every page as Markdown, for coding agents, generated from the pages at build time.
- `brand/`: the hand-authored placeholder mark and social card; `public/`, `src/assets/`: their rendered copies.
- `functions/ingest/[[path]].ts`: the Cloudflare Pages Function that proxies analytics (idle unless analytics is on).

`npm run build` writes the static site to `dist/`, including the Pagefind search index and the sitemap.

## Screenshots

`src/assets/shots/` holds real captures of the dashboard (and `../docs/media/dashboard.png`, the root README's), all
taken from a built Hallway 0.3.0 with staged data, never from anyone's real machine:

- a throwaway `HOME` and `HALLWAY_HOME`, with `dashboard.title: my-laptop`;
- demo apps served by `python3 -m http.server` from `~/Code/<name>` directories with generic names (one git repo
  with a second worktree, for `repo @ branch`), two declared apps deliberately not running (one `down`, one
  `stopped`), and `example.com` bookmarks;
- every other listener on the capturing machine in `ignore.yaml` by port, so the observed tray shows only the demo;
- `hallway thumbs enable` for the screenshots on the doors, and an uptime history seeded through `UptimeStore.add`
  (90 days of five-minute samples) so the bars and the 90-day view aren't empty;
- for "Lost at last reboot", a simulated reboot: the daemon stopped, three demo servers killed, `state/boot.json`'s
  boot time and every `lastSeen` in `state/observed.json` moved before the machine's boot time, the daemon started.

Captured with Playwright at 2× (`deviceScaleFactor: 2`) in the dark theme (the landing page is always dark). Check
every pixel for host names, paths and user names before committing one: the repository is public.

## Brand assets (placeholder)

The door mark and social card are **placeholders** for the proposed hallway identity (D23 in
`docs/09-decisions.md`), which is the working direction but not final branding. They are drawn by hand in
`brand/mark.svg` and `brand/og-image.svg`; `npm run brand` renders the favicons, Apple touch icon and social card from
them with sharp, and the outputs are committed:

| From `brand/` | To | Used as |
| --- | --- | --- |
| `mark.svg` | `public/favicon.svg`, `src/assets/mark.svg` | favicon; the docs header and landing nav logo |
| `mark.svg` | `public/favicon.ico` (16/32/48), `public/apple-touch-icon.png` (180) | icon fallbacks |
| `og-image.svg` | `public/og-image.png` (1200×630) | `og:image` / `twitter:image` |

The social card's text is set in whatever fonts the rendering machine has, so look at the PNG after re-rendering.
When Hallway gets a real brand kit at the repo root (as Local Review has), replace this with a copy step like Local
Review's `sync-brand`.

Fonts are all OFL-licensed and self-hosted from `@fontsource-variable` packages: Fraunces (headings, nameplates),
Inter (text) and JetBrains Mono (door numbers, code).

## Deploying

Like Local Review's site, this is meant to be built and served by **Cloudflare Pages** straight from the GitHub repo
(git integration, no deploy Action). **Nothing has been set up yet.** To deploy it, Ed needs to:

1. **Create the Pages project.** Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
   `edspencer/hallway`, with:

   | Setting | Value |
   | --- | --- |
   | Framework preset | Astro (or None) |
   | Production branch | `main` |
   | Root directory | `website` |
   | Build command | `npm install && npm run build` |
   | Build output directory | `dist` |
   | Node version | 22, from `website/.node-version` (no setting needed) |

2. **Add the custom domain** `hallway.edspencer.net` in the Pages project → Custom domains. If `edspencer.net`'s DNS
   is on Cloudflare, that creates the CNAME itself; otherwise add a CNAME from `hallway` to `<project>.pages.dev` at
   the DNS host. (Cloudflare Pages has no CNAME *file*: the domain lives in the project settings, as for Local
   Review.)
3. Optionally, set `PUBLIC_POSTHOG_KEY` (below) and redeploy.

Every PR that touches the repo then gets a preview deployment. Until then (and after), the `website` job in the
root `.github/workflows/ci.yml` builds the site and checks its links whenever `website/**` changes, as Local
Review's CI does.

## Analytics (PostHog, off until you set one variable)

PostHog loads **only if `PUBLIC_POSTHOG_KEY` is set when the site is built**. No key is committed, and with it unset
no analytics code is emitted on any page. To turn it on, set it in Cloudflare Pages → the project → **Settings →
Variables and Secrets** as a plain-text variable (a public, publishable `phc_…` key), then redeploy.

Requests go to `/ingest` on the site's own domain and `functions/ingest/[[path]].ts` forwards them to PostHog's
**US** cloud. For the EU cloud, change the two hosts in that function and `ui_host` in `src/site.mjs` together.
`npm run preview` and `npm run dev` don't run the Pages Function, so `/ingest` 404s locally; that is expected.
