// The schemas of the human-editable files (docs/02-architecture.md, "File formats"), as data. One description per
// file drives three things, so they can't drift apart: validation, the defaults filled in on read, and the file-format
// reference in AGENT-GUIDE.md (`referenceMarkdown`). Hand-rolled rather than a schema library (Q-VALIDATION's
// leaning, as Local Review does): the files are small and the rules few.
import type { AppConfig, BookmarkGroupConfig, HallwayConfig, IgnoreConfig } from '../../shared/api.js';

/** A path into a parsed file: keys and list indexes. */
export type KeyPath = (string | number)[];

export interface Issue {
  severity: 'error' | 'warning';
  key: KeyPath;
  message: string;
  /** Point at the key itself rather than its value (unknown keys). */
  atKey?: boolean;
}

interface Base {
  /** One line for the reference. */
  doc: string;
  /** Missing (or null) is an error. */
  required?: boolean;
  /** Null is a meaningful value (kept as null rather than replaced by the default). */
  nullable?: boolean;
  /** For the reference, when the default isn't a literal (`the slug`). */
  defaultDoc?: string;
  /** Extra rule, given the normalised value: an error message, or null. */
  check?: (v: any) => string | null;
}
export type Field =
  | (Base & { t: 'string'; default?: string | null; pattern?: RegExp; patternDoc?: string })
  | (Base & { t: 'int'; default?: number | null; min?: number; max?: number })
  | (Base & { t: 'bool'; default?: boolean })
  | (Base & { t: 'enum'; values: readonly string[]; default?: string })
  | (Base & { t: 'list'; of: Field; default?: unknown[]; minItems?: number; maxItems?: number; unique?: boolean })
  | (Base & { t: 'object'; fields: Record<string, Field>; /** absent → null rather than an object of defaults */ optional?: boolean })
  | (Base & { t: 'map'; of: Field });

// ---------------------------------------------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------------------------------------------

/** A slug: the file name, and a DNS label in fronted mode (`<slug>.<base>`). */
export const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SLUG_DOC = 'lower-case letters, digits and hyphens; starts and ends with a letter or digit; at most 63 characters';
/** A hostname: dot-separated DNS labels. */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Slugs that would collide with Hallway's own names in fronted mode, besides the dashboard's label. */
export const ALWAYS_RESERVED = ['www', 'api'];

/** The dashboard's host when config.yaml doesn't set one: `hallway.localhost`, or the bare custom domain. */
export const defaultDashboardHost = (base: string) => (base === 'localhost' ? 'hallway.localhost' : base);

/** Slugs an app can't have: `www`, `api`, and the dashboard's label if the dashboard is `<label>.<base>`. */
export function reservedSlugs(cfg: { domain: Pick<HallwayConfig['domain'], 'base' | 'dashboard'> }): string[] {
  const { base, dashboard } = cfg.domain;
  const label = dashboard.endsWith('.' + base) ? dashboard.slice(0, -base.length - 1) : null;
  return [...new Set([...(label && SLUG.test(label) ? [label] : []), ...ALWAYS_RESERVED])];
}

function isUrl(s: string) {
  try {
    const u = new URL(s);
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
  } catch {
    return false;
  }
}
const urlCheck = (v: string | null) => (v === null || isUrl(v) ? null : `not a URL (expected e.g. https://example.com/)`);
const pathCheck = (v: string | null) => (v === null || v.startsWith('/') ? null : `must start with "/"`);

const port = (doc: string, extra: Partial<Base> & { default?: number }): Field => ({ t: 'int', min: 1, max: 65535, doc, ...extra });
const str = (doc: string, extra: Partial<Extract<Field, { t: 'string' }>> = {}): Field => ({ t: 'string', doc, ...extra });
const tags: Field = { t: 'list', of: { t: 'string', doc: 'a tag', pattern: /^\S+$/, patternDoc: 'no spaces' }, default: [], doc: 'Free-form tags, for filtering.' };
const icon: Field = str('`auto` (the site\'s favicon, else a registry-matched brand mark, D66), an emoji, a path to an image in the data home, an image URL, or `si:<slug>` for a specific brand from the registry (src/lib/brands.ts).', { default: 'auto' });

