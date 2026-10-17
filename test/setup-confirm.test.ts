// `hallway setup` and `teardown` ask before they change anything (D67): the plan, what will prompt (sudo in the
// terminal; macOS's own trust-settings dialog), then `Continue? [y/N]`. --yes skips the question; no terminal and no
// --yes is a usage error. Nothing here runs a command.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageError } from '../server/args.ts';
import { platformFor } from '../server/platform/index.ts';
import { type Plan, type SetupDeps, confirmPlan, promptsAhead, runPlan } from '../server/proxy/setup.ts';

const trust = (done = false) => ({ kind: 'run' as const, why: 'Trust the CA', done, dialog: platformFor('darwin').fronting.trustDialog, recipe: { files: [], cmds: [{ argv: ['security', 'add-trusted-cert'], sudo: true }] } });
const redirect = (done = false) => ({ kind: 'run' as const, why: 'Redirect 443', done, recipe: { files: [], cmds: [{ argv: ['launchctl', 'bootstrap'], sudo: true }] } });
const mine = { kind: 'hallway' as const, why: 'Write Caddy’s configuration', action: async () => {} };
const plan = (...steps: Plan['steps']): Plan => ({ refusals: [], warnings: ['a warning'], steps });

function harness(confirm: SetupDeps['confirm'], answer?: string) {
  let out = '';
  const asked: string[] = [];
  const deps = {
    out: (s: string) => (out += s),
    platform: platformFor('darwin'),
    isRoot: false,
    confirm: confirm && { ...confirm, ask: confirm.ask ?? (answer === undefined ? undefined : async (q: string) => (asked.push(q), answer)) },
  };
  return { deps, asked, out: () => out };
}

describe('asking before setup runs', () => {
  test('a terminal: the plan, what will ask (twice, on macOS), then Continue? [y/N]; y goes ahead', async () => {
    const h = harness({}, 'y');
    assert.equal(await confirmPlan(plan(mine, trust(), redirect()), h.deps, 'setup'), true);
    assert.deepEqual(h.asked, ['Continue? [y/N] ']);
    const out = h.out();
    assert.match(out, /! a warning/);
    assert.match(out, /1\. \[Hallway\] Write Caddy’s configuration\n2\. \[sudo\] Trust the CA\n {5}\$ sudo security add-trusted-cert/);
    assert.match(out, /You'll be asked twice: for your password by sudo, here in the terminal, and then by a separate macOS dialog \(Touch ID or your password\) to change certificate trust settings, which macOS asks for itself, even under sudo \(Big Sur and later\)\./);
    assert.ok(out.indexOf('Trust the CA') < out.indexOf("You'll be asked twice"), 'the plan comes first');
    assert.ok(!/Nothing was run/.test(out));
  });

  test('the default is no: n, an empty answer (Enter or Ctrl-D), anything else', async () => {
    for (const a of ['n', 'N', 'no', '', '   ', 'sure', 'yy']) {
      const h = harness({}, a);
      assert.equal(await confirmPlan(plan(mine, redirect()), h.deps, 'setup'), false, JSON.stringify(a));
      assert.match(h.out(), /Nothing was run\. `hallway setup --print` shows the plan again\./);
    }
    for (const a of ['y', 'Y', 'yes', 'YES', ' y ']) assert.equal(await confirmPlan(plan(redirect()), harness({}, a).deps, 'setup'), true, JSON.stringify(a));
  });

  test('--yes: no question and no up-front plan (each step still prints as it runs), but it still says what will ask', async () => {
    const h = harness({ yes: true });
    assert.equal(await confirmPlan(plan(mine, trust(), redirect()), h.deps, 'setup'), true);
    assert.deepEqual(h.asked, []);
    assert.ok(!/Trust the CA/.test(h.out()));
    assert.match(h.out(), /You'll be asked twice/);
  });

  test('no terminal and no --yes: a usage error, before anything is printed or run', async () => {
    for (const confirm of [{}, undefined]) {
      const h = harness(confirm);
      await assert.rejects(confirmPlan(plan(mine, redirect()), h.deps, 'setup'), (e) => e instanceof UsageError && /no terminal to ask on: run it in one, or pass --yes/.test(e.message));
      assert.equal(h.out(), '');
    }
    await assert.rejects(confirmPlan(plan(redirect()), harness({}).deps, 'teardown'), /`hallway teardown` asks before/);
  });

  test('answering no runs nothing (the steps never start)', async () => {
    const ran: string[] = [];
    const h = harness({}, 'n');
    const p = plan({ kind: 'hallway', why: 'x', action: async () => void ran.push('hallway') }, redirect());
    if (await confirmPlan(p, h.deps, 'setup')) await runPlan(p, { out: () => {}, exec: async (argv) => (ran.push(argv.join(' ')), 0) });
    assert.deepEqual(ran, []);
  });

  test('teardown asks too, without pointing at --print', async () => {
    const h = harness({}, '');
    assert.equal(await confirmPlan(plan(redirect()), h.deps, 'teardown'), false);
    assert.match(h.out(), /Nothing was run\.\n$/);
  });
});

describe('what will ask', () => {
  const darwin = platformFor('darwin');
  const linux = platformFor('linux');
  test('macOS with the trust step to do: twice; already trusted: only sudo; as root: only the dialog', () => {
    assert.match(promptsAhead(plan(trust(), redirect()), darwin)!, /^You'll be asked twice/);
    assert.match(promptsAhead(plan(trust(true), redirect()), darwin)!, /^sudo will ask for your password, here in the terminal/);
    assert.match(promptsAhead(plan(trust(), redirect()), darwin, true)!, /^You'll be asked by a separate macOS dialog/);
  });
  test('Linux has no such dialog; nothing privileged left to do: it says nothing will ask (D65)', () => {
    const linuxTrust = { ...trust(), dialog: undefined };
    assert.match(promptsAhead(plan(linuxTrust, redirect()), linux), /^sudo will ask/);
    assert.equal(promptsAhead(plan(mine, trust(true), redirect(true)), darwin), 'Nothing here will ask for a password.');
  });
});
