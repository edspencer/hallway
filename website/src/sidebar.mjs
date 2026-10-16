// @ts-check
/**
 * The docs sidebar, maintained BY HAND: Starlight does not auto-discover pages, so a new page must be added here.
 *
 * It lives in its own module because two things read it: astro.config.mjs (the sidebar itself) and
 * src/llms.ts (the order of pages in /llms.txt and /llms-full.txt), so the two can't disagree.
 *
 * Never point an entry at `/`: that is the landing page, which renders outside Starlight with no sidebar and no
 * way back.
 *
 * @type {any[]}
 */
export const SIDEBAR = [
	{
		label: 'Getting Started',
		collapsed: false,
		items: [
			// NOT `link: '/'`: `/` is the marketing landing page, which renders
			// outside Starlight with no sidebar and no way back.
			{ label: 'Introduction', slug: 'introduction' },
			{ label: 'Installation', slug: 'getting-started/installation', badge: { text: 'soon', variant: 'caution' } },
			{ label: 'Quickstart', slug: 'getting-started/quickstart' },
		],
	},
	{
		label: 'Concepts',
		collapsed: false,
		items: [
			{ label: 'Apps: declared, discovered, observed', slug: 'concepts/apps' },
			{ label: 'Health states', slug: 'concepts/health' },
			{ label: 'Direct and fronted mode', slug: 'concepts/modes' },
			{ label: 'Services and reboots', slug: 'concepts/services' },
			{ label: 'Bookmarks', slug: 'concepts/bookmarks' },
			{ label: 'The dashboard', slug: 'concepts/dashboard' },
		],
	},
	{
		label: 'Networking',
		collapsed: false,
		items: [
			{ label: 'Fronted mode and HTTPS', slug: 'networking/fronted-mode' },
			{ label: 'Custom domains', slug: 'networking/custom-domains' },
			{ label: 'Setup, teardown and doctor', slug: 'networking/setup-and-doctor' },
		],
	},
	{
		label: 'Working with agents',
		collapsed: false,
		items: [
			{ label: 'Files first', slug: 'agents/overview' },
			{ label: 'hallway run', slug: 'agents/hallway-run' },
			{ label: 'Agent guide and llms.txt', slug: 'agents/agent-guide' },
			{ label: 'MCP server', slug: 'agents/mcp' },
		],
	},
	{
		label: 'Reference',
		collapsed: true,
		items: [
			{ label: 'CLI', slug: 'reference/cli' },
			{ label: 'config.yaml', slug: 'reference/config-yaml' },
			{ label: 'apps/<slug>.yaml', slug: 'reference/app-yaml' },
			{ label: 'Bookmarks and ignore files', slug: 'reference/bookmarks-yaml' },
			{ label: 'The data home', slug: 'reference/data-home' },
			{ label: 'HTTP API', slug: 'reference/http-api' },
			{ label: 'Environment variables', slug: 'reference/environment' },
		],
	},
	{
		label: 'Guarantees & security',
		collapsed: false,
		items: [
			{ label: 'No root in the daemon', slug: 'guarantees/no-root' },
			{ label: 'Your ports stay put', slug: 'guarantees/ports' },
			{ label: 'Localhost security', slug: 'guarantees/localhost-security' },
		],
	},
	{
		label: 'Project',
		collapsed: false,
		items: [
			{ label: 'Roadmap', slug: 'roadmap' },
			{ label: 'Why the name', slug: 'why-the-name' },
			{ label: 'Contributing', slug: 'contributing' },
		],
	},
];
