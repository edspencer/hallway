// What `hallway` (serve) prints once it's listening: the HALLWAY banner and version, the "Hallway on …" line, the
// dashboard's address, the data home, and two hints: that local domains (fronted mode, D47) are there to turn on, and
// that `npx hallway` lasts only as long as the terminal (D61). Modelled on Local Review's banner (server/banner.ts
// there): hand-rolled, no dependency, a 12-pixel-high font drawn with half blocks (▀ ▄ █), so it's 6 rows and fits an
// 80-column terminal, coloured from copper to lamplight amber (the dashboard's accent, src/theme/tokens.css).
//
// The banner is only for a person at a terminal: none when stdout isn't a TTY (piped, a service's log file, CI) unless
// FORCE_COLOR is set, none with --quiet, a one-line title when the terminal is too narrow. Colour follows Node's own
// rules (tty.WriteStream#getColorDepth: NO_COLOR, FORCE_COLOR, TERM=dumb, COLORTERM, Windows 10+). The "Hallway on"
// line is always printed and always first after the banner, with "Data home:" right after it: scripts and tests wait
// for it (scripts/smoke-pack.mjs). --quiet (what the service jobs run) prints that line alone.
import tty from 'node:tty';

// Each glyph: 12 pixel rows, `#` set. Rows pair up into one text row each.
const FONT: Record<string, string[]> = {
  H: ['##..##', '##..##', '##..##', '##..##', '##..##', '######', '######', '##..##', '##..##', '##..##', '##..##', '##..##'],
  A: ['.####.', '######', '##..##', '##..##', '##..##', '##..##', '######', '######', '##..##', '##..##', '##..##', '##..##'],
  L: ['##....', '##....', '##....', '##....', '##....', '##....', '##....', '##....', '##....', '##....', '######', '######'],
  W: ['##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##.##.##', '##.##.##', '##.##.##', '##.##.##', '########', '.##..##.'],
  Y: ['##..##', '##..##', '##..##', '##..##', '.####.', '.####.', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
};

/** The banner's lines, uncoloured: `text` drawn in FONT, one column between letters. */
export function bannerLines(text = 'HALLWAY'): string[] {
  const glyphs = [...text].map((ch) => FONT[ch]!);
  const px = Array.from({ length: 12 }, (_, y) => glyphs.map((g) => g[y]).join('.'));
  const out: string[] = [];
  for (let y = 0; y < 12; y += 2) {
    let line = '';
    for (let x = 0; x < px[y]!.length; x++) {
      const top = px[y]![x] === '#';
      const bottom = px[y + 1]![x] === '#';
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    out.push(line.trimEnd());
  }
  return out;
}

type Rgb = [number, number, number];
// left to right: copper (the doors' woodwork, lifted to read on black), the accent's lamplight amber #f0b35a, and a
// deeper amber that still reads on a light terminal
const STOPS: Rgb[] = [
  [204, 116, 64],
  [240, 179, 90],
  [222, 150, 56],
];
function gradient(t: number): Rgb {
  const s = Math.min(STOPS.length - 2, Math.floor(t * (STOPS.length - 1)));
  const f = t * (STOPS.length - 1) - s;
  return STOPS[s]!.map((v, i) => Math.round(v + (STOPS[s + 1]![i]! - v) * f)) as Rgb;
}

/** An SGR foreground colour for `rgb` at a colour depth (24, 8 or 4 bits; 1: none). */
function fg([r, g, b]: Rgb, depth: number): string {
  if (depth >= 24) return `\x1b[38;2;${r};${g};${b}m`;
  if (depth >= 8) {
    const c = (v: number) => Math.round((v / 255) * 5);
    return `\x1b[38;5;${16 + 36 * c(r) + 6 * c(g) + c(b)}m`;
  }
  return '\x1b[33m'; // 16 colours: yellow
}
const RESET = '\x1b[0m';

export interface Terminal {
  isTTY?: boolean;
  columns?: number;
  env: NodeJS.ProcessEnv;
  /** Colour depth (bits); default: Node's own detection for this env. */
  depth?: number;
}

/** Node's colour detection, for a TTY or not: FORCE_COLOR wins over NO_COLOR, as in Node and force-color.org. */
export function colorDepth(t: Terminal): number {
  if (t.depth !== undefined) return t.depth;
  const forced = t.env.FORCE_COLOR !== undefined;
  if (!t.isTTY && !forced) return 1;
  return tty.WriteStream.prototype.getColorDepth.call(null, t.env);
}

function paint(line: string, width: number, depth: number): string {
  if (depth < 4) return line;
  let out = '';
  let last = '';
  for (let x = 0; x < line.length; x++) {
    const ch = line[x]!;
    if (ch === ' ') {
      out += ch;
      continue;
    }
    const code = fg(gradient(width > 1 ? x / (width - 1) : 0), depth);
    if (code !== last) out += code;
    last = code;
    out += ch;
  }
  return out + RESET;
}

const bold = (s: string, depth: number) => (depth >= 4 ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string, depth: number) => (depth >= 4 ? `\x1b[2m${s}\x1b[22m` : s);

export interface Startup {
  version: string;
  /** The daemon's own address: `http://localhost:4255`. */
  url: string;
  /** The data home, as people see it (`~/.hallway`). */
  home: string;
  /** Fronted mode: the dashboard's address there (`https://hallway.localhost`). Null in direct mode. */
  dashboardUrl: string | null;
  /** Direct mode on a platform that can do fronted mode: what `hallway setup` would give (`https://hallway.localhost`,
   * `https://<app>.localhost`). Null: say nothing about it (it's on, or it can't be on here: Windows, D58). */
  localDomains: { dashboard: string; app: string } | null;
  /** Running from npx's cache or the like (server/services/transient.ts): where, for the hint. */
  transient: string | null;
  /** Lines to print after the data home (files with errors). */
  notes?: string[];
  quiet?: boolean;
  /** `npm run dev`: the dashboard to open is Vite's, so just the line. */
  dev?: boolean;
}

/** The startup text, for a terminal (or not: `t.isTTY`). */
export function startupMessage(o: Startup, t: Terminal): string {
  const depth = colorDepth(t);
  const line = `Hallway on ${o.url}`;
  if (o.quiet || o.dev) return line + '\n';
  const out: string[] = [];
  const showBanner = t.isTTY || (t.env.FORCE_COLOR !== undefined && depth > 1);
  if (showBanner) {
    const lines = bannerLines();
    const width = Math.max(...lines.map((l) => l.length));
    // 2 columns of margin; narrower than that, a one-line title rather than a wrapped banner
    // 0 or unset: the terminal didn't say (a bare pty), so assume the usual 80
    if ((t.columns || 80) >= width + 2) out.push('', ...lines.map((l) => ' ' + paint(l, width, depth)), ' ' + dim(`v${o.version}`, depth), '');
    else out.push('', ' ' + bold(paint('▌ HALLWAY', 9, depth), depth) + ' ' + dim(`v${o.version}`, depth), '');
  }
  out.push(line, `Data home: ${o.home}`);
  if (o.dashboardUrl) out.push(`Dashboard: ${bold(o.dashboardUrl, depth)}  (${o.url} works too)`);
  out.push(...(o.notes ?? []));
  if (o.localDomains)
    out.push(
      '',
      `Local domains are off. Run ${bold('hallway setup', depth)} to reach this dashboard at`,
      `${o.localDomains.dashboard} and each app at ${o.localDomains.app}`,
      `(by default with no admin needed; setup prints each step before it runs).`,
    );
  if (o.transient)
    out.push('', `Running from ${o.transient}, so it stops with this terminal. To keep it running:`, `  ${bold('npm i -g hallway && hallway service install', depth)}`);
  return out.join('\n') + '\n';
}

/** What `hallway serve` prints when a Hallway daemon already answers on the port: not an error (exit 0). */
export function alreadyRunning(o: { url: string; version: string; dashboardUrl: string | null }): string {
  return `Hallway is already running at ${o.dashboardUrl ?? o.url}${o.dashboardUrl ? ` (and ${o.url})` : ''}, version ${o.version}. Nothing to do.\n`;
}