// ---------------------------------------------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------------------------------------------

export const APP_SCHEMA: Field = {
  t: 'object',
  doc: 'One app per file: `apps/<slug>.yaml`. The slug is the file name.',
  fields: {
    name: str('Display name.', { defaultDoc: 'the slug' }),
    description: str('One line about it.', { nullable: true, default: null }),
    port: port('The port the app actually listens on. Never changed by Hallway.', { required: true }),
    host: str('Where the app listens (the probe and proxy target).', { default: '127.0.0.1' }),
    expected: {
      t: 'enum',
      values: ['running', 'stopped', 'adhoc'],
      default: 'running',
      doc: '`running`: should always be up (not responding is `down`). `stopped`: off on purpose. `adhoc`: up sometimes (not responding is `stopped`, not `down`).',
    },
    health: {
      t: 'object',
      optional: true,
      doc: 'How to check it. Leave out to probe `GET /` (any status below 500 is healthy).',
      fields: {
        path: str('The path to `GET`, e.g. `/api/health`.', { required: true, check: pathCheck }),
        expectStatus: { t: 'int', min: 100, max: 599, nullable: true, default: null, doc: 'The status that means healthy.', defaultDoc: 'any 2xx' },
      },
    },
    proxy: {
      t: 'object',
      doc: 'Fronted mode only (v1).',
      fields: {
        preserveHost: { t: 'bool', default: false, doc: 'Pass the public Host header through instead of rewriting it to the upstream address.' },
        aliases: { t: 'list', of: str('a hostname label', { pattern: SLUG, patternDoc: SLUG_DOC }), default: [], doc: 'Extra names: `[review]` also serves it at `review.<base>`.' },
      },
    },
    service: {
      t: 'object',
      optional: true,
      doc: 'Present: Hallway keeps it running as a native service (launchd / systemd). Write it with the CLI (`hallway run`, `hallway service add`), not by hand.',
      fields: {
        command: { t: 'list', of: str('an argument'), minItems: 1, required: true, doc: 'The command, as an argv array: `["npm", "run", "dev"]`.' },
        cwd: str('The working directory (`~` allowed).', { nullable: true, default: null }),
        env: { t: 'map', of: str('a value'), default: {}, doc: 'Extra environment. `PORT` and `HOST` are set for you.' } as Field,
        runAtLoad: { t: 'bool', default: true, doc: 'Start it at login.' },
        keepAlive: { t: 'bool', default: true, doc: 'Restart it if it exits.' },
      },
    },
    links: {
      t: 'list',
      default: [],
      doc: 'Deep links shown on the card.',
      of: {
        t: 'object',
        doc: 'a link',
        fields: {
          label: str('The link text.', { required: true }),
          path: str('A path on the app, e.g. `/api`.', { check: pathCheck }),
          url: str('Or a full URL.', { check: urlCheck }),
        },
        check: (l: { path?: string | null; url?: string | null }) => ((l.path == null) === (l.url == null) ? 'give either `path` or `url`' : null),
      },
    },
    project: {
      t: 'object',
      optional: true,
      doc: 'Where its code lives. Filled in when it is claimed from the observed tray.',
      fields: {
        dir: str('The project directory (`~` allowed).', { nullable: true, default: null }),
        repo: str('The repository URL.', { nullable: true, default: null, check: urlCheck }),
      },
    },
    tags,
    icon,
  },
};

export const BOOKMARKS_SCHEMA: Field = {
  t: 'object',
  doc: 'One group of links per file: `bookmarks/<group>.yaml`. The group slug is the file name.',
  fields: {
    title: str('The group\'s heading.', { defaultDoc: 'the group slug' }),
    order: { t: 'int', default: 100, doc: 'Groups sort by `order`, then `title`.' },
    collapsed: { t: 'bool', default: false, doc: 'Shown collapsed on the dashboard.' },
    links: {
      t: 'list',
      default: [],
      doc: 'The links, in order.',
      of: {
        t: 'object',
        doc: 'a link',
        fields: {
          title: str('The link text.', { defaultDoc: "the URL's host name" }),
          url: str('Where it goes.', { required: true, check: urlCheck }),
          description: str('A tooltip.', { nullable: true, default: null }),
          icon,
          tags,
        },
      },
    },
  },
};

