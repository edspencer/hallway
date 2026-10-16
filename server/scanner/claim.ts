// The slug a Claim form is pre-filled with (docs/04-apps-health-services.md, "Claim"). The claim itself (the
// `apps/<slug>.yaml` it writes) is the daemon core's (server/api.ts), through the store.
import type { Observation } from './types.js';
import { fallbackName } from './observations.js';

/** A valid app slug: a DNS label, because it becomes `<slug>.<base>` in fronted mode (docs/02-architecture.md). */
export const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** The dashboard's own label and names that would be confusing as app hostnames. */
export const RESERVED_SLUGS = new Set(['hallway', 'www', 'api']);

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
 * A slug for an observation: from the package (or project) name, else its supervisor or executable, plus the branch
 * for a worktree sibling, made unique against `taken` with a numeric suffix.
 */
export function suggestSlug(obs: Observation, taken: ReadonlySet<string> = new Set()): string {
  let base = slugify(obs.project?.name ?? fallbackName(obs) ?? obs.process ?? '') || `app-${obs.port}`;
  const branch = obs.git?.branch;
  if (obs.label.includes(' @ ') && branch && !['main', 'master', 'trunk'].includes(branch))
    base = slugify(`${base}-${branch}`) || base;
  if (RESERVED_SLUGS.has(base)) base = `${base}-app`;
  let slug = base;
  for (let n = 2; taken.has(slug) || RESERVED_SLUGS.has(slug); n++) slug = `${base.slice(0, 60)}-${n}`;
  return slug;
}
