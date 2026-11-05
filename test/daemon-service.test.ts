// `hallway service start|stop|restart|status|logs|install` for the daemon, against the CLI contract (D74): exit 4 with
// no job, exit 3 when it's installed but not running, `stop` that doesn't disable, `--json` that is one document on
// stdout. systemd's runner is mocked with a little state (active, enabled), and a stand-in daemon (an HTTP server
// answering /api/health as this version) comes and goes with `start` and `stop`. Nothing touches a real home.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { makeCtx } from '../server/commands/index.ts';
import { diagnose } from '../server/commands/doctor.ts';
import { service } from '../server/commands/services.ts';
import { VERSION } from '../server/config.ts';
import { platformFor } from '../server/platform/index.ts';
import type { RunResult } from '../server/platform/services.ts';
import { Services, logFiles } from '../server/services/index.ts';
import { writeRuntimeFile } from '../server/contract/runtime-file.ts';
import { writeUpdateCheck } from '../server/contract/update-check.ts';
import { exitWatchdog, tmpDir, tmpStore } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => unknown)[] = [];
after(async () => {
  for (const f of cleanups) await f();
});

/** A stand-in daemon on a port of its own: listening while the unit is active, answering /api/busy with `counts`. */
async function standIn() {
  let server: http.Server | null = null;
  const counts = { setup: 0, app: 0 };
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const up = () =>
    new Promise<void>((r) => {
      server = http.createServer((req, res) =>
        res
          .setHeader('content-type', 'application/json')
          .end(JSON.stringify(req.url === '/api/busy' ? { busy: counts.setup + counts.app > 0, version: VERSION, counts } : { ok: true, version: VERSION })),
      );
      server.listen(port, '127.0.0.1', r);
    });
  const down = () =>
    new Promise<void>((r) => {
      if (!server) return r();
      server.closeAllConnections();
      server.close(() => r());
      server = null;
    });
  cleanups.push(down);
  return { port, up, down, counts };
}

async function setup() {
  const t = await tmpStore();
  const root = tmpDir('hw-test-daemon-svc-');
  cleanups.push(t.cleanup, () => fs.rmSync(root, { recursive: true, force: true }));
  // a built CLI, in a package.json'd tree, so the job's version can be read back
  const pkg = path.join(root, 'lib', 'node_modules', 'hallway');
  const cliScript = path.join(pkg, 'dist', 'server', 'cli.js');
  fs.mkdirSync(path.dirname(cliScript), { recursive: true });
  fs.writeFileSync(cliScript, '');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'hallway', version: VERSION }));
  const userHome = path.join(root, 'home');
  fs.mkdirSync(userHome);
  const daemon = await standIn();
  await t.store.patchConfig({ port: daemon.port });
  // where the Linux module puts it (with path.posix, on every OS: D58)
  let unit = '';
  const state = { active: false, enabled: false };
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push([cmd, ...args].join(' '));
    const [, verb] = args;
    if (verb === 'show')
      return {
        code: 0,
        stdout: `LoadState=${fs.existsSync(unit) ? 'loaded' : 'not-found'}\nActiveState=${state.active ? 'active' : 'inactive'}\nMainPID=${state.active ? 4242 : 0}\nUnitFileState=${fs.existsSync(unit) ? (state.enabled ? 'enabled' : 'disabled') : ''}\n`,
        stderr: '',
      };
    if (verb === 'enable') state.enabled = true;
    if (verb === 'disable') state.enabled = false;
    if (verb === 'start' || verb === 'restart') {
      if (verb === 'restart') await daemon.down();
      if (verb === 'restart' || !state.active) await daemon.up();
      state.active = true;
    }
    if (verb === 'stop') {
      state.active = false;
      await daemon.down();
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  // what the daemon writes once it's listening: where `busy` and the busy check find it (D75)
  writeRuntimeFile(t.home, { pid: process.pid, port: daemon.port, url: `http://127.0.0.1:${daemon.port}`, version: VERSION });
  const env = { PATH: '' };
  const services = new Services({ store: t.store, platform: platformFor('linux'), run, env, userHome, cliScript, node: { path: process.execPath, version: process.version } });
  unit = services.manager.file('hallway.daemon');
  let out = '';
  let err = '';
  const ctx = makeCtx({ home: t.home, env, cwd: root, out: (s) => void (out += s), err: (s) => void (err += s), run, platform: platformFor('linux') });
  ctx.services = () => services;
  const cmd = async (args: string[], flags: Record<string, string> = {}) => {
    out = '';
    err = '';
    const code = await service(ctx, args, flags, undefined);
    return { code, out, err };
  };
  return { ...t, unit, state, calls, daemon, cmd, ctx };
}

