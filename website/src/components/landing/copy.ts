/**
 * Landing-page copy, in one place.
 *
 * Every string the landing page renders lives here rather than being scattered
 * through the components, so the words can be worked on without touching markup.
 * (Same arrangement as Local Review's and Paddock's sites.)
 *
 * Hallway is PRE-RELEASE: it is a specification with an implementation just
 * starting. Every claim here must be checkable against the spec (spec.md and
 * docs/ at the repo root) and must say which milestone it belongs to. Nothing
 * may read as shipped. The illustrations are mock-ups of the planned design,
 * drawn in HTML and CSS (Mock.astro), and are captioned as such.
 */

import { REPO_URL, TAGLINE, INSTALL_COMMAND } from '../../site.mjs';

export { REPO_URL };

export const hero = {
	/** Small line above the H1. */
	eyebrow: 'Pre-release · open source · local-only',
	/** The H1. */
	title: `${TAGLINE}.`,
	lede: 'Hallway keeps a live list of every web server running on your machine: the ones you installed on purpose, the ones a coding agent started and forgot, and the ones nobody remembers starting at all.',
	body: 'It shows them on one calm page, with what each one is, whether it is healthy and how to reach it. Later, it gives each a memorable HTTPS name and keeps the important ones running across reboots.',
};

/** The one command worth pasting, once it exists. */
export const QUICKSTART = {
	id: 'install',
	label: 'Install',
	soon: 'Coming soon',
	blurb: 'Not released yet: the npm name is reserved with an empty placeholder while Hallway is built in the open from a detailed spec. macOS first, Node 22+.',
	command: `${INSTALL_COMMAND} && hallway service install`,
	link: { text: 'What it will look like', href: '/getting-started/quickstart/' },
} as const;

/** The second item in the strip: a link, not a tab (see CommandTabs.astro). */
export const SECONDARY_LINK = {
	label: 'Roadmap',
	href: '/roadmap/',
	title: 'What ships in v0, v1 and v2',
} as const;

/** The hero buttons, repeated in the closing section. */
export const HERO_LINKS = [
	{ text: 'Read the docs', href: '/introduction/', icon: 'docs', primary: true },
	{ text: 'See the roadmap', href: '/roadmap/', icon: 'arrow', primary: false },
	{ text: 'View on GitHub', href: REPO_URL, icon: 'github', primary: false },
] as const;

/** The problem, told once: an anonymised version of what started the project (docs/01-background.md). */
export const STORY = {
	eyebrow: 'The problem',
	title: 'Six servers, two weeks, one reboot.',
	paragraphs: [
		'Coding agents make small web apps nearly free: a dashboard, a slide deck, a log viewer, a little internal tool. Each one runs on some port, started by `npm run dev` in a session that has long since ended.',
		'One developer looked at what was listening on their laptop and found six dev servers on ports [4321], [4455], [4666], [4670], [4671] and [7333], one to two weeks old. Three had command lines like `node dist/index.js` that said nothing at all; they could only be identified by reading each process’s working directory.',
		'Three of them were the same dashboard, running from three git worktrees of one repo. Every worktree asked for port [4666], so two had been pushed onto [4670] and [4671] by hand. Only the branch names told them apart.',
		'Then the machine rebooted. All six died, nothing restarted them, and nobody noticed for two days. By then their working directories were gone, so there was no way to say what had been lost.',
	],
	kicker: 'Hallway is the page that would have known.',
} as const;

/** The value-prop grid. Each carries the milestone it ships in (docs/08-roadmap.md). */
export const VALUE_PROPS = [
	{
		icon: 'radar',
		ms: 'v0',
		title: 'It finds what is running',
		body: 'A scanner looks at what is listening, skips the IDE and tool helpers on high ports, and names each server from its working directory, package.json and git branch. Claim one in a click.',
	},
	{
		icon: 'door',
		ms: 'v0',
		title: 'Every door labelled',
		body: 'One page lists every app with its name, its port on a door-number plate, its health and 24 hours of uptime. Worktree siblings show as repo @ branch, so identical apps stop looking identical.',
	},
	{
		icon: 'moon',
		ms: 'v0',
		title: 'Calm by default',
		body: 'Something you stopped on purpose shows as a closed door, never as red. Only an app you said should be running can be down, and only then does the page (and its tab title) raise the alarm.',
	},
	{
		icon: 'file',
		ms: 'v0',
		title: 'Plain YAML you can edit',
		body: 'One small file per app and per bookmark group, in ~/.hallway. Edit one in your editor, or let an agent do it, and every open dashboard updates within a second.',
	},
	{
		icon: 'lock',
		ms: 'v1',
		title: 'Memorable HTTPS names',
		body: 'Turn on fronted mode and every app gets https://<slug>.localhost with a locally trusted certificate, through Caddy. No DNS server needed; .internal domains are there if you want your own.',
	},
	{
		icon: 'refresh',
		ms: 'v1',
		title: 'Survives the reboot',
		body: 'The apps you care about become native launchd services and come back on their own. Everything else is remembered, so after a restart Hallway lists what was lost and offers to bring it back.',
	},
] as const;

