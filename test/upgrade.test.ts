// After `npm i -g hallway@latest` (D69): the daemon's job file is usually unchanged, so a daemon started by the old
// version keeps running the old code. `service install`, `service regenerate` and `setup` restart it when the daemon
// answering isn't this CLI's version, and say so; doctor flags it; forwarders another version started are restarted
// too. A stand-in daemon answers /api/health with whatever version the test says, and "restarting" its job (the mocked
// systemctl / launchctl) makes it answer this version. Nothing touches a real home or service manager.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import path from 'node:path';
import { makeCtx } from '../server/commands/index.ts';
import { diagnose } from '../server/commands/doctor.ts';
import { restartStaleDaemon, service } from '../server/commands/services.ts';
import { VERSION } from '../server/config.ts';
import { platformFor } from '../server/platform/index.ts';
import type { RunResult } from '../server/platform/services.ts';
import { DAEMON_LABEL, Services } from '../server/services/index.ts';
import { forwards } from '../server/services/spec.ts';
import { exitWatchdog, onWindows, rmTmp, tmpDir, tmpStore } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => unknown)[] = [];
after(async () => {
  for (const c of cleanups) await c();
});

const OLD = '0.5.2';
assert.notEqual(VERSION, OLD);

/** A stand-in daemon on 127.0.0.1: answers /api/health as `version`. */
async function fakeDaemon() {
  const state = { version: OLD as string | null };
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/health' || !state.version) return res.writeHead(404).end();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, version: state.version }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  cleanups.push(() => new Promise<void>((r) => (server.close(() => r()), server.closeAllConnections())));
  return { state, port: (server.address() as net.AddressInfo).port };
}

/** Linux, systemd mocked: the daemon's unit is running iff `running`; restarting it makes the daemon this version. */
async function linuxHarness({ version = OLD as string | null, running = true, restartWorks = true } = {}) {
  const t = await tmpStore();
  const root = tmpDir('hw-test-upgrade-');
  cleanups.push(t.cleanup, () => rmTmp(root));
  const cliScript = path.join(root, 'lib', 'node_modules', 'hallway', 'dist', 'server', 'cli.js');
  fs.mkdirSync(path.dirname(cliScript), { recursive: true });
  fs.writeFileSync(cliScript, '');
  const userHome = path.join(root, 'home');
  fs.mkdirSync(userHome);
  const daemon = await fakeDaemon();
  daemon.state.version = version;
  await t.store.patchConfig({ port: daemon.port });
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push([cmd, ...args].join(' '));
    if (args[1] === 'show') {
      const unitExists = fs.existsSync(services.manager.file(DAEMON_LABEL));
      const up = running && unitExists && args[2] === 'hallway-daemon.service';
      return { code: 0, stdout: `LoadState=${unitExists ? 'loaded' : 'not-found'}\nActiveState=${up ? 'active' : 'inactive'}\nMainPID=${up ? 4242 : 0}\nUnitFileState=enabled\n`, stderr: '' };
    }
    if (args[1] === 'restart' && args[2] === 'hallway-daemon.service' && restartWorks) daemon.state.version = VERSION;
    if (args[1] === 'start' && args[2] === 'hallway-daemon.service' && !daemon.state.version) daemon.state.version = VERSION;
    return { code: 0, stdout: '', stderr: '' };
  };
  const env = { PATH: '/usr/bin' };
  const services = new Services({ store: t.store, platform: platformFor('linux'), run, env, userHome, cliScript, node: { path: process.execPath, version: process.version } });
  let out = '';
  let err = '';
  const ctx = makeCtx({ home: t.home, env, cwd: root, out: (s) => void (out += s), err: (s) => void (err += s), run, platform: platformFor('linux') });
  ctx.services = () => services;
  // the job as the old version left it: the same file (same install path), its manifest saying the old version
  await services.installDaemon();
  const manifest = services.manifestFile(DAEMON_LABEL);
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(`"hallwayVersion": "${VERSION}"`, `"hallwayVersion": "${OLD}"`));
  daemon.state.version = version;
  calls.length = 0;
  return { ...t, services, ctx, calls, daemon, run, output: () => out, errors: () => err };
}

