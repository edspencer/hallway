// Trusted the way browsers check it (D72): curl's verdict by exit code, the commands each platform asks (Apple's curl
// with no CA given on macOS; Chrome's NSS database or the system's curl on Linux), the browsers an organisation set to
// ignore certificates you add (managed preferences), and when setup says to quit and reopen a browser.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { curlTrust, curlTrustArgs } from '../server/platform/fronting.ts';
import { APPLE_CURL, darwinBrowserPolicies, darwinFronting, managedPrefsFiles, policyOff } from '../server/platform/fronting-darwin.ts';
import { linuxFronting } from '../server/platform/fronting-linux.ts';
import { platformFor } from '../server/platform/index.ts';
import { policyWarning, tierOptions } from '../server/proxy/tiers.ts';
import { RESTART_BROWSER, planSetup, trustRan } from '../server/proxy/setup.ts';
import { RESTART_BROWSER as PAGE_WORDS } from '../src/lib/domains.ts';

const env = { setupDir: '/x', rootCert: '/x/root.crt', rootSha1: null, httpsPort: 4443, httpPort: 4480, dnsPort: 4253, base: 'localhost', userHome: '/Users/someone', tools: { nft: null, certutil: null, nssdb: false, systemctl: null, resolved: false, caStore: null } } as const;

describe("curl's verdict", () => {
  test('0 is trusted whatever the status; 60/51/35 are not, in curl\'s words; refused says nothing about trust', () => {
    assert.deepEqual(curlTrust(0, '', 'x'), { trusted: true, how: 'x' });
    assert.deepEqual(curlTrust(60, 'curl: (60) SSL certificate problem: unable to get local issuer certificate\nMore details here: https://curl.se/docs/sslcerts.html\n', 'x').trusted, false);
    assert.equal(curlTrust(60, 'curl: (60) SSL certificate problem: unable to get local issuer certificate\n', 'x').cause, 'SSL certificate problem: unable to get local issuer certificate');
    assert.equal(curlTrust(51, "curl: (51) SSL: no alternative certificate subject name matches target host name 'hallway.localhost'", 'x').trusted, false);
    assert.deepEqual(curlTrust(7, 'curl: (7) Failed to connect to hallway.localhost port 443', 'x'), { trusted: null, how: 'x', cause: 'Failed to connect to hallway.localhost port 443' });
  });
  test('no CA, no config file, loopback whatever DNS says', () => {
    const a = curlTrustArgs('hallway.localhost', 443);
    assert.equal(a[0], '-q', '-q must come first to skip ~/.curlrc');
    assert.ok(!a.some((x) => /cacert|capath|insecure|^-k$/.test(x)));
    assert.deepEqual(a.slice(-3), ['--resolve', 'hallway.localhost:443:127.0.0.1', 'https://hallway.localhost:443/']);
  });
});

