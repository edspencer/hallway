// `hallway run`, `status`, `stop`, `start`, `restart`, `logs` and `service rm`, end to end: the real CLI (from
// source), a real server process, and a stand-in `systemctl` (test/fixtures/fake-systemctl) that reads the units
// Hallway writes and really runs them, detached. So it checks what can be checked without a systemd user instance:
// the unit Hallway generates is runnable as written, the server outlives the CLI, the YAML follows the lifecycle,
// and PATH survives the fnm trap. Linux only (macOS would use launchctl); a throwaway HOME and data home throughout.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ipv6Loopback } from '../server/proxy/index.ts';
import { exitWatchdog, ROOT, tmpDir, rmTmp } from './fixture.ts';

await exitWatchdog();
const v6 = await ipv6Loopback();

const linux = process.platform === 'linux';
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-systemctl');
const ROOTDIR = linux ? tmpDir('hw-test-e2e-') : '';
const HOME = path.join(ROOTDIR, 'home');
const DATA = path.join(ROOTDIR, 'data');
const PROJ = path.join(ROOTDIR, 'my app');
// fnm's trap: `node` reached through a per-shell symlink directory that the job must not keep
const SHELL_BIN = path.join(ROOTDIR, 'state', 'fnm_multishells', '4242_1700000000000', 'bin');

function env(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['PORT', 'HALLWAY_DEV', 'HALLWAY_DEV_BIND', 'HALLWAY_DEV_ALLOWED_HOSTS', 'XDG_CONFIG_HOME', 'NODE_ENV']) delete e[k];
  return { ...e, HOME, HALLWAY_HOME: DATA, FAKE_RESTART_SEC: '0.2', PATH: [SHELL_BIN, FAKE, process.env.PATH].join(':') };
}

