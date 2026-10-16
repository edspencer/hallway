// Creating the data home's layout (docs/02-architecture.md, "Data home") on first run. Idempotent, and it never
// replaces a file that exists: a user's config.yaml, ignore.yaml or .gitignore is theirs.
import fs from 'node:fs';
import path from 'node:path';
import { dataPaths } from '../config.js';
import { atomicWrite, ExistsError } from './safefs.js';
import { CONFIG_SCHEMA, type Field } from './schema.js';

/** The machine-written directories: in the generated .gitignore, so the data home can be a git repository. */
export const MACHINE_DIRS = ['state', 'cache', 'generated', 'logs', 'backups'] as const;

export const GITIGNORE = `# Written by Hallway. The data home can be a git repository: these directories are machine-written and
# regenerable (state, caches, logs, backups), so they stay out of it. Edit freely; Hallway won't rewrite this file.
${MACHINE_DIRS.map((d) => `/${d}/`).join('\n')}
.*.tmp-*
`;

function commented(f: Field, indent: string, out: string[]) {
  if (f.t !== 'object') return;
  for (const [k, sub] of Object.entries(f.fields)) {
    if (k === 'version') continue;
    const doc = sub.doc.replace(/`/g, '');
    if (sub.t === 'object') {
      out.push(`# ${indent}${k}:${indent ? '' : ` ${' '.repeat(Math.max(1, 30 - indent.length - k.length))}# ${doc}`}`);
      commented(sub, indent + '  ', out);
      continue;
    }
    const d = 'default' in sub ? sub.default : undefined;
    const value = d === undefined ? '' : d === null ? 'null' : Array.isArray(d) ? `[${d.join(', ')}]` : String(d);
    const line = `${indent}${k}: ${value}`.trimEnd();
    out.push(`# ${line}${' '.repeat(Math.max(1, 32 - line.length))}# ${doc}${sub.defaultDoc && d == null ? ` Default: ${sub.defaultDoc.replace(/`/g, '')}.` : ''}`);
  }
}

/** A new config.yaml: `version: 1`, then every setting commented out at its default (generated from the schema). */
export function configTemplate(): string {
  const out = [
    '# Hallway settings. Every key is optional: the commented values are the defaults; uncomment one to change it.',
    '# Hallway reloads this file when it changes. The full reference: `hallway guide`, or /agent-guide.md on the daemon.',
    'version: 1',
    '',
  ];
  commented(CONFIG_SCHEMA, '', out);
  return out.join('\n') + '\n';
}

export const IGNORE_TEMPLATE = `# Listeners the port scanner should never show (the dashboard's "Ignore" adds to these).
ports: []          # e.g. [631, 8080]
processes: []      # process names, e.g. [rapportd, ControlCenter]
dirs: []           # working directories, e.g. [~/Code/scratch]
`;

/** Create the data home's directories and starter files, where missing. Returns the paths it created. */
export function initDataHome(home: string): string[] {
  const p = dataPaths(home);
  const created: string[] = [];
  for (const dir of [p.home, p.apps, p.bookmarks, p.state, p.cache, p.generated, p.logs, p.backups]) {
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
  }
  const files: [string, () => string][] = [
    [path.join(home, '.gitignore'), () => GITIGNORE],
    [p.config, configTemplate],
    [p.ignore, () => IGNORE_TEMPLATE],
  ];
  for (const [file, text] of files) {
    if (fs.existsSync(file)) continue;
    try {
      atomicWrite(file, text(), { createOnly: true });
      created.push(file);
    } catch (e) {
      if (!(e instanceof ExistsError)) throw e; // someone else made it meanwhile: theirs wins
    }
  }
  return created;
}
