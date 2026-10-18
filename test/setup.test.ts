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
import { BREW_ENV, darwinFronting, resolverText, userTrustListsRoot } from '../server/platform/fronting-darwin.ts';
import { dnsmasqConf } from '../server/platform/fronting.ts';
import { forwards } from '../server/services/spec.ts';
import { type Facts, type SetupDeps, SetupError, cmdLine, formatPlan, planSetup, promptsAhead, runPlan, setup, teardown, versionAtLeast } from '../server/proxy/setup.ts';
import { HSTS_PRELOADED_TLDS, parseTlds, tldVerdict, delegatedTlds } from '../server/proxy/tld.ts';
import { onWindows, ROOT, tmpDir, rmTmp } from './fixture.ts';

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
const NOTHING = { redirect: false, systemTrust: false, userTrust: false, resolver: false, oldResolver: null, dnsmasq: false, forwarders: [] as string[] };

type Over = Partial<Omit<Facts, 'found'>> & { os: 'darwin' | 'linux'; base?: string; found?: Partial<Facts['found']> };
function facts(over: Over = { os: 'darwin' }): Facts {
  const base = over.base ?? 'localhost';
  const custom = base !== 'localhost';
  const tier = over.tier ?? (custom ? 'system' : 'user');
  const scheme = tier === 'none' ? 'http' : 'https';
  const lowPorts = over.lowPorts ?? (over.os === 'darwin' ? 'sockets' : tier === 'system' ? 'redirect' : 'none');
  const env: FrontingEnv = {
    setupDir: `${HOME}/generated/setup`,
    rootCert: `${HOME}/state/caddy/data/pki/authorities/local/root.crt`,
    rootSha1: null,
    httpsPort: 4443,
    httpPort: 4480,
    dnsPort: 4253,
    base,
    userHome: '/home/me',
    tools: over.os === 'linux' ? { nft: '/usr/sbin/nft', certutil: '/usr/bin/certutil', nssdb: true, systemctl: '/usr/bin/systemctl', resolved: true, caStore: 'debian' } : { nft: null, certutil: null, nssdb: false, systemctl: null, resolved: false, caStore: null },
  };
  const { os: _os, found, ...rest } = over;
  return {
    platform: over.os,
    tier,
    previous: null,
    base,
    custom,
    dashboard: custom ? base : 'hallway.localhost',
    httpsPort: 4443,
    httpPort: 4480,
    dnsPort: 4253,
    scheme,
    publicPort: lowPorts === 'none' ? (scheme === 'https' ? 4443 : 4480) : scheme === 'https' ? 443 : 80,
    lowPorts,
    forwards: lowPorts === 'sockets' ? forwards({ httpsPort: 4443, httpPort: 4480 }, scheme) : [],
    tld: custom ? tldVerdict(base, IANA) : null,
    caddy: { path: '/opt/homebrew/bin/caddy', version: 'v2.11.7', install: { advice: 'x' } },
    dnsmasq: custom ? { path: '/opt/homebrew/sbin/dnsmasq', install: { advice: 'x' } } : null,
    conflicts: [],
    warnings: [],
    stops: [],
    env,
    found: { ...NOTHING, ...found },
    done: { trust: tier === 'none', lowPorts: lowPorts === 'none', resolver: !custom, config: false },
    ...rest,
  };
}

const plan = (f: Facts) => planSetup(f, platformFor(f.platform), HOME);
const print = (f: Facts) => formatPlan(plan(f), { printOnly: true });
const sudoSteps = (f: Facts) => plan(f).steps.filter((s) => s.kind === 'run' && s.recipe.cmds.some((c) => c.sudo));

