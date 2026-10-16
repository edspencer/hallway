# website/CLAUDE.md

Astro + Starlight documentation site for Hallway, to be deployed to **https://hallway.edspencer.net** by
**Cloudflare Pages** (not set up yet: see README.md "Deploying"). Its structure deliberately matches Local Review's
docs site (`edspencer/local-review`, `website/`), which itself began as a copy of Paddock's.

**Versions: Astro 7 + Starlight 0.42 (Node >= 22.12)**, the same as Local Review's site, and the lockfile started
as a copy of its lockfile. The Astro 7 notes there apply here too:

- `markdown.processor: unified({ rehypePlugins })` in `astro.config.mjs`, because Astro 7's default Markdown
  processor doesn't run rehype plugins. Mermaid fences go through `src/plugins/rehype-pre-mermaid.mjs` and render
  client-side (`public/mermaid-init.js`, from the CDN). Check diagrams in **both** colour themes.
- `compressHTML: true`, because Astro 7's default glues inline text together.
- `overrides: { "postcss-nested": "^7.0.2" }` in `package.json` (an advisory fix; drop it once
  `@expressive-code/core` depends on postcss-nested 7 itself).
- The build prints two expected warnings: `The collection "i18n" does not exist or is empty` and
  `Entry docs → 404 was not found`. Ignore them.

`npm audit` in `website/` should report 0 vulnerabilities. Check it when you change dependencies.

This package is **standalone**: NOT part of the root `hallway` package. Build it on its own from `website/`. The build
deps are in `dependencies`, not `devDependencies`, so a plain `npm install` under `NODE_ENV=production` still installs
them (that is what Cloudflare's build does).

## Where it differs from Local Review's site, and why

- **No screenshots, no demo video (yet).** The landing page's illustrations are drawn in HTML/CSS from the spec's
  designs (`src/components/landing/Mock.astro`) and every one carries a "Mock-up · planned design" tag. Local Review's
  `rehype-shots` plugin and capture pipeline were left out. The v0 dashboard now exists: switch to real captures the
  way Local Review does.
- **llms.txt is generated here** (`src/llms.ts`, `src/pages/llms.txt.ts`, `src/pages/llms-full.txt.ts`) from the docs
  pages in sidebar order, instead of being committed copies of what the app serves. When the app serves its own
  `/llms.txt`, consider Local Review's arrangement.
- **The sidebar lives in `src/sidebar.mjs`**, so the llms.txt routes can read it too.
- **The brand is a placeholder made here** (`brand/`, `npm run brand`), not copied from a repo-level brand kit.
- **Fonts are self-hosted** from `@fontsource-variable` packages (all OFL) rather than loaded from Google Fonts.
- **A release banner on every docs page** (v0 is out; what the milestone badges mean), by overriding Starlight's
  `Banner` (`src/components/Banner.astro`).

## Content rules

**v0 is released** (Hallway 0.1.0 on npm, macOS and Linux); v1 and v2 are upcoming.

- **Mark features with their milestone**: `<span class="ms ms--v0">v0</span>` (available now; this includes
  `hallway run` and managed services, shipped early from v1), `<span class="ms">v1</span>`,
  `<span class="ms">v2</span>` (styled in `custom.css`). **Never write a v1 or v2 feature as if it has shipped**: say
  "upcoming" or "coming in v1" in the words too. Keep badges **out of headings** (they end up in the anchor slugs):
  put them at the start of the paragraph below.
- **The install command** is `INSTALL_COMMAND` in `src/site.mjs`; `getting-started/installation.md` and
  `quickstart.md` write it out in code blocks. When v1 ships, reword the banner, the roadmap and the badges.
- **The spec is the source of truth** (`../spec.md`, `../docs/`). Every claim should be checkable against it. Where
  the spec leaves something open, say so rather than inventing an answer.
- **Keep it generic**: `example.com`, `myname.internal`, `~/Code/my-app`; no employer, machine or user names.
- **The hallway imagery** (doors, lamplight, door-number plates) belongs in visuals and the odd light touch, never in
  labels a reader has to decode. Narnia/Aslan may appear only in the "Why the name" backstory, never as branding.

Every page needs Starlight frontmatter (`title:`, and a `description:` because llms.txt uses it; quote values with a
colon). Door-number plates and state chips are available as raw HTML: `<span class="plate">4255</span>`,
`<span class="state state--down">■ down</span>` (always colour, shape and word together).

**Links.** Link pages site-relative with the trailing slash (`/reference/cli/`). After a build,
`node scripts/check-links.mjs` checks every internal link and `#fragment` in `dist/` (the `website` job in the root
`ci.yml` runs the build and this check whenever `website/**` changes).

## Sidebar

Maintained **by hand** in `src/sidebar.mjs`. Starlight does NOT auto-discover pages: add new pages there. Never point a
sidebar entry at `/` (the landing page is outside Starlight).

## Landing page

`src/pages/index.astro` is a custom page outside Starlight with its own layout (`LandingLayout.astro`), its own
always-dark styles (`src/styles/landing.css`) and script (`src/scripts/landing.ts`). All its copy is in
`src/components/landing/copy.ts`. Because it is outside Starlight, head tags, fonts and analytics are re-provided by
`LandingLayout.astro`: change a site-wide head tag in `astro.config.mjs` and check whether the layout needs it too.

## Design tokens

All colours and fonts are CSS variables in `src/styles/tokens.css`, imported by both `custom.css` (docs) and
`landing.css`. The identity is the proposed hallway direction (`../docs/05-ui.md` "Visual direction", D23): warm
near-black, lamplight amber, brass door plates. **Amber is not a text colour on light grounds** (about 1.8:1): the
light theme's accent is the deep amber-brown token.

## Analytics and deploy

As Local Review's: PostHog only when `PUBLIC_POSTHOG_KEY` is set at build time (`posthogSnippet()` in `src/site.mjs`,
proxied by `functions/ingest/[[path]].ts`), and Cloudflare Pages with root directory `website`, build command
`npm install && npm run build`, output `dist`. Details in README.md.

## Previewing under a process supervisor

`astro preview` detaches itself when it isn't on a TTY, which a process supervisor can't track (it restarts the
command in a loop). Under a supervisor, serve `dist/` with any static file server instead.