describe('what each platform asks', () => {
  test("macOS: Apple's curl, never Homebrew's", async () => {
    const calls: string[][] = [];
    const v = await darwinFronting.osTrust!({ host: 'hallway.localhost', port: 4443 }, 'user', env as never, async (cmd, args) => (calls.push([cmd, ...args]), { code: 60, stdout: '', stderr: 'curl: (60) SSL certificate problem: unable to get local issuer certificate' }));
    assert.equal(calls[0][0], APPLE_CURL);
    assert.equal(APPLE_CURL, '/usr/bin/curl');
    assert.deepEqual([v.trusted, v.cause], [false, 'SSL certificate problem: unable to get local issuer certificate']);
    assert.match(v.how, /Apple's curl/);
  });
  test("Linux: System-wide certificate is the system's curl; no curl is 'don't know'", async () => {
    const v = await linuxFronting.osTrust!({ host: 'hallway.localhost', port: 443 }, 'system', env as never, async () => ({ code: 0, stdout: '', stderr: '' }));
    assert.equal(v.trusted, true);
    const none = await linuxFronting.osTrust!({ host: 'hallway.localhost', port: 443 }, 'system', env as never, async () => ({ code: 127, stdout: '', stderr: '' }));
    assert.equal(none.trusted, null);
  });
  test("Linux: User certificate's NSS database is looked for again, since setup may have just made it", async () => {
    const { tmpDir, rmTmp } = await import('./fixture.ts');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const home = tmpDir('hw-nss-');
    try {
      fs.mkdirSync(path.join(home, '.pki', 'nssdb'), { recursive: true });
      fs.writeFileSync(path.join(home, 'root.crt'), '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
      const e = { ...env, userHome: home, rootCert: path.join(home, 'root.crt'), tools: { ...env.tools, certutil: '/usr/bin/certutil', nssdb: false } };
      const v = await linuxFronting.osTrust!({ host: 'hallway.localhost', port: 4443 }, 'user', e as never, async () => ({ code: 0, stdout: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n', stderr: '' }));
      assert.equal(v.trusted, true);
    } finally {
      rmTmp(home);
    }
  });
  test("Linux: User certificate is Chrome's NSS database (no certutil: not trusted)", async () => {
    const v = await linuxFronting.osTrust!({ host: 'hallway.localhost', port: 4443 }, 'user', env as never, async () => ({ code: 0, stdout: '', stderr: '' }));
    assert.deepEqual([v.trusted, v.how], [false, "Chrome's NSS database (~/.pki/nssdb)"]);
  });
});

describe('a browser set by its organisation to ignore certificates you add (D72)', () => {
  test('managed preferences, machine-wide and per user; only files that exist are read', async () => {
    assert.deepEqual(managedPrefsFiles('com.google.Chrome', 'someone'), ['/Library/Managed Preferences/com.google.Chrome.plist', '/Library/Managed Preferences/someone/com.google.Chrome.plist']);
    const read: string[] = [];
    const exists = (f: string) => f === '/Library/Managed Preferences/someone/com.google.Chrome.plist';
    const found = await darwinBrowserPolicies('someone', async (cmd, args) => (read.push([cmd, ...args].join(' ')), { code: 0, stdout: 'false\n', stderr: '' }), undefined, exists);
    assert.deepEqual(found, [{ browser: 'Chrome', file: '/Library/Managed Preferences/someone/com.google.Chrome.plist' }]);
    assert.deepEqual(read, ['plutil -extract CAPlatformIntegrationEnabled raw -o - /Library/Managed Preferences/someone/com.google.Chrome.plist']);
    // set to true, or not set (plutil fails): nothing
    assert.deepEqual(await darwinBrowserPolicies('someone', async () => ({ code: 0, stdout: 'true', stderr: '' }), undefined, () => true), []);
    assert.deepEqual(await darwinBrowserPolicies('someone', async () => ({ code: 1, stdout: '', stderr: 'No value at that key path' }), undefined, () => true), []);
    assert.equal(policyOff(0, '0'), true);
  });
  test("the warning: which browser, where, that System-wide certificate doesn't get round it; none for No HTTPS", () => {
    const p = [{ browser: 'Chrome', file: '/Library/Managed Preferences/com.google.Chrome.plist' }];
    const w = policyWarning(p, 'user')!;
    assert.match(w, /^Your organisation has set Chrome to ignore certificates added to this Mac \(CAPlatformIntegrationEnabled is false in \/Library\/Managed Preferences\/com\.google\.Chrome\.plist\)/);
    assert.match(w, /System-wide certificate doesn't get round it/);
    assert.equal(policyWarning(p, 'none'), null);
    assert.equal(policyWarning([], 'user'), null);
    const tiers = tierOptions('darwin', { proxy: { caddy: null, httpsPort: 4443, httpPort: 4480, publicPort: 443, trust: null, scheme: 'https' }, domain: { base: 'localhost', dashboard: 'hallway.localhost', tls: true, dnsPort: 4253 } } as never, true, p);
    assert.deepEqual(tiers.map((t) => !!t.warning), [true, true, false]);
  });
});

describe('quit and reopen the browser: only when a trust step ran', () => {
  const plan = (done: boolean, tier: 'user' | 'none' = 'user') =>
    planSetup(
      {
        platform: 'darwin', tier, previous: null, base: 'localhost', custom: false, dashboard: 'hallway.localhost', httpsPort: 4443, httpPort: 4480, dnsPort: 4253,
        scheme: tier === 'none' ? 'http' : 'https', publicPort: 443, lowPorts: 'sockets', forwards: [], tld: null,
        caddy: { path: '/opt/homebrew/bin/caddy', version: 'v2.11.2', install: { advice: 'x' } }, dnsmasq: null, conflicts: [], chosenPort: false, warnings: [], stops: [],
        env: { ...env, rootSha1: 'AB' } as never,
        found: { redirect: false, systemTrust: false, userTrust: done, resolver: false, oldResolver: null, dnsmasq: false, forwarders: [] },
        done: { trust: done, lowPorts: false, resolver: true, config: false },
      },
      platformFor('darwin'),
      '/Users/someone/.hallway',
    );
  test('the trust step is the plan\'s; not done after a run means it ran', () => {
    assert.equal(trustRan(plan(false)), true);
    assert.equal(trustRan(plan(true)), false, 'already trusted: nothing changed');
    assert.equal(trustRan(plan(false, 'none')), false, 'No HTTPS has no trust step');
  });
  test('the page and the CLI say the same words', () => {
    assert.equal(PAGE_WORDS, RESTART_BROWSER);
    assert.match(RESTART_BROWSER, /^If a browser showed a certificate warning before, quit and reopen it \(Chrome remembers the old result\)\.$/);
  });
});
