// `node scripts/services-real.mjs`: the managed-service lifecycle against the machine's REAL service manager
// (launchd on macOS, systemd's user instance on Linux, Task Scheduler on Windows), with the built CLI
// (dist/server/cli.js). CI only: it writes into the real ~/Library/LaunchAgents, ~/.config/systemd/user or
// %LOCALAPPDATA%\hallway\tasks and loads jobs into the real launchd / systemd / Task Scheduler, so
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
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
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
/** The exit code as well: `service status` exits 3 (not running) and 4 (not installed), the CLI contract's (D74). */
const hwExit = (...args) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [cli, ...args], { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout), stderr: String(e.stderr) };
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
const windows = process.platform === 'win32';
const uid = process.getuid?.();
const unitDir = darwin
  ? path.join(os.homedir(), 'Library', 'LaunchAgents')
  : windows
    ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'hallway', 'tasks')
    : path.join(os.homedir(), '.config', 'systemd', 'user');
const unitFile = (label) => path.join(unitDir, darwin ? `${label}.plist` : windows ? `${label}.json` : `${label.replace(/\./g, '-')}.service`);
const managerSays = (label) => {
  try {
    if (darwin) return execFileSync('launchctl', ['print', `gui/${uid}/${label}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // the task's definition (its state words are localised; the supervisor's state file says whether it runs)
    if (windows) return execFileSync('schtasks', ['/Query', '/TN', `\\${label}`, '/XML'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return execFileSync('systemctl', ['--user', 'show', label.replace(/\./g, '-') + '.service', '--property=ActiveState,LoadState,UnitFileState'], { encoding: 'utf8' });
  } catch {
    return null;
  }
};
/** Whether the manager would start the job at the next login: what `service stop` must leave alone (D74). */
const disabled = (label) => {
  if (darwin) return new RegExp(`"${label.replace(/\./g, '\\.')}" => (true|disabled)`).test(execFileSync('launchctl', ['print-disabled', `gui/${uid}`], { encoding: 'utf8' }));
  if (windows) return /<Settings>[\s\S]*<Enabled>false<\/Enabled>[\s\S]*<\/Settings>/.test(managerSays(label) ?? '');
  return !/UnitFileState=enabled/.test(managerSays(label) ?? '');
};

try {
  step(`${darwin ? 'launchd (gui/' + uid + ')' : windows ? 'Task Scheduler' : 'systemd --user'}; data home ${data}`);
  hw('app', 'ls'); // creates the data home
  const port = await freePort();
  // a small log limit, so the rotation step below doesn't need 10 MB of output
  fs.appendFileSync(path.join(data, 'config.yaml'), `port: ${port}\nservices:\n  logMaxBytes: 65536\n  logGenerations: 2\n`);

  step('service status before install: exit 4');
  assert.equal(hwExit('service', 'status').code, 4);
  assert.equal(hwExit('service', 'stop').code, 4);

  step('service install');
  const installed = hw('service', 'install');
  assert.match(installed, new RegExp(`It's running: http://localhost:${port}`), installed);
  assert.ok(fs.existsSync(unitFile('hallway.daemon')));
  console.log(hw('service', 'status'));
  if (darwin) assert.match(managerSays('hallway.daemon') ?? '', /state = running/);
  else if (windows) assert.match(managerSays('hallway.daemon') ?? '', /<LogonTrigger>/);
  else assert.match(managerSays('hallway.daemon') ?? '', /ActiveState=active/);

  const st = JSON.parse(hw('service', 'status', '--json'));
  assert.equal(st.running, true);
  assert.equal(st.answering, true);
  assert.equal(st.installedVersion, st.runningVersion);

  step('service stop: stopped, not disabled (the next login starts it); status exits 3');
  const stopped = JSON.parse(hw('service', 'stop', '--json'));
  assert.equal(stopped.ok, true);
  await until('the daemon to stop', () => down(`http://localhost:${port}/api/health`));
  assert.equal(disabled('hallway.daemon'), false, 'service stop leaves the job enabled');
  if (darwin) assert.equal(managerSays('hallway.daemon'), null, 'booted out');
  else if (!windows) assert.match(managerSays('hallway.daemon') ?? '', /ActiveState=(inactive|failed)/);
  const after = hwExit('service', 'status', '--json');
  assert.equal(after.code, 3, after.stdout + after.stderr);
  assert.equal(JSON.parse(after.stdout).installed, true);
  // and it stays stopped: KeepAlive / Restart=always / the supervisor don't bring it back
  await sleep(darwin || windows ? 12000 : 3000);
  assert.ok(await down(`http://localhost:${port}/api/health`), 'still stopped');

  step('service start, service logs');
  const started = JSON.parse(hw('service', 'start', '--json'));
  assert.equal(started.ok, true);
  assert.equal(started.answering, true);
  assert.equal(hwExit('service', 'status').code, 0);
  const daemonLogs = await until('the startup line in service logs', () => {
    const l = hw('service', 'logs', '-n', '10');
    return l.includes(`Hallway ${pkg.version}: http://localhost:${port}`) && l;
  });
  console.log(daemonLogs);

  step('busy (D75): the service daemon found through runtime.json, idle');
  const idle = hwExit('busy', '--json');
  assert.equal(idle.code, 0, idle.stderr);
  const busyDoc = JSON.parse(idle.stdout);
  assert.equal(busyDoc.running, true);
  assert.equal(busyDoc.busy, false);
  assert.equal(busyDoc.version, pkg.version);
  assert.deepEqual(busyDoc.counts, { setup: 0, app: 0 });

  step('service restart');
  assert.equal(JSON.parse(hw('service', 'restart', '--json')).ok, true);
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
  // the control for the daemon's `service stop` above: an app's stop is durable, across logins too (D41)
  assert.equal(disabled('hallway.app.real-demo'), true, "an app's stop disables it");
  assert.match(hw('start', 'real-demo'), /real-demo started/);
  // launchd and Task Scheduler undo the disable; systemd enables a unit only if it starts at login, which a run
  // without --persist doesn't
  if (darwin || windows) assert.equal(disabled('hallway.app.real-demo'), false, 'start enables it again');
  assert.match(hw('restart', 'real-demo'), /real-demo restarted/);

  step('--persist: KeepAlive / Restart=always / the supervisor brings it back after a crash');
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

  step('log rotation: copy, then truncate, while the service manager keeps writing');
  fs.writeFileSync(
    path.join(work, 'noisy.js'),
    "process.stdout.write(('x'.repeat(99) + '\\n').repeat(3000)); require('http').createServer((q, s) => { console.log('hit'); s.end('ok') }).listen(Number(process.env.PORT), process.env.HOST)",
  );
  const noisy = hw('run', 'real-noisy', '--', 'node', 'noisy.js');
  const noisyUrl = noisy.match(/real-noisy is up: (http:\/\/localhost:\d+)/)?.[1];
  assert.ok(noisyUrl, noisy);
  const out = path.join(data, 'logs', 'real-noisy.out.log');
  await until('the daemon to rotate real-noisy.out.log', () => fs.existsSync(`${out}.1`), 40000);
  for (let i = 0; i < 5; i++) await fetch(noisyUrl);
  await sleep(500);
  const sizes = { live: fs.statSync(out).size, rotated: fs.statSync(`${out}.1`).size };
  step(`rotated: ${JSON.stringify(sizes)}`);
  assert.ok(sizes.rotated <= 65536, 'the rotated file is within the limit');
  // had the service manager not opened the log for appending, the writer would carry on at its old offset (~300 KB)
  assert.ok(sizes.live < 4096, `writes after the truncation land at the start of the file (${sizes.live} bytes)`);
  assert.match(fs.readFileSync(out, 'utf8'), /^(hit\n)+$/);
  hw('service', 'rm', 'real-noisy');

  step('service regenerate, doctor');
  console.log(hw('service', 'regenerate'));
  const doc = JSON.parse(execFileSync(process.execPath, [cli, 'doctor', '--json'], { cwd: work, env, encoding: 'utf8' }));
  const failed = doc.checks.filter((c) => c.status === 'fail');
  assert.deepEqual(failed, [], 'doctor finds no problems');
  // the jobs' PATHs are what Hallway itself wrote: doctor must find nothing wrong with them (on Windows it once split
  // them on `:`, which cut every `C:\…` entry in two)
  assert.deepEqual(doc.checks.filter((c) => c.id === 'job-path'), [], 'no PATH warnings');
  console.log(doc.checks.map((c) => `${c.status} ${c.message}`).join('\n'));

  step('clean up');
  hw('service', 'rm', 'real-demo');
  hw('service', 'rm', 'real-kept');
  hw('service', 'uninstall');
  await until('the daemon to go', () => down(`http://localhost:${port}/api/health`));
  // nothing running: busy exits 3 (its runtime.json is gone, or names a pid that's gone)
  assert.equal(hwExit('busy').code, 3);
  await until('the persistent app to go', () => down(keptUrl));
  for (const l of ['hallway.daemon', 'hallway.app.real-demo', 'hallway.app.real-kept']) {
    assert.equal(fs.existsSync(unitFile(l)), false, `${unitFile(l)} is removed`);
    if (darwin || windows) assert.equal(managerSays(l), null, `${l} is unloaded`);
  }
  step('ok');
} finally {
  // best effort, in case an assertion stopped the run halfway
  for (const args of [['service', 'rm', 'real-demo'], ['service', 'rm', 'real-kept'], ['service', 'rm', 'real-noisy'], ['service', 'uninstall']])
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
