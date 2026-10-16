// The dashboard's pure logic (src/lib/): state counts and the tab title (D22), formatting, the filter, door paint;
// and the theme tokens' contrast (docs/05-ui.md: state colours must pass in both themes).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AppHealth } from '../shared/api.ts';
import { PAINTS, dominantColour, hash, monogram, paintIndex } from '../src/lib/colour.ts';
import { matchScore } from '../src/lib/filter.ts';
import { ago, displayUrl, duration, homeDir, hostOf, millis, percent, shorten, slugify, tildify } from '../src/lib/format.ts';
import { bootLabel, lostCommand, lostCount, lostWhere } from '../src/lib/lost.ts';
import { countStates, doorState, faviconMark, isScanning, subtitle, tabTitle } from '../src/lib/status.ts';
import { ROOT } from './fixture.ts';

const health = (state: AppHealth['state'], starting = false): { health: AppHealth } => ({
  health: { state, starting, since: null, checkedAt: null, httpStatus: null, latencyMs: null, detail: null, uptime24h: null, latencyP50: null },
});

describe('scanning', () => {
  test('needs both a scanner in the daemon and scan.enabled', () => {
    const st = (scanner: boolean, enabled: boolean) =>
      ({ daemon: { providers: { scanner } }, config: { config: { scan: { enabled } } } }) as Parameters<typeof isScanning>[0];
    assert.equal(isScanning(st(true, true)), true);
    assert.equal(isScanning(st(true, false)), false, 'the first-run screen must not promise that a server will be found');
    assert.equal(isScanning(st(false, true)), false);
  });
});

describe('door subtitle', () => {
  test('repo @ branch for a worktree, unless the name already says it; else the description', () => {
    const app = (name: string, label: string | null, description: string | null = null) =>
      ({ name, identity: label === null ? null : { label }, config: { description } }) as Parameters<typeof subtitle>[0];
    assert.equal(subtitle(app('Notes', 'notes @ branch-a')), 'notes @ branch-a');
    assert.equal(subtitle(app('notes @ branch-a', 'notes @ branch-a')), null);
    assert.equal(subtitle(app('notes @ branch-a', 'notes @ branch-a', 'Team notes')), 'Team notes');
    assert.equal(subtitle(app('Deck', null, 'Slides')), 'Slides');
  });
});

describe('status', () => {
  test('counts each state, with starting among the not-yet-known', () => {
    const c = countStates([health('healthy'), health('healthy'), health('down'), health('unhealthy'), health('stopped'), health('unknown'), health('healthy', true)]);
    assert.deepEqual(c, { up: 2, down: 1, unhealthy: 1, stopped: 1, unknown: 2, total: 7 });
    assert.equal(doorState(health('healthy', true)), 'starting');
  });

  test('the tab title counts only down and unhealthy (D12, D22)', () => {
    assert.equal(tabTitle({ down: 0, unhealthy: 0 }), 'Hallway');
    assert.equal(tabTitle({ down: 1, unhealthy: 0 }), '(1 down) Hallway');
    assert.equal(tabTitle({ down: 2, unhealthy: 1 }), '(2 down · 1 unhealthy) Hallway');
    assert.equal(tabTitle({ down: 0, unhealthy: 3 }), '(3 unhealthy) Hallway');
    assert.equal(faviconMark({ down: 0, unhealthy: 0 }), null);
    assert.equal(faviconMark({ down: 1, unhealthy: 1 }), 'down');
    assert.equal(faviconMark({ down: 0, unhealthy: 1 }), 'unhealthy');
  });
});

