// `node scripts/fronted-real.mjs`: fronted mode for real (v1 acceptance criteria 1–4, 7–11; D47), with the built
// CLI, on a CI runner with passwordless sudo: `hallway setup` installs the 443/80 redirect (pf on macOS, nftables on
// Linux), trusts Hallway's CA system-wide and starts Caddy as a user-level job; then a custom domain (dnsmasq and the
// resolver); then `hallway teardown` must leave nothing behind. It changes the machine's firewall, trust store and
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
  if (!/^(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(host)) return res.writeHead(403).end('forbidden host\\n');
  res.end(JSON.stringify({ host, forwardedHost: req.headers['x-forwarded-host'] ?? null }));
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;
function strictApp() {
  const child = spawn(process.execPath, ['-e', STRICT_APP], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((r) => child.stdout.once('data', (d) => r({ child, port: Number(String(d).trim()) })));
}

const leftovers = () =>
  [
    ...(darwin ? ['/etc/pf.anchors/hallway', '/Library/LaunchDaemons/hallway.pf.plist', '/etc/resolver/myname.internal'] : ['/etc/hallway/redirect.nft', '/etc/systemd/system/hallway-redirect.service', '/etc/systemd/resolved.conf.d/hallway.conf', '/usr/local/share/ca-certificates/hallway-local-ca.crt']),
    ...(darwin ? ['hallway.caddy.plist', 'hallway.dnsmasq.plist'].map((f) => path.join(os.homedir(), 'Library', 'LaunchAgents', f)) : ['hallway-caddy.service', 'hallway-dnsmasq.service'].map((f) => path.join(os.homedir(), '.config', 'systemd', 'user', f))),
  ].filter((p) => fs.existsSync(p));

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
try {
  step('before: nothing of ours is installed');
  assert.deepEqual(leftovers(), []);
  must('app', 'add', 'review', '--port', String(review.port), '--name', 'Local Review');
  must('service', 'install');
  await until('the daemon', async () => (await fetch('http://localhost:4255/api/health').catch(() => null))?.ok);

  step('criterion 8: something else on 443 → setup and doctor name it and stop');
  // root's, so on macOS lsof (as the user) can't see it: setup has to notice it by connecting. An absolute Node, since
  // sudo's secure_path may not have python3 or node on it.
  const squatter = spawn('sudo', ['-n', process.execPath, '-e', "require('node:net').createServer(s => s.end()).listen(443, '127.0.0.1')"], { stdio: 'inherit' });
  await until('the squatter on 443', async () => sh('nc', ['-z', '127.0.0.1', '443']).code === 0, 10000);
  await sleep(1500);
  await check('setup refuses, before doing anything', async () => {
    const r = hw('setup');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /port 443|443 answers/);
    assert.match(r.out, /Setup stopped before doing anything/);
    assert.deepEqual(leftovers(), []);
  });
  sh('sudo', ['-n', 'pkill', '-f', 'listen\\(443']);
  squatter.kill();
  await sleep(500);

  step('criterion 1: setup --print prints the plan and runs nothing');
  await check('--print', async () => {
    const out = must('setup', '--print');
    assert.match(out, /\$ sudo /);
    assert.match(out, /Nothing was run/);
    assert.deepEqual(leftovers(), []);
  });

  step('criteria 1–2: setup, for real');
  must('setup');
  const ca = path.join(data, 'state', 'caddy', 'data', 'pki', 'authorities', 'local', 'root.crt');
  await check('https://hallway.localhost serves the dashboard with a certificate the system trusts', async () => {
    const r = curl('https://hallway.localhost/api/health');
    assert.equal(status(r), 200, r.out);
    assert.match(must('setup', '--print'), /already done/, 'nothing left to do');
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
    assert.match(r.out, new RegExp(`"host":"127\\.0\\.0\\.1:${review.port}"`));
    assert.match(r.out, /"forwardedHost":"review\.localhost"/);
  });
  must('app', 'add', 'other', '--port', String(other.port));
  await check('https://other.localhost, declared just now', async () => {
    await until('other.localhost', async () => status(curl('https://other.localhost/')) === 200, 10000);
  });

  step('idempotent: setup again does only what is missing');
  await check('re-running setup', async () => {
    const out = must('setup');
    assert.match(out, /already done/);
  });

  step('doctor');
  await check('doctor has no networking failures', async () => {
    const r = hw('doctor', '--json');
    const checks = JSON.parse(r.out.slice(r.out.indexOf('{'))).checks;
    const bad = checks.filter((c) => c.status === 'fail' && ['caddy', 'caddy-service', 'caddy-config', 'caddy-socket', 'caddy-ports', 'ports-80-443', 'redirect', 'ca'].includes(c.id));
    assert.deepEqual(bad, []);
  });

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
  must('setup', '--domain', 'myname.internal');
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
    assert.match(r.out, new RegExp(`127\\.0\\.0\\.1:${review.port}`));
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
    const r = hw('setup', '--domain', 'foo.local');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /mDNS/);
  });

  step('criterion 11: teardown leaves nothing behind; the dashboard keeps working directly');
  must('teardown');
  await check('no files, jobs, redirect or trusted root left', async () => {
    assert.deepEqual(leftovers(), []);
    if (darwin) {
      assert.doesNotMatch(sh('sudo', ['pfctl', '-a', 'com.apple/hallway', '-s', 'nat']).out, /rdr/);
      assert.doesNotMatch(sh('security', ['find-certificate', '-a', '-c', 'Hallway Local CA', '/Library/Keychains/System.keychain']).out, /Hallway/);
    } else {
      assert.notEqual(sh('sudo', ['nft', 'list', 'table', 'inet', 'hallway']).code, 0, 'the nft table is gone');
      assert.doesNotMatch(fs.readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8'), new RegExp(fs.readFileSync(ca, 'utf8').split('\n')[1].slice(0, 40)));
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
  await check('teardown again: nothing to undo', async () => assert.match(must('teardown'), /Nothing to undo/));
} finally {
  step('clean up');
  hw('teardown');
  hw('service', 'uninstall');
  review.child.kill();
  other.child.kill();
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
