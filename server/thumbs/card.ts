// Tier-3 thumbnails (D13, D54): a generated card, for an app with no screenshot. An SVG drawn as one of the dashboard's
// doors (its paint, raised panels, knob and brass number plate) carrying the app's name, its framework, `repo @ branch`
// and its address; rendered to PNG by resvg with the bundled fonts only (assets/fonts/, made by
// scripts/card-fonts.py), so the same app gives the same bytes on every machine and nothing scans the system's fonts.
//
// The colours are tokens.css's (the door paints, the lift and shade, the plate's brass). The daemon can't read that
// file at run time (it isn't shipped), so they are copied here and test/card.test.ts checks they still match (D28).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { ROOT } from '../config.js';

export const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
export const FONT_FILES = ['Fraunces-SemiBold.ttf', 'Inter-Medium.ttf', 'JetBrainsMono-Regular.ttf'];

/** The card's size in CSS pixels; the PNG is drawn at `ZOOM`× (the size a screenshot is stored at, ~640×400). */
export const CARD = { width: 320, height: 200 };
export const ZOOM = 2;
/** Bump when the drawing changes, so every card's ETag does too. */
const DESIGN = 2;

/** tokens.css: `--hw-paint-0` … `--hw-paint-9` (the doors with no icon colour), and what paint lightens and darkens to. */
export const PALETTE = {
  paints: ['#4f6b8a', '#7a5a8c', '#3f7a6e', '#8a5a3c', '#6b7a3f', '#8a4f5a', '#4f7f8f', '#8a7440', '#5f5a8f', '#8a6a7f'],
  lift: '#fff3e0',
  shade: '#0d0a07',
  lamplight: '#ffd08a',
  accent: '#f0b35a',
  plateTop: '#f6c46e',
  plateBottom: '#d99a45',
  plateText: '#24180a',
  /** `--hw-text` (dark), the ink on a painted door. */
  ink: '#ede4d8',
};

/** What a card shows. Everything but the name may be missing. */
export interface CardModel {
  slug: string;
  name: string;
  /** The address without its scheme: `localhost:5173`, `my-app.localhost`. */
  address: string | null;
  framework: string | null;
  repo: string | null;
  branch: string | null;
}

/** The dashboard's door paint for a slug (src/lib/colour.ts `paintIndex`: FNV-1a, modulo the ten paints). */
export function paintIndex(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % PALETTE.paints.length;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** `a` mixed `t` (0–1) of the way towards `b`, as hex. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Cut `s` to `max` characters, with an ellipsis. */
function fit(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, Math.max(1, max - 1)).join('') + '…';
}

/** JetBrains Mono's advance is 0.6 em for every glyph, so mono text is measured exactly. */
const MONO_EM = 0.6;
/** Fraunces SemiBold averages about 0.56 em a character over names; a little generous, so a name never overflows. */
const DISPLAY_EM = 0.6;