const hallway = (args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
    execFile(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/cli.ts'), ...args], { env: env(), cwd: ROOT, timeout: 60000 }, (err, stdout, stderr) =>
      res({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });

const SERVER = `require('http').createServer((q, s) => { console.log('hit ' + q.url); s.end('hello from ' + process.env.PORT + ' ' + process.env.HOST) }).listen(Number(process.env.PORT), process.env.HOST, () => console.log('listening on ' + process.env.PORT))`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const unitFile = (slug: string) => path.join(HOME, '.config', 'systemd', 'user', `hallway-app-${slug}.service`);
const yaml = (slug: string) => fs.readFileSync(path.join(DATA, 'apps', `${slug}.yaml`), 'utf8');

describe('hallway run & co. (fake systemctl, real processes)', { skip: !linux && 'Linux only: macOS runs launchctl' }, () => {
  before(() => {
    fs.mkdirSync(HOME, { recursive: true });
    fs.mkdirSync(PROJ, { recursive: true });
    fs.writeFileSync(path.join(PROJ, 'server.js'), SERVER);
    fs.mkdirSync(SHELL_BIN, { recursive: true });
    fs.symlinkSync(process.execPath, path.join(SHELL_BIN, 'node'));
  });

  after(async () => {
    // whatever happened, leave nothing running
    for (const s of ['demo', 'crash', 'kept', 'hmr']) await hallway(['service', 'rm', s]);
    const state = path.join(HOME, '.fake-systemd');
    for (const f of fs.existsSync(state) ? fs.readdirSync(state) : [])
      if (/\.(pid|supervisor)$/.test(f)) {
        const pid = Number(fs.readFileSync(path.join(state, f), 'utf8'));
        if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
      }
    rmTmp(ROOTDIR);
  });

  let port = 0;

  test('doctor on a brand-new machine: warnings, not failures, and it creates nothing', async () => {
    const r = await hallway(['doctor', '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const d = JSON.parse(r.stdout);
    assert.equal(d.ok, true);
    assert.equal(d.checks.find((c: { id: string }) => c.id === 'data-home').status, 'warn');
    assert.equal(fs.existsSync(DATA), false, 'doctor is read-only');
  });

  test('run: registers the app, starts it as a unit, waits for the port, prints the URL, exits 0', async () => {
    const r = await hallway(['run', 'demo', '--cwd', PROJ, '--name', 'Demo', '--', 'node', 'server.js']);
    assert.equal(r.code, 0, r.stderr);
    const m = /demo is up: (http:\/\/localhost:(\d+))/.exec(r.stdout);
    assert.ok(m, r.stdout);
    port = Number(m[2]);
    const [lo, hi] = [5100, 5999];
    assert.ok(port >= lo && port <= hi, `port ${port} is from ports.assignRange`);
    // the CLI has exited; the server is still there, and has PORT and HOST from the unit
    const body = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.equal(body, `hello from ${port} 127.0.0.1`);
    const y = yaml('demo');
    assert.match(y, /^name: Demo$/m);
    assert.match(y, new RegExp(`^port: ${port}$`, 'm'));
    assert.match(y, /^expected: adhoc$/m);
    assert.match(y, /runAtLoad: false/);
    assert.match(y, /keepAlive: false/);
  });

  test("the unit's PATH starts with node's real bin and drops fnm's per-shell directory", () => {
    const unit = fs.readFileSync(unitFile('demo'), 'utf8');
    const PATH = /^Environment="PATH=([^"]*)"$/m.exec(unit)![1].split(':');
    assert.equal(PATH[0], path.dirname(fs.realpathSync(process.execPath)));
    assert.ok(!PATH.some((d) => d.includes('fnm_multishells')), PATH.join(':'));
    assert.match(unit, new RegExp(`^ExecStart=${fs.realpathSync(process.execPath).replace(/[.]/g, '\\.')} server\\.js$`, 'm'));
    assert.doesNotMatch(unit, /WantedBy/, 'not started at login without --persist');
    const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'generated', 'services', 'hallway.app.demo.json'), 'utf8'));
    assert.equal(manifest.node.version, process.version);
  });

  test('status --json probes it once (no daemon): healthy', async () => {
    const r = await hallway(['status', 'demo', '--json']);
    assert.equal(r.code, 0, r.stderr);
    const v = JSON.parse(r.stdout);
    assert.equal(v.slug, 'demo');
    assert.equal(v.health.state, 'healthy');
    assert.equal(v.managed, true);
  });

  test('logs: what the server wrote', async () => {
    const r = await hallway(['logs', 'demo', '--lines', '5']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`listening on ${port}`));
    assert.match(r.stdout, /hit \//);
  });

  test('stop: the server is gone and the YAML says stopped; start brings it back', async () => {
    const s = await hallway(['stop', 'demo']);
    assert.equal(s.code, 0, s.stderr);
    assert.match(yaml('demo'), /^expected: stopped$/m);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
    const st = JSON.parse((await hallway(['status', 'demo', '--json'])).stdout);
    assert.equal(st.health.state, 'stopped');
    const r = await hallway(['start', 'demo']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`demo started: http://localhost:${port}`));
    assert.match(yaml('demo'), /^expected: adhoc$/m);
  });

  test('run again with no command: the recorded one, the same port; --port to change it is refused', async () => {
    const r = await hallway(['run', 'demo']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`localhost:${port}`));
    const bad = await hallway(['run', 'demo', '--port', String(port + 1)]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /never changes an app's port/);
    const re = await hallway(['restart', 'demo']);
    assert.equal(re.code, 0, re.stderr);
  });

  test('a command that exits before listening: exit 1 with its exit status and last log lines', async () => {
    const r = await hallway(['run', 'crash', '--cwd', PROJ, '--', 'node', '-e', "console.error('cannot start: no config'); process.exit(3)"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /crash didn't come up: it exited with status 3/);
    assert.match(r.stderr, /cannot start: no config/);
  });

  test('--persist makes a real service (at login, restarted when it exits)', async () => {
    const r = await hallway(['run', 'kept', '--cwd', PROJ, '--persist', '--', 'node', 'server.js']);
    assert.equal(r.code, 0, r.stderr);
    const unit = fs.readFileSync(unitFile('kept'), 'utf8');
    assert.match(unit, /^Restart=always$/m);
    assert.match(unit, /^WantedBy=default.target$/m);
    assert.match(yaml('kept'), /^expected: running$/m);
  });

  // D68: Vite 8 on a Mac logs "Local: http://localhost:5100/" and listens on [::1] only; run used to wait out its 30 s
  // on 127.0.0.1 and say nothing was listening
  test('a server that listens on [::1] only comes up, and run says where; status finds it healthy there', { skip: !v6 && 'no IPv6 loopback' }, async () => {
    const t0 = Date.now();
    const r = await hallway(['run', 'hmr', '--cwd', PROJ, '--', 'node', '-e', "require('http').createServer((q, s) => s.end('v6')).listen(Number(process.env.PORT), '::1')"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(Date.now() - t0 < 20_000, 'no 30 s wait');
    const m = /hmr is up: http:\/\/localhost:(\d+) \(listening on \[::1\]:(\d+)\)/.exec(r.stdout);
    assert.ok(m && m[1] === m[2], r.stdout);
    const v = JSON.parse((await hallway(['status', 'hmr', '--json'])).stdout);
    assert.equal(v.health.state, 'healthy');
    assert.equal(v.health.address, '::1');
    assert.equal(await (await fetch(`http://[::1]:${m![1]}/`)).text(), 'v6');
    assert.equal((await hallway(['service', 'rm', 'hmr'])).code, 0);
  });

  test('usage errors exit 2', async () => {
    for (const args of [['run'], ['run', 'demo', '--port', 'x'], ['stop'], ['logs'], ['service'], ['service', 'frob'], ['app', 'add', 'Bad Slug'], ['status', '--frob']]) {
      const r = await hallway(args);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
    }
    const missing = await hallway(['stop', 'nope']);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no app 'nope'/);
  });

  test('service rm: the unit is gone, the process too, and the app stays declared', async () => {
    const pidFile = path.join(HOME, '.fake-systemd', 'hallway-app-demo.service.pid');
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(alive(pid));
    const r = await hallway(['service', 'rm', 'demo']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.existsSync(unitFile('demo')), false);
    assert.ok(!alive(pid), 'stopped');
    assert.doesNotMatch(yaml('demo'), /service:/);
    assert.match(yaml('demo'), new RegExp(`^port: ${port}$`, 'm'));
  });
});