export const IGNORE_SCHEMA: Field = {
  t: 'object',
  doc: '`ignore.yaml`: observed listeners to hide.',
  fields: {
    ports: { t: 'list', of: port('a port', {}), default: [], unique: true, doc: 'Never show these ports.' },
    processes: { t: 'list', of: str('a process name'), default: [], unique: true, doc: 'Never show listeners owned by these process names.' },
    dirs: { t: 'list', of: str('a directory'), default: [], unique: true, doc: 'Never show listeners whose working directory is under these paths (`~` allowed).' },
  },
};

const posInt = (doc: string, def: number, min = 1): Field => ({ t: 'int', min, default: def, doc });

export const CONFIG_SCHEMA: Field = {
  t: 'object',
  doc: '`config.yaml`: global settings. Every key is optional.',
  fields: {
    version: { t: 'int', min: 1, max: 1, default: 1, doc: 'The data home\'s format. Always `1` for now.' },
    port: port('The daemon\'s port (127.0.0.1 only). `--port` and `$PORT` override it.', { default: 4255 }),
    mode: { t: 'enum', values: ['direct', 'fronted'], default: 'direct', doc: '`direct`: links go to `localhost:<port>`. `fronted`: Caddy serves `https://<slug>.<base>` (v1, needs `hallway setup`).' },
    domain: {
      t: 'object',
      doc: 'Fronted mode\'s names.',
      fields: {
        base: str('Apps are served at `<slug>.<base>`.', { default: 'localhost', pattern: HOSTNAME, patternDoc: 'a host name' }),
        dashboard: str('Where the dashboard is in fronted mode.', { defaultDoc: '`hallway.localhost` when `base` is `localhost`, else `<base>`', pattern: HOSTNAME, patternDoc: 'a host name' }),
        tls: { t: 'bool', default: true, doc: 'Fronted mode is always HTTPS.' },
        dnsPort: port('Custom domains only: the loopback port Hallway\'s own dnsmasq answers on (the resolver configuration points at it).', { default: 4253 }),
      },
    },
    proxy: {
      t: 'object',
      doc: 'Fronted mode\'s Caddy (v1). Caddy runs as you on loopback ports above 1024; `hallway setup` redirects 443 and 80 to them.',
      fields: {
        caddy: str('The Caddy binary.', { nullable: true, default: null, defaultDoc: '`caddy` on your PATH, else Homebrew\'s' }),
        httpsPort: port('The loopback port Caddy serves HTTPS on.', { default: 4443 }),
        httpPort: port('The loopback port Caddy serves HTTP (a redirect to HTTPS) on.', { default: 4480 }),
        publicPort: port('The HTTPS port in links: 443 once `hallway setup` has redirected it to `httpsPort`. Set it to `httpsPort` to use fronted mode with no setup (links then carry the port).', { default: 443 }),
      },
    },
    probe: {
      t: 'object',
      doc: 'Health checks.',
      fields: {
        intervalSeconds: posInt('Seconds between checks.', 60, 5),
        liveIntervalSeconds: posInt('Seconds between checks while a dashboard is open.', 15, 1),
        timeoutMs: posInt('How long a check waits for an answer.', 5000, 100),
        concurrency: posInt('Checks in flight at once.', 8),
        failuresBeforeUnhealthy: posInt('Consecutive failures before an app leaves `healthy`.', 2),
      },
    },
    ports: {
      t: 'object',
      doc: 'Port assignment.',
      fields: {
        assignRange: {
          t: 'list',
          of: port('a port', {}),
          minItems: 2,
          maxItems: 2,
          default: [5100, 5999],
          doc: '`[low, high]`: where new apps with no port get one. Existing ports are never changed.',
          check: (r: number[]) => (r[0] > r[1] ? 'the first port must not be above the second' : null),
        },
      },
    },
    services: {
      t: 'object',
      doc: 'Managed services (`hallway run`, `hallway service add`).',
      fields: {
        startGraceSeconds: posInt('A service just started is `starting`, not `down`, for this long.', 30, 0),
        logMaxBytes: posInt('Rotate a service\'s log above this size.', 10485760, 1024),
        logGenerations: posInt('Rotated logs to keep.', 3),
      },
    },
    scan: {
      t: 'object',
      doc: 'The port scanner.',
      fields: {
        enabled: { t: 'bool', default: true, doc: 'Look for unnamed listeners.' },
        intervalSeconds: posInt('Seconds between scans.', 120, 10),
        includeEphemeralPorts: { t: 'bool', default: false, doc: 'Include ephemeral ports (49152–65535, and Linux\'s own range), where IDE and tool helpers listen.' },
        minPort: port('Ignore ports below this.', { default: 1024 }),
      },
    },
    thumbnails: {
      t: 'object',
      doc: 'The pictures on the doors.',
      fields: { mode: { t: 'enum', values: ['favicon', 'screenshot', 'card'], default: 'favicon', doc: '`favicon`: the app\'s favicon on its door (a monogram if it has none). `screenshot`: a picture of each healthy app as the door\'s glass (run `hallway thumbs enable` first: it installs the browser). `card`: every door drawn as a generated card.' } },
    },
    dashboard: {
      t: 'object',
      doc: 'The home page.',
      fields: {
        title: str('The page title.', { nullable: true, default: null, defaultDoc: "the machine's host name" }),
        sections: {
          t: 'list',
          of: { t: 'enum', values: ['apps', 'observed', 'bookmarks'], doc: 'a section' },
          default: ['apps', 'observed', 'bookmarks'],
          unique: true,
          doc: 'Which sections to show, in order.',
        },
        theme: { t: 'enum', values: ['auto', 'dark', 'light'], default: 'auto', doc: '`auto` follows the system.' },
        hints: {
          t: 'object',
          doc: "One-off suggestions on the dashboard. Dismissing one there sets it to false here.",
          fields: {
            localDomains: { t: 'bool', default: true, doc: 'The "Local domains" panel: how to turn on https://<app>.localhost (`hallway setup`). Shown only in direct mode, and never on Windows.' },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

const typeName = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'a mapping' : typeof v);

/**
 * Validate `value` against `field` and fill in defaults. Never throws: problems come back as issues (errors make the
 * value unusable; warnings don't). Unknown keys are reported as warnings and left out of the value (the file keeps
 * them).
 */
export function validate(field: Field, value: unknown, key: KeyPath = [], issues: Issue[] = []): { value: any; issues: Issue[] } {
  const err = (message: string, k = key) => issues.push({ severity: 'error', key: k, message });
  const done = (v: any) => {
    if (v !== null && v !== undefined && field.check && !issues.some((i) => i.severity === 'error' && startsWith(i.key, key))) {
      const m = field.check(v);
      if (m) err(m);
    }
    return { value: v, issues };
  };

  if (value === undefined || (value === null && !field.nullable)) {
    if (field.required) {
      err(value === null ? 'must not be empty' : 'is required');
      return { value: null, issues };
    }
    if (field.t === 'object') return field.optional ? { value: null, issues } : validate({ ...field, required: false }, {}, key, issues);
    const d = 'default' in field ? field.default : null;
    return { value: d === undefined ? null : structuredClone(d), issues };
  }
  if (value === null) return { value: null, issues };

  switch (field.t) {
    case 'string': {
      // a bare number or date is fine as text (`name: 2048`); a boolean or a structure is a mistake
      const s = typeof value === 'number' ? String(value) : value instanceof Date ? value.toISOString() : value;
      if (typeof s !== 'string') {
        err(`must be text, not ${typeName(value)}`);
        return { value: null, issues };
      }
      if (field.pattern && !field.pattern.test(s)) err(`"${s}" is not valid: ${field.patternDoc ?? `must match ${field.pattern}`}`);
      return done(s);
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        err(`must be a whole number, not ${typeof value === 'number' ? value : typeName(value)}`);
        return { value: null, issues };
      }
      if (field.min !== undefined && value < field.min) err(field.max !== undefined ? `must be between ${field.min} and ${field.max}` : `must be at least ${field.min}`);
      else if (field.max !== undefined && value > field.max) err(field.min !== undefined ? `must be between ${field.min} and ${field.max}` : `must be at most ${field.max}`);
      return done(value);
    }
    case 'bool':
      if (typeof value !== 'boolean') {
        err(`must be true or false, not ${typeName(value)}`);
        return { value: null, issues };
      }
      return done(value);
    case 'enum':
      if (typeof value !== 'string' || !field.values.includes(value)) {
        err(`must be one of ${field.values.join(', ')}${typeof value === 'string' ? `, not "${value}"` : ''}`);
        return { value: null, issues };
      }
      return done(value);
    case 'list': {
      if (!Array.isArray(value)) {
        err(`must be a list, not ${typeName(value)}`);
        return { value: null, issues };
      }
      if (field.minItems !== undefined && value.length < field.minItems)
        err(field.minItems === field.maxItems ? `must have exactly ${field.minItems} items` : `must have at least ${field.minItems} item${field.minItems === 1 ? '' : 's'}`);
      else if (field.maxItems !== undefined && value.length > field.maxItems)
        err(field.minItems === field.maxItems ? `must have exactly ${field.maxItems} items` : `must have at most ${field.maxItems} items`);
      const out = value.map((v, i) => validate({ ...field.of, required: true }, v, [...key, i], issues).value);
      if (field.unique) {
        const seen = new Set<string>();
        out.forEach((v, i) => {
          const k = JSON.stringify(v);
          if (seen.has(k)) issues.push({ severity: 'warning', key: [...key, i], message: `${JSON.stringify(v)} is listed twice` });
          seen.add(k);
        });
      }
      return done(out);
    }
    case 'map': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        err(`must be a mapping, not ${typeName(value)}`);
        return { value: null, issues };
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = validate({ ...field.of, required: true }, v, [...key, k], issues).value;
      return done(out);
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
        err(`must be a mapping (key: value lines), not ${typeName(value)}`);
        return { value: null, issues };
      }
      const out: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(field.fields)) {
        const v = validate(f, (value as Record<string, unknown>)[k], [...key, k], issues).value;
        // optional keys with no value and no default (a link's `path`) stay absent rather than null
        if (v !== null || f.nullable || f.t === 'object' || 'default' in f || f.defaultDoc) out[k] = v;
      }
      for (const k of Object.keys(value)) {
        if (!(k in field.fields)) issues.push({ severity: 'warning', key: [...key, k], atKey: true, message: `unknown key "${k}" (kept in the file, but Hallway doesn't use it)${suggest(k, Object.keys(field.fields))}` });
      }
      return done(out);
    }
  }
}

const startsWith = (a: KeyPath, b: KeyPath) => b.every((k, i) => a[i] === k);

/** "did you mean `expected`?" for a near-miss key. */
function suggest(k: string, known: string[]) {
  const lc = k.toLowerCase();
  const near = known.find((n) => n.toLowerCase() === lc || distance(n.toLowerCase(), lc) <= Math.max(1, Math.floor(n.length / 4)));
  return near ? `; did you mean "${near}"?` : '';
}
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** An app file's contents: the schema, then the defaults that depend on the slug. */
export function validateApp(slug: string, raw: unknown) {
  const r = validate(APP_SCHEMA, raw ?? {});
  if (r.value) r.value.name ??= slug;
  return r as { value: AppConfig; issues: Issue[] };
}

export function validateBookmarks(group: string, raw: unknown) {
  const r = validate(BOOKMARKS_SCHEMA, raw ?? {});
  if (r.value) {
    r.value.title ??= group;
    for (const l of r.value.links ?? []) {
      if (l && l.title == null && typeof l.url === 'string') l.title = isUrl(l.url) ? new URL(l.url).hostname || l.url : l.url;
    }
  }
  return r as { value: BookmarkGroupConfig; issues: Issue[] };
}

export function validateIgnore(raw: unknown) {
  return validate(IGNORE_SCHEMA, raw ?? {}) as { value: IgnoreConfig; issues: Issue[] };
}

export function validateConfig(raw: unknown) {
  const v = (raw as { version?: unknown } | null)?.version;
  const r = validate(CONFIG_SCHEMA, raw ?? {});
  if (typeof v === 'number' && v > 1) {
    // replace the generic range error with one that says what happened
    r.issues = r.issues.filter((i) => !(i.key.length === 1 && i.key[0] === 'version'));
    r.issues.push({ severity: 'error', key: ['version'], message: `version ${v} was written by a newer Hallway; this one understands version 1` });
  }
  if (r.value?.domain) r.value.domain.dashboard ??= defaultDashboardHost(r.value.domain.base ?? 'localhost');
  return r as { value: HallwayConfig; issues: Issue[] };
}

/** config.yaml's defaults. */
export function defaultConfig(): HallwayConfig {
  return validateConfig({}).value;
}

// ---------------------------------------------------------------------------------------------------------------
// The reference, for AGENT-GUIDE.md
// ---------------------------------------------------------------------------------------------------------------

function typeDoc(f: Field): string {
  switch (f.t) {
    case 'string':
      return 'text';
    case 'int':
      return f.min !== undefined && f.max !== undefined ? `number ${f.min}–${f.max}` : f.min !== undefined ? `number ≥ ${f.min}` : 'number';
    case 'bool':
      return 'true/false';
    case 'enum':
      return f.values.map((v) => `\`${v}\``).join(' \\| ');
    case 'list':
      return `list of ${f.of.t === 'object' ? 'mappings' : typeDoc(f.of)}`;
    case 'map':
      return `mapping of ${typeDoc(f.of)}`;
    case 'object':
      return 'mapping';
  }
}

function defaultDocOf(f: Field): string {
  if (f.required) return '**required**';
  if (f.defaultDoc) return f.defaultDoc;
  if (f.t === 'object') return f.optional ? 'absent' : '';
  const d = 'default' in f ? f.default : undefined;
  if (d === undefined) return '';
  if (d === null) return '`null`';
  return '`' + (Array.isArray(d) ? `[${d.join(', ')}]` : typeof d === 'object' ? '{}' : String(d)) + '`';
}

function rows(f: Field, prefix: string, out: string[]) {
  if (f.t !== 'object') return;
  for (const [k, sub] of Object.entries(f.fields)) {
    const key = prefix + k;
    let doc = sub.doc;
    if (sub.t === 'string' && sub.pattern) doc += ` (${sub.patternDoc})`;
    out.push(`| \`${key}\` | ${typeDoc(sub)} | ${defaultDocOf(sub)} | ${doc.replace(/\|/g, '\\|')} |`);
    if (sub.t === 'object') rows(sub, key + '.', out);
    if (sub.t === 'list' && sub.of.t === 'object') rows(sub.of, key + '[].', out);
  }
}

function table(title: string, f: Field, note = '') {
  const out = [`### ${title}`, '', f.doc + (note ? ' ' + note : ''), '', '| Key | Type | Default | Meaning |', '|-----|------|---------|---------|'];
  rows(f, '', out);
  return out.join('\n');
}

/** The file-format reference: one table per file, generated from the schemas above. */
export function referenceMarkdown(): string {
  return [
    table('`apps/<slug>.yaml`', APP_SCHEMA, `The slug: ${SLUG_DOC}. Reserved: \`${ALWAYS_RESERVED.join('`, `')}\` and the dashboard's label (\`hallway\` by default).`),
    table('`bookmarks/<group>.yaml`', BOOKMARKS_SCHEMA, `The group slug follows the same rules as an app slug.`),
    table('`ignore.yaml`', IGNORE_SCHEMA),
    table('`config.yaml`', CONFIG_SCHEMA),
    'Unknown keys are kept when Hallway writes a file, and reported as warnings. A file that fails to parse or validate is never overwritten: Hallway keeps using its last good version and shows the error (file, line, message) until it is fixed.',
  ].join('\n\n');
}
