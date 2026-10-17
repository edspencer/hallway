#!/usr/bin/env node
// Generates src/lib/brands.data.ts from the simple-icons devDependency (D66): a curated subset of self-hosted and
// developer-tool brands, picked because they're commonly run with no HTML favicon of their own (Ollama's server
// answers "Ollama is running"; most databases and message queues answer nothing a browser would show an icon for).
// Bundling all of simple-icons would add ~16 MB unpacked for ~3500 brands nobody runs locally (D66), so this script
// extracts only the title, hex and SVG path for CURATED's slugs and writes them as a plain literal: no simple-icons
// import at runtime, so it costs nothing in the published package.
//
// Run after editing CURATED below: `node scripts/brand-icons.mjs`. Keywords are matched as whole tokens against a
// process name, command line, supervisor label or app name (src/lib/brands.ts) — never generic runtime or language
// names (`node`, `python`, `http`), which would false-match almost everything.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'src', 'lib', 'brands.data.ts');

/** slug: the simple-icons id. keywords: exact, lower-case tokens (executable name, supervisor label, command words,
 * app name/slug). ports: well-known defaults, included only where no other common tool shares the port. */
const CURATED = [
  { slug: 'ollama', keywords: ['ollama'], ports: [11434] },
  { slug: 'postgresql', keywords: ['postgres', 'postgresql'], ports: [5432] },
  { slug: 'mysql', keywords: ['mysql', 'mysqld'], ports: [3306] },
  { slug: 'mariadb', keywords: ['mariadb', 'mariadbd'], ports: [] },
  { slug: 'mongodb', keywords: ['mongod', 'mongodb', 'mongo'], ports: [27017] },
  { slug: 'redis', keywords: ['redis', 'redis-server'], ports: [6379] },
  { slug: 'sqlite', keywords: ['sqlite', 'sqlite3'], ports: [] },
  { slug: 'grafana', keywords: ['grafana', 'grafana-server'], ports: [] },
  { slug: 'prometheus', keywords: ['prometheus'], ports: [9090] },
  { slug: 'jupyter', keywords: ['jupyter', 'jupyterlab', 'jupyter-lab', 'jupyter-notebook'], ports: [8888] },
  { slug: 'rabbitmq', keywords: ['rabbitmq', 'rabbitmq-server'], ports: [5672] },
  { slug: 'elasticsearch', keywords: ['elasticsearch'], ports: [] },
  { slug: 'kibana', keywords: ['kibana'], ports: [5601] },
  { slug: 'influxdb', keywords: ['influxd', 'influxdb'], ports: [8086] },
  { slug: 'nginx', keywords: ['nginx'], ports: [] },
  { slug: 'docker', keywords: ['dockerd'], ports: [] },
  { slug: 'n8n', keywords: ['n8n'], ports: [5678] },
  { slug: 'supabase', keywords: ['supabase'], ports: [] },
  { slug: 'minio', keywords: ['minio'], ports: [] },
  { slug: 'portainer', keywords: ['portainer'], ports: [] },
  { slug: 'gitea', keywords: ['gitea'], ports: [] },
  { slug: 'jenkins', keywords: ['jenkins'], ports: [] },
  { slug: 'wordpress', keywords: ['wordpress', 'wp-cli'], ports: [] },
  { slug: 'ghost', keywords: ['ghost'], ports: [2368] },
  { slug: 'consul', keywords: ['consul'], ports: [8500] },
  { slug: 'traefikproxy', keywords: ['traefik'], ports: [] },
  { slug: 'caddy', keywords: ['caddy'], ports: [] },
  { slug: 'apachecouchdb', keywords: ['couchdb'], ports: [5984] },
  { slug: 'neo4j', keywords: ['neo4j'], ports: [7474] },
  { slug: 'apachekafka', keywords: ['kafka'], ports: [9092] },
  { slug: 'keycloak', keywords: ['keycloak'], ports: [] },
  { slug: 'nextcloud', keywords: ['nextcloud'], ports: [] },
  { slug: 'homeassistant', keywords: ['homeassistant', 'hass'], ports: [8123] },
  { slug: 'plex', keywords: ['plex', 'plexmediaserver'], ports: [32400] },
  { slug: 'jellyfin', keywords: ['jellyfin'], ports: [8096] },
  { slug: 'apacheairflow', keywords: ['airflow'], ports: [] },
  { slug: 'metabase', keywords: ['metabase'], ports: [] },
  { slug: 'apachesuperset', keywords: ['superset'], ports: [] },
  { slug: 'airbyte', keywords: ['airbyte'], ports: [] },
  { slug: 'meilisearch', keywords: ['meilisearch', 'meili'], ports: [7700] },
  { slug: 'opensearch', keywords: ['opensearch'], ports: [] },
  { slug: 'uptimekuma', keywords: ['uptime-kuma', 'uptimekuma'], ports: [] },
  { slug: 'qdrant', keywords: ['qdrant'], ports: [6333] },
  { slug: 'temporal', keywords: ['temporal', 'temporalite', 'temporal-server'], ports: [7233] },
  { slug: 'logstash', keywords: ['logstash'], ports: [] },
  { slug: 'vault', keywords: ['vault'], ports: [8200] },
  { slug: 'milvus', keywords: ['milvus'], ports: [19530] },
];

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'simple-icons', 'data', 'simple-icons.json'), 'utf8'));

const seenPorts = new Map();
const entries = CURATED.map(({ slug, keywords, ports }) => {
  const m = meta.find((i) => i.slug === slug);
  if (!m) throw new Error(`simple-icons has no slug "${slug}" (renamed upstream? fix scripts/brand-icons.mjs)`);
  const svg = fs.readFileSync(path.join(ROOT, 'node_modules', 'simple-icons', 'icons', `${slug}.svg`), 'utf8');
  const paths = [...svg.matchAll(/<path\s[^>]*\bd="([^"]+)"/g)].map((x) => x[1]);
  if (!paths.length) throw new Error(`${slug}.svg has no <path d>`);
  for (const p of ports) {
    const other = seenPorts.get(p);
    if (other) throw new Error(`port ${p} is claimed by both ${other} and ${slug}: drop it from one (ambiguous ports are worse than no hint)`);
    seenPorts.set(p, slug);
  }
  return { slug, title: m.title, hex: `#${m.hex.toLowerCase()}`, path: paths.join(' '), keywords, ports };
});

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const arr = (xs) => `[${xs.map((x) => `'${esc(x)}'`).join(', ')}]`;
const lines = entries.map((e) => `  { slug: '${e.slug}', title: '${esc(e.title)}', hex: '${e.hex}', path: '${esc(e.path)}', keywords: ${arr(e.keywords)}, ports: ${JSON.stringify(e.ports)} },`);

const out = `// GENERATED by scripts/brand-icons.mjs from the simple-icons devDependency (CC0; see its DISCLAIMER.md for
// brands' own trademarks) — do not hand-edit. Edit CURATED there and re-run \`node scripts/brand-icons.mjs\`.
// A curated subset (D66): simple-icons itself is ~16 MB unpacked for ~3500 brands, almost none of which anyone runs
// on a dev machine, so only these are vendored, with no simple-icons import left at run time.
import type { BrandEntry } from './brands.js';

export const BRAND_DATA: BrandEntry[] = [
${lines.join('\n')}
];
`;

fs.writeFileSync(OUT, out);
console.log(`wrote ${entries.length} brand icons to ${path.relative(ROOT, OUT)}`);
