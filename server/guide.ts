// The agent-facing documents (docs/06-agent-interface.md, "Agent guide"; Local Review's shared/llms.ts):
// - AGENT-GUIDE.md, shipped in the package: `hallway guide`, and GET /agent-guide.md with this daemon's live facts;
// - GET /llms.txt (https://llmstxt.org): an H1, a blockquote summary, the live facts and enough of the guide to
//   register a server, then link lists; GET /llms-full.txt is llms.txt followed by the whole guide;
// - `hallway guide --snippet`: the paragraph for users' agent instruction files, from the guide's own section.
// The guide's file-format reference sits between two markers and is regenerated from the validator's schemas
// (server/store/schema.ts) every time it's rendered, so it can't drift; test/guide.test.ts keeps the committed copy in
// step too (`npm run sync:guide` rewrites it).
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORT, ROOT } from './config.js';
import { referenceMarkdown } from './store/schema.js';

export const AGENT_GUIDE = path.join(ROOT, 'AGENT-GUIDE.md');
export const REF_BEGIN = '<!-- BEGIN file-format reference: generated from server/store/schema.ts (npm run sync:guide) -->';
export const REF_END = '<!-- END file-format reference -->';
const LIVE_MARKER = '<!-- live facts -->';
export const DEFAULT_URL = `http://localhost:${DEFAULT_PORT}`;
export const SNIPPET_SECTION = 'For your agent instruction file';
export const REGISTER_SECTION = 'Registering a server';

/** What the running daemon knows, all of it already on the dashboard. */
export interface LiveFacts {
  version: string;
  home: string;
  mode: string;
  base: string;
  /** Fronted mode: what an app's address looks like (`https://<slug>.localhost`, `http://…` in the No HTTPS tier). */
  appsAt?: string;
  apps: { slug: string; name: string; port: number | null; url: string | null; expected: string | null; error: boolean }[];
  groups: { group: string; title: string; links: number }[];
  /** "Lost at last reboot", when there's a notice (D54). */
  lost?: { bootTime: string; items: { id: string; label: string; port: number; slug: string | null; dir: string | null; branch: string | null; command: string | null; back: boolean }[] } | null;
}

export interface GuideInput {
  /** AGENT-GUIDE.md's text. */
  guide: string;
  /** Where the daemon is: `http://localhost:4255`. */
  url: string;
  /** Only the running daemon's copy has these. */
  live?: LiveFacts;
  /** Without a daemon (`hallway guide`): the data home, so the guide can still say where files go. */
  home?: string;
}

/** AGENT-GUIDE.md with its reference section regenerated. */
export function withReference(guide: string): string {
  const a = guide.indexOf(REF_BEGIN);
  const b = guide.indexOf(REF_END);
  if (a < 0 || b < a) throw new Error(`AGENT-GUIDE.md: missing the file-format reference markers (server/guide.ts)`);
  return `${guide.slice(0, a + REF_BEGIN.length)}\n\n${referenceMarkdown()}\n\n${guide.slice(b)}`;
}

export function readGuide(): string {
  return withReference(fs.readFileSync(AGENT_GUIDE, 'utf8'));
}

/** Split markdown into `## ` sections (outside code fences): heading → body. */
function sections(md: string): Map<string, string> {
  const out = new Map<string, string[]>();
  let current: string[] = [];
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^## (.+)$/.exec(line);
    if (m) out.set(m[1].trim(), (current = []));
    else current.push(line);
  }
  return new Map([...out].map(([k, v]) => [k, v.join('\n').trim()]));
}

/** One `## ` section of the guide, without its heading. Throws if it's missing. */
export function guideSection(guide: string, heading: string): string {
  const body = sections(guide).get(heading);
  if (body === undefined) throw new Error(`AGENT-GUIDE.md: no "## ${heading}" section (server/guide.ts)`);
  return body;
}

/** The snippet for agent instruction files: the blockquote in its section, unquoted. */
export function snippet(guide: string): string {
  const quote = guideSection(guide, SNIPPET_SECTION)
    .split('\n')
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^> ?/, ''));
  if (!quote.length) throw new Error(`AGENT-GUIDE.md: "## ${SNIPPET_SECTION}" has no blockquote (server/guide.ts)`);
  return quote.join('\n').trim() + '\n';
}

const code = (s: string) => '`' + s + '`';