/** The card as SVG (320×200 user units). Pure: the same model always gives the same string. */
export function cardSvg(m: CardModel): string {
  const { width: W, height: H } = CARD;
  const paint = PALETTE.paints[paintIndex(m.slug)]!;
  const top = mix(paint, PALETTE.lift, 0.18);
  const foot = mix(paint, PALETTE.shade, 0.42);
  const line = 'rgba(0,0,0,0.22)';
  const light = 'rgba(255,243,224,0.16)';
  const muted = mix(PALETTE.ink, paint, 0.32);
  const out: string[] = [];

  // the door: painted, two raised panels under an arch, a knob
  out.push(
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.38" stop-color="${paint}"/><stop offset="1" stop-color="${foot}"/></linearGradient>`,
    `<radialGradient id="k" cx="0.35" cy="0.35" r="0.65"><stop offset="0" stop-color="${PALETTE.lamplight}"/><stop offset="0.6" stop-color="${PALETTE.accent}"/><stop offset="1" stop-color="#5a3c14"/></radialGradient>`,
    `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PALETTE.plateTop}"/><stop offset="1" stop-color="${PALETTE.plateBottom}"/></linearGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#p)"/>`,
  );
  const panel = (x: number, y: number, w: number, h: number, r: number) => {
    const d = `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r * 2} ${y}H${x + w - r * 2}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
    out.push(`<path d="${d}" fill="none" stroke="${light}" stroke-width="1.5" transform="translate(0.75 0.75)"/>`, `<path d="${d}" fill="none" stroke="${line}" stroke-width="1.5"/>`);
  };
  panel(22, 26, W - 44, H - 52, 22);
  out.push(`<circle cx="${W - 34}" cy="${H * 0.56}" r="4.5" fill="url(#k)"/>`);

  // the framework, top left inside the panel: a small mark and its name
  if (m.framework) {
    const fw = fit(m.framework.toLowerCase(), 14);
    const w = 22 + fw.length * 10 * MONO_EM;
    out.push(
      `<g transform="translate(40 34)"><rect width="${w.toFixed(1)}" height="18" rx="9" fill="rgba(13,10,7,0.28)"/>`,
      `<path d="M9 5.5l-3.5 3.5 3.5 3.5M14 5.5l3.5 3.5-3.5 3.5" fill="none" stroke="${PALETTE.lamplight}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(-1.5 0)"/>`,
      `<text x="20" y="12.6" font-family="JetBrains Mono" font-size="10" fill="${PALETTE.ink}">${esc(fw)}</text></g>`,
    );
  }

  // the name, as large as fits; under it `repo @ branch`
  const inner = W - 96;
  const chars = [...m.name].length || 1;
  const size = Math.max(19, Math.min(34, inner / (chars * DISPLAY_EM)));
  const name = fit(m.name, Math.floor(inner / (size * DISPLAY_EM)));
  const where = m.repo ? (m.branch ? `${m.repo} @ ${m.branch}` : m.repo) : m.branch;
  const nameY = where ? 94 : 104;
  out.push(`<text x="${W / 2}" y="${nameY}" text-anchor="middle" font-family="Fraunces" font-size="${size.toFixed(1)}" fill="${PALETTE.ink}">${esc(name)}</text>`);
  if (where) out.push(`<text x="${W / 2}" y="${nameY + 22}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="${muted}">${esc(fit(where, Math.floor(inner / (11 * MONO_EM))))}</text>`);

  // the address on the brass number plate
  if (m.address) {
    const fs = 14;
    const addr = fit(m.address, Math.floor((W - 96) / (fs * MONO_EM)));
    const w = [...addr].length * fs * MONO_EM + 22;
    const x = (W - w) / 2;
    out.push(
      `<rect x="${x.toFixed(1)}" y="${H - 66}" width="${w.toFixed(1)}" height="26" rx="5" fill="url(#b)" stroke="rgba(36,24,10,0.55)" stroke-width="1"/>`,
      `<text x="${W / 2}" y="${H - 48.2}" text-anchor="middle" font-family="JetBrains Mono" font-size="${fs}" fill="${PALETTE.plateText}">${esc(addr)}</text>`,
    );
  }

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, ...out, `</svg>`].join('\n');
}

let fontPaths: string[] | null = null;

/** The card's font files in `dir`. Throws if one is missing: resvg would silently draw no text at all. */
export function cardFonts(dir = FONT_DIR): string[] {
  const paths = FONT_FILES.map((f) => path.join(dir, f));
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length) throw new Error(`the card's fonts are missing (${missing.join(', ')}): reinstall Hallway`);
  return paths;
}

/** An SVG as PNG at `zoom`×, with the bundled fonts only: the same bytes on every machine, and no system font scan. */
export function svgToPng(svg: string, zoom = ZOOM): Buffer {
  fontPaths ??= cardFonts();
  const r = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: zoom },
    font: { fontFiles: fontPaths, loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', serifFamily: 'Fraunces', monospaceFamily: 'JetBrains Mono' },
  });
  return r.render().asPng();
}

/** A card's ETag, from what it shows (no need to draw it to know whether it changed). */
export function cardEtag(m: CardModel): string {
  return `"c${crypto.createHash('sha256').update(JSON.stringify([DESIGN, m])).digest('hex').slice(0, 15)}"`;
}
