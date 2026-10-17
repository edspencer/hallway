// Fronted mode's tiers (server/proxy/tiers.ts, D65): the recommendation, what config.yaml says for each, the question
// setup asks, and how `--trust` and `--domain` combine. Pure, plus the CLI's argument checks.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../server/store/schema.ts';
import { currentTier, machineFacts, suggestedTier, tierProxy, tierQuestion, tierUrls } from '../server/proxy/tiers.ts';
import { platformFor } from '../server/platform/index.ts';
import { makeCtx } from '../server/commands/index.ts';
import { setup as setupCommand } from '../server/commands/setup.ts';
import { UsageError } from '../server/args.ts';
import { type SetupDeps, chooseTier } from '../server/proxy/setup.ts';

const cfg = defaultConfig();

describe('which tier to recommend', () => {
  test('macOS: No admin unless an admin on a Mac no MDM manages', () => {
    assert.equal(suggestedTier('darwin', { admin: false, managed: false }), 'user');
    assert.equal(suggestedTier('darwin', { admin: true, managed: true }), 'user');
    assert.equal(suggestedTier('darwin', { admin: true, managed: false }), 'system');
  });
  test('Linux: System-wide with sudo, else No admin', () => {
    assert.equal(suggestedTier('linux', { admin: true, managed: false }), 'system');
    assert.equal(suggestedTier('linux', { admin: false, managed: false }), 'user');
  });
  test('asked of the OS with no privilege: `id -Gn`, and `profiles status -type enrollment` on macOS', async () => {
    const calls: string[] = [];
    const run = (answers: Record<string, string>) => async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      return { code: 0, stdout: answers[cmd] ?? '', stderr: '' };
    };
    assert.deepEqual(await machineFacts(platformFor('darwin'), run({ id: 'staff everyone admin', profiles: 'Enrolled via DEP: Yes\nMDM enrollment: Yes (User Approved)\n' }), 501), { admin: true, managed: true });
    assert.deepEqual(await machineFacts(platformFor('darwin'), run({ id: 'staff everyone', profiles: 'Enrolled via DEP: No\nMDM enrollment: No\n' }), 501), { admin: false, managed: false });
    assert.deepEqual(await machineFacts(platformFor('linux'), run({ id: 'me adm sudo' }), 1000), { admin: true, managed: false });
    assert.deepEqual(await machineFacts(platformFor('linux'), run({ id: 'me users' }), 1000), { admin: false, managed: false });
    assert.deepEqual(await machineFacts(platformFor('linux'), run({ id: 'root' }), 0), { admin: true, managed: false });
    assert.ok(calls.includes('profiles status -type enrollment'));
    assert.ok(!calls.some((c) => c.startsWith('sudo')));
  });
});

describe('what each tier writes', () => {
  test('macOS: 443/80 in every tier (launchd); Linux carries the port unless System-wide', () => {
    assert.deepEqual(tierProxy('darwin', 'user', cfg.proxy), { trust: 'user', scheme: 'https', publicPort: 443 });
    assert.deepEqual(tierProxy('darwin', 'none', cfg.proxy), { trust: 'none', scheme: 'http', publicPort: 80 });
    assert.deepEqual(tierProxy('linux', 'user', cfg.proxy), { trust: 'user', scheme: 'https', publicPort: 4443 });
    assert.deepEqual(tierProxy('linux', 'none', cfg.proxy), { trust: 'none', scheme: 'http', publicPort: 4480 });
    assert.deepEqual(tierProxy('linux', 'system', cfg.proxy), { trust: 'system', scheme: 'https', publicPort: 443 });
  });
  test('URLs per tier, as the question and the dashboard show them', () => {
    assert.deepEqual(tierUrls('darwin', 'none', cfg), { dashboard: 'http://hallway.localhost', app: 'http://review.localhost' });
    assert.deepEqual(tierUrls('linux', 'user', cfg), { dashboard: 'https://hallway.localhost:4443', app: 'https://review.localhost:4443' });
  });
  test('a setup from before the tiers counts as System-wide', () => {
    assert.equal(currentTier(cfg), 'system');
    assert.equal(currentTier({ proxy: { ...cfg.proxy, trust: 'user' } }), 'user');
    assert.equal(currentTier({ proxy: { ...cfg.proxy, scheme: 'http' } }), 'none');
  });
});

