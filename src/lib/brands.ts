// Brand icons for doors with no favicon (docs/05-ui.md "Thumbnails"; D66): when `icon: auto` finds no favicon, a
// registry match gives the door a recognisable mark instead of a plain monogram — the motivating case is Ollama,
// whose server just answers "Ollama is running" with no icon of its own. Everything here is pure and runs entirely
// in the dashboard: the hints it needs (process, command, supervisor label, name, port) are already on `AppView`
// (`identity`, `config`), so no server change is needed to resolve a match.
//
// Priority (highest first): an explicit `icon: si:<slug>` always wins, even over a favicon (never fetched for a
// `si:` value: iconSource in server/thumbs/index.ts only recognises `auto`, a URL, a path or an emoji). Otherwise a
// favicon beats a registry match, and a registry match beats the monogram. Matching only runs for `icon: auto` (or
// unset): a custom icon that failed to load is left alone, not silently replaced.
import { BRAND_DATA } from './brands.data.js';

export interface BrandEntry {
  /** The simple-icons slug (`si:<slug>` in an app's `icon:`). */
  slug: string;
  title: string;
  /** `#rrggbb`, from simple-icons. */
  hex: string;
  /** One or more `<path d>`s, space-joined; the icon's own 24×24 viewBox. */
  path: string;
  /** Lower-case tokens matched whole, never as a substring, against process/command/supervisor/name. */
  keywords: string[];
  /** Well-known default ports, included only where no other common tool shares one (a weak last resort). */
  ports: number[];
}

export const BRAND_REGISTRY: BrandEntry[] = BRAND_DATA;

export interface BrandHints {
  /** `AppConfig.icon` (or a discovered/observed app's, which has none: pass `null`). */
  icon?: string | null;
  process?: string | null;
  command?: string | null;
  supervisorLabel?: string | null;
  name?: string | null;
  slug?: string | null;
  port?: number | null;
}

/** Lower-case words, split on anything that isn't a letter, digit or `-` (so `redis-server` and `n8n` survive, but a
 * dotted supervisor label such as `homebrew.mxcl.ollama` splits into its parts). */
function tokens(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
}

/** `si:<slug>` → the slug, trimmed; null if `icon` isn't that form. */
export function explicitBrandSlug(icon: string | null | undefined): string | null {
  const m = /^si:(.+)$/.exec((icon ?? '').trim());
  return m ? m[1].trim() : null;
}

/**
 * A brand for these hints, or null. An explicit `si:<slug>` is tried first and, found or not, is the end of it
 * (never falls through to auto-matching or the port hint). Auto-matching only runs when `icon` is `auto`, empty or
 * unset: a configured favicon/path/emoji that didn't resolve to a picture is left to the monogram, not overridden.
 */
export function matchBrand(hints: BrandHints, registry: BrandEntry[] = BRAND_REGISTRY): BrandEntry | null {
  const explicit = explicitBrandSlug(hints.icon);
  if (explicit !== null) return registry.find((b) => b.slug === explicit) ?? null;
  if (hints.icon && hints.icon !== 'auto') return null;

  const words = new Set([...tokens(hints.process), ...tokens(hints.command), ...tokens(hints.supervisorLabel), ...tokens(hints.name), ...tokens(hints.slug)]);
  for (const b of registry) if (b.keywords.some((k) => words.has(k))) return b;
  if (hints.port != null) for (const b of registry) if (b.ports.includes(hints.port)) return b;
  return null;
}