describe('setup --print, per tier (D65)', () => {
  test('golden: macOS, User certificate, fresh', POSIX_PATHS, () => golden('setup-darwin.txt', print(facts({ os: 'darwin' }))));
  test('golden: macOS, User certificate, moving from the System-wide setup of 0.6 (pf redirect, System keychain)', POSIX_PATHS, () =>
    golden('setup-darwin-migrate.txt', print(facts({ os: 'darwin', previous: 'system', found: { redirect: true, systemTrust: true } }))));
  test('golden: macOS, No HTTPS', POSIX_PATHS, () => golden('setup-darwin-none.txt', print(facts({ os: 'darwin', tier: 'none' }))));
  test('golden: macOS, System-wide, a custom domain, Caddy and dnsmasq to install with Homebrew', POSIX_PATHS, () =>
    golden(
      'setup-darwin-custom.txt',
      print(
        facts({
          os: 'darwin',
          base: 'myname.internal',
          caddy: { path: null, version: null, install: { cmd: ['/opt/homebrew/bin/brew', 'install', 'caddy'] } },
          dnsmasq: { path: null, install: { cmd: ['/opt/homebrew/bin/brew', 'install', 'dnsmasq'] } },
        }),
      ),
    ));
  test('golden: Linux, System-wide, a custom domain', POSIX_PATHS, () => golden('setup-linux-custom.txt', print(facts({ os: 'linux', base: 'myname.internal' }))));
  test('golden: Linux, User certificate, moving from System-wide certificate', POSIX_PATHS, () =>
    golden('setup-linux-user.txt', print(facts({ os: 'linux', tier: 'user', previous: 'system', found: { redirect: true, systemTrust: true } }))));
  test('golden: Linux, No HTTPS, from User certificate', POSIX_PATHS, () => golden('setup-linux-none.txt', print(facts({ os: 'linux', tier: 'none', previous: 'user', found: { userTrust: true } }))));

  test('User certificate and No HTTPS have no sudo step at all; System-wide has one for each privileged part', () => {
    for (const os of ['darwin', 'linux'] as const) {
      assert.deepEqual(sudoSteps(facts({ os, tier: 'user' })), [], `${os}: user`);
      assert.deepEqual(sudoSteps(facts({ os, tier: 'none' })), [], `${os}: none`);
      assert.equal(sudoSteps(facts({ os, base: 'myname.internal' })).length, os === 'darwin' ? 2 : 3, `${os}: trust, resolver${os === 'linux' ? ', redirect' : ''}`);
    }
  });

  test("macOS never installs a redirect: launchd's sockets in every tier, 443 and 80 (or only 80 for plain HTTP)", () => {
    for (const tier of ['user', 'system', 'none'] as const) {
      const p = plan(facts({ os: 'darwin', tier }));
      const text = formatPlan(p);
      assert.ok(!/pfctl|pf\.anchors|LaunchDaemons/.test(text), `${tier}: no pf`);
      const sock = p.steps.find((s) => /^Have launchd hold loopback port/.test(s.why));
      assert.ok(sock && sock.kind === 'hallway', `${tier}: the forwarders`);
      assert.equal(sock.detail!.length, tier === 'none' ? 2 : 4);
      assert.match(sock.detail!.join('\n'), tier === 'none' ? /hallway\.forward\.http6 {2}\[::1\]:80 → 127\.0\.0\.1:4480/ : /hallway\.forward\.https {2}127\.0\.0\.1:443 → 127\.0\.0\.1:4443/);
    }
  });

  test('the user-trust step is the user\'s own (no sudo), marked as asking, in words that say it isn\'t an admin prompt', () => {
    const p = plan(facts({ os: 'darwin', tier: 'user' }));
    const trust = p.steps.find((s) => s.kind === 'run' && /for your account/.test(s.why));
    assert.ok(trust && trust.kind === 'run');
    assert.deepEqual(trust.recipe.cmds.map((c) => cmdLine(c)), ['security add-trusted-cert -r trustRoot -k /home/me/Library/Keychains/login.keychain-db /home/me/.hallway/state/caddy/data/pki/authorities/local/root.crt']);
    assert.match(trust.dialog!, /your\* certificate trust settings\. This is not an administrator prompt/);
    assert.match(promptsAhead(p, platformFor('darwin')), /^You'll be asked by macOS, for your Touch ID or password, to change \*your\* certificate trust settings/);
    assert.equal(promptsAhead(plan(facts({ os: 'darwin', tier: 'none' })), platformFor('darwin')), 'Nothing here will ask for a password.');
    assert.equal(promptsAhead(plan(facts({ os: 'linux', tier: 'user' })), platformFor('linux')), 'Nothing here will ask for a password.');
  });

  test('moving from System-wide certificate to User certificate: sudo once, to remove the pf redirect and the System keychain trust; said up front', () => {
    const f = facts({ os: 'darwin', previous: 'system', found: { redirect: true, systemTrust: true } });
    const p = plan(f);
    assert.deepEqual(sudoSteps(f).map((s) => s.why.slice(0, 40)), ['Remove the pf redirect an older Hallway ', "Remove Hallway's local certificate autho"]);
    assert.match(p.warnings.join(' '), /Moving from System-wide certificate to User certificate: what the old tier added is removed \(that needs sudo, this once\)/);
    assert.match(promptsAhead(p, platformFor('darwin')), /^You'll be asked twice: for your password by sudo, here in the terminal, and then by macOS, for your Touch ID/);
    // the forwarders come before the pf redirect goes, so 443 keeps answering throughout
    const i = (re: RegExp) => p.steps.findIndex((s) => re.test(s.why));
    assert.ok(i(/^Have launchd hold/) < i(/^Remove the pf redirect/));
  });

  test('System-wide again on a Mac set up by 0.6: the pf redirect goes, the System keychain trust stays', () => {
    const f = facts({ os: 'darwin', tier: 'system', previous: 'system', found: { redirect: true, systemTrust: true }, done: { trust: true, lowPorts: false, resolver: true, config: false } });
    const text = print(f);
    assert.match(text, /Remove the pf redirect an older Hallway installed/);
    assert.match(text, /Trust Hallway's local certificate authority in the System keychain.*\(already done\)/);
    assert.match(plan(f).warnings.join(' '), /older Hallway's pf redirect is still installed: it's removed/);
  });

  test('No HTTPS removes the user-domain trust (it may ask) and the system one; System-wide on Linux keeps the NSS entry', () => {
    const p = plan(facts({ os: 'darwin', tier: 'none', previous: 'user', found: { userTrust: true, systemTrust: true } }));
    assert.ok(p.steps.some((s) => s.kind === 'run' && /Stop trusting .* for your account/.test(s.why) && s.dialog));
    assert.ok(p.steps.some((s) => s.kind === 'run' && /System keychain \(No HTTPS doesn't trust it/.test(s.why)));
    const l = plan(facts({ os: 'linux', tier: 'system', previous: 'user', found: { userTrust: true } }));
    assert.ok(!l.steps.some((s) => /NSS database \(as you/.test(s.why)), "System-wide's trust includes the NSS database");
  });

  test('a custom domain is System-wide only: another tier goes back to *.localhost and removes the resolver and dnsmasq', () => {
    const p = plan(facts({ os: 'linux', tier: 'user', previous: 'system', found: { oldResolver: 'myname.internal', dnsmasq: true } }));
    assert.ok(p.steps.some((s) => s.kind === 'run' && /Stop sending the custom domain/.test(s.why)));
    assert.ok(p.steps.some((s) => s.kind === 'hallway' && /remove Hallway's dnsmasq/.test(s.why)));
    assert.match(formatPlan(p), /links become https:\/\/<app>\.localhost:4443/);
  });

  test('links per tier: macOS https/http on 443/80; Linux carries the port except System-wide', () => {
    const links = (os: 'darwin' | 'linux', tier: 'user' | 'system' | 'none') => /links become (\S+)/.exec(formatPlan(plan(facts({ os, tier }))))![1];
    assert.equal(links('darwin', 'user'), 'https://<app>.localhost');
    assert.equal(links('darwin', 'system'), 'https://<app>.localhost');
    assert.equal(links('darwin', 'none'), 'http://<app>.localhost');
    assert.equal(links('linux', 'system'), 'https://<app>.localhost');
    assert.equal(links('linux', 'user'), 'https://<app>.localhost:4443');
    assert.equal(links('linux', 'none'), 'http://<app>.localhost:4480');
  });

  test('stops: the forwarders would run npx\'s Hallway (D61), or nobody is at the Mac to answer the trust dialog', () => {
    const p = plan(facts({ os: 'darwin', stops: ["Hallway is running from npx's cache, which npm can delete at any time. Install it first: `npm i -g hallway`, then run `hallway setup` again."] }));
    assert.match(p.refusals[0], /npx's cache/);
    assert.match(formatPlan(p, { printOnly: true }), /setup would stop/);
  });

  test('already-done parts are marked, and run as root there is no sudo prefix', () => {
    const p = plan(facts({ os: 'darwin', base: 'myname.internal', done: { trust: true, lowPorts: true, resolver: true, config: true } }));
    const text = formatPlan(p, { printOnly: true, isRoot: true });
    assert.equal((text.match(/\(already done\)/g) ?? []).length, 4);
    assert.ok(!/\$ sudo /.test(text));
  });

  test('refusals: .local, a port held by someone else, a missing tool with no installer', () => {
    const p = plan(facts({ os: 'linux', base: 'foo.local', conflicts: ['port 443 (HTTPS) is held by ssh (pid 42: ssh -L 443:…), listening on 127.0.0.1'], caddy: { path: null, version: null, install: { advice: 'install Caddy' } } }));
    assert.equal(p.refusals.length, 3);
    assert.match(p.refusals[0], /mDNS/);
    assert.match(p.refusals[1], /ssh \(pid 42[\s\S]*Docker Desktop/);
    assert.match(p.refusals[2], /caddy isn't installed: install Caddy/);
  });

  test("Linux System-wide without systemd or nftables: refused with what to do, the rest of the plan still shown", () => {
    const f = facts({ os: 'linux', tier: 'system' });
    f.env.tools = { ...f.env.tools, systemctl: null };
    const p = plan(f);
    assert.match(p.refusals.join(' '), /doesn't run systemd.*publicPort/);
    assert.ok(p.steps.some((s) => /Trust/.test(s.why)), 'the trust step is still planned');
    f.env.tools = { ...f.env.tools, systemctl: '/usr/bin/systemctl', nft: null };
    assert.match(plan(f).refusals.join(' '), /needs nftables/);
  });

  test("Linux User certificate without certutil: refused, with how to get it; no NSS database yet: it's made first", () => {
    const f = facts({ os: 'linux', tier: 'user' });
    f.env.tools = { ...f.env.tools, certutil: null };
    assert.match(plan(f).refusals.join(' '), /needs certutil: install `certutil` \(Debian and Ubuntu: `sudo apt install libnss3-tools`/);
    f.env.tools = { ...f.env.tools, certutil: '/usr/bin/certutil', nssdb: false };
    const trust = plan(f).steps.find((s) => s.kind === 'run' && /NSS database/.test(s.why));
    assert.ok(trust && trust.kind === 'run');
    assert.deepEqual(trust.recipe.cmds.map((c) => c.argv.slice(0, 2).join(' ')), ['mkdir -p', '/usr/bin/certutil -N', '/usr/bin/certutil -d', '/usr/bin/certutil -d']);
    assert.ok(trust.recipe.cmds.every((c) => !c.sudo));
  });
});

describe('System-wide with nothing on 443 (a publicPort of httpsPort set by hand before the tiers)', () => {
  test('no redirect step, no 443/80 needed, a warning saying links carry the port; fine without systemd', () => {
    const f = facts({ os: 'linux', tier: 'system', lowPorts: 'none' });
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
    const e = facts({ os: 'linux', base: 'myname.internal' }).env;
    const f = linuxFronting;
    const installed = [...f.redirect!(e).files, ...f.resolver(e).files].map((x) => x.dest);
    const removed = [...f.unredirect(e).cmds, ...f.unresolver(e).cmds].filter((c) => c.argv[0] === 'rm').flatMap((c) => c.argv.slice(2));
    const looked = Object.values(f.installed(e)).flat();
    for (const d of installed) {
      assert.ok(removed.includes(d), `${d} is removed`);
      assert.ok(looked.includes(d), `${d} is looked for`);
    }
    // macOS: the resolver, and the old pf redirect's files, which it only ever removes
    const m = { ...facts({ os: 'darwin', base: 'myname.internal' }).env };
    const mremoved = [...darwinFronting.unredirect(m).cmds, ...darwinFronting.unresolver(m).cmds].filter((c) => c.argv[0] === 'rm').flatMap((c) => c.argv.slice(2));
    for (const d of [...darwinFronting.resolver(m).files.map((x) => x.dest), ...darwinFronting.installed(m).redirect]) assert.ok(mremoved.includes(d), `${d} is removed`);
    assert.equal(darwinFronting.redirect, undefined, 'macOS has no redirect to install');
  });
  test("the user's own trust, and its undo: no sudo on either platform", () => {
    for (const f of [darwinFronting, linuxFronting]) {
      const e = { ...facts({ os: f === darwinFronting ? 'darwin' : 'linux' }).env, rootSha1: 'AB12' };
      for (const r of [f.userTrust!(e), f.userUntrust!(e)]) for (const c of r.cmds) assert.equal(c.sudo, false, cmdLine(c));
    }
    assert.deepEqual(darwinFronting.userUntrust!({ ...facts({ os: 'darwin' }).env, rootSha1: 'AB12' }).cmds.map((c) => cmdLine(c)), [
      'security remove-trusted-cert /home/me/.hallway/state/caddy/data/pki/authorities/local/root.crt',
      'security delete-certificate -Z AB12 /home/me/Library/Keychains/login.keychain-db',
    ]);
  });
  test("macOS: `security dump-trust-settings` naming Hallway's root", () => {
    assert.ok(userTrustListsRoot('Number of trusted certs = 2\nCert 0: Some Corp Root\n   Number of trust settings : 1\nCert 1: Hallway Local CA - 2026 ECC Root\n   Number of trust settings : 1\n'));
    assert.ok(!userTrustListsRoot('SecTrustSettingsCopyCertificates: No Trust Settings were found.\n'));
    assert.ok(!userTrustListsRoot('Cert 0: Not Hallway Local CA\n'));
  });
  test('Linux: is it in the NSS database? The PEM certutil prints, compared with the root', async () => {
    const dir = tmpDir('hw-test-nss-');
    try {
      const pem = '-----BEGIN CERTIFICATE-----\nMIIBabc\ndef=\n-----END CERTIFICATE-----\n';
      fs.writeFileSync(path.join(dir, 'root.crt'), pem);
      const e = { ...facts({ os: 'linux' }).env, rootCert: path.join(dir, 'root.crt') };
      const run = (out: string, code = 0) => async () => ({ code, stdout: out, stderr: '' });
      assert.equal(await linuxFronting.userTrusted!(e, run(pem.replace(/\n/g, '\r\n'))), true);
      assert.equal(await linuxFronting.userTrusted!(e, run('-----BEGIN CERTIFICATE-----\nOTHER\n-----END CERTIFICATE-----\n')), false);
      assert.equal(await linuxFronting.userTrusted!(e, run('', 255)), false);
      assert.equal(await linuxFronting.userTrusted!({ ...e, tools: { ...e.tools, nssdb: false } }, run(pem)), false);
    } finally {
      rmTmp(dir);
    }
  });
  test('dnsmasq: the base domain only, loopback only', () => {
    const c = dnsmasqConf('myname.internal', 4253);
    for (const l of ['port=4253', 'listen-address=127.0.0.1', 'bind-interfaces', 'no-resolv', 'address=/myname.internal/127.0.0.1', 'address=/myname.internal/::1']) assert.ok(c.split('\n').includes(l), l);
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
  test("removing the old pf redirect: its first bootout's \"No such process\" isn't shown", () => {
    const bootout = darwinFronting.unredirect(facts({ os: 'darwin' }).env).cmds.find((c) => c.argv[1] === 'bootout')!;
    assert.equal(bootout.quiet, true);
    assert.equal(bootout.mayFail, true);
  });
  test("Homebrew installs run without its auto-update, cleanup or hints", () => {
    const dir = tmpDir('hw-test-brew-');
    try {
      fs.writeFileSync(path.join(dir, 'brew'), '#!/bin/sh\n', { mode: 0o755 });
      const how = darwinFronting.installHelper('caddy', { PATH: dir });
      assert.ok('cmd' in how);
      assert.deepEqual(how.cmd, ['/usr/bin/env', ...BREW_ENV, path.join(dir, 'brew'), 'install', 'caddy']);
    } finally {
      rmTmp(dir);
    }
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
      rmTmp(dir);
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
      rmTmp(dir);
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
    for (const r of [f.redirect!, f.unredirect, f.trust, f.untrust, f.userTrust!, f.userUntrust!, f.resolver, f.unresolver]) assert.throws(() => r({} as FrontingEnv), /not supported on Windows|isn't supported on Windows/);
  });
});

describe("our own forwarders aren't squatters", () => {
  test('a node running `cli.js forward <port>` on 443/80 is ours; anything else is not', async () => {
    const { isOurForwarder } = await import('../server/proxy/setup.ts');
    assert.ok(isOurForwarder('/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/hallway/dist/server/cli.js forward 4443'));
    assert.ok(isOurForwarder('C:\\node\\node.exe C:\\hallway\\dist\\server\\cli.js forward 4480'));
    assert.ok(!isOurForwarder('/usr/bin/node /srv/proxy.js'));
    assert.ok(!isOurForwarder('/usr/bin/node /x/cli.js forwarder 443'));
  });
});
