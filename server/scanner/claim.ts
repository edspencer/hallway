// Claim (docs/04-apps-health-services.md, "Claim"): turn an observed listener into a declared app. The draft keeps
// the observed port (never a new one: D17), is `expected: adhoc` (it was started by hand and may well stop), records
// the project directory, and carries the observed command as a commented-out `service:` block the user can enable.
import os from 'node:os';
import type { ObservedListener } from '../../shared/api.js';
import { tildify } from '../config.js';

/** A valid app slug: a DNS label, because it becomes `<slug>.<base>` in fronted mode (docs/02-architecture.md). */
export const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** The dashboard's own label and names that would be confusing as app hostnames. */
export const RESERVED_SLUGS = new Set(['hallway', 'www', 'api']);

export type Expected = 'running' | 'stopped' | 'adhoc';

/** `@scope/My_App` → `my-app`. Empty if nothing usable is left. */
export function slugify(s: string): string {
  return s
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/**
 * A slug for an observation: from the package (or project) name, plus the branch for a worktree sibling, made unique
 * against `taken` with a numeric suffix.
 */
export function suggestSlug(obs: ObservedListener, taken: ReadonlySet<string> = new Set()): string {
  let base = slugify(obs.project?.name ?? obs.process ?? '') || `app-${obs.port}`;
  const branch = obs.git?.branch;
  if (obs.label.includes(' @ ') && branch && !['main', 'master', 'trunk'].includes(branch))
    base = slugify(`${base}-${branch}`) || base;
  if (RESERVED_SLUGS.has(base)) base = `${base}-app`;
  let slug = base;
  for (let n = 2; taken.has(slug) || RESERVED_SLUGS.has(slug); n++) slug = `${base.slice(0, 60)}-${n}`;
  return slug;
}

export interface ClaimOptions {
  slug?: string;
  name?: string;
  expected?: Expected;
}

/** A YAML string scalar. JSON's double-quoted strings are valid YAML; plain words stay unquoted. */
const str = (s: string) => (/^[A-Za-z0-9][\w .,/@()+-]*$/.test(s) && !/[:#]/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s));

/** The host to write: omitted when it's the default 127.0.0.1 (or the app listens everywhere, which includes it). */
function upstreamHost(obs: ObservedListener): string | null {
  if (obs.bind === 'all' || obs.addresses.some((a) => a.startsWith('127.'))) return null;
  if (obs.addresses.includes('::1')) return '::1';
  return obs.addresses[0] ?? null;
}

/**
 * The contents of `apps/<slug>.yaml` for an observation. Throws on an invalid or reserved slug, or an unknown
 * `expected`; the caller still has to check that the file doesn't exist.
 */
export function claimDraft(
  obs: ObservedListener,
  opts: ClaimOptions = {},
  taken: ReadonlySet<string> = new Set(),
  { home = os.homedir(), now = new Date() } = {},
): { slug: string; yaml: string } {
  const slug = opts.slug ?? suggestSlug(obs, taken);
  if (!SLUG.test(slug)) throw new Error(`'${slug}' is not a valid slug: lowercase letters, digits and dashes, starting and ending with a letter or digit`);
  if (RESERVED_SLUGS.has(slug)) throw new Error(`'${slug}' is reserved`);
  const expected = opts.expected ?? 'adhoc';
  if (!['running', 'stopped', 'adhoc'].includes(expected)) throw new Error(`expected must be running, stopped or adhoc, not '${expected}'`);
  const name = opts.name?.trim() || obs.label;
  const dir = obs.project?.root ?? obs.cwd;
  const host = upstreamHost(obs);

  const lines = [`# Claimed from a listener Hallway observed on port ${obs.port} (${now.toISOString().slice(0, 10)}).`];
  lines.push(`name: ${str(name)}`);
  if (obs.project?.description) lines.push(`description: ${str(obs.project.description)}`);
  lines.push(`port: ${obs.port}`);
  if (host) lines.push(`host: ${str(host)}`);
  lines.push(`expected: ${expected}`);
  if (dir || obs.git?.remote) {
    lines.push('project:');
    if (dir) lines.push(`  dir: ${str(tildify(dir, home))}`);
    if (obs.git?.remote) lines.push(`  repo: ${str(obs.git.remote)}`);
  }
  const argv = obs.argv?.length ? obs.argv : obs.command ? obs.command.split(/\s+/) : null;
  if (argv) {
    lines.push('', '# The command it was running with. Uncomment to have Hallway keep it running as a service (v1).');
    lines.push('# service:', `#   command: [${argv.map((a) => JSON.stringify(a)).join(', ')}]`);
    if (obs.cwd) lines.push(`#   cwd: ${str(tildify(obs.cwd, home))}`);
  }
  return { slug, yaml: lines.join('\n') + '\n' };
}
