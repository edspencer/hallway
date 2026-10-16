// `hallway setup` / `teardown` (server/proxy/setup.ts) and the privileged recipes (server/platform/fronting*.ts):
// the --print plans for macOS and Linux are golden files, run on every OS; the TLD rules; running a plan (sudo, steps
// already done, a failing command). Nothing here runs a privileged command: CI's "Fronted mode (real …)" jobs do that.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { platformFor } from '../server/platform/index.ts';
import type { FrontingEnv } from '../server/platform/fronting.ts';
import { linuxFronting, nftRules, resolvedDropin } from '../server/platform/fronting-linux.ts';
import { darwinFronting, pfAnchor, resolverText } from '../server/platform/fronting-darwin.ts';
import { dnsmasqConf } from '../server/platform/fronting.ts';
import { type Facts, type SetupDeps, SetupError, cmdLine, formatPlan, planSetup, runPlan, setup, teardown, versionAtLeast } from '../server/proxy/setup.ts';
import { HSTS_PRELOADED_TLDS, parseTlds, tldVerdict, delegatedTlds } from '../server/proxy/tld.ts';
import { onWindows, ROOT, tmpDir } from './fixture.ts';

// the goldens hold the POSIX paths a plan has on macOS and Linux; fronted mode is unsupported on Windows (D58)
const POSIX_PATHS = { skip: onWindows('a plan names data-home paths in the OS\'s own form; fronted mode is unsupported on Windows') };

