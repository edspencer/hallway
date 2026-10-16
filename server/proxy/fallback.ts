// generated/fallback.html (docs/03-networking.md, "Dashboard fallback"): the static page Caddy serves when an upstream
// doesn't answer. On the dashboard's host that means the daemon is down, so the page says so, says how to restart it,
// and still lists every app with its link: a dead dashboard still answers "what do I have?". On an app's host it says
// which app isn't answering, and where Caddy looked for it. The daemon rewrites it whenever an app or config.yaml
// changes. It is one self-contained file (Caddy serves it from generated/, with nothing else), styled with the
// dashboard's own tokens (src/theme/tokens.css, D28) inlined.
import fs from 'node:fs';
import path from 'node:path';
import type { HallwayConfig } from '../../shared/api.js';
import { ROOT, WEB_DIST } from '../config.js';
import type { ProxyAppInput } from './caddy.js';
import { appHosts, dialAddress, httpsUrl } from './names.js';

/** The design tokens: the copy Vite puts in the built dashboard (the npm package), else the source (a checkout). */
export const TOKENS_CSS = [path.join(WEB_DIST, 'tokens.css'), path.join(ROOT, 'src', 'theme', 'tokens.css')];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface FallbackInput {
  config: HallwayConfig;
  apps: readonly ProxyAppInput[];
  /** Commands that restart the daemon, best first (`hallway service restart`, then the native one). */
  restart: readonly string[];
  /** The dashboard's direct address, which works whenever the daemon does. */
  directUrl: string;
  now?: Date;
  /** The tokens' CSS; read from src/theme/tokens.css by default. */
  tokens?: string;
}

export function fallbackHtml({ config, apps, restart, directUrl, now = new Date(), tokens }: FallbackInput): string {
  const css = tokens ?? TOKENS_CSS.map(safeRead).find(Boolean) ?? '';
  const sorted = [...apps].sort((a, b) => a.config.name.localeCompare(b.config.name) || a.slug.localeCompare(b.slug));
  const data = {
    dashboard: config.domain.dashboard.toLowerCase(),
    apps: Object.fromEntries(
      sorted.flatMap(({ slug, config: a }) => appHosts(slug, a.proxy.aliases, config.domain.base).map((h) => [h, { slug, name: a.name, dial: dialAddress(a.host, a.port), expected: a.expected, managed: !!a.service }])),
    ),
  };
  const rows = sorted
    .map(({ slug, config: a }) => {
      const url = httpsUrl(`${slug}.${config.domain.base}`, config.proxy.publicPort);
      return `<li><a href="${esc(url)}">${esc(a.name)}</a> <span class="host">${esc(url.replace(/^https:\/\//, ''))}</span> <span class="port">:${a.port}</span></li>`;
    })
    .join('\n      ');
  // inline JSON can't contain `</script>`: `<` is escaped
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Not answering · Hallway</title>
<!-- Written by Hallway's daemon (generated/fallback.html). Caddy serves it when an app, or the daemon, isn't answering. -->
<script>document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';</script>
<style>
${css}
body { margin: 0; background: var(--hw-bg); color: var(--hw-text); font: 15px/1.5 var(--hw-font-ui); }
main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem; }
h1 { font: 600 1.75rem/1.2 var(--hw-font-display); margin: 0 0 .5rem; }
.brand { font: 600 .8rem/1 var(--hw-font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--hw-accent-text); margin-bottom: 1.5rem; }
.why { color: var(--hw-text-muted); margin: 0 0 1.5rem; }
.fix { background: var(--hw-bg-raised); border: 1px solid var(--hw-line); border-radius: var(--hw-radius); padding: 1rem 1.25rem; margin-bottom: 2rem; }
.fix p { margin: 0 0 .5rem; }
code { font: .9em var(--hw-font-mono); background: var(--hw-bg-sunken); border-radius: var(--hw-radius-small); padding: .1em .35em; }
h2 { font: 600 1rem/1.3 var(--hw-font-display); margin: 0 0 .75rem; color: var(--hw-text-muted); }
ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--hw-line); }
li { padding: .55rem 0; border-bottom: 1px solid var(--hw-line); display: flex; gap: .75rem; align-items: baseline; flex-wrap: wrap; }
a { color: var(--hw-accent-text); text-decoration: none; font-weight: 600; }
a:hover, a:focus-visible { text-decoration: underline; }
.host { color: var(--hw-text-muted); }
.port { margin-left: auto; font-family: var(--hw-font-mono); color: var(--hw-text-subtle); }
.empty, footer { color: var(--hw-text-subtle); }
footer { margin-top: 2rem; font-size: .85rem; }
</style>
</head>
<body>
<main>
  <div class="brand">Hallway</div>
  <h1 id="title">This address isn't answering</h1>
  <p class="why" id="why">Caddy couldn't reach what lives here.</p>
  <div class="fix" id="fix">
    <p>Start it again with:</p>
    ${restart.map((c) => `<p><code>${esc(c)}</code></p>`).join('\n    ')}
    <p>Or check what's wrong with <code>hallway doctor</code>.</p>
  </div>
  <h2>Your apps</h2>
  ${sorted.length ? `<ul>\n      ${rows}\n  </ul>` : '<p class="empty">No apps are declared yet.</p>'}
  <footer>This page is static: the daemon wrote it at ${esc(now.toISOString().replace(/\.\d+Z$/, 'Z'))}. When the daemon is running, the dashboard is also at <a href="${esc(directUrl)}">${esc(directUrl.replace(/^https?:\/\//, ''))}</a>.</footer>
</main>
<script>
(function () {
  var d = ${json};
  var h = location.hostname.toLowerCase();
  var t = document.getElementById('title'), w = document.getElementById('why'), f = document.getElementById('fix');
  function code(s) { var c = document.createElement('code'); c.textContent = s; return c; }
  if (h === d.dashboard) {
    t.textContent = "Hallway's daemon isn't running";
    w.textContent = 'The dashboard is served by a small background process, and it isn\\'t answering. Your apps may still be fine: their links are below.';
  } else if (d.apps[h]) {
    var a = d.apps[h];
    t.textContent = a.name + " isn't answering";
    w.textContent = 'Nothing answered at ' + a.dial + (a.expected === 'running' ? ', and it should be running.' : '.');
    f.textContent = '';
    var p = document.createElement('p');
    if (a.managed) { p.append('Hallway manages it; start it with '); p.append(code('hallway start ' + a.slug)); p.append(', and see why it stopped with '); p.append(code('hallway logs ' + a.slug)); p.append('.'); }
    else { p.append('Start it the way you usually do. To have Hallway keep it running, see '); p.append(code('hallway service add ' + a.slug)); p.append('.'); }
    f.append(p);
  } else {
    f.hidden = true;
  }
})();
</script>
</body>
</html>
`;
}

function safeRead(file: string) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
