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
import { service } from '../server/commands/services.ts';
import { VERSION } from '../server/config.ts';
import { platformFor } from '../server/platform/index.ts';
import type { RunResult } from '../server/platform/services.ts';
import { Services, logFiles } from '../server/services/index.ts';
import { exitWatchdog, tmpDir, tmpStore } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => unknown)[] = [];
after(async () => {
  for (const f of cleanups) await f();
});

/** A stand-in daemon on a port of its own: listening while the unit is active. */
async function standIn() {
  let server: http.Server | null = null;
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const up = () =>
    new Promise<void>((r) => {
      server = http.createServer((_, res) => res.setHeader('content-type', 'application/json').end(JSON.stringify({ ok: true, version: VERSION })));
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
  return { port, up, down };
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
  const unit = path.join(userHome, '.config', 'systemd', 'user', 'hallway-daemon.service');
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
  const env = { PATH: '' };
  const services = new Services({ store: t.store, platform: platformFor('linux'), run, env, userHome, cliScript, node: { path: process.execPath, version: process.version } });
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
  return { ...t, unit, state, calls, daemon, cmd };
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
});