describe('format', () => {
  test('addresses drop the scheme and a bare slash', () => {
    assert.equal(displayUrl('http://localhost:5622/'), 'localhost:5622');
    assert.equal(displayUrl('https://review.localhost'), 'review.localhost');
    assert.equal(displayUrl('http://localhost:4000/app?x=1'), 'localhost:4000/app?x=1');
    assert.equal(hostOf('https://www.example.com/a'), 'example.com');
  });

  test('the home directory comes from the data home and its display form', () => {
    assert.equal(homeDir('/Users/me/.hallway', '~/.hallway'), '/Users/me');
    assert.equal(homeDir('/srv/hallway', '/srv/hallway'), null);
    assert.equal(tildify('/Users/me/Code/app', '/Users/me'), '~/Code/app');
    assert.equal(tildify('/Users/meant/x', '/Users/me'), '/Users/meant/x');
    assert.equal(tildify('/x', null), '/x');
    assert.equal(shorten('abcdef', 6), 'abcdef');
    assert.equal(shorten('abcdefg', 6), 'abcde…');
    assert.equal(tildify('C:\\Users\\me\\Code\\app', 'C:\\Users\\me'), '~\\Code\\app');
    assert.equal(tildify('C:\\Users\\meant\\x', 'C:\\Users\\me'), 'C:\\Users\\meant\\x');
  });

  test('durations, percentages, latencies', () => {
    assert.equal(duration(4000), '4 s');
    assert.equal(duration(5 * 60_000), '5 min');
    assert.equal(duration(3 * 3600_000), '3 h');
    assert.equal(duration(9 * 86400_000), '9 days');
    assert.equal(duration(86400_000 * 2), '2 days');
    assert.equal(ago(null), '');
    assert.equal(ago(new Date(1000).toISOString(), 61_000), '1 min ago');
    assert.equal(percent(1), '100%');
    assert.equal(percent(0.9996), '100%');
    assert.equal(percent(0.993), '99.3%');
    assert.equal(percent(null), '–');
    assert.equal(millis(12.4), '12 ms');
    assert.equal(millis(1400), '1.4 s');
  });

  test('slugify makes a valid slug or nothing', () => {
    assert.equal(slugify('Log viewer'), 'log-viewer');
    assert.equal(slugify('  Café  Menu!! '), 'cafe-menu');
    assert.equal(slugify('***'), '');
    assert.equal(slugify('a'.repeat(80)).length, 63);
  });
});

describe('filter', () => {
  const app = (name: string, ...rest: (string | number | null)[]) => ({ fields: [name, ...rest] });

  test('substrings, word starts and abbreviations of the name', () => {
    assert.ok(matchScore('log', app('Log viewer')) > 0);
    assert.ok(matchScore('view', app('Log viewer')) > 0);
    assert.ok(matchScore('lgv', app('Log viewer')) > 0);
    assert.ok(matchScore('4666', app('dashboard', 'dashboard', 4666)) > 0);
    assert.ok(matchScore('feature-a', app('dashboard', 'dashboard @ feature-a')) > 0);
    assert.equal(matchScore('', app('x')), 1);
  });

  test('every word must match, and loose letters scattered over a URL do not', () => {
    assert.equal(matchScore('log nope', app('Log viewer')), 0);
    assert.equal(matchScore('log', app('Runbooks', 'runbooks.example.org')), 0);
    assert.equal(matchScore('gv', app('Log viewer')), 0, 'an abbreviation starts a word');
  });

  test('a match on the name outranks one on another field', () => {
    assert.ok(matchScore('slides', app('Slides')) > matchScore('slides', app('Deck', '~/Code/slides')));
  });
});

describe('door paint', () => {
  test('hashing is stable and spreads over the paints', () => {
    assert.equal(hash('slides'), hash('slides'));
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(paintIndex));
    assert.ok(seen.size >= 5);
    assert.ok([...seen].every((i) => i >= 0 && i < PAINTS));
  });

  test('monograms', () => {
    assert.equal(monogram('Log viewer'), 'LV');
    assert.equal(monogram('slides'), 'S');
    assert.equal(monogram('teamMetrics'), 'TM');
    assert.equal(monogram('dashboard @ feature-a'), 'DF');
    assert.equal(monogram('***'), '?');
  });

  test('the dominant colour skips white, black and grey, and needs more than a stray pixel', () => {
    const px = (r: number, g: number, b: number, a = 255, n = 1) => Array.from({ length: n }, () => [r, g, b, a]).flat();
    const icon = [...px(255, 255, 255, 255, 40), ...px(0, 0, 0, 255, 30), ...px(31, 158, 116, 255, 20), ...px(200, 30, 30, 255, 3), ...px(31, 158, 116, 0, 50)];
    assert.equal(dominantColour(icon), '#1f9e74');
    assert.equal(dominantColour([...px(128, 128, 128, 255, 100)]), null);
    assert.equal(dominantColour([...px(255, 255, 255, 255, 100), ...px(200, 30, 30)]), null);
  });

  test('every door paint is a token', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/theme/tokens.css'), 'utf8');
    for (let i = 0; i < PAINTS; i++) assert.match(css, new RegExp(`--hw-paint-${i}:`));
  });
});

