// Door paint (docs/05-ui.md, "Thumbnails", tier 1): the dominant colour of an app's favicon, or a colour picked from a
// hash of its slug when it has none. The paints themselves are theme tokens (`--hw-paint-0` … in tokens.css); this
// only chooses one, or reads a colour out of an image's pixels. Pure (tested under node).

/** How many door paints tokens.css defines. */
export const PAINTS = 10;

/** A stable 32-bit hash (FNV-1a). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The paint for something without an icon colour: the same slug always gets the same door. */
export const paintIndex = (key: string) => hash(key) % PAINTS;
export const paintVar = (key: string) => `var(--hw-paint-${paintIndex(key)})`;

/** A monogram: the first letter or digit of each of the first two words (`Log viewer` → `LV`, `slides` → `S`). */
export function monogram(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-./@]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0]!.toUpperCase();
  return words.length > 1 ? first + [...words[1]][0]!.toUpperCase() : first;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * The dominant colour of an image's RGBA pixels: quantise to 4 bits a channel, then take the most frequent bucket
 * that is opaque and saturated enough to be a brand colour (not a white background, a black outline or grey text),
 * returned as its average. Null when nothing qualifies (a monochrome icon: the hashed paint is better than grey).
 */
export function dominantColour(rgba: ArrayLike<number>): string | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    if (rgba[i + 3]! < 160) continue;
    const [, s, l] = rgbToHsl(r, g, b);
    if (s < 0.28 || l < 0.12 || l > 0.9) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    k.n++;
    k.r += r;
    k.g += g;
    k.b += b;
    buckets.set(key, k);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const k of buckets.values()) if (!best || k.n > best.n) best = k;
  // a stray coloured pixel or two isn't a colour scheme
  if (!best || best.n < 6) return null;
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/** Door paint from a favicon's colour: toned down towards the theme's neutral (tokens.css), or the hashed paint. */
export const paintFor = (key: string, colour: string | null) =>
  colour ? `color-mix(in oklab, ${colour} var(--hw-paint-strength), var(--hw-paint-mute))` : paintVar(key);