const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'proxy');
function golden(name: string, text: string) {
  const file = path.join(GOLDEN, name);
  if (process.env.HALLWAY_UPDATE_GOLDEN) fs.writeFileSync(file, text);
  assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} changed; if on purpose: HALLWAY_UPDATE_GOLDEN=1 npm test`);
}

const HOME = '/home/me/.hallway';
const IANA = parseTlds('# Version 2026101600\nCOM\nORG\nDEV\nAPP\nIO\n');

function facts(over: Partial<Facts> & { os: 'darwin' | 'linux'; base?: string } = { os: 'darwin' }): Facts {
  const base = over.base ?? 'localhost';
  const custom = base !== 'localhost';
  const env: FrontingEnv = {
    setupDir: `${HOME}/generated/setup`,
    rootCert: `${HOME}/state/caddy/data/pki/authorities/local/root.crt`,
    rootSha1: null,
    httpsPort: 4443,
    httpPort: 4480,
    dnsPort: 4253,
    base,
    userHome: '/home/me',
    tools: over.os === 'linux' ? { nft: '/usr/sbin/nft', certutil: '/usr/bin/certutil', systemctl: '/usr/bin/systemctl', resolved: true, caStore: 'debian' } : { nft: null, certutil: null, systemctl: null, resolved: false, caStore: null },
  };
  const { os: _os, ...rest } = over;
  return {
    platform: over.os,
    base,
    custom,
    dashboard: custom ? base : 'hallway.localhost',
    httpsPort: 4443,
    httpPort: 4480,
    dnsPort: 4253,
    noRedirect: false,
    tld: custom ? tldVerdict(base, IANA) : null,
    caddy: { path: '/opt/homebrew/bin/caddy', version: 'v2.11.7', install: { advice: 'x' } },
    dnsmasq: custom ? { path: '/opt/homebrew/sbin/dnsmasq', install: { advice: 'x' } } : null,
    conflicts: [],
    warnings: [],
    env,
    done: { trust: false, redirect: false, resolver: false, config: false },
    ...rest,
  };
}

const plan = (f: Facts) => planSetup(f, platformFor(f.platform), HOME);

describe('setup --print', () => {
  test('golden: macOS, *.localhost', POSIX_PATHS, () => golden('setup-darwin.txt', formatPlan(plan(facts({ os: 'darwin' })), { printOnly: true })));
  test('golden: macOS, a custom domain, Caddy and dnsmasq to install with Homebrew', POSIX_PATHS, () =>
    golden(
      'setup-darwin-custom.txt',
      formatPlan(
        plan(
          facts({
            os: 'darwin',
            base: 'myname.internal',
            caddy: { path: null, version: null, install: { cmd: ['/opt/homebrew/bin/brew', 'install', 'caddy'] } },
            dnsmasq: { path: null, install: { cmd: ['/opt/homebrew/bin/brew', 'install', 'dnsmasq'] } },
          }),
        ),
        { printOnly: true },
      ),
    ));
  test('golden: Linux, a custom domain', POSIX_PATHS, () => golden('setup-linux-custom.txt', formatPlan(plan(facts({ os: 'linux', base: 'myname.internal' })), { printOnly: true })));

  test('every privileged command is a sudo command with an explanation; the files it installs are shown first', () => {
    for (const os of ['darwin', 'linux'] as const) {
      const p = plan(facts({ os, base: 'myname.internal' }));
      const sudo = p.steps.filter((s) => s.kind === 'run' && s.recipe.cmds.some((c) => c.sudo));
      assert.equal(sudo.length, 3, `${os}: trust, redirect, resolver`);
      for (const s of sudo) assert.ok(s.why.length > 20);
      const text = formatPlan(p, { printOnly: true });
      assert.match(text, /\$ sudo /);
      assert.match(text, /Nothing was run/);
    }
  });

  test('already-done parts are marked, and run as root there is no sudo prefix', () => {
    const p = plan(facts({ os: 'darwin', done: { trust: true, redirect: true, resolver: true, config: true } }));
    const text = formatPlan(p, { printOnly: true, isRoot: true });
    assert.equal((text.match(/\(already done\)/g) ?? []).length, 3);
    assert.ok(!/\$ sudo /.test(text));
  });

  test('refusals: .local, a port held by someone else, a missing tool with no installer', () => {
    const p = plan(facts({ os: 'linux', base: 'foo.local', conflicts: ['port 443 (HTTPS) is held by ssh (pid 42: ssh -L 443:…), listening on 127.0.0.1'], caddy: { path: null, version: null, install: { advice: 'install Caddy' } } }));
    assert.equal(p.refusals.length, 3);
    assert.match(p.refusals[0], /mDNS/);
    assert.match(p.refusals[1], /ssh \(pid 42[\s\S]*Docker Desktop/);
    assert.match(p.refusals[2], /caddy isn't installed: install Caddy/);
  });

  test("Linux without systemd or nftables: refused with what to do, the rest of the plan still shown", () => {
    const f = facts({ os: 'linux' });
    f.env.tools = { ...f.env.tools, systemctl: null };
    const p = plan(f);
    assert.match(p.refusals.join(' '), /doesn't run systemd.*publicPort/);
    assert.ok(p.steps.some((s) => /Trust/.test(s.why)), 'the trust step is still planned');
    f.env.tools = { ...f.env.tools, systemctl: '/usr/bin/systemctl', nft: null };
    assert.match(plan(f).refusals.join(' '), /needs nftables/);
  });
});

describe('fronted mode with no redirect (proxy.publicPort = proxy.httpsPort)', () => {
  test('no redirect step, no 443/80 needed, a warning saying links carry the port; fine without systemd', () => {
    const f = facts({ os: 'linux', noRedirect: true });
    f.env.tools = { ...f.env.tools, systemctl: null, nft: null };
    const p = plan(f);
    assert.deepEqual(p.refusals, []);
    assert.ok(!p.steps.some((s) => /Redirect/.test(s.why)));
    assert.match(p.warnings.join(' '), /links carry :4443/);
    assert.match(formatPlan(p), /Check https:\/\/hallway\.localhost:4443 answers, with/);
  });
});

describe('the recipes', () => {
  test('teardown undoes setup: every file installed is looked for and removed', () => {
    for (const f of [darwinFronting, linuxFronting]) {
      const e = facts({ os: f === darwinFronting ? 'darwin' : 'linux', base: 'myname.internal' }).env;
      e.tools = { nft: '/usr/sbin/nft', certutil: null, systemctl: '/usr/bin/systemctl', resolved: true, caStore: 'debian' };
      e.rootSha1 = 'AB12';
      const installed = [...f.redirect(e).files, ...f.resolver(e).files].map((x) => x.dest);
      const removed = [...f.unredirect(e).cmds, ...f.unresolver(e).cmds].filter((c) => c.argv[0] === 'rm').flatMap((c) => c.argv.slice(2));
      const looked = Object.values(f.installed(e)).flat();
      for (const d of installed) {
        assert.ok(removed.includes(d), `${d} is removed`);
        assert.ok(looked.includes(d), `${d} is looked for`);
      }
    }
  });
  test('dnsmasq: the base domain only, loopback only', () => {
    const c = dnsmasqConf('myname.internal', 4253);
    for (const l of ['port=4253', 'listen-address=127.0.0.1', 'bind-interfaces', 'no-resolv', 'address=/myname.internal/127.0.0.1', 'address=/myname.internal/::1']) assert.ok(c.split('\n').includes(l), l);
  });
  test('pf: loopback only, both families, to the configured ports', () => {
    const a = pfAnchor({ httpsPort: 8443, httpPort: 8080 });
    assert.equal(a.split('\n').filter((l) => l.startsWith('rdr pass on lo0')).length, 4);
    assert.match(a, /to 127\.0\.0\.1 port 443 -> 127\.0\.0\.1 port 8443/);
    assert.match(a, /to ::1 port 80 -> ::1 port 8080/);
  });
  test('nft: replaces its own table (idempotent), loopback daddr only', () => {
    const n = nftRules({ httpsPort: 4443, httpPort: 4480 });
    assert.match(n, /^table inet hallway\ndelete table inet hallway\ntable inet hallway \{/m);
    assert.match(n, /ip daddr 127\.0\.0\.1 tcp dport 443 redirect to :4443/);
    assert.match(n, /ip6 daddr ::1 tcp dport 80 redirect to :4480/);
  });
  test('resolvers point at the dnsmasq port, for the base alone', () => {
    assert.match(resolverText('myname.internal', 4253), /nameserver 127\.0\.0\.1\nport 4253/);
    assert.match(resolvedDropin('myname.internal', 4253), /DNS=127\.0\.0\.1:4253\nDomains=~myname\.internal/);
  });
});

describe('base domains', () => {
  test('the verdicts', () => {
    const v = (b: string, tlds: Set<string> | null = IANA) => tldVerdict(b, tlds).verdict;
    assert.equal(v('localhost'), 'ok');
    assert.equal(v('myname.internal'), 'ok');
    assert.equal(v('myname.test'), 'ok');
    assert.equal(v('lab.home.arpa'), 'ok');
    assert.equal(v('foo.local'), 'refuse');
    assert.equal(v('me.dev'), 'refuse');
    assert.equal(v('me.app'), 'refuse');
    assert.equal(v('me.example'), 'refuse');
    assert.equal(v('local.example.com'), 'warn');
    assert.match(tldVerdict('local.example.com', IANA).reason, /real, delegated TLD/);
    assert.equal(v('name.surname'), 'warn');
    assert.match(tldVerdict('name.surname', IANA).reason, /isn't a TLD today/);
    assert.match(tldVerdict('name.surname', null).reason, /couldn't fetch IANA/);
    assert.ok(HSTS_PRELOADED_TLDS.includes('dev') && HSTS_PRELOADED_TLDS.length > 40);
  });

  test("IANA's list is cached for a week; a failed fetch falls back to the stale copy, else null", async () => {
    const dir = tmpDir('hw-test-tlds-');
    try {
      let calls = 0;
      const ok = (async () => {
        calls++;
        return new Response('# v\nCOM\nNET\n');
      }) as typeof fetch;
      const bad = (async () => {
        throw new Error('offline');
      }) as typeof fetch;
      assert.equal(await delegatedTlds(dir, { fetchImpl: bad }), null);
      assert.ok((await delegatedTlds(dir, { fetchImpl: ok }))!.has('com'));
      await delegatedTlds(dir, { fetchImpl: ok });
      assert.equal(calls, 1, 'cached');
      const later = Date.now() + 8 * 24 * 3600_000;
      assert.ok((await delegatedTlds(dir, { fetchImpl: bad, now: later }))!.has('net'), 'stale beats nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('running a plan', () => {
  test('prints each step, prefixes sudo, skips what is done, tolerates mayFail, and stops at a failure', async () => {
    const ran: string[][] = [];
    let out = '';
    const exec = async (argv: string[]) => {
      ran.push(argv);
      return argv.includes('boom') ? 1 : argv.includes('meh') ? 3 : 0;
    };
    const dir = tmpDir('hw-test-plan-');
    const actions: string[] = [];
    try {
      const steps = [
        { kind: 'hallway' as const, why: 'one', action: async () => void actions.push('one') },
        { kind: 'run' as const, why: 'two', done: true, recipe: { files: [], cmds: [{ argv: ['never'], sudo: true }] } },
        { kind: 'run' as const, why: 'three', recheck: async () => true, recipe: { files: [], cmds: [{ argv: ['never'], sudo: true }] } },
        { kind: 'run' as const, why: 'four', recipe: { files: [{ src: path.join(dir, 'f'), dest: '/etc/f', text: 'hi\n' }], cmds: [{ argv: ['meh'], sudo: true, mayFail: true }, { argv: ['install', 'x'], sudo: true }] } },
        { kind: 'run' as const, why: 'five', recipe: { files: [], cmds: [{ argv: ['boom'], sudo: false }] } },
        { kind: 'hallway' as const, why: 'six', action: async () => void actions.push('six') },
      ];
      await assert.rejects(runPlan({ refusals: [], warnings: [], steps }, { out: (s) => (out += s), exec }), SetupError);
      assert.deepEqual(ran, [['sudo', 'meh'], ['sudo', 'install', 'x'], ['boom']]);
      assert.deepEqual(actions, ['one'], 'nothing after the failure');
      assert.equal(fs.readFileSync(path.join(dir, 'f'), 'utf8'), 'hi\n', 'staged before the commands');
      assert.match(out, /2\. two: already done/);
      assert.match(out, /3\. three: already done/);
      assert.match(out, /\$ sudo install x/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('command lines are shell-quoted for people', () => {
    assert.equal(cmdLine({ argv: ['security', 'delete-certificate', '-c', 'Hallway Local CA'], sudo: true }), "sudo security delete-certificate -c 'Hallway Local CA'");
    assert.equal(cmdLine({ argv: ['x'], sudo: true }, true), 'x');
  });

  test('Caddy versions', () => {
    assert.ok(versionAtLeast('v2.11.7', [2, 7, 0]));
    assert.ok(versionAtLeast('v2.7.0', [2, 7, 0]));
    assert.ok(!versionAtLeast('v2.6.4', [2, 7, 0]));
    assert.ok(!versionAtLeast(null, [2, 7, 0]));
  });
});

describe('Windows (D58)', () => {
  // setup refuses before it reads the store, looks for a tool or writes a file: deps it would use are traps
  const trap = () => {
    throw new Error('setup touched something on Windows');
  };
  const deps = (out: string[]) =>
    ({ platform: platformFor('win32'), out: (s: string) => out.push(s), services: trap, query: trap, env: {}, userHome: 'C:\\Users\\me', isRoot: false, get store() { return trap(); } }) as unknown as SetupDeps;

  test('setup refuses at once, with the reason, and --print too', async () => {
    for (const print of [false, true])
      await assert.rejects(setup(deps([]), { print }), (e) => e instanceof SetupError && /fronted mode isn't supported on Windows/.test(e.message));
  });

  test('teardown has nothing to undo', async () => {
    const out: string[] = [];
    assert.equal(await teardown(deps(out)), 0);
    assert.match(out.join(''), /^Nothing to undo: fronted mode isn't supported on Windows/);
  });

  test('every recipe throws FrontingUnsupported', () => {
    const f = platformFor('win32').fronting;
    for (const r of [f.redirect, f.unredirect, f.trust, f.untrust, f.resolver, f.unresolver]) assert.throws(() => r({} as FrontingEnv), /not supported on Windows|isn't supported on Windows/);
  });
});
