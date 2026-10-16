// A small reader for ignore.yaml, so the scanner can honour it before the YAML store (server/store/) exists. It
// understands exactly the shape the spec gives (docs/02-architecture.md, "ignore.yaml"): three top-level lists, in
// flow (`[631, 5000]`) or block (`- rapportd`) style, with comments. Swap it for the store's parsed copy once there is
// one; anything it can't read is treated as "ignore nothing" rather than an error.
import fs from 'node:fs';
import os from 'node:os';
import { expandHome } from '../config.js';
import { EMPTY_IGNORE, type IgnoreRules } from './filter.js';

const unquote = (s: string) => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

/** Drop a `# comment` that isn't inside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function parseIgnoreYaml(text: string, home = os.homedir()): IgnoreRules {
  const lists: Record<string, string[]> = { ports: [], processes: [], dirs: [] };
  let current: string | null = null;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const key = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (key) {
      current = key[1] in lists ? key[1] : null;
      const rest = key[2].trim();
      if (current && rest.startsWith('[') && rest.endsWith(']'))
        lists[current].push(...rest.slice(1, -1).split(',').map(unquote).filter(Boolean));
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && current) lists[current].push(unquote(item[1]));
  }
  return {
    ports: lists.ports.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 65535),
    processes: lists.processes,
    dirs: lists.dirs.map((d) => expandHome(d, home)),
  };
}

export function readIgnoreFile(file: string): IgnoreRules {
  try {
    return parseIgnoreYaml(fs.readFileSync(file, 'utf8'));
  } catch {
    return EMPTY_IGNORE;
  }
}
