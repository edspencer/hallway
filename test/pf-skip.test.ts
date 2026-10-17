// pf told to skip loopback (D64): the macOS parsers against test/fixtures/platform/pfctl-*.txt, the diagnosis, the
// read-only queries it runs (through `sudo -n`, mocked), and what doctor and setup do with it. Nothing here runs pfctl;
// CI's "Fronted mode (real pf, keychain)" job does, with a ruleset that sets the skip.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { platformFor } from '../server/platform/index.ts';
import type { LoopbackSkip } from '../server/platform/fronting.ts';
import type { RunResult } from '../server/platform/services.ts';
import { BREW_ENV, darwinFronting, diagnoseLoopbackSkip, loopbackSkip, parsePfReferences, parsePfSkipped, pfConfSkipsLoopback, stockMainRuleset } from '../server/platform/fronting-darwin.ts';
import { nothingOn443 } from '../server/proxy/doctor.ts';
import { type Facts, NO_ACTIONS, type Step, formatPlan, planSetup, runPlan } from '../server/proxy/setup.ts';
import { ROOT, rmTmp, tmpDir } from './fixture.ts';

const fx = (name: string) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'platform', name), 'utf8');
const STOCK = { interfaces: fx('pfctl-interfaces-skip.txt'), references: fx('pfctl-references.txt'), nat: fx('pfctl-nat-stock.txt'), rules: fx('pfctl-rules-stock.txt'), pfConf: fx('pf.conf') };
const RELOAD = 'sudo pfctl -f /etc/pf.conf && sudo launchctl kickstart -k system/hallway.pf';

describe('the parsers', () => {
  test('`pfctl -s Interfaces -v`: the skipped interfaces', () => {
    assert.deepEqual([...parsePfSkipped(fx('pfctl-interfaces-skip.txt'))], ['lo0']);
    assert.deepEqual([...parsePfSkipped(fx('pfctl-interfaces.txt'))], []);
    assert.deepEqual([...parsePfSkipped('lo (skip)\nlo0 (skip)\nen0\n')], ['lo', 'lo0']);
  });

  test('`pfctl -s References`: who holds pf enabled', () => {
    assert.deepEqual(parsePfReferences(fx('pfctl-references.txt')), [
      { pid: 412, name: 'pfd' },
      { pid: 88213, name: 'pfctl' },
    ]);
    assert.deepEqual(parsePfReferences('TOKENS:\nPID      Process Name                 TOKEN                    TIMESTAMP\n'), []);
    assert.deepEqual(parsePfReferences('618      Some VPN Helper              9813589183660731843      0 days 00:03:31\n'), [{ pid: 618, name: 'Some VPN Helper' }]);
  });

  test('/etc/pf.conf setting the skip itself', () => {
    assert.equal(pfConfSkipsLoopback(fx('pf.conf')), false, "macOS's stock pf.conf");
    for (const yes of ['set skip on lo0\n', 'set skip on { lo0 en0 }\n', '  set skip on {en0,lo0}', 'set skip on lo', 'set skip on \\\n  lo0\n']) assert.equal(pfConfSkipsLoopback(yes), true, yes);
    for (const no of ['# set skip on lo0\n', 'set skip on en0\n', 'pass on lo0 all\n', 'set skip on lo01\n']) assert.equal(pfConfSkipsLoopback(no), false, no);
  });

  test("the main ruleset is macOS's stock one: only the com.apple hooks, the rdr one among them", () => {
    assert.equal(stockMainRuleset(fx('pfctl-nat-stock.txt'), fx('pfctl-rules-stock.txt')), true);
    assert.equal(stockMainRuleset(fx('pfctl-nat-stock.txt'), fx('pfctl-rules-killswitch.txt')), false, "a kill switch's rules would be dropped");
    assert.equal(stockMainRuleset('nat-anchor "com.apple/*" all\n', fx('pfctl-rules-stock.txt')), false, 'no rdr hook');
    assert.equal(stockMainRuleset(`${fx('pfctl-nat-stock.txt')}rdr-anchor "com.apple.internet-sharing/*" all\n`, fx('pfctl-rules-stock.txt')), false, "a system service's own hook");
    assert.equal(stockMainRuleset('', ''), false, 'an empty ruleset (`pfctl -f` of a file with no anchors)');
  });
});