describe('the question', () => {
  test('three numbered choices with their URLs, the recommended one marked and the default', () => {
    const q = tierQuestion('darwin', cfg, 'user', null);
    assert.match(q.text, /^Local domains: open your apps by name instead of by port\.\n\n {2}1\) No admin {5}https:\/\/review\.localhost {3}\(recommended\)\n {5}macOS asks for your own password or Touch ID once/);
    assert.match(q.text, /2\) System-wide {2}https:\/\/review\.localhost\n {5}Needs an administrator/);
    assert.match(q.text, /3\) No prompts {3}http:\/\/review\.localhost\n {5}Nothing at all\./);
    assert.equal(q.prompt, 'Which? [1] ');
    assert.equal(q.byAnswer(''), 'user');
    assert.equal(q.byAnswer('2'), 'system');
    assert.equal(q.byAnswer(' none '), 'none');
    assert.equal(q.byAnswer('4'), null);
    assert.equal(q.byAnswer('sure'), null);
  });
  test('set up already: the current tier is the default, and says so', () => {
    const q = tierQuestion('linux', cfg, 'system', 'none');
    assert.equal(q.prompt, 'Which? [3] ');
    assert.match(q.text, /3\) No prompts {3}http:\/\/review\.localhost:4480 {3}\(current\)/);
    assert.match(q.text, /1\) No admin {5}https:\/\/review\.localhost:4443\n {5}Nothing: the certificate goes into your own NSS database/);
  });
});

describe('`hallway setup --trust`', () => {
  const run = (flags: Record<string, string>) => setupCommand(makeCtx({ home: '/nonexistent', out: () => {}, err: () => {} }), [], flags);
  test('only user, system or none', async () => {
    await assert.rejects(run({ trust: 'admin' }), (e) => e instanceof UsageError && /--trust is user, system or none, not 'admin'/.test(e.message));
  });
  test('--domain needs System-wide: with another tier it is a usage error', async () => {
    await assert.rejects(run({ trust: 'user', domain: 'myname.internal' }), (e) => e instanceof UsageError && /--domain needs --trust system/.test(e.message));
  });
});

describe('choosing the tier in setup', () => {
  const deps = (over: Partial<SetupDeps> & { mode?: 'direct' | 'fronted'; trust?: 'user' | 'system' | 'none' | null } = {}) => {
    let out = '';
    const c = defaultConfig();
    const d = {
      store: { currentConfig: () => ({ ...c, mode: over.mode ?? 'direct', proxy: { ...c.proxy, trust: over.trust ?? null } }) },
      platform: platformFor('darwin'),
      machine: { admin: false, managed: true },
      out: (s: string) => void (out += s),
      ...over,
    } as unknown as SetupDeps;
    return { d, out: () => out };
  };

  test('--trust wins; --domain means System-wide and says so', async () => {
    assert.equal(await chooseTier(deps().d, { trust: 'none' }), 'none');
    const h = deps();
    assert.equal(await chooseTier(h.d, { domain: 'myname.internal' }), 'system');
    assert.match(h.out(), /A custom domain needs System-wide/);
  });
  test('on a terminal: the question, asked again until the answer makes sense; Enter takes the default', async () => {
    const answers = ['9', ''];
    const asked: string[] = [];
    const h = deps({ confirm: { ask: async (q: string) => (asked.push(q), answers.shift()!) } });
    assert.equal(await chooseTier(h.d, {}), 'user');
    assert.deepEqual(asked, ['Which? [1] ', 'Which? [1] ']);
    assert.match(h.out(), /Answer 1, 2 or 3/);
  });
  test('no terminal (or --yes, or --print): the current tier, else the recommended one, said out loud', async () => {
    const a = deps({ confirm: { yes: true } });
    assert.equal(await chooseTier(a.d, {}), 'user');
    assert.match(a.out(), /^Tier: No admin \(--trust user\), recommended here\. Choose another with --trust user, --trust system or --trust none\./);
    const b = deps({ mode: 'fronted', trust: null, confirm: { yes: true } });
    assert.equal(await chooseTier(b.d, {}), 'system', 'set up before the tiers: stays System-wide');
    assert.match(b.out(), /as set up now/);
    const c = deps({ confirm: { ask: async () => '3' } });
    assert.equal(await chooseTier(c.d, { print: true }), 'user', '--print never asks');
  });
});
