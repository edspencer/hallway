// Formatting for people: addresses, paths, ages, percentages. Pure (tested under node).

/** `http://localhost:5622/` → `localhost:5622`; `https://review.localhost` → `review.localhost`. */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const rest = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${rest}${u.search}`;
  } catch {
    return url.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');
  }
}

/** The hostname of a URL, without `www.`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The user's home directory, worked out from the data home and how it's shown (`/Users/x/.hallway` shown as
 * `~/.hallway` → `/Users/x`). Null when the data home isn't under it.
 */
export function homeDir(dataHome: string, dataHomeDisplay: string): string | null {
  if (!dataHomeDisplay.startsWith('~')) return null;
  const rest = dataHomeDisplay.slice(1);
  return dataHome.endsWith(rest) ? dataHome.slice(0, dataHome.length - rest.length) || null : null;
}

/** A path as people see it: the home directory as `~`. */
export function tildify(p: string, home: string | null): string {
  if (!home) return p;
  if (p === home) return '~';
  return p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

/** `3 s`, `5 min`, `2 h`, `9 days`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** "5 min ago" from an ISO time; empty for null. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : `${duration(now - t)} ago`;
}

/** 0–1 → `99.9%` (one decimal under 100, none at 100), `–` for null. */
export function percent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  const p = v * 100;
  if (p >= 99.95) return '100%';
  return `${p.toFixed(1)}%`;
}

/** `12 ms`, `1.4 s`; `–` for null. */
export function millis(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}

/** A local time for tooltips: `Fri 14:30`, or `16 Oct 14:30` when it isn't this week. */
export function shortTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (now - d.getTime() < 6 * 24 * 3600_000) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

/** A slug from free text: lower-case letters, digits and hyphens (the store's SLUG rule). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

export const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