describe('the diagnosis', () => {
  test("couldn't check (no root): null, with how to let it look", () => {
    const d = diagnoseLoopbackSkip({ interfaces: null, references: null, nat: null, rules: null, pfConf: null });
    assert.equal(d.skipped, null);
    assert.equal(d.repairable, false);
    assert.match(d.fix, /sudo -v/);
  });

  test('not skipped', () => {
    assert.equal(diagnoseLoopbackSkip({ ...STOCK, interfaces: fx('pfctl-interfaces.txt') }).skipped, false);
  });

  test("skipped, stock ruleset, pf.conf doesn't set it: repairable, names the enabler but not Hallway's own pfctl", () => {
    const d = diagnoseLoopbackSkip(STOCK);
    assert.equal(d.skipped, true);
    assert.equal(d.repairable, true);
    assert.equal(d.message, 'pf is set to skip loopback (lo0), so the redirect is ignored; something other than Hallway set this (pf was turned on by pfd (pid 412), which may be what set it)');
    assert.ok(d.fix.includes(`\`${RELOAD}\``));
    assert.match(d.fix, /`hallway setup`/);
    assert.match(d.fix, /comes back/);
    assert.ok(!d.message.includes('pfctl'));
  });

  test('skipped, and nobody but pfctl holds pf enabled: no enabler named', () => {
    const d = diagnoseLoopbackSkip({ ...STOCK, references: 'TOKENS:\nPID Process Name TOKEN TIMESTAMP\n88213    pfctl    4411938712204416611      0 days 00:01:17\n' });
    assert.match(d.message, /set this$/);
  });

  test("skipped, and /etc/pf.conf sets it: reloading won't help, and setup won't", () => {
    const d = diagnoseLoopbackSkip({ ...STOCK, pfConf: `set skip on lo0\n${fx('pf.conf')}` });
    assert.equal(d.repairable, false);
    assert.match(d.fix, /\/etc\/pf\.conf itself says `set skip on lo0`, so loading it again won't help/);
  });

  test("skipped, and the main ruleset has someone's rules: reloading would drop them, so only advice", () => {
    const d = diagnoseLoopbackSkip({ ...STOCK, rules: fx('pfctl-rules-killswitch.txt') });
    assert.equal(d.repairable, false);
    assert.match(d.fix, /would drop them/);
    assert.equal(diagnoseLoopbackSkip({ ...STOCK, nat: null }).repairable, false, "couldn't read the ruleset");
  });
});

/** A runner answering `sudo -n pfctl …` from fixtures; it records every call. */
function pfRunner(answers: Record<string, string | null>) {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push([cmd, ...args].join(' '));
    const out = answers[args.slice(3).join(' ')];
    return out == null ? { code: 1, stdout: '', stderr: 'sudo: a password is required' } : { code: 0, stdout: out, stderr: '' };
  };
  return { run, calls };
}

describe('asking pf', () => {
  test('read-only queries only, every one through `sudo -n` (it never prompts)', async () => {
    const r = pfRunner({ 'Interfaces -v': STOCK.interfaces, References: STOCK.references, nat: STOCK.nat, rules: STOCK.rules });
    const d = await loopbackSkip(r.run, () => STOCK.pfConf);
    assert.equal(d.repairable, true);
    assert.deepEqual(r.calls, ['sudo -n pfctl -s Interfaces -v', 'sudo -n pfctl -s References', 'sudo -n pfctl -s nat', 'sudo -n pfctl -s rules']);
  });

  test('not skipped: one query', async () => {
    const r = pfRunner({ 'Interfaces -v': fx('pfctl-interfaces.txt') });
    assert.equal((await loopbackSkip(r.run, () => null)).skipped, false);
    assert.equal(r.calls.length, 1);
  });

  test('no cached sudo password: null', async () => {
    const r = pfRunner({});
    assert.equal((await loopbackSkip(r.run, () => null)).skipped, null);
  });
});