function liveFacts(i: GuideInput, f: LiveFacts): string {
  const apps = f.apps.length
    ? f.apps.map((a) => `  - ${code(a.slug)}: ${a.name}${a.port ? `, port ${a.port}` : ''}${a.expected ? `, expected ${a.expected}` : ''}${a.url ? `, ${a.url}` : ''}${a.error ? ' (its file has an error: see /api/state)' : ''}`).join('\n')
    : '  - none yet';
  const groups = f.groups.length ? f.groups.map((g) => `  - ${code(g.group)}: ${g.title} (${g.links} link${g.links === 1 ? '' : 's'})`).join('\n') : '  - none yet';
  return [
    '**This Hallway, right now:**',
    '',
    `- Served at ${i.url}, version ${f.version}. It listens on 127.0.0.1 only: fetch its URLs with \`curl\` (a web-fetch tool may refuse localhost).`,
    `- Data home: ${code(f.home)}. Apps are ${code(path.join(f.home, 'apps', '<slug>.yaml'))}; bookmark groups are ${code(path.join(f.home, 'bookmarks', '<group>.yaml'))}.`,
    `- Mode: ${f.mode}${f.mode === 'fronted' ? ` (apps at ${f.appsAt ?? `https://<slug>.${f.base}`})` : ' (apps are linked as http://localhost:<port>)'}.`,
    `- Apps (pick a slug that isn't taken):`,
    apps,
    `- Bookmark groups:`,
    groups,
    ...lostFacts(f),
  ].join('\n');
}

/** What the last reboot took down, and how to start each again (the dashboard's banner, for agents). */
function lostFacts(f: LiveFacts): string[] {
  const l = f.lost;
  if (!l?.items.length) return [];
  return [
    `- Lost at the last reboot (the machine booted at ${l.bootTime}; these were running before it and weren't after). Start one again with \`hallway run <slug> --cwd <dir> -- <command>\` (\`--persist\` to keep it across reboots); \`hallway lost dismiss <id>\` clears one:`,
    ...l.items.map(
      (i) =>
        `  - ${code(i.id)}: ${i.label}, port ${i.port}${i.dir ? `, in ${code(i.dir)}${i.branch ? ` @ ${i.branch}` : ''}` : ''}${i.command ? `, ran ${code(i.command)}` : ''}${i.slug ? `, app ${code(i.slug)}` : ''}${i.back ? ' (back: listening again)' : ''}`,
    ),
  ];
}

function offlineFacts(i: GuideInput): string {
  return [
    `**No live data here:** this copy comes from the package, not a running daemon. With Hallway running, ${i.url}/agent-guide.md (or /llms.txt) adds its version, data home, mode and current apps.`,
    i.home ? `The data home on this machine is ${code(i.home)}.` : 'The data home is `~/.hallway` (or `$HALLWAY_HOME`).',
  ].join(' ');
}

/** The default URL becomes this daemon's. */
const localize = (md: string, i: GuideInput) => md.replaceAll(DEFAULT_URL, i.url);

/** The whole guide, with live facts where its marker is (GET /agent-guide.md, `hallway guide`). */
export function agentGuide(i: GuideInput): string {
  const facts = i.live ? liveFacts(i, i.live) : offlineFacts(i);
  const g = localize(i.guide.trimEnd(), i);
  return `${g.includes(LIVE_MARKER) ? g.replace(LIVE_MARKER, facts) : g}\n`;
}

/** GET /llms.txt: the summary, live facts, how to register a server, and links. */
export function llmsTxt(i: GuideInput): string {
  return [
    '# Hallway',
    '',
    `> Hallway (npm: \`hallway\`) is a local-only dashboard of every web server on this machine, served at ${i.url}. It shows each app's health and gives it a stable place to be found. Its configuration is plain YAML in a data home that coding agents read and edit directly; the dashboard updates live. This file tells an agent how to register a server and add bookmarks.`,
    '',
    i.live ? liveFacts(i, i.live) : offlineFacts(i),
    '',
    '**The rules:**',
    '',
    "- **Never change an existing app's `port`.** Apps hardcode their ports; Hallway never reassigns one, and neither should you.",
    '- **Only touch `apps/`, `bookmarks/`, `ignore.yaml` and `config.yaml`.** `state/`, `cache/`, `generated/`, `logs/` and `backups/` are machine-written.',
    '- **Prefer `expected: adhoc`** for a throwaway server, so it shows as stopped (not down) when it is off.',
    "- **Don't delete files.** `DELETE /api/apps/<slug>` moves the file to `backups/removed/` instead.",
    '',
    `**How to register a server** (the "${REGISTER_SECTION}" section of the agent guide):`,
    '',
    localize(guideSection(i.guide, REGISTER_SECTION), i),
    '',
    '## Docs',
    '',
    `- [Agent guide](${i.url}/agent-guide.md): the whole guide: bookmarks, status, the HTTP API, etiquette and the file-format reference. Also \`hallway guide\`.`,
    `- [llms-full.txt](${i.url}/llms-full.txt): this file followed by the whole agent guide`,
    `- [State](${i.url}/api/state): everything the dashboard shows, as JSON`,
    `- MCP: \`${i.url}/mcp\` (Streamable HTTP), or \`hallway mcp\` on stdio: the same operations as typed tools (the "MCP" section of the agent guide)`,
    '',
  ].join('\n');
}

/** GET /llms-full.txt: llms.txt, then the whole guide. */
export function llmsFullTxt(i: GuideInput): string {
  return `${llmsTxt(i)}\n---\n\n${agentGuide(i)}`;
}
