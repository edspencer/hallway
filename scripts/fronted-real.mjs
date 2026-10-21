// `node scripts/fronted-real.mjs`: fronted mode for real (v1 acceptance criteria 1–4, 7–11; D47, D65), with the built
// CLI, on a CI runner with passwordless sudo. First the System-wide setup of the last release (0.6.0, from npm: pf on
// macOS), which this build's `hallway setup --trust system` must migrate (launchd's sockets on macOS, no pf); then the
// criteria, System-wide: 443/80 (launchd on macOS, nftables on Linux), the CA trusted system-wide, Caddy as a
// user-level job; then a custom domain (dnsmasq and the resolver); then the other tiers, each switched to from the
// last: No HTTPS (plain HTTP) everywhere, User certificate for real on Linux (the NSS database) and as a plan on macOS (its
// trust step waits for a Touch ID dialog nobody can answer on a runner); then `hallway teardown` must leave nothing
// behind. It changes the machine's firewall, trust store and
// resolver, so it refuses to run unless CI=true and HALLWAY_REAL_FRONTED=1. The data home is a throwaway; the labels
// and system paths are the real ones, which is why it must never run on a machine that uses Hallway.
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CI !== 'true' || process.env.HALLWAY_REAL_FRONTED !== '1') {
  console.error('fronted-real: refusing to run outside CI (set CI=true and HALLWAY_REAL_FRONTED=1 on a throwaway machine)');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'server', 'cli.js');