describe('doctor: nothing answers on 443', () => {
  const darwin = platformFor('darwin');
  const q = (answers: Record<string, string | null>) => pfRunner(answers).run;

  test('pf skips lo0: the specific line, with the fix', async () => {
    const c = await nothingOn443({ platform: darwin, query: q({ 'Interfaces -v': STOCK.interfaces, References: STOCK.references, nat: STOCK.nat, rules: STOCK.rules }) }, 443, 4443, false);
    assert.equal(c.id, 'redirect');
    assert.equal(c.status, 'fail');
    assert.match(c.message, /^pf is set to skip loopback \(lo0\), so the redirect is ignored; something other than Hallway set this \(pf was turned on by pfd/);
    assert.ok(c.fix!.includes(RELOAD));
  });

  test("it doesn't: the generic line", async () => {
    const c = await nothingOn443({ platform: darwin, query: q({ 'Interfaces -v': fx('pfctl-interfaces.txt') }) }, 443, 4443, false);
    assert.equal(c.message, "nothing answers on 127.0.0.1:443: the redirect from 443 to 4443 isn't in place");
  });

  test("couldn't check: the generic line, and how to let it look", async () => {
    const c = await nothingOn443({ platform: darwin, query: q({}) }, 443, 4443, false);
    assert.match(c.message, /isn't in place$/);
    assert.match(c.fix!, /couldn't check without a password prompt: `sudo -v`/);
  });

  test('Linux, or no redirect: pf is never asked', async () => {
    const trap = async (): Promise<RunResult> => assert.fail('nothing should run');
    assert.match((await nothingOn443({ platform: platformFor('linux'), query: trap }, 443, 4443, false)).message, /isn't in place/);
    assert.equal((await nothingOn443({ platform: darwin, query: trap }, 4443, 4443, true)).message, 'nothing answers on 127.0.0.1:4443');
  });
});

const HOME = '/home/me/.hallway';
const skip = (s: Partial<LoopbackSkip>): LoopbackSkip => ({ skipped: true, message: 'pf is set to skip loopback (lo0)', fix: 'do the thing', repairable: true, ...s });
function darwinFacts(over: Partial<Facts> = {}): Facts {
  return {
    platform: 'darwin',
    base: 'localhost',
    custom: false,
    dashboard: 'hallway.localhost',
    httpsPort: 4443,
    httpPort: 4480,
    dnsPort: 4253,
    noRedirect: false,
    tld: null,
    caddy: { path: '/opt/homebrew/bin/caddy', version: 'v2.11.7', install: { advice: 'x' } },
    dnsmasq: null,
    conflicts: [],
    warnings: [],
    env: { setupDir: `${HOME}/generated/setup`, rootCert: `${HOME}/root.crt`, rootSha1: null, httpsPort: 4443, httpPort: 4480, dnsPort: 4253, base: 'localhost', userHome: '/home/me', tools: { nft: null, certutil: null, systemctl: null, resolved: false, caStore: null } },
    done: { trust: false, redirect: false, resolver: false, config: false },
    ...over,
  };
}
const unskipStep = (steps: Step[]) => steps.find((s) => s.kind === 'run' && s.recipe.cmds.some((c) => c.argv.join(' ') === 'pfctl -f /etc/pf.conf'));

describe('setup', () => {
  const darwin = platformFor('darwin');

  test("couldn't check yet: a conditional step right after the redirect, checked again just before it runs", () => {
    const p = planSetup(darwinFacts({ loopbackSkip: skip({ skipped: null, repairable: false }) }), darwin, HOME);
    const i = p.steps.findIndex((s) => /^Redirect loopback/.test(s.why));
    const s = unskipStep(p.steps);
    assert.ok(s && p.steps[i + 1] === s, 'right after the redirect');
    assert.match(s.why, /^If pf has been told to skip loopback \(lo0\)/);
    assert.match(formatPlan(p), /\$ sudo pfctl -f \/etc\/pf\.conf\n {5}\$ sudo launchctl kickstart -k system\/hallway\.pf/);
  });

  test('known to be skipped and repairable: the step; known not to be, or the redirect works: none', () => {
    assert.match(unskipStep(planSetup(darwinFacts({ loopbackSkip: skip({}) }), darwin, HOME).steps)!.why, /^Make pf stop skipping loopback/);
    assert.equal(unskipStep(planSetup(darwinFacts({ loopbackSkip: skip({ skipped: false }) }), darwin, HOME).steps), undefined);
    assert.equal(unskipStep(planSetup(darwinFacts({ loopbackSkip: null, done: { trust: true, redirect: true, resolver: true, config: true } }), darwin, HOME).steps), undefined);
    assert.equal(unskipStep(planSetup(darwinFacts({ loopbackSkip: skip({}), noRedirect: true }), darwin, HOME).steps), undefined);
  });

  test("skipped but not safe to clear: advice, and setup doesn't touch it", () => {
    const p = planSetup(darwinFacts({ loopbackSkip: skip({ repairable: false, fix: '/etc/pf.conf itself says `set skip on lo0`' }) }), darwin, HOME);
    assert.equal(unskipStep(p.steps), undefined);
    assert.match(p.warnings.join('\n'), /Hallway won't change that itself: \/etc\/pf\.conf itself says/);
  });

  test('the recheck: not needed, not safe, or run', async () => {
    const at = async (now: LoopbackSkip | null) => {
      const p = planSetup(darwinFacts({ loopbackSkip: skip({ skipped: null, repairable: false }) }), darwin, HOME, { ...NO_ACTIONS, loopbackSkip: async () => now });
      const ran: string[] = [];
      let out = '';
      await runPlan({ ...p, steps: [unskipStep(p.steps)!] }, { out: (s) => (out += s), exec: async (argv) => (ran.push(argv.join(' ')), 0) });
      return { ran, out };
    };
    const no = await at(skip({ skipped: false }));
    assert.deepEqual(no.ran, []);
    assert.match(no.out, /not needed: pf doesn't skip loopback/);
    assert.deepEqual((await at(null)).ran, []);
    assert.match((await at(skip({ skipped: null }))).out, /couldn't ask pf/);
    const unsafe = await at(skip({ repairable: false, fix: 'take lo0 out' }));
    assert.deepEqual(unsafe.ran, []);
    assert.match(unsafe.out, /not done: pf is set to skip loopback \(lo0\)\. take lo0 out/);
    assert.deepEqual((await at(skip({}))).ran, ['sudo pfctl -f /etc/pf.conf', 'sudo launchctl kickstart -k system/hallway.pf']);
  });

  test('Linux has no such step', () => {
    const f = darwinFacts({ platform: 'linux', loopbackSkip: skip({ skipped: null }) });
    f.env.tools = { nft: '/usr/sbin/nft', certutil: null, systemctl: '/usr/bin/systemctl', resolved: true, caStore: 'debian' };
    assert.equal(unskipStep(planSetup(f, platformFor('linux'), HOME).steps), undefined);
  });
});

describe('quieter setup output (the same real-Mac run)', () => {
  test("the first bootout's \"No such process\" isn't shown: its stderr is dropped", async () => {
    const r = darwinFronting.redirect(darwinFacts().env);
    const bootout = r.cmds.find((c) => c.argv[1] === 'bootout')!;
    assert.equal(bootout.quiet, true);
    assert.equal(bootout.mayFail, true);
    const quiet: boolean[] = [];
    await runPlan({ refusals: [], warnings: [], steps: [{ kind: 'run', why: 'x', recipe: r }] }, { out: () => {}, exec: async (_argv, o) => (quiet.push(!!o?.quiet), 0) });
    assert.deepEqual(quiet, [false, false, true, false]);
  });

  test("Homebrew installs run without its auto-update, cleanup or hints", () => {
    const dir = tmpDir('hw-test-brew-');
    try {
      fs.writeFileSync(path.join(dir, 'brew'), '#!/bin/sh\n', { mode: 0o755 });
      const how = darwinFronting.installHelper('caddy', { PATH: dir });
      assert.ok('cmd' in how);
      assert.deepEqual(how.cmd, ['/usr/bin/env', ...BREW_ENV, path.join(dir, 'brew'), 'install', 'caddy']);
      assert.deepEqual(BREW_ENV, ['HOMEBREW_NO_AUTO_UPDATE=1', 'HOMEBREW_NO_INSTALL_CLEANUP=1', 'HOMEBREW_NO_ENV_HINTS=1']);
    } finally {
      rmTmp(dir);
    }
  });
});
