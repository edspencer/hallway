// `node scripts/services-real.mjs`: the managed-service lifecycle against the machine's REAL service manager
// (launchd on macOS, systemd's user instance on Linux), with the built CLI (dist/server/cli.js). CI only: it writes
// into the real ~/Library/LaunchAgents or ~/.config/systemd/user and loads jobs into the real launchd / systemd, so
// it refuses to run unless CI=true and HALLWAY_REAL_SERVICES=1. It removes everything it installs. The data home is a
// throwaway; the jobs' labels are the real ones (hallway.daemon, hallway.app.*), which is why it must not run on a
// machine that uses Hallway.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CI !== 'true' || process.env.HALLWAY_REAL_SERVICES !== '1') {
  console.error('services-real: refusing to run outside CI (set CI=true and HALLWAY_REAL_SERVICES=1 on a throwaway machine)');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'server', 'cli.js');
assert.ok(fs.existsSync(cli), 'build first (npm run build)');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hw-real-')));
const data = path.join(tmp, 'data');
const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const env = { ...process.env, HALLWAY_HOME: data };
for (const k of ['PORT', 'HALLWAY_DEV', 'HALLWAY_DEV_BIND', 'HALLWAY_DEV_ALLOWED_HOSTS', 'NODE_OPTIONS']) delete env[k];
const step = (s) => console.log(`services-real: ${s}`);
const hw = (...args) => {
  try {
    return execFileSync(process.execPath, [cli, ...args], { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`hallway ${args.join(' ')} exited ${e.status}:\n${e.stdout}\n${e.stderr}`);
  }
};
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}
const up = async (url) => (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
const down = async (url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
};

const darwin = process.platform === 'darwin';
const uid = process.getuid();
const unitDir = darwin ? path.join(os.homedir(), 'Library', 'LaunchAgents') : path.join(os.homedir(), '.config', 'systemd', 'user');
const unitFile = (label) => path.join(unitDir, darwin ? `${label}.plist` : `${label.replace(/\./g, '-')}.service`);
const managerSays = (label) => {
  try {
    return darwin
      ? execFileSync('launchctl', ['print', `gui/${uid}/${label}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      : execFileSync('systemctl', ['--user', 'show', label.replace(/\./g, '-') + '.service', '--property=ActiveState,LoadState'], { encoding: 'utf8' });
  } catch {
    return null;
  }
};

try {
  step(`${darwin ? 'launchd (gui/' + uid + ')' : 'systemd --user'}; data home ${data}`);
  hw('app', 'ls'); // creates the data home
  const port = await freePort();
  fs.appendFileSync(path.join(data, 'config.yaml'), `port: ${port}\n`);

  step('service install');
  const installed = hw('service', 'install');
  assert.match(installed, new RegExp(`It's running: http://localhost:${port}`), installed);
  assert.ok(fs.existsSync(unitFile('hallway.daemon')));
  console.log(hw('service', 'status'));
  if (darwin) assert.match(managerSays('hallway.daemon') ?? '', /state = running/);
  else assert.match(managerSays('hallway.daemon') ?? '', /ActiveState=active/);

  step('service restart');
  hw('service', 'restart');
  await until('the daemon after a restart', () => up(`http://localhost:${port}/api/health`));

  step('hallway run (not persistent)');
  fs.writeFileSync(path.join(work, 'server.js'), "require('http').createServer((q, s) => { console.log('hit', q.url); s.end('pid ' + process.pid) }).listen(Number(process.env.PORT), process.env.HOST, () => console.log('listening'))");
  const ran = hw('run', 'real-demo', '--', 'node', 'server.js');
  const url = ran.match(/real-demo is up: (http:\/\/localhost:\d+)/)?.[1];
  assert.ok(url, ran);
  assert.match(await (await fetch(url)).text(), /^pid \d+$/);
  assert.match(hw('logs', 'real-demo'), /listening/);
  const status = JSON.parse(hw('status', 'real-demo', '--json'));
  assert.equal(status.managed, true);

  step('stop, start, restart');
  hw('stop', 'real-demo');
  await until('the app to stop', () => down(url));
  assert.match(fs.readFileSync(path.join(data, 'apps', 'real-demo.yaml'), 'utf8'), /^expected: stopped$/m);
  if (darwin) assert.equal(managerSays('hallway.app.real-demo'), null, 'booted out');
  assert.match(hw('start', 'real-demo'), /real-demo started/);
  assert.match(hw('restart', 'real-demo'), /real-demo restarted/);

  step('--persist: KeepAlive / Restart=always brings it back after a crash');
  const kept = hw('run', 'real-kept', '--persist', '--', 'node', 'server.js');
  const keptUrl = kept.match(/real-kept is up: (http:\/\/localhost:\d+)/)?.[1];
  assert.ok(keptUrl, kept);
  const pid1 = Number((await (await fetch(keptUrl)).text()).split(' ')[1]);
  process.kill(pid1, 'SIGKILL');
  const pid2 = await until('the persistent app to be restarted', async () => {
    const t = await (await fetch(keptUrl, { signal: AbortSignal.timeout(1000) })).text();
    const p = Number(t.split(' ')[1]);
    return p && p !== pid1 ? p : null;
  }, 40000);
  step(`restarted: pid ${pid1} → ${pid2}`);

  step('service regenerate, doctor');
  console.log(hw('service', 'regenerate'));
  const doc = JSON.parse(execFileSync(process.execPath, [cli, 'doctor', '--json'], { cwd: work, env, encoding: 'utf8' }));
  const failed = doc.checks.filter((c) => c.status === 'fail');
  assert.deepEqual(failed, [], 'doctor finds no problems');
  console.log(doc.checks.map((c) => `${c.status} ${c.message}`).join('\n'));

  step('clean up');
  hw('service', 'rm', 'real-demo');
  hw('service', 'rm', 'real-kept');
  hw('service', 'uninstall');
  await until('the daemon to go', () => down(`http://localhost:${port}/api/health`));
  await until('the persistent app to go', () => down(keptUrl));
  for (const l of ['hallway.daemon', 'hallway.app.real-demo', 'hallway.app.real-kept']) {
    assert.equal(fs.existsSync(unitFile(l)), false, `${unitFile(l)} is removed`);
    if (darwin) assert.equal(managerSays(l), null, `${l} is unloaded`);
  }
  step('ok');
} finally {
  // best effort, in case an assertion stopped the run halfway
  for (const args of [['service', 'rm', 'real-demo'], ['service', 'rm', 'real-kept'], ['service', 'uninstall']])
    try {
      execFileSync(process.execPath, [cli, ...args], { cwd: work, env, stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  for (const f of ['daemon.out.log', 'daemon.err.log', 'real-demo.err.log', 'real-kept.err.log'])
    if (fs.existsSync(path.join(data, 'logs', f)) && fs.statSync(path.join(data, 'logs', f)).size)
      console.log(`--- ${f}\n${fs.readFileSync(path.join(data, 'logs', f), 'utf8').slice(-4000)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