assert.ok(fs.existsSync(cli), 'build first (npm run build)');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hw-fr-')));
const data = path.join(tmp, 'data');
const env = { ...process.env, HALLWAY_HOME: data };
for (const k of ['PORT', 'HALLWAY_DEV', 'HALLWAY_DEV_BIND', 'HALLWAY_DEV_ALLOWED_HOSTS', 'NODE_OPTIONS']) delete env[k];
const darwin = process.platform === 'darwin';
const step = (s) => console.log(`\n=== fronted-real: ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run the CLI; returns { code, out } and never throws (output is echoed for the log). */
function hw(...args) {
  try {
    const out = execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 6 * 60_000, killSignal: 'SIGKILL' });
    process.stdout.write(out.replace(/^/gm, '    | '));
    return { code: 0, out };
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    process.stdout.write(out.replace(/^/gm, '    | '));
    return { code: e.status ?? 1, out };
  }
}
const must = (...args) => {
  const r = hw(...args);
  assert.equal(r.code, 0, `hallway ${args.join(' ')} exited ${r.code}`);
  return r.out;
};
const sh = (cmd, args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, killSignal: 'SIGKILL', ...opts }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};
/** curl, with the system's trust store (no --cacert, no -k): the CA has to be trusted for this to pass. */
const curl = (url, extra = []) => sh('curl', ['-sS', '--max-time', '5', '-o', '-', '-w', '\n%{http_code}', ...extra, url]);
const status = (r) => Number(r.out.trim().split('\n').pop());
async function until(what, fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}

// A well-behaved local app: like Local Review, it answers 403 to any Host that isn't its own (DNS-rebinding defence).
// A process of its own: this script runs curl and the CLI synchronously, which would starve a server in-process.
const STRICT_APP = `
const http = require('node:http');
const s = http.createServer((req, res) => {
  const host = req.headers.host ?? '';
  if (!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$/.test(host)) return res.writeHead(403).end('forbidden host\\n');
  res.end(JSON.stringify({ host, forwardedHost: req.headers['x-forwarded-host'] ?? null, family: req.socket.localFamily }));
});
s.on('error', () => console.log(0)); // no IPv6 loopback on this runner: port 0, and the [::1] checks are skipped
s.listen(0, process.argv[1], () => console.log(s.address().port));`;
/** The strict app on one address: 127.0.0.1, or ::1 only (what Vite does on a Mac, where localhost is ::1 first; D68). */
function strictApp(address = '127.0.0.1') {
  const child = spawn(process.execPath, ['-e', STRICT_APP, address], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((r) => child.stdout.once('data', (d) => r({ child, port: Number(String(d).trim()) })));
}

const FORWARDERS = ['https', 'https6', 'http', 'http6'].map((n) => `hallway.forward.${n}`);
const agent = (label) => path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const leftovers = () =>
  [
    ...(darwin ? ['/etc/pf.anchors/hallway', '/Library/LaunchDaemons/hallway.pf.plist', '/etc/resolver/myname.internal'] : ['/etc/hallway/redirect.nft', '/etc/systemd/system/hallway-redirect.service', '/etc/systemd/resolved.conf.d/hallway.conf', '/usr/local/share/ca-certificates/hallway-local-ca.crt']),
    ...(darwin ? ['hallway.caddy', 'hallway.dnsmasq', ...FORWARDERS].map(agent) : ['hallway-caddy.service', 'hallway-dnsmasq.service'].map((f) => path.join(os.homedir(), '.config', 'systemd', 'user', f))),
  ].filter((p) => fs.existsSync(p));
const pfGone = () => {
  assert.ok(!fs.existsSync('/Library/LaunchDaemons/hallway.pf.plist'), 'the hallway.pf LaunchDaemon is gone');
  assert.ok(!fs.existsSync('/etc/pf.anchors/hallway'), 'the pf anchor file is gone');
  assert.doesNotMatch(sh('sudo', ['-n', 'pfctl', '-a', 'com.apple/hallway', '-s', 'nat']).out, /rdr/, 'no rdr rules loaded');
};
const systemTrusted = () =>
  darwin
    ? /Hallway/.test(sh('security', ['find-certificate', '-a', '-c', 'Hallway Local CA', '/Library/Keychains/System.keychain']).out)
    : fs.existsSync('/usr/local/share/ca-certificates/hallway-local-ca.crt');
const doctorFails = (ids) => {
  const r = hw('doctor', '--json');
  return JSON.parse(r.out.slice(r.out.indexOf('{'))).checks.filter((c) => c.status === 'fail' && ids.includes(c.id));
};

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failures.push(name);
  }
}

const review = await strictApp();
const other = await strictApp();
const six = await strictApp('::1');
try {
  step('before: nothing of ours is installed');
  assert.deepEqual(leftovers(), []);
  must('app', 'add', 'review', '--port', String(review.port), '--name', 'Local Review');
  must('service', 'install');
  await until('the daemon', async () => (await fetch('http://localhost:4255/api/health').catch(() => null))?.ok);

  step('migration: the System-wide setup of 0.6.0 (from npm; pf on macOS), then this build');
  // npx's copy of the last release, run against the same data home: what a user upgrading from it has
  await check('0.6.0 sets up System-wide', async () => {
    // from the temp directory: in the checkout, npx would take this package (also called hallway) for the one asked for
    const r = sh('npx', ['-y', 'hallway@0.6.0', 'setup', '--yes'], { env, cwd: tmp, timeout: 8 * 60_000 });
    process.stdout.write(r.out.replace(/^/gm, '    | '));
    assert.equal(r.code, 0);
    assert.equal(status(curl('https://hallway.localhost/api/health')), 200);
    if (darwin) assert.ok(fs.existsSync('/Library/LaunchDaemons/hallway.pf.plist'), "0.6.0's pf redirect");
  });
  await check('this build plans the move: on macOS the pf redirect goes, with one sudo step; the trust stays', async () => {
    const out = must('setup', '--print', '--trust', 'system');
    if (darwin) {
      assert.match(out, /\[sudo\] Remove the pf redirect an older Hallway installed/);
      assert.match(out, /Have launchd hold loopback ports 443 and 80/);
    }
    assert.match(out, /System keychain|system-wide.*\(already done\)|trust store.*\(already done\)/);
  });
  await check('doctor on the 0.6.0 setup: on macOS the pf redirect is named as left over', async () => {
    if (!darwin) return;
    const r = hw('doctor', '--json');
    const c = JSON.parse(r.out.slice(r.out.indexOf('{'))).checks.find((x) => x.id === 'leftover-redirect');
    assert.equal(c?.status, 'warn');
    assert.match(c.fix, /hallway setup --trust system/);
  });
  await check('migrating: 443 answers throughout and after, through launchd on macOS; no pf left', async () => {
    must('setup', '--yes', '--trust', 'system');
    assert.equal(status(curl('https://hallway.localhost/api/health')), 200);
    if (darwin) {
      pfGone();
      for (const l of FORWARDERS) assert.ok(fs.existsSync(agent(l)), `${l} installed`);
      assert.equal(sh('launchctl', ['print', `gui/${process.getuid()}/hallway.forward.https`]).code, 0, 'loaded');
      // [::1] too
      assert.equal(status(curl('https://hallway.localhost/api/health', ['--resolve', 'hallway.localhost:443:::1'])), 200);
      assert.match(sh('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--resolve', 'hallway.localhost:80:::1', 'http://hallway.localhost/']).out, /^308/);
    }
    assert.ok(systemTrusted(), 'the root is still trusted system-wide');
  });
  // back to nothing, so the criteria below start from a fresh machine
  must('teardown', '--yes');
  assert.deepEqual(leftovers(), []);

  step('criterion 8: something else on 443 → setup and doctor name it and stop');
  // root's, so on macOS lsof (as the user) can't see it: setup has to notice it by connecting. An absolute Node, since
  // sudo's secure_path may not have python3 or node on it.
  const pidFile = path.join(tmp, 'squatter.pid');
  const squatter = spawn('sudo', ['-n', process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); require('node:net').createServer(s => s.end()).listen(443, '127.0.0.1')`], { stdio: 'inherit' });
  await until('the squatter on 443', async () => sh('nc', ['-z', '127.0.0.1', '443']).code === 0, 10000);
  await sleep(1500);
  await check('setup refuses, before doing anything', async () => {
    const r = hw('setup', '--yes', '--trust', 'system');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /port 443|443 answers/);
    assert.match(r.out, /Setup stopped before doing anything/);
    assert.deepEqual(leftovers(), []);
  });
  sh('sudo', ['-n', 'kill', fs.readFileSync(pidFile, 'utf8').trim()]);
  squatter.kill();
  await until('443 to be free again', async () => sh('nc', ['-z', '127.0.0.1', '443']).code !== 0, 10000);
  await sleep(500);

  step('criterion 1: setup --print prints the plan and runs nothing');
  await check('--print', async () => {
    const out = must('setup', '--print', '--trust', 'system');
    assert.match(out, /\$ sudo /);
    assert.match(out, /Nothing was run/);
    assert.deepEqual(leftovers(), []);
  });

  step('D67: with no terminal and no --yes, setup refuses (it would ask first), and changes nothing');
  await check('setup with no TTY', async () => {
    const r = hw('setup', '--trust', 'system');
    assert.equal(r.code, 2, 'a usage error');
    assert.match(r.out, /no terminal to ask on: run it in one, or pass --yes/);
    assert.deepEqual(leftovers(), []);
  });

  step('criteria 1–2: setup, for real');
  must('setup', '--yes', '--trust', 'system');
  const ca = path.join(data, 'state', 'caddy', 'data', 'pki', 'authorities', 'local', 'root.crt');
  await check('https://hallway.localhost serves the dashboard with a certificate the system trusts', async () => {
    const r = curl('https://hallway.localhost/api/health');
    assert.equal(status(r), 200, r.out);
    assert.match(must('setup', '--print', '--trust', 'system'), /already done/, 'nothing left to do');
    assert.match(r.out, /"ok":true/);
  });
  await check('http:// redirects to https://', async () => {
    const r = sh('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code} %{redirect_url}', 'http://hallway.localhost/x']);
    assert.match(r.out, /^308 https:\/\/hallway\.localhost\/x/);
  });

  step('criterion 3: a new app works with no sudo and no restart, and its Host is rewritten');
  await check('https://review.localhost reaches the strict app (no 403)', async () => {
    const r = curl('https://review.localhost/');
    assert.equal(status(r), 200, r.out);
    assert.match(r.out, new RegExp(`"host":"localhost:${review.port}"`));
    assert.match(r.out, /"forwardedHost":"review\.localhost"/);
  });
  must('app', 'add', 'other', '--port', String(other.port));
  await check('https://other.localhost, declared just now', async () => {
    await until('other.localhost', async () => status(curl('https://other.localhost/')) === 200, 10000);
  });

  step('D68: an app listening on [::1] only (Vite on a Mac) is reached, probed healthy, and its address recorded');
  if (!six.port) console.log('  - skipped: no IPv6 loopback on this runner');
  else must('app', 'add', 'hmr', '--port', String(six.port));
  if (six.port) await check('https://hmr.localhost reaches the [::1]-only app', async () => {
    await until('hmr.localhost', async () => status(curl('https://hmr.localhost/')) === 200, 10000);
    const r = curl('https://hmr.localhost/');
    assert.match(r.out, new RegExp(`"host":"localhost:${six.port}"`));
    assert.match(r.out, /"family":"IPv6"/);
  });
  if (six.port) await check('the daemon probes it healthy, on ::1', async () => {
    await until('hmr healthy', async () => {
      const r = curl('https://hallway.localhost/api/apps/hmr');
      const v = status(r) === 200 ? JSON.parse(r.out.slice(0, r.out.lastIndexOf('\n'))) : null;
      return v?.health?.state === 'healthy' && v.health.address === '::1';
    }, 20000);
  });

  step('idempotent: setup again does only what is missing');
  await check('re-running setup', async () => {
    const out = must('setup', '--yes', '--trust', 'system');
    assert.match(out, /already done/);
  });

  step('doctor');
  await check('doctor has no networking failures', async () => {
    const r = hw('doctor', '--json');
    const checks = JSON.parse(r.out.slice(r.out.indexOf('{'))).checks;
    const bad = checks.filter((c) => c.status === 'fail' && ['caddy', 'caddy-service', 'caddy-config', 'caddy-socket', 'caddy-ports', 'ports-80-443', 'low-ports', 'redirect', 'ca'].includes(c.id));
    assert.deepEqual(bad, []);
  });

  if (darwin) {
    step("D65: launchd holds 443 and 80, so pf can't take them away (D64's `set skip on lo0` no longer matters)");
    await check('with pf told to skip loopback, 443 still answers', async () => {
      const r = sh('sh', ['-c', "(echo 'set skip on lo0'; cat /etc/pf.conf) | sudo -n pfctl -f -"]);
      assert.equal(r.code, 0, r.out);
      assert.equal(status(curl('https://hallway.localhost/api/health')), 200);
      sh('sudo', ['-n', 'pfctl', '-f', '/etc/pf.conf']);
    });
    await check('a WebSocket-style long-lived connection through the forwarder: 30 s idle, then still open', async () => {
      // a TLS connection to 443 that sends nothing for 30 s, then a request: the forwarder has no timeout
      const r = sh('node', ['-e', `
        const tls = require('node:tls');
        const s = tls.connect({ host: '127.0.0.1', port: 443, servername: 'hallway.localhost' }, () => setTimeout(() => s.write('GET /api/health HTTP/1.1\\r\\nHost: hallway.localhost\\r\\nConnection: close\\r\\n\\r\\n'), 30000));
        let d = ''; s.on('data', (c) => (d += c)); s.on('end', () => { console.log(d.split('\\r\\n')[0]); process.exit(/200/.test(d) ? 0 : 1); });
        s.on('error', (e) => { console.log(e.message); process.exit(1); });`], { timeout: 60_000, env: { ...env, NODE_EXTRA_CA_CERTS: ca } });
      assert.equal(r.code, 0, r.out);
    });
  }

  step('criterion 7: with the daemon stopped, the dashboard host serves the fallback page');
  must('service', 'uninstall');
  await check('fallback lists every app', async () => {
    const r = await until('the fallback', async () => {
      const x = curl('https://hallway.localhost/');
      return status(x) === 502 ? x : null;
    });
    assert.match(r.out, /isn't running|isn&#39;t running|Not answering/);
    assert.match(r.out, /https:\/\/review\.localhost/);
    assert.match(r.out, /https:\/\/other\.localhost/);
  });
  must('service', 'install');
  await until('the daemon again', async () => (await fetch('http://localhost:4255/api/health').catch(() => null))?.ok);

  step('criterion 9: a custom domain');
  must('setup', '--yes', '--domain', 'myname.internal');
  await check('--domain with another tier is a usage error', async () => {
    const r = hw('setup', '--yes', '--trust', 'user', '--domain', 'myname.internal');
    assert.equal(r.code, 2);
  });
  await check('https://myname.internal is the dashboard', async () => {
    const r = await until('myname.internal', async () => {
      const x = curl('https://myname.internal/api/health');
      return status(x) === 200 ? x : null;
    }, 20000);
    assert.match(r.out, /"ok":true/);
  });
  await check('https://review.myname.internal is the app', async () => {
    const r = await until('review.myname.internal', async () => {
      const x = curl('https://review.myname.internal/');
      return status(x) === 200 ? x : null;
    }, 20000);
    assert.match(r.out, new RegExp(`"host":"localhost:${review.port}"`));
  });
  await check('other names still resolve (the resolver only takes myname.internal)', async () => {
    assert.equal(sh(darwin ? 'dscacheutil' : 'getent', darwin ? ['-q', 'host', '-a', 'name', 'github.com'] : ['hosts', 'github.com']).code, 0);
  });
  await check('doctor: dnsmasq on loopback only, the names resolve', async () => {
    const r = hw('doctor', '--json');
    const checks = JSON.parse(r.out.slice(r.out.indexOf('{'))).checks;
    assert.ok(checks.some((c) => c.id === 'dnsmasq-bind' && c.status === 'pass'), 'dnsmasq-bind');
    assert.deepEqual(checks.filter((c) => c.id === 'resolve' && c.status !== 'pass'), []);
  });

  step('criterion 10: .local is refused');
  await check('setup --domain foo.local', async () => {
    const r = hw('setup', '--yes', '--domain', 'foo.local');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /mDNS/);
  });

  step('D65: the other tiers, switched to from System-wide with a custom domain');
  await check('User certificate, as a plan: no sudo but the removals; the trust step is the user\'s own, and says so', async () => {
    const out = must('setup', '--print', '--trust', 'user');
    assert.match(out, /Moving from System-wide certificate to User certificate: what the old tier added is removed \(that needs sudo, this once\)/);
    assert.match(out, /myname\.internal is a custom domain, and those need System-wide certificate/);
    if (darwin) {
      assert.match(out, /\[you\] Trust Hallway's local certificate authority for your account only/);
      assert.match(out, /\$ security add-trusted-cert -r trustRoot -k \S+\/Library\/Keychains\/login\.keychain-db /);
      assert.match(out, /\(asks: macOS, for your Touch ID or password, to change \*your\* certificate trust settings\. This is not an administrator prompt\)/);
    }
    // the only sudo steps remove what System-wide installed
    for (const line of out.split('\n').filter((l) => /^\d+\. \[sudo\]/.test(l))) assert.match(line, /Remove|Stop sending/, line);
  });
  await check('No HTTPS: plain HTTP on the default names; the resolver, dnsmasq and the system-wide trust are gone', async () => {
    const out = must('setup', '--yes', '--trust', 'none');
    assert.match(out, /Moving from System-wide certificate to No HTTPS/);
    const app = darwin ? 'http://review.localhost/' : 'http://review.localhost:4480/';
    const r = await until('the app over plain HTTP', async () => {
      const x = curl(app);
      return status(x) === 200 ? x : null;
    }, 15000);
    assert.match(r.out, new RegExp(`"host":"localhost:${review.port}"`));
    assert.equal(systemTrusted(), false, 'no longer trusted system-wide');
    assert.ok(!fs.existsSync(darwin ? '/etc/resolver/myname.internal' : '/etc/systemd/resolved.conf.d/hallway.conf'), 'the resolver is gone');
    if (darwin) {
      assert.ok(!fs.existsSync(agent('hallway.forward.https')) && fs.existsSync(agent('hallway.forward.http')), 'only port 80 is held');
      assert.notEqual(status(curl('https://hallway.localhost/')), 200, 'nothing on 443');
    } else assert.notEqual(sh('sudo', ['nft', 'list', 'table', 'inet', 'hallway']).code, 0, 'the nft table is gone');
    assert.deepEqual(doctorFails(['caddy', 'caddy-service', 'caddy-config', 'low-ports', 'redirect']), []);
    const s = await until('the daemon on plain HTTP', async () => {
      const x = await (await fetch('http://localhost:4255/api/state')).json();
      return x.apps.find((a) => a.slug === 'review').url.startsWith('http://review.localhost') ? x : null;
    }, 10000);
    assert.equal(s.fronting.trust, 'none');
  });
  if (!darwin)
    await check('User certificate on Linux, for real: https on :4443, the root in the NSS database only, no sudo', async () => {
      const out = must('setup', '--yes', '--trust', 'user');
      assert.doesNotMatch(out, /\$ sudo /);
      const r = curl('https://review.localhost:4443/', ['--cacert', ca]);
      assert.equal(status(r), 200, r.out);
      assert.match(sh('certutil', ['-L', '-d', `sql:${os.homedir()}/.pki/nssdb`]).out, /Hallway Local CA/);
      assert.equal(systemTrusted(), false);
      assert.deepEqual(doctorFails(['redirect', 'ca']), []);
    });

  step('D71: something else on 443 and 80 → named once, then links on Caddy\'s own port (--port 4443), then back');
  {
    // from nothing, so that none of our own forwarders hold 80 when the squatter binds it
    must('teardown', '--yes');
    // every address, like Rancher Desktop's Traefik. On macOS as the user (visible to lsof, so named with its pid); on
    // Linux only root can, so it's someone else's, found by its socket
    const pidFile = path.join(tmp, 'squatter2.pid');
    // launchd lets go of the forwarders' sockets a moment after teardown: wait for that, and retry while it does
    await until('443 and 80 to be free after teardown', async () => sh('nc', ['-z', '127.0.0.1', '443']).code !== 0 && sh('nc', ['-z', '127.0.0.1', '80']).code !== 0, 15000);
    const code = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); const net = require('node:net'); const end = Date.now() + 20000; const hold = (p) => net.createServer(s => s.end()).on('error', (e) => { if (e.code !== 'EADDRINUSE' || Date.now() > end) throw e; setTimeout(() => hold(p), 500); }).listen(p, '0.0.0.0'); for (const p of [443, 80]) hold(p)`;
    const squatter = darwin ? spawn(process.execPath, ['-e', code], { stdio: 'inherit' }) : spawn('sudo', ['-n', process.execPath, '-e', code], { stdio: 'inherit' });
    await until('the squatter on 443 and 80', async () => sh('nc', ['-z', '127.0.0.1', '443']).code === 0 && sh('nc', ['-z', '127.0.0.1', '80']).code === 0, 25000);
    await sleep(1500);
    try {
      await check('setup stops before changing anything, with one message for both ports and the way to coexist', async () => {
        const before = fs.readFileSync(path.join(data, 'config.yaml'), 'utf8');
        const r = hw('setup', '--yes', '--trust', 'system');
        assert.notEqual(r.code, 0);
        assert.match(r.out, darwin ? /Ports 443 and 80 are taken by node: node \(pid \d+: .*\), listening on \*, so reachable from your network/ : /Ports? 443( and 80)? (is|are) taken by a process you can't see/);
        assert.match(r.out, /Or leave it running and give Hallway's links Caddy's own port, 4443: `hallway setup --trust system --port 4443`/);
        assert.match(r.out, /Setup stopped before doing anything/);
        if (darwin) assert.equal((r.out.match(/Hallway won't fight it/g) ?? []).length, 1, 'one message for both ports');
        assert.equal(fs.readFileSync(path.join(data, 'config.yaml'), 'utf8'), before, 'config.yaml unchanged');
      });
      await check('--port 4443: links carry the port, nothing on 443/80 of ours, doctor says which port', async () => {
        const out = must('setup', '--yes', '--trust', 'system', '--port', '4443');
        assert.match(out, /Links carry Caddy's own port, :4443/);
        const r = await until('the dashboard on :4443', async () => {
          const x = curl('https://hallway.localhost:4443/api/health');
          return status(x) === 200 ? x : null;
        }, 15000);
        assert.ok(r);
        assert.match(fs.readFileSync(path.join(data, 'config.yaml'), 'utf8'), /publicPort: 4443/);
        if (darwin) assert.ok(!fs.existsSync(agent('hallway.forward.https')) && !fs.existsSync(agent('hallway.forward.http')), 'no forwarders');
        else assert.notEqual(sh('sudo', ['nft', 'list', 'table', 'inet', 'hallway']).code, 0, 'no redirect');
        const s = await until('links with :4443', async () => {
          const x = await (await fetch('http://localhost:4255/api/state')).json();
          return x.apps.find((a) => a.slug === 'review').url === 'https://review.localhost:4443' ? x : null;
        }, 10000);
        assert.equal(s.fronting.standardPort, 443);
        assert.match(await (await fetch('http://localhost:4255/llms.txt')).text(), /review\.localhost:4443/);
        assert.deepEqual(doctorFails(['caddy', 'caddy-service', 'caddy-config', 'redirect', 'ca', 'ports-80-443']), []);
        const doc = hw('doctor', '--json');
        assert.match(doc.out, /links carry Caddy's own port, :4443/);
        assert.equal(status(curl(`https://review.localhost:4443/`)), 200);
      });
      await check('--port 443 while it is still taken: stopped, nothing changed', async () => {
        const r = hw('setup', '--yes', '--port', '443');
        assert.notEqual(r.code, 0);
        assert.match(r.out, /Setup stopped before doing anything/);
        assert.match(fs.readFileSync(path.join(data, 'config.yaml'), 'utf8'), /publicPort: 4443/);
      });
    } finally {
      if (darwin) squatter.kill();
      else sh('sudo', ['-n', 'kill', fs.readFileSync(pidFile, 'utf8').trim()]);
      squatter.kill();
    }
    await until('443 and 80 to be free again', async () => sh('nc', ['-z', '127.0.0.1', '443']).code !== 0, 10000);
    await sleep(500);
    await check('--port 443 once it is free: back to plain https:// links, in the same tier', async () => {
      const out = must('setup', '--yes', '--port', '443');
      assert.match(out, /Tier: System-wide certificate \(--trust system\), as set up now/);
      const r = await until('the dashboard on 443', async () => {
        const x = curl('https://hallway.localhost/api/health');
        return status(x) === 200 ? x : null;
      }, 15000);
      assert.ok(r);
      assert.doesNotMatch(fs.readFileSync(path.join(data, 'config.yaml'), 'utf8'), /publicPort: 4443/);
      await until('links without a port', async () => {
        const x = await (await fetch('http://localhost:4255/api/state')).json();
        return x.apps.find((a) => a.slug === 'review').url === 'https://review.localhost';
      }, 10000);
    });
  }

  step('criterion 11: teardown leaves nothing behind; the dashboard keeps working directly');
  must('teardown', '--yes');
  await check('no files, jobs, redirect or trusted root left', async () => {
    assert.deepEqual(leftovers(), []);
    if (darwin) {
      assert.doesNotMatch(sh('sudo', ['pfctl', '-a', 'com.apple/hallway', '-s', 'nat']).out, /rdr/);
      assert.doesNotMatch(sh('security', ['find-certificate', '-a', '-c', 'Hallway Local CA', '/Library/Keychains/System.keychain']).out, /Hallway/);
    } else {
      assert.notEqual(sh('sudo', ['nft', 'list', 'table', 'inet', 'hallway']).code, 0, 'the nft table is gone');
      assert.doesNotMatch(fs.readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8'), new RegExp(fs.readFileSync(ca, 'utf8').split('\n')[1].slice(0, 40)));
      assert.doesNotMatch(sh('certutil', ['-L', '-d', `sql:${os.homedir()}/.pki/nssdb`]).out, /Hallway Local CA/, 'not in the NSS database either');
    }
    assert.notEqual(status(curl('https://hallway.localhost/')), 200);
  });
  await check('the dashboard on http://localhost:4255, in direct mode', async () => {
    // the daemon reads config.yaml through its watcher, a moment after teardown wrote it
    const s = await until('direct mode', async () => {
      const x = await (await fetch('http://localhost:4255/api/state')).json();
      return x.config.config.mode === 'direct' ? x : null;
    }, 10000);
    assert.match(s.apps.find((a) => a.slug === 'review').url, /^http:\/\/localhost:/);
  });
  await check('teardown again: nothing to undo', async () => assert.match(must('teardown', '--yes'), /Nothing to undo/));
} finally {
  step('clean up');
  hw('teardown', '--yes');
  hw('service', 'uninstall');
  review.child.kill();
  other.child.kill();
  six.child.kill();
  const left = leftovers();
  if (left.length) {
    console.log(`left behind: ${left.join(', ')}`);
    failures.push('cleanup');
  }
}
if (failures.length) {
  console.error(`\nfronted-real: ${failures.length} check(s) failed: ${failures.join('; ')}`);
  process.exitCode = 1;
} else console.log('\nfronted-real: all checks passed');
