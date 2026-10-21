// The dashboard's pure logic (src/lib/): state counts and the tab title (D22), formatting, the filter, door paint;
// and the theme tokens' contrast (docs/05-ui.md: state colours must pass in both themes).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AppHealth, FrontingInfo } from '../shared/api.ts';
import { BRAND_REGISTRY, explicitBrandSlug, matchBrand } from '../src/lib/brands.ts';
import { PAINTS, dominantColour, hash, monogram, paintIndex } from '../src/lib/colour.ts';
import { matchScore } from '../src/lib/filter.ts';
import { ago, displayUrl, duration, homeDir, hostOf, millis, percent, shorten, slugify, tildify } from '../src/lib/format.ts';
import { TIER_LABEL, checksSummary, conflictHeadline, conflictProcess, conflictWhere, domainsView, failedWords, hostOfUrl, withPort, initialTier, logTail, runningWords, tierChoices, turnOnPhase } from '../src/lib/domains.ts';
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

describe('brand icons (D66)', () => {
  const ollama = () => BRAND_REGISTRY.find((b) => b.slug === 'ollama')!;

  test('every entry has a title, a 6-digit hex and at least one SVG path', () => {
    assert.ok(BRAND_REGISTRY.length > 20);
    for (const b of BRAND_REGISTRY) {
      assert.match(b.hex, /^#[0-9a-f]{6}$/, b.slug);
      assert.ok(b.title.length > 0, b.slug);
      assert.ok(b.path.length > 0, b.slug);
      assert.ok(b.keywords.length > 0, b.slug);
    }
  });

  test('no two entries share a well-known port (an ambiguous hint is worse than none)', () => {
    const seen = new Map<number, string>();
    for (const b of BRAND_REGISTRY) for (const p of b.ports) assert.ok(!seen.has(p) && seen.set(p, b.slug), `port ${p}: ${b.slug} vs ${seen.get(p)}`);
  });

  test('matches Ollama by its process name, its command, its supervisor label, or its port alone', () => {
    assert.equal(matchBrand({ process: 'ollama' })?.slug, 'ollama');
    assert.equal(matchBrand({ command: '/opt/homebrew/bin/ollama serve' })?.slug, 'ollama');
    assert.equal(matchBrand({ supervisorLabel: 'homebrew.mxcl.ollama' })?.slug, 'ollama');
    assert.equal(matchBrand({ port: 11434 })?.slug, 'ollama');
    assert.equal(matchBrand({ name: 'Ollama' })?.slug, 'ollama');
  });

  test('never matches a bare runtime, language or generic server module', () => {
    for (const hints of [{ process: 'node' }, { process: 'python3' }, { command: 'python3 -m http.server' }, { command: 'node dist/index.js' }, { process: 'bun' }, { name: 'My App' }, { port: 3000 }])
      assert.equal(matchBrand(hints), null, JSON.stringify(hints));
  });

  test('a port only matches when nothing else does; a real signal wins even if a contradicting port is given', () => {
    assert.equal(matchBrand({ process: 'postgres', port: 11434 })?.slug, 'postgresql', 'the process name is a real signal, the port a weak and contradicting one');
    assert.equal(matchBrand({ process: 'node', port: 5432 })?.slug, 'postgresql', 'with no other signal, the port alone is still a hint');
  });

  test('matching only runs for icon: auto (or unset); a configured custom icon is left to the monogram', () => {
    assert.equal(matchBrand({ process: 'ollama', icon: 'auto' })?.slug, 'ollama');
    assert.equal(matchBrand({ process: 'ollama', icon: null })?.slug, 'ollama');
    assert.equal(matchBrand({ process: 'ollama' })?.slug, 'ollama');
    assert.equal(matchBrand({ process: 'ollama', icon: '🦙' }), null);
    assert.equal(matchBrand({ process: 'ollama', icon: 'https://example.com/icon.png' }), null);
    assert.equal(matchBrand({ process: 'ollama', icon: '/images/custom.png' }), null);
  });

  test('icon: si:<slug> is explicit and wins over every hint, even a contradicting one', () => {
    assert.equal(matchBrand({ icon: 'si:postgresql', process: 'ollama', port: 11434 })?.slug, 'postgresql');
    assert.equal(explicitBrandSlug('si:ollama'), 'ollama');
    assert.equal(explicitBrandSlug('auto'), null);
    assert.equal(explicitBrandSlug(null), null);
  });

  test('an unknown si: slug is a miss, not a fall-through to auto-matching', () => {
    assert.equal(matchBrand({ icon: 'si:not-a-real-brand', process: 'ollama' }), null);
  });

  test('a custom registry (tests) is used verbatim: Ollama is only in the real one', () => {
    assert.equal(matchBrand({ process: 'ollama' }, []), null);
    assert.equal(matchBrand({ process: 'ollama' }, [ollama()])?.slug, 'ollama');
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

describe('local domains (D63)', () => {
  const f = (o: Partial<FrontingInfo> = {}): FrontingInfo => ({ unsupported: null, mode: 'direct', trust: null, dashboardUrl: 'https://hallway.localhost', appUrl: 'https://<app>.localhost', base: 'localhost', pushError: null, ...o });
  const st = (fronting: FrontingInfo | null | undefined, localDomains?: boolean) =>
    ({ fronting, config: { config: { dashboard: localDomains === undefined ? {} : { hints: { localDomains } } } } }) as Parameters<typeof domainsView>[0];

  test('direct mode on a platform that can: the panel, and the header control says off', () => {
    assert.deepEqual(domainsView(st(f(), true)), { header: 'off', panel: true, fronting: f() });
    assert.equal(domainsView(st(f())).panel, true, 'a config view without hints (an older daemon) reads as show');
  });
  test('dismissed: no panel, but the header control stays to bring it back', () => {
    assert.deepEqual(domainsView(st(f(), false)), { header: 'off', panel: false, fronting: f() });
  });
  test('fronted mode: no panel, the header shows it on', () => {
    const v = domainsView(st(f({ mode: 'fronted' }), true));
    assert.equal(v.header, 'on');
    assert.equal(v.panel, false);
  });
  test('Windows (setup refuses) and daemons without the field: nothing at all', () => {
    for (const x of [f({ unsupported: 'Local domains aren’t available on Windows.' }), null, undefined]) assert.deepEqual(domainsView(st(x, true)), { header: 'hidden', panel: false, fronting: x ?? null });
  });
  test("checks: checking until they arrive; the worst status wins; problems first, fails before warnings", () => {
    assert.equal(checksSummary(null).tone, 'checking');
    assert.equal(checksSummary(null, 'connect ENOENT').tone, 'fail', 'a failed push needs no checks to be a problem');
    assert.deepEqual(checksSummary([{ id: 'a', status: 'pass', message: 'ok' }, { id: 'b', status: 'skip', message: '-' }]), { tone: 'ok', problems: [], text: 'Working' });
    const s = checksSummary([
      { id: 'w', status: 'warn', message: 'w' },
      { id: 'f', status: 'fail', message: 'f' },
      { id: 'p', status: 'pass', message: 'p' },
    ]);
    assert.equal(s.tone, 'fail');
    assert.equal(s.text, '1 problem');
    assert.deepEqual(s.problems.map((c) => c.id), ['f', 'w']);
    assert.equal(checksSummary([{ id: 'w', status: 'warn', message: 'w' }, { id: 'v', status: 'warn', message: 'v' }]).text, '2 warnings');
    assert.equal(checksSummary([{ id: 'p', status: 'pass', message: 'p' }], 'boom').tone, 'fail');
  });
  test('the header shows the host', () => {
    assert.equal(hostOfUrl('https://hallway.localhost'), 'hallway.localhost');
    assert.equal(hostOfUrl('https://myname.internal:4443/'), 'myname.internal:4443');
  });
});

describe('local domains: the tiers (D65, D70)', () => {
  const tier = (trust: 'user' | 'system' | 'none', recommended = trust === 'user') => ({ trust, name: trust, url: '', asks: '', note: '', command: `hallway setup --trust ${trust}`, recommended, canTurnOn: trust !== 'system' });
  test('the panel opens on the recommended tier, else the first', () => {
    assert.equal(initialTier([tier('user'), tier('system'), tier('none')]), 'user');
    assert.equal(initialTier([tier('system', false), tier('none', true)]), 'none');
    assert.equal(initialTier([tier('system', false), tier('none', false)]), 'system');
    assert.equal(initialTier([]), null);
  });
  test('a Turn on: running until the daemon answers, then done or failed (a refusal is failed too)', () => {
    const job = (state: 'running' | 'done' | 'failed') => ({ state, trust: 'user' as const, log: '', error: state === 'failed' ? 'that failed (exit 1)' : null });
    assert.equal(turnOnPhase(null), null);
    assert.equal(turnOnPhase({ trust: 'user', job: null, error: null }), 'running', 'before the first answer');
    assert.equal(turnOnPhase({ trust: 'user', job: job('running'), error: null }), 'running');
    assert.equal(turnOnPhase({ trust: 'user', job: job('done'), error: null }), 'done');
    assert.equal(turnOnPhase({ trust: 'user', job: job('failed'), error: null }), 'failed');
    assert.equal(turnOnPhase({ trust: 'none', job: null, error: 'this needs sudo once' }), 'failed');
  });
  test('the words: a Mac waits on Touch ID for User certificate; a stop names the likely cause without asserting it', () => {
    assert.equal(runningWords('user', true).title, 'Waiting for Touch ID…');
    assert.equal(runningWords('user', false).title, 'Turning on…');
    assert.equal(runningWords('none', true).title, 'Turning on…');
    assert.match(failedWords('user', true).detail, /^If the Touch ID prompt was cancelled or went unanswered, run it in a terminal instead:$/);
    assert.match(failedWords('none', true).detail, /^Run it in a terminal instead/);
  });
  test("the stop's reason picks the words (D71): Touch ID only when the dialog's step failed (or an older daemon didn't say)", () => {
    assert.match(failedWords('user', true, 'dialog').detail, /Touch ID/);
    for (const r of ['ports', 'refused', 'sudo', 'failed'] as const) assert.doesNotMatch(failedWords('user', true, r).detail, /Touch ID/, r);
    assert.match(failedWords('user', true, 'sudo').detail, /needs sudo/);
  });
  test('a port conflict, for people; an address on another port', () => {
    const c = { ports: [443, 80], kind: 'standard' as const, pid: 7090, process: 'ssh', command: 'ssh: ~/x', addresses: ['*'], exposed: true, tool: { id: 'rancher-desktop' as const, name: 'Rancher Desktop' }, container: null, fix: [] };
    assert.equal(conflictHeadline(c), 'Ports 443 and 80 are taken by Rancher Desktop');
    assert.equal(conflictProcess(c), 'ssh, pid 7090');
    assert.deepEqual(conflictWhere(c), { text: 'Listening on every address (*): reachable from your network, not just this machine', exposed: true });
    assert.equal(conflictHeadline({ ...c, ports: [443], tool: null, pid: null, process: null }), 'Port 443 is taken by a process you can’t see');
    assert.equal(withPort('https://<app>.localhost', 4443), 'https://<app>.localhost:4443');
    assert.equal(withPort('https://hallway.localhost:4443', 443), 'https://hallway.localhost');
    assert.equal(withPort('http://review.localhost', 4480), 'http://review.localhost:4480');
  });
  test('an older daemon sends no tiers (the panel falls back to the two commands); the log tail is the last lines; the header names', () => {
    assert.deepEqual(tierChoices({ unsupported: null, mode: 'direct', trust: null, dashboardUrl: '', appUrl: '', base: 'localhost', pushError: null }), []);
    assert.equal(logTail('a\nb\nc\nd\n', 2), 'c\nd');
    assert.deepEqual(TIER_LABEL, { user: 'user certificate', system: 'system-wide certificate', none: 'no HTTPS' });
  });
});
