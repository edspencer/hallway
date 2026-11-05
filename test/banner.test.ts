// The startup text (server/banner.ts): the HALLWAY banner only on a terminal (or with FORCE_COLOR), colour by Node's
// rules, a one-line title on a narrow terminal, and on stderr; stdout's first line always `Hallway <version>: <url>` (the
// CLI contract's, D75), with "Data home:" after it, for scripts; the local-domains hint in direct mode (D63); the npx hint (D61); --quiet and `npm run dev` just the line.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyRunning, bannerLines, startupMessage, type Startup, type Terminal } from '../server/banner.ts';

const o: Startup = {
  version: '1.2.3',
  url: 'http://localhost:4255',
  home: '~/.hallway',
  dashboardUrl: null,
  localDomains: { dashboard: 'https://hallway.localhost', app: 'https://<app>.localhost' },
  transient: null,
};
const parts = (t: Partial<Terminal>, extra: Partial<Startup> = {}) => startupMessage({ ...o, ...extra }, { env: {}, ...t });
/** What a terminal shows: the banner (stderr) first, then stdout's text. */
const msg = (t: Partial<Terminal>, extra: Partial<Startup> = {}) => {
  const r = parts(t, extra);
  return r.banner + r.text;
};
const ESC = '\x1b[';
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('startup banner', () => {
  test('HALLWAY: 6 rows of half blocks that fit 80 columns with a margin', () => {
    const lines = bannerLines();
    assert.equal(lines.length, 6);
    assert.ok(Math.max(...lines.map((l) => l.length)) <= 78);
    assert.ok(lines.every((l) => /^[ █▀▄]+$/.test(l)));
  });

  test('not a terminal (a service log, a pipe): no banner, no colour; the line, the data home, then the hint', () => {
    const text = msg({ isTTY: false });
    assert.ok(!text.includes(ESC) && !text.includes('█'));
    assert.equal(
      text,
      [
        'Hallway 1.2.3: http://localhost:4255',
        'Data home: ~/.hallway',
        '',
        'Local domains are off. Run hallway setup to reach this dashboard at',
        'https://hallway.localhost and each app at https://<app>.localhost',
        '(by default with no admin needed; setup prints each step before it runs).',
        '',
      ].join('\n'),
    );
  });

  test('a truecolor terminal: the banner in copper-to-amber, the version, the command in bold', () => {
    const text = msg({ isTTY: true, columns: 100, depth: 24 });
    assert.match(text, /\x1b\[38;2;204;116;64m/);
    assert.match(text, /\x1b\[38;2;222;150;56m/);
    assert.ok(text.includes('\x1b[1mhallway setup\x1b[22m'));
    const p = plain(text);
    assert.ok(p.includes(bannerLines()[0]!));
    assert.match(p, /^ v1\.2\.3$/m);
    assert.match(p, /^Hallway 1\.2\.3: http:\/\/localhost:4255\nData home: ~\/\.hallway\n/m, 'scripts/smoke-pack.mjs waits for these two lines together');
  });

  test("on a terminal the banner is stderr's, so stdout's first line is still the contract's (D75)", () => {
    const r = parts({ isTTY: true, columns: 100, depth: 24 });
    assert.ok(plain(r.banner).includes(bannerLines()[0]!));
    assert.equal(r.text.split('\n')[0], 'Hallway 1.2.3: http://localhost:4255');
    assert.ok(!r.text.includes('█'));
    // stderr a terminal, stdout piped: the banner, but no colour on stdout
    const piped = startupMessage(o, { env: {}, isTTY: false }, { env: {}, isTTY: true, depth: 24 });
    assert.ok(piped.banner.includes(ESC));
    assert.ok(!piped.text.includes(ESC));
    // stdout a terminal, stderr piped (2>log): no banner, nothing drawn into the log
    assert.equal(startupMessage(o, { env: {}, isTTY: true, depth: 24 }, { env: {}, isTTY: false }).banner, '');
  });

  test('256 and 16 colours', () => {
    assert.match(msg({ isTTY: true, depth: 8 }), /\x1b\[38;5;\d+m/);
    assert.ok(msg({ isTTY: true, depth: 4 }).includes('\x1b[33m'));
  });

  test("NO_COLOR on a terminal: the banner, without colour (Node's own detection)", () => {
    const text = msg({ isTTY: true, env: { NO_COLOR: '1' } });
    assert.ok(text.includes(bannerLines()[0]!));
    assert.ok(!text.includes(ESC));
  });

  test('FORCE_COLOR: the banner even when piped; FORCE_COLOR=0 none', () => {
    assert.match(msg({ isTTY: false, env: { FORCE_COLOR: '3' } }), /\x1b\[38;2;/);
    assert.ok(!msg({ isTTY: false, env: { FORCE_COLOR: '0' } }).includes('█'));
  });

  test('every line fits 80 columns', () => {
    for (const l of plain(msg({ isTTY: true, columns: 80, depth: 24 }, { transient: "npx's cache" })).split('\n')) assert.ok(l.length <= 80, l);
  });

  test("a terminal that doesn't say how wide it is (0 columns): the banner, as for 80", () => {
    assert.ok(msg({ isTTY: true, columns: 0, depth: 1 }).includes(bannerLines()[0]!));
  });

  test('a narrow terminal: a one-line title instead', () => {
    const text = msg({ isTTY: true, columns: 40, depth: 1 });
    assert.ok(!text.includes('█'));
    assert.ok(text.startsWith('\n ▌ HALLWAY v1.2.3\n\nHallway 1.2.3: '));
  });

  test('fronted mode: the dashboard address, the direct one as a fallback, and no hint', () => {
    const text = msg({ isTTY: false }, { dashboardUrl: 'https://hallway.localhost', localDomains: null });
    assert.match(text, /^Dashboard: https:\/\/hallway\.localhost {2}\(http:\/\/localhost:4255 works too\)$/m);
    assert.doesNotMatch(text, /Local domains are off/);
    assert.ok(text.startsWith('Hallway 1.2.3: http://localhost:4255\nData home: ~/.hallway\n'));
  });

  test('where fronted mode can’t work (Windows): no hint', () => {
    assert.equal(msg({ isTTY: false }, { localDomains: null }), 'Hallway 1.2.3: http://localhost:4255\nData home: ~/.hallway\n');
  });

  test('from npx: one line on how to keep it running', () => {
    const text = msg({ isTTY: false }, { transient: "npx's cache", localDomains: null });
    assert.match(text, /^Running from npx's cache, so it stops with this terminal\. To keep it running:\n {2}npm i -g hallway && hallway service install\n$/m);
  });

  test('notes (files with errors) come after the data home', () => {
    const text = msg({ isTTY: false }, { notes: ['1 file has errors (shown on the dashboard): apps/x.yaml'], localDomains: null });
    assert.equal(text, 'Hallway 1.2.3: http://localhost:4255\nData home: ~/.hallway\n1 file has errors (shown on the dashboard): apps/x.yaml\n');
  });

  test('--quiet (the service jobs) and npm run dev: just the line, even on a terminal', () => {
    for (const extra of [{ quiet: true }, { dev: true }, { quiet: true, transient: "npx's cache" }])
      assert.equal(msg({ isTTY: true, depth: 24 }, extra), 'Hallway 1.2.3: http://localhost:4255\n');
  });

  test('already running: where, and the fronted address first when there is one', () => {
    assert.equal(alreadyRunning({ url: 'http://localhost:4255', version: '1.2.3', dashboardUrl: null }), 'Hallway is already running at http://localhost:4255, version 1.2.3. Nothing to do.\n');
    assert.equal(
      alreadyRunning({ url: 'http://localhost:4255', version: '1.2.3', dashboardUrl: 'https://hallway.localhost' }),
      'Hallway is already running at https://hallway.localhost (and http://localhost:4255), version 1.2.3. Nothing to do.\n',
    );
  });
});