/**
 * The scroll-swap "how it will work" section: each entry is one step and the
 * illustration that goes with it. `mock` names a panel in Mock.astro; they are
 * drawn in HTML/CSS from the spec's designs (docs/05-ui.md), not captured from
 * software, because the software does not exist yet.
 */
export const FEATURES = [
	{
		ms: 'v0',
		title: 'Found running, not yet named',
		body: 'The scanner turns “something has been listening on :4666 for nine days” into a row with a name, a directory, a branch and an age, flagged as orphaned when its session is gone. Claim it and it becomes an app, on the port it already uses. Or ignore it for good.',
		mock: 'observed',
		alt: 'Mock-up of the observed tray: two unnamed servers, each with its port, the directory and branch it runs from, how long it has been up, and Claim and Ignore buttons',
	},
	{
		ms: 'v0',
		title: 'A door for every app',
		body: 'Each app is a door with a number plate: its port. Healthy apps stand ajar with a sliver of lamplight; stopped ones are simply closed; down ones go dark. Every state is also a shape and a word, so the picture is never the only clue.',
		mock: 'doors',
		alt: 'Mock-up of three app cards: a healthy one with a warm edge and a full uptime bar, a stopped one drawn quietly, and a down one marked with a red square and the word down',
	},
	{
		ms: 'v1',
		title: 'Agents start servers properly',
		body: 'Instead of a bare npm run dev, an agent runs hallway run. The server is handed to launchd so it outlives the session, keeps a stable port, and the command prints the URL and exits, so it never hangs a tool call.',
		mock: 'run',
		alt: 'Mock-up of a terminal: hallway run slides -- npx astro dev --port $PORT, followed by the app URL, the log path and a prompt',
	},
	{
		ms: 'v1',
		title: 'Names instead of numbers',
		body: 'In fronted mode, Caddy serves each app at https://<slug>.localhost with a certificate your machine trusts. Adding an app never needs sudo; the one privileged step is a guided hallway setup that prints every command before it runs.',
		mock: 'address',
		alt: 'Mock-up of a browser address bar showing a padlock and https://slides.localhost',
	},
	{
		ms: 'v0',
		title: 'Bookmarks by the front door',
		body: 'The remote things you always forget the URL of, such as admin consoles, BI dashboards and status pages, hang by the door as favicon chips in groups. They are inert: nothing is launched or checked.',
		mock: 'bookmarks',
		alt: 'Mock-up of two bookmark groups, Production and Docs, each a row of small chips with a monogram and a title',
	},
] as const;

/** The "works with your agent" section. */
export const AGENTS = {
	eyebrow: 'Built for agent-spawned servers',
	title: 'Files first, so every agent can help.',
	body: 'Everything Hallway knows lives in small YAML files under ~/.hallway. Any coding agent that can edit a file can register an app or add a bookmark, and the dashboard updates live. No plugin, no API key.',
	points: [
		{
			title: 'One command instead of npm run dev',
			body: '`hallway run <slug> -- <command>` starts the server under launchd, waits for it to listen, prints the URL and exits. Planned for v1.',
		},
		{
			title: 'A guide written for agents',
			body: '`hallway guide` prints the agent guide, with live data, and `hallway guide --snippet` prints two sentences for your `AGENTS.md` or `CLAUDE.md`. Planned for v0.',
		},
		{
			title: 'MCP, without the risk',
			body: 'A v2 MCP server on the same port describes apps and edits bookmarks, through the same write path as everything else. It never starts a process.',
		},
	],
	link: { text: 'Read about agents', href: '/agents/overview/' },
	/** The app file shown in the code card. Illustrative: the format from the spec, not real data. */
	file: 'apps/slides.yaml',
	sample: `name: Slides
description: Quarterly review deck
port: 4321                  # never changed by Hallway
expected: adhoc             # up sometimes; off is fine

health:
  path: /

project:
  dir: ~/Code/slides

tags: [decks]`,
} as const;