describe('the daemon as a service (the CLI contract, D74)', () => {
  test('nothing installed: status exits 4 (its --json says so); start, stop, restart and logs exit 4 and say how to install', async () => {
    const s = await setup();
    const st = await s.cmd(['status']);
    assert.equal(st.code, 4);
    assert.match(st.out, /not installed/);
    const j = await s.cmd(['status'], { json: '1' });
    assert.equal(j.code, 4);
    const doc = JSON.parse(j.out);
    assert.equal(doc.installed, false);
    assert.equal(doc.running, false);
    assert.equal(doc.installedVersion, null);
    for (const verb of ['start', 'stop', 'restart', 'logs']) {
      const r = await s.cmd([verb]);
      assert.equal(r.code, 4, verb);
      assert.equal(r.out, '', verb);
      assert.match(r.err, /isn't installed as a service.*hallway service install/, verb);
    }
    // with --json, the refusal is still one document on stdout
    const r = await s.cmd(['stop'], { json: '1' });
    assert.equal(r.code, 4);
    assert.equal(JSON.parse(r.out).ok, false);
    assert.equal(fs.existsSync(s.unit), false, 'nothing was written');
  });

  test('install --json: one document on stdout, the prose on stderr; status then exits 0', async () => {
    const s = await setup();
    const r = await s.cmd(['install'], { json: '1' });
    assert.equal(r.code, 0, r.err);
    const doc = JSON.parse(r.out);
    assert.equal(doc.ok, true);
    assert.equal(doc.action, 'install');
    assert.equal(doc.running, true);
    assert.equal(doc.answering, true);
    assert.equal(doc.runningVersion, VERSION);
    assert.equal(doc.installedVersion, VERSION);
    assert.equal(doc.port, s.daemon.port);
    assert.equal(doc.log, logFiles(s.home, 'daemon').out);
    assert.deepEqual(doc.logs, logFiles(s.home, 'daemon'));
    assert.equal(doc.unit, s.unit);
    // the fields cli-contract's schemas/service-status.schema.json requires
    for (const k of ['installed', 'running', 'answering', 'installedVersion', 'runningVersion', 'port', 'url', 'pid', 'unit', 'log', 'warnings']) assert.ok(k in doc, k);
    assert.deepEqual(doc.warnings, []);
    assert.match(r.err, /Installed Hallway's daemon/);
    const st = await s.cmd(['status']);
    assert.equal(st.code, 0, st.out);
    assert.match(st.out, new RegExp(`Version: +${VERSION.replace(/\./g, '\\.')} installed`));
    assert.match(st.out, /Logs: .*daemon\.out\.log/);
  });

  test("stop doesn't disable: the unit stays enabled, so the next login or boot starts it; status exits 3; start brings it back", async () => {
    const s = await setup();
    await s.cmd(['install']);
    assert.equal(s.state.enabled, true);
    s.calls.length = 0;
    const stop = await s.cmd(['stop']);
    assert.equal(stop.code, 0, stop.err);
    assert.match(stop.out, /Stopped Hallway's daemon\. It stays stopped until `hallway service start`, or your next login or boot/);
    assert.ok(s.calls.includes('systemctl --user stop hallway-daemon.service'));
    assert.ok(!s.calls.some((c) => c.includes('disable')), s.calls.join('\n'));
    assert.equal(s.state.enabled, true);

    const st = await s.cmd(['status'], { json: '1' });
    assert.equal(st.code, 3);
    assert.equal(JSON.parse(st.out).installed, true);
    assert.equal(JSON.parse(st.out).answering, false);

    // stopping a stopped one is fine
    const again = await s.cmd(['stop']);
    assert.equal(again.code, 0);
    assert.match(again.out, /wasn't running/);

    const start = await s.cmd(['start'], { json: '1' });
    assert.equal(start.code, 0, start.err);
    const doc = JSON.parse(start.out);
    assert.equal(doc.action, 'start');
    assert.equal(doc.wasRunning, false);
    assert.equal(doc.answering, true);
    assert.match(start.err, /Started Hallway's daemon/);
    assert.equal((await s.cmd(['status'])).code, 0);

    const already = await s.cmd(['start']);
    assert.match(already.out, /already running/);
  });

  test('restart --json and stop --json are one document each', async () => {
    const s = await setup();
    await s.cmd(['install']);
    const r = await s.cmd(['restart'], { json: '1' });
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).action, 'restart');
    const st = await s.cmd(['stop'], { json: '1' });
    assert.equal(st.code, 0, st.err);
    const doc = JSON.parse(st.out);
    assert.equal(doc.action, 'stop');
    assert.equal(doc.wasRunning, true);
    assert.equal(doc.running, false);
    assert.equal(doc.enabled, true);
  });

  test('service logs: the daemon\'s logs, -n lines of them (as `logs daemon` shows)', async () => {
    const s = await setup();
    await s.cmd(['install']);
    const f = logFiles(s.home, 'daemon');
    fs.mkdirSync(path.dirname(f.out), { recursive: true });
    fs.writeFileSync(f.out, Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    const all = await s.cmd(['logs']);
    assert.equal(all.code, 0);
    assert.equal(all.out.trim().split('\n').filter((l) => /^line /.test(l)).length, 50, 'the last 50 by default');
    const few = await s.cmd(['logs'], { lines: '3' });
    assert.deepEqual(few.out.trim().split('\n').filter((l) => /^line /.test(l)), ['line 78', 'line 79', 'line 80']);
  });

  test('uninstall: status exits 4 again', async () => {
    const s = await setup();
    await s.cmd(['install']);
    const r = await s.cmd(['uninstall'], { json: '1' });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).wasInstalled, true);
    assert.equal((await s.cmd(['status'])).code, 4);
  });

  test('stop and restart refuse with 75 while the daemon is busy, and say why; --force says Overriding: and goes ahead (D75)', async () => {
    const s = await setup();
    await s.cmd(['install']);
    s.daemon.counts.setup = 1;
    s.daemon.counts.app = 2;
    s.calls.length = 0;
    for (const verb of ['stop', 'restart']) {
      const r = await s.cmd([verb]);
      assert.equal(r.code, 75, verb);
      assert.equal(r.out, '');
      assert.equal(
        r.err,
        `hallway: Hallway is busy: 1 local-domains setup and 2 app starts, stops or restarts are running. Try \`hallway service ${verb}\` again once it has finished, or add --force.\n`,
      );
    }
    // with --json, still one document on stdout
    const j = await s.cmd(['stop'], { json: '1' });
    assert.equal(j.code, 75);
    assert.equal(JSON.parse(j.out).error, 'busy');
    assert.ok(!s.calls.some((c) => / (stop|restart) hallway-daemon/.test(c)), 'nothing was stopped');
    assert.equal((await s.cmd(['status'])).code, 0);

    const forced = await s.cmd(['restart'], { force: '1' });
    assert.equal(forced.code, 0, forced.err);
    assert.match(forced.err, /^Overriding: Hallway is busy: 1 local-domains setup and 2 app starts, stops or restarts are running\.\n/);
    const stopped = await s.cmd(['stop'], { force: '1' });
    assert.equal(stopped.code, 0, stopped.err);
    assert.match(stopped.err, /^Overriding: /);

    // not busy: no word about it
    s.daemon.counts.setup = s.daemon.counts.app = 0;
    await s.cmd(['start']);
    const idle = await s.cmd(['stop']);
    assert.equal(idle.code, 0);
    assert.equal(idle.err, '');
  });

  test('not installed beats busy: stop exits 4 even when a `hallway serve` in a terminal is busy', async () => {
    const s = await setup();
    await s.daemon.up();
    s.daemon.counts.app = 1;
    assert.equal((await s.cmd(['stop'])).code, 4);
  });
});

describe('service install --refresh, --port, and replacing a running daemon (the CLI contract 0.2, D76)', () => {
  test('--refresh with nothing installed exits 4 and writes nothing; --json is still one document', async () => {
    const s = await setup();
    const r = await s.cmd(['install'], { refresh: '1' });
    assert.equal(r.code, 4);
    assert.match(r.err, /isn't installed as a service, so there's nothing to refresh/);
    assert.equal(fs.existsSync(s.unit), false);
    const j = await s.cmd(['install'], { refresh: '1', json: '1' });
    assert.equal(j.code, 4);
    assert.equal(JSON.parse(j.out).ok, false);
    assert.ok(!s.calls.some((c) => / (start|restart|enable) /.test(c)), 'nothing was started');
  });

  test('install over a running daemon restarts it, even with nothing changed (enable --now would leave it serving)', async () => {
    const s = await setup();
    await s.cmd(['install']);
    const before = fs.readFileSync(s.unit, 'utf8');
    s.calls.length = 0;
    const r = await s.cmd(['install'], { refresh: '1' });
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(s.unit, 'utf8'), before, 'a faithful refresh is byte-identical');
    assert.ok(s.calls.some((c) => c === 'systemctl --user restart hallway-daemon.service'), s.calls.join('\n'));
    assert.match(r.out, /Refreshed Hallway's daemon/);
    assert.match(r.out, /Restarted the daemon\./);
  });

  test("a first install starts it once and doesn't restart it (systemd's start limit)", async () => {
    const s = await setup();
    s.calls.length = 0;
    assert.equal((await s.cmd(['install'])).code, 0);
    assert.equal(s.calls.filter((c) => / (start|restart) hallway-daemon/.test(c)).length, 1, s.calls.join('\n'));
  });

  test('--port is written to config.yaml, where the daemon and the CLI read it', async () => {
    const s = await setup();
    await s.store.patchConfig({ port: 1 });
    const r = await s.cmd(['install'], { port: String(s.daemon.port) });
    assert.equal(r.code, 0, r.err);
    assert.equal(s.store.currentConfig().port, s.daemon.port);
    assert.match(fs.readFileSync(path.join(s.home, 'config.yaml'), 'utf8'), new RegExp(`port: ${s.daemon.port}`));
    await assert.rejects(s.cmd(['install'], { port: 'x' }), /--port must be a port number/);
  });

  test("status --json carries `update` from the last check, and leaves it out (never null) when there's nothing", async () => {
    const s = await setup();
    await s.cmd(['install']);
    const none = JSON.parse((await s.cmd(['status'], { json: '1' })).out);
    assert.equal('update' in none, false);
    const check = { name: 'hallway', current: VERSION, target: '99.0.0', tag: 'latest', updateAvailable: true, installMethod: 'npm-global' as const, canUpdate: true, command: 'hallway update', engines: '>=22.13', nodeOk: true, changelog: 'https://example.com/v99.0.0', checkedAt: new Date().toISOString() };
    writeUpdateCheck(s.home, check);
    const st = await s.cmd(['status'], { json: '1' });
    assert.deepEqual(JSON.parse(st.out).update, { latest: '99.0.0', updateAvailable: true, checkedAt: check.checkedAt });
    assert.equal(st.err, '', '--json: the notice is for people');
    const prose = await s.cmd(['status']);
    assert.match(prose.err, /Hallway 99\.0\.0 is available \(you have .*\)\.\n {2}Run: hallway update\n {2}Changes: https:\/\/example\.com\/v99\.0\.0/);
    // a cache written for another version says nothing
    writeUpdateCheck(s.home, { ...check, current: '0.0.1' });
    assert.equal('update' in JSON.parse((await s.cmd(['status'], { json: '1' })).out), false);
    assert.equal((await s.cmd(['status'])).err, '');
  });

  test('scoped flags: --refresh, --check and --to anywhere else are usage errors', async () => {
    const s = await setup();
    await assert.rejects(s.cmd(['status'], { refresh: '1' }), /service status doesn't take --refresh/);
    await assert.rejects(s.cmd(['start'], { force: '1' }), /service start doesn't take --force/);
    await assert.rejects(s.cmd(['install'], { force: '1' }), /service install doesn't take --force/);
  });

  test("doctor: the service's own Hallway is checked against this CLI's, and the running version against the installed one", async () => {
    const s = await setup();
    await s.cmd(['install']);
    const checks = await diagnose(s.ctx, async () => ({ code: 1, stdout: '', stderr: '' }), { offline: true });
    const unit = checks.find((c) => c.id === 'unit');
    // the rig's job runs a Hallway of its own (lib/node_modules/hallway), not this checkout
    assert.equal(unit?.status, 'warn');
    assert.match(unit!.message, /runs Hallway .* from .*node_modules[\\/]hallway, not this one/);
    assert.equal(checks.find((c) => c.id === 'running-version')?.status, 'pass');
  });
});