const restarts = (calls: string[]) => calls.filter((c) => /systemctl --user restart hallway-daemon\.service/.test(c));

describe('service install after an upgrade (D69)', { skip: onWindows('systemd mocked, POSIX paths') }, () => {
  test('the daemon answering as the old version is restarted, and says so; then it answers as this one', async () => {
    const h = await linuxHarness();
    assert.equal(await service(h.ctx, ['install'], {}, undefined), 0, h.errors());
    assert.equal(restarts(h.calls).length, 1, h.calls.join('\n'));
    assert.match(h.output(), new RegExp(`Restarted the daemon: ${OLD.replace(/\./g, '\\.')} → ${VERSION.replace(/\./g, '\\.')}\\.`));
    assert.match(h.output(), /It's running: http:\/\/localhost:\d+/);
    assert.equal(h.daemon.state.version, VERSION);
    assert.match(fs.readFileSync(h.services.manifestFile(DAEMON_LABEL), 'utf8'), new RegExp(`"hallwayVersion": "${VERSION}"`));
  });

  test('already this version: nothing restarted, nothing said about it', async () => {
    const h = await linuxHarness({ version: VERSION });
    assert.equal(await service(h.ctx, ['install'], {}, undefined), 0, h.errors());
    assert.deepEqual(restarts(h.calls), []);
    assert.doesNotMatch(h.output(), /Restarted/);
  });

  test("a restart that doesn't take (still the old version after the wait) is an error, not \"It's running\"", async () => {
    // a service manager that says yes and does nothing
    const h = await linuxHarness({ restartWorks: false });
    const t0 = Date.now();
    assert.equal(await service(h.ctx, ['install'], {}, undefined), 1);
    assert.ok(Date.now() - t0 >= 14_000, 'it waited for the new version');
    assert.match(h.errors(), new RegExp(`the daemon was started, but it still answers as version ${OLD.replace(/\./g, '\\.')}, not`));
  });

  test('service regenerate restarts it too, and the table says from which version', async () => {
    const h = await linuxHarness();
    assert.equal(await service(h.ctx, ['regenerate'], {}, undefined), 0, h.errors());
    assert.equal(restarts(h.calls).length, 1);
    assert.match(h.output(), new RegExp(`hallway\\.daemon\\s+restarted: ${OLD.replace(/\./g, '\\.')} → `));
    const again = await linuxHarness({ version: VERSION });
    // its manifest says the old version, but the running daemon says it's this one: what it says wins
    await service(again.ctx, ['regenerate'], {}, undefined);
    assert.deepEqual(restarts(again.calls), []);
    assert.match(again.output(), /hallway\.daemon\s+unchanged/);
  });

  test('service restart says from which version to which', async () => {
    const h = await linuxHarness();
    assert.equal(await service(h.ctx, ['restart'], {}, undefined), 0, h.errors());
    assert.match(h.output(), new RegExp(`Restarted Hallway's daemon \\(${OLD.replace(/\./g, '\\.')} → `));
  });

  test("setup's restart: the daemon's service is restarted; a daemon that isn't Hallway's service gets told how", async () => {
    const h = await linuxHarness();
    await restartStaleDaemon(h.ctx);
    assert.equal(restarts(h.calls).length, 1);
    assert.match(h.output(), /Restarted the daemon: /);
    const serve = await linuxHarness({ running: false });
    await restartStaleDaemon(serve.ctx);
    assert.deepEqual(restarts(serve.calls), []);
    assert.match(serve.errors(), new RegExp(`is version ${OLD.replace(/\./g, '\\.')}, but this CLI is .*a \`hallway serve\` in a terminal`));
    const same = await linuxHarness({ version: VERSION });
    await restartStaleDaemon(same.ctx);
    assert.equal(same.output() + same.errors(), '');
  });

  test('doctor: a failure when the daemon is another version, with `hallway service restart`; nothing when it matches', async () => {
    const h = await linuxHarness();
    const checks = await diagnose(h.ctx, h.run);
    const v = checks.find((c) => c.id === 'daemon-version');
    assert.equal(v?.status, 'fail');
    assert.match(v!.message, new RegExp(`the daemon is running version ${OLD.replace(/\./g, '\\.')}, but this CLI is ${VERSION.replace(/\./g, '\\.')}`));
    assert.match(v!.fix!, /^`hallway service restart`/);
    const same = await linuxHarness({ version: VERSION });
    assert.equal((await diagnose(same.ctx, same.run)).find((c) => c.id === 'daemon-version'), undefined);
  });
});

describe('forwarders another version started (D69)', { skip: onWindows('launchd mocked, POSIX paths') }, () => {
  async function harness(running: boolean) {
    const t = await tmpStore();
    const root = tmpDir('hw-test-upgrade-fwd-');
    cleanups.push(t.cleanup, () => rmTmp(root));
    const cliScript = path.join(root, 'lib', 'node_modules', 'hallway', 'dist', 'server', 'cli.js');
    fs.mkdirSync(path.dirname(cliScript), { recursive: true });
    fs.writeFileSync(cliScript, '');
    const userHome = path.join(root, 'home');
    fs.mkdirSync(userHome);
    const calls: string[] = [];
    const run = async (cmd: string, args: string[]): Promise<RunResult> => {
      calls.push([cmd, ...args].join(' '));
      if (args[0] === 'print') return { code: 0, stdout: running ? 'x = {\n\tstate = running\n\tpid = 77\n}' : 'x = {\n\tstate = not running\n}', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const services = new Services({ store: t.store, platform: platformFor('darwin'), run, env: { PATH: '/usr/bin' }, userHome, cliScript, node: { path: process.execPath, version: process.version } });
    await t.store.patchConfig({ mode: 'fronted', proxy: { trust: 'user' } });
    const want = forwards({ httpsPort: 4443, httpPort: 4480 }, 'https');
    await services.forwardersUp(want);
    const age = (label: string) => {
      const f = services.manifestFile(label);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(`"hallwayVersion": "${VERSION}"`, `"hallwayVersion": "${OLD}"`));
    };
    calls.length = 0;
    return { services, calls, want, age };
  }
  const bootouts = (calls: string[]) => calls.filter((c) => / bootout /.test(c)).map((c) => c.split('/').pop());

  test('a running one is restarted (it runs `hallway forward` until killed); ones of this version are left alone', async () => {
    const h = await harness(true);
    h.age('hallway.forward.https');
    assert.equal(h.services.staleVersion('hallway.forward.https'), OLD);
    assert.equal(h.services.staleVersion('hallway.forward.http'), null);
    assert.deepEqual(await h.services.restartStaleForwarders(), ['hallway.forward.https']);
    assert.deepEqual(bootouts(h.calls), ['hallway.forward.https'], 'unloaded and loaded again: launchd binds its socket afresh');
    assert.equal(h.services.staleVersion('hallway.forward.https'), null, 'its manifest is this version now');
    assert.equal(h.services.staleVersion('hallway.app.x'), null, "an app's job never runs Hallway's code on macOS");
  });

  test("one that isn't running is left for launchd to start, from the CLI on disk, on the next connection", async () => {
    const h = await harness(false);
    h.age('hallway.forward.https');
    assert.deepEqual(await h.services.restartStaleForwarders(), []);
    assert.deepEqual(bootouts(h.calls), []);
  });

  test('setup (forwardersUp) and regenerate restart a stale running one, even with its plist unchanged', async () => {
    const h = await harness(true);
    h.age('hallway.forward.http6');
    await h.services.forwardersUp(h.want);
    assert.deepEqual(bootouts(h.calls), ['hallway.forward.http6']);
    h.calls.length = 0;
    h.age('hallway.forward.https6');
    const r = await h.services.regenerate();
    assert.deepEqual(r.filter((x) => x.restarted).map((x) => [x.label, x.upgraded]), [['hallway.forward.https6', OLD]]);
  });
});
