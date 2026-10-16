// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import rehypePreMermaid from './src/plugins/rehype-pre-mermaid.mjs';
import { SITE_URL, REPO_URL, TITLE, TAGLINE, posthogSnippet } from './src/site.mjs';
import { SIDEBAR } from './src/sidebar.mjs';

// PUBLIC_POSTHOG_KEY comes from the build environment (Cloudflare Pages
// variables) or a local .env. Unset — the default — means no analytics at all.
// See src/site.mjs and website/README.md.
const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), 'PUBLIC_');
const posthog = posthogSnippet(env.PUBLIC_POSTHOG_KEY);

// https://astro.build/config
export default defineConfig({
	site: SITE_URL,
	// Astro 7's default, 'jsx', strips whitespace between elements, which glues inline
	// text together ("Edit pagePrevious…"). `true` keeps Astro 5/6's HTML-aware rules.
	compressHTML: true,
	vite: {
		plugins: [tailwindcss()],
	},
	markdown: {
		// Astro 7 renders Markdown with Sätteri by default, which doesn't run rehype
		// plugins; the unified (remark/rehype) processor does. Mermaid code fences are
		// pre-processed here and rendered client-side (see head script).
		processor: unified({ rehypePlugins: [rehypePreMermaid] }),
	},
	integrations: [
		sitemap(),
		starlight({
			title: TITLE,
			description: TAGLINE,
			// Fonts (all OFL, self-hosted) first, then the tokens they and everything else use.
			customCss: [
				'@fontsource-variable/inter',
				'@fontsource-variable/fraunces',
				'@fontsource-variable/jetbrains-mono',
				'./src/styles/tailwind.css',
				'./src/styles/custom.css',
			],
			// A PLACEHOLDER mark (brand/mark.svg, copied by `npm run brand`), next to the
			// title set in the display face (custom.css). Not final branding.
			logo: {
				src: './src/assets/mark.svg',
				alt: '',
			},
			favicon: '/favicon.svg',
			// Every page carries a pre-release banner (src/components/Banner.astro).
			components: {
				Banner: './src/components/Banner.astro',
			},
			// Each page's <head> links its Markdown copy and /llms.txt, for agents (src/routeData.ts).
			routeMiddleware: './src/routeData.ts',
			head: [
				// .ico fallback for the browsers and crawlers that ignore SVG icons.
				{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
				{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
				// Mermaid: themed from Starlight, and kept legible rather than scaled
				// down to fit. Lives in public/mermaid-init.js (copied from Paddock's site).
				{ tag: 'script', attrs: { type: 'module', src: '/mermaid-init.js' } },
				// PostHog, only when PUBLIC_POSTHOG_KEY is set at build time. The landing
				// page (outside Starlight) emits the same snippet from the same helper.
				...(posthog ? [{ tag: /** @type {const} */ ('script'), content: posthog }] : []),
				// Social-share image. Starlight already emits per-page og:title,
				// og:description, og:url and twitter:card=summary_large_image, and a user
				// `head` entry OVERRIDES those, so we must not restate them here. The one
				// thing Starlight has no default for is the image.
				{ tag: 'meta', attrs: { property: 'og:image', content: `${SITE_URL}/og-image.png` } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { property: 'og:image:alt', content: `${TITLE}: ${TAGLINE.toLowerCase()}` } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: `${SITE_URL}/og-image.png` } },
			],
			social: [{ icon: 'github', label: 'GitHub', href: REPO_URL }],
			editLink: {
				baseUrl: `${REPO_URL}/edit/main/website/`,
			},
			// Hand-maintained in src/sidebar.mjs: Starlight does NOT auto-discover pages.
			sidebar: SIDEBAR,
		}),
	],
});