describe('theme contrast', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/theme/tokens.css'), 'utf8');
  const split = css.indexOf(":root[data-theme='light']");
  const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--hw-([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!]));
  const dark = tokens(css.slice(0, split));
  const light = { ...dark, ...tokens(css.slice(split)) };
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };
  const TEXT = ['text', 'text-muted', 'text-subtle', 'accent-text', 'healthy', 'unhealthy', 'down', 'stopped', 'unknown', 'starting'];

  for (const [name, t] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    test(`${name}: every text and state colour is at least 4.5:1 on the page and on cards`, () => {
      for (const fg of TEXT)
        for (const bg of ['bg', 'bg-raised']) {
          assert.ok(t[fg] && t[bg], `--hw-${fg} / --hw-${bg} defined`);
          const r = ratio(t[fg]!, t[bg]!);
          assert.ok(r >= 4.5, `${name} --hw-${fg} on --hw-${bg}: ${r.toFixed(2)}:1`);
        }
    });
  }

  test('the light accent is not used as text (it is under 4.5:1); its text variant is', () => {
    assert.ok(ratio(light.accent!, light.bg!) < 4.5);
    assert.ok(ratio(light['accent-text']!, light.bg!) >= 4.5);
    const styles = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
    assert.doesNotMatch(styles, /(?<![-\w])color:\s*var\(--hw-accent\)/, 'text uses --hw-accent-text, never --hw-accent');
  });

  test('no colour is hard-coded outside tokens.css (D28)', () => {
    const styles = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
    assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});

describe('lost at last reboot', () => {
  const item = (back: boolean, extra: object = {}) =>
    ({ id: 'x', port: 1, label: 'x', slug: null, managed: false, title: null, firstSeen: null, lastSeen: null, back, suggestedSlug: null, command: null, cwd: null, identity: { projectDir: null, cwd: null, branch: null, command: null }, ...extra }) as never;
  const notice = (...items: never[]) => ({ bootTime: '2026-09-28T20:05:00Z', previousBootTime: null, detectedAt: '', items });

  test('the count: lost, some back, all back', () => {
    assert.equal(lostCount(notice(item(false), item(false), item(false))).text, '3 apps');
    assert.equal(lostCount(notice(item(false))).text, '1 app');
    assert.equal(lostCount(notice(item(false), item(true), item(true))).text, '1 app · 2 back');
    assert.equal(lostCount(notice(item(true), item(true))).text, 'all 2 are back');
    assert.equal(lostCount(notice(item(true))).text, 'it’s back');
  });

  test('when, where and the command', () => {
    assert.match(bootLabel('2026-09-28T20:05:00'), /^Mon 28 Sept? 20:05$/);
    assert.equal(bootLabel('nope'), 'unknown');
    const i = item(false, { identity: { projectDir: '/home/me/Code/viz', cwd: '/home/me/Code/viz/web', branch: 'feature/x', command: 'node x' }, command: ['node', '/home/me/Code/viz/dev.js'] });
    assert.equal(lostWhere(i, '/home/me'), '~/Code/viz @ feature/x');
    assert.equal(lostCommand(i, '/home/me'), 'node ~/Code/viz/dev.js');
    assert.equal(lostWhere(item(false), '/home/me'), null);
    assert.equal(lostCommand(item(false), null), null);
  });
});
