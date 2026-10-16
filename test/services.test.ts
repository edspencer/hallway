// Managed services (server/platform/launchd.ts, systemd.ts; server/services/): the plist and unit renderers against
// golden files, both platforms' lifecycles with the command runner mocked (so macOS is checked on Linux and the
// other way round), the PATH trap, ports, logs and rotation. Nothing here touches the real service manager or a real
// home directory. (UPDATE_GOLDEN=1 rewrites the golden files.)
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchdManager, parseLaunchctlPrint, plistPath, renderPlist } from '../server/platform/launchd.ts';
import type { RunResult, ServiceSpec } from '../server/platform/services.ts';
import { execWord, labelOf, parseShow, renderUnit, systemdManager, unitName, unitPath } from '../server/platform/systemd.ts';
import { platformFor } from '../server/platform/index.ts';
import { Services } from '../server/services/index.ts';
import { followFiles, tailFile } from '../server/services/logs.ts';
import { WELL_KNOWN_PORTS, assignPort } from '../server/services/ports.ts';
import { nodeShebang, pathProblem, resolveCommand, resolveNode, servicePath, which } from '../server/services/resolve.ts';
import { rotateFile, rotateLogs } from '../server/services/rotate.ts';
import { appSpec, daemonSpec, substitute } from '../server/services/spec.ts';
import { exitWatchdog, onWindows, ROOT, tmpDir, tmpStore, rmTmp } from './fixture.ts';

await exitWatchdog();

const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'services');
function golden(name: string, actual: string) {
  const f = path.join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(f, actual);
  }
  assert.equal(actual, fs.readFileSync(f, 'utf8'), `${name} differs from its golden file (UPDATE_GOLDEN=1 npm test rewrites it)`);
}

const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((c) => c()));
const tmp = (p: string) => {
  const d = tmpDir(p);
  cleanups.push(() => rmTmp(d));
  return d;
};

// A job as docs/04's template has it (macOS paths), and the same on Linux.
const reviewMac: ServiceSpec = {
  label: 'hallway.app.review',
  description: 'Hallway: Local Review (review)',
  program: ['/Users/someone/.local/share/fnm/node-versions/v24.15.0/installation/bin/node', '/Users/someone/.local/share/fnm/node-versions/v24.15.0/installation/lib/node_modules/local-review/dist/server/cli.js', 'serve', '--quiet'],
  cwd: '/Users/someone/Code/local-review',
  env: {
    PATH: '/Users/someone/.local/share/fnm/node-versions/v24.15.0/installation/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    PORT: '5622',
  },
  runAtLoad: true,
  keepAlive: true,
  stdout: '/Users/someone/.hallway/logs/review.out.log',
  stderr: '/Users/someone/.hallway/logs/review.err.log',
  node: { path: '/Users/someone/.local/share/fnm/node-versions/v24.15.0/installation/bin/node', version: 'v24.15.0' },
};
const reviewLinux: ServiceSpec = {
  ...reviewMac,
  program: ['/home/someone/.local/share/fnm/node-versions/v24.15.0/installation/bin/node', '/home/someone/.local/share/fnm/node-versions/v24.15.0/installation/lib/node_modules/local-review/dist/server/cli.js', 'serve', '--quiet'],
  cwd: '/home/someone/Code/local-review',
  env: { ...reviewMac.env, PATH: '/home/someone/.local/share/fnm/node-versions/v24.15.0/installation/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
  stdout: '/home/someone/.hallway/logs/review.out.log',
  stderr: '/home/someone/.hallway/logs/review.err.log',
  node: { path: '/home/someone/.local/share/fnm/node-versions/v24.15.0/installation/bin/node', version: 'v24.15.0' },
};
// `hallway run demo -- python3 -m http.server $PORT`: not persistent, so neither at login nor restarted.
const adhoc: ServiceSpec = {
  label: 'hallway.app.demo',
  description: 'Hallway: demo (demo)',
  program: ['/usr/bin/python3.12', '-m', 'http.server', '5100'],
  cwd: '/home/someone/Code/my app',
  env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', GREETING: 'say "hi" & 100% \\ $HOME', PORT: '5100' },
  runAtLoad: false,
  keepAlive: false,
  stdout: '/home/someone/.hallway/logs/demo.out.log',
  stderr: '/home/someone/.hallway/logs/demo.err.log',
  node: null,
};
const tricky: ServiceSpec = { ...adhoc, program: ['/usr/bin/sh', '-c', 'echo "$PORT" 50% done; exit', ''] };

describe('launchd plists', () => {
  test('match the golden files (docs/04 template)', () => {
    golden('review.plist', renderPlist(reviewMac));
    golden('demo.plist', renderPlist(adhoc));
  });

  test('read back their PATH, XML-escaped values included', () => {
    assert.equal(plistPath(renderPlist(reviewMac)), reviewMac.env.PATH);
    assert.equal(plistPath(renderPlist({ ...adhoc, env: { PATH: '/a&b/<c>' } })), '/a&b/<c>');
    assert.equal(plistPath('<plist/>'), null);
  });

  test('launchctl print is parsed for state, pid and last exit code (top level only)', () => {
    const text = [
      'gui/501/hallway.app.review = {',
      '\tactive count = 1',
      '\tpath = /Users/someone/Library/LaunchAgents/hallway.app.review.plist',
      '\tstate = running',
      '',
      '\tprogram = /usr/local/bin/node',
      '\tendpoints = {',
      '\t\tstate = active',
      '\t}',
      '\tpid = 4242',
      '\tlast exit code = (never exited)',
      '}',
    ].join('\n');
    assert.deepEqual(parseLaunchctlPrint(text), { state: 'running', pid: 4242, lastExitCode: null });
    assert.deepEqual(parseLaunchctlPrint('x = {\n\tstate = not running\n\tlast exit code = 78: EX_CONFIG\n}'), { state: 'not running', pid: null, lastExitCode: null });
    assert.deepEqual(parseLaunchctlPrint('x = {\n\tstate = waiting\n\tlast exit code = 1\n}'), { state: 'waiting', pid: null, lastExitCode: 1 });
  });
});

describe('systemd units', () => {
  test('match the golden files', () => {
    golden('review.service', renderUnit(reviewLinux));
    golden('demo.service', renderUnit(adhoc));
    golden('tricky.service', renderUnit(tricky));
  });

  test('names: hallway-daemon.service, hallway-app-<slug>.service, and back', () => {
    assert.equal(unitName('hallway.daemon'), 'hallway-daemon.service');
    assert.equal(unitName('hallway.app.my-app'), 'hallway-app-my-app.service');
    assert.equal(labelOf('hallway-app-my-app.service'), 'hallway.app.my-app');
    assert.equal(labelOf('hallway-daemon.service'), 'hallway.daemon');
    assert.equal(labelOf('other.service'), null);
    assert.equal(labelOf('hallway-app-.service'), null);
  });

  test('ExecStart words escape specifiers and variables, and quote when they must', () => {
    assert.equal(execWord('plain'), 'plain');
    assert.equal(execWord('50%'), '50%%');
    assert.equal(execWord('$PORT'), '$$PORT');
    assert.equal(execWord('a b'), '"a b"');
    assert.equal(execWord('say "hi"'), '"say \\"hi\\""');
    assert.equal(execWord(''), '""');
    assert.equal(execWord(';'), '";"');
  });

  test('read back their PATH, and parse systemctl show', () => {
    assert.equal(unitPath(renderUnit(reviewLinux)), reviewLinux.env.PATH);
    assert.equal(unitPath(renderUnit({ ...adhoc, env: { PATH: '/odd"dir/100%' } })), '/odd"dir/100%');
    assert.deepEqual(parseShow('LoadState=loaded\nActiveState=active\nMainPID=12\n'), { LoadState: 'loaded', ActiveState: 'active', MainPID: '12' });
  });
});

/** A runner that records every call and answers from a script. */
function mockRunner(answer: (cmd: string, args: string[]) => Partial<RunResult> | undefined = () => undefined) {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push([cmd, ...args].join(' '));
    return { code: 0, stdout: '', stderr: '', ...answer(cmd, args) };
  };
  return { calls, run };
}

describe('the launchd lifecycle (runner mocked)', () => {
  const dir = '/nonexistent/LaunchAgents';
  const notLoaded = (cmd: string, args: string[]) => (args[0] === 'print' ? { code: 113, stderr: 'Could not find service' } : undefined);
  const running = (cmd: string, args: string[]) => (args[0] === 'print' ? { stdout: 'x = {\n\tstate = running\n\tpid = 7\n}' } : undefined);

  test('start: enable, then bootstrap (which starts a RunAtLoad job)', async () => {
    const m = mockRunner(notLoaded);
    await launchdManager({ dir, uid: 501, run: m.run }).start(reviewMac);
    assert.deepEqual(m.calls, [
      'launchctl enable gui/501/hallway.app.review',
      'launchctl print gui/501/hallway.app.review',
      `launchctl bootstrap gui/501 ${dir}/hallway.app.review.plist`,
    ]);
  });

  test('start a job that is not RunAtLoad: bootstrap, then kickstart', async () => {
    const m = mockRunner(notLoaded);
    await launchdManager({ dir, uid: 501, run: m.run }).start(adhoc);
    assert.deepEqual(m.calls.slice(2), [`launchctl bootstrap gui/501 ${dir}/hallway.app.demo.plist`, 'launchctl kickstart gui/501/hallway.app.demo']);
  });

  test('start a running job: nothing to do', async () => {
    const m = mockRunner(running);
    await launchdManager({ dir, uid: 501, run: m.run }).start(adhoc);
    assert.deepEqual(m.calls, ['launchctl enable gui/501/hallway.app.demo', 'launchctl print gui/501/hallway.app.demo']);
  });

  test('stop: bootout (so KeepAlive cannot resurrect it), then disable (so login does not either)', async () => {
    const m = mockRunner();
    await launchdManager({ dir, uid: 501, run: m.run }).stop('hallway.app.review');
    assert.deepEqual(m.calls, ['launchctl bootout gui/501/hallway.app.review', 'launchctl disable gui/501/hallway.app.review']);
    // already unloaded is fine
    const gone = mockRunner((c, a) => (a[0] === 'bootout' ? { code: 3, stderr: 'No such process' } : undefined));
    await launchdManager({ dir, uid: 501, run: gone.run }).stop('hallway.app.review');
  });

  test('restart: kickstart -k, or bootout + bootstrap when the plist changed', async () => {
    const m = mockRunner(running);
    const mgr = launchdManager({ dir, uid: 501, run: m.run });
    await mgr.restart(reviewMac);
    assert.deepEqual(m.calls.slice(1), ['launchctl kickstart -k gui/501/hallway.app.review']);
    m.calls.length = 0;
    await mgr.restart(adhoc, { reload: true });
    assert.deepEqual(m.calls.slice(1), [
      'launchctl bootout gui/501/hallway.app.demo',
      'launchctl enable gui/501/hallway.app.demo',
      `launchctl bootstrap gui/501 ${dir}/hallway.app.demo.plist`,
      'launchctl kickstart gui/501/hallway.app.demo',
    ]);
  });

  test('bootstrap is retried while a booted-out job is still exiting', async () => {
    let n = 0;
    const m = mockRunner((c, a) => (a[0] === 'print' ? { code: 113 } : a[0] === 'bootstrap' && n++ < 2 ? { code: 5, stderr: 'Bootstrap failed: 5: Input/output error' } : undefined));
    await launchdManager({ dir, uid: 501, run: m.run, sleep: async () => {} }).start(reviewMac);
    assert.equal(m.calls.filter((c) => c.includes('bootstrap')).length, 3);
  });

  test('status: loaded and running with its pid; not loaded; errors are explained', async () => {
    const mgr = launchdManager({ dir, uid: 501, run: mockRunner(running).run });
    assert.deepEqual(await mgr.status('hallway.app.review'), { label: 'hallway.app.review', installed: false, loaded: true, running: true, pid: 7, lastExitCode: null, state: 'running', enabled: null });
    const off = await launchdManager({ dir, uid: 501, run: mockRunner(notLoaded).run }).status('hallway.app.review');
    assert.equal(off.loaded, false);
    const missing = launchdManager({ dir, uid: 501, run: mockRunner(() => ({ code: 127 })).run });
    await assert.rejects(missing.status('x'), /launchctl is not available/);
    const broken = launchdManager({ dir, uid: 501, run: mockRunner((c, a) => (a[0] === 'enable' ? { code: 1, stderr: 'boom' } : undefined)).run });
    await assert.rejects(broken.start(reviewMac), /launchctl enable gui\/501\/hallway.app.review failed \(exit 1\): boom/);
  });

  test('write, list and remove the plist file', async () => {
    const d = tmp('hw-test-la-');
    const m = mockRunner();
    const mgr = launchdManager({ dir: d, uid: 501, run: m.run });
    assert.equal(await mgr.write(reviewMac), true);
    assert.equal(await mgr.write(reviewMac), false, 'unchanged');
    fs.writeFileSync(path.join(d, 'com.other.plist'), '');
    assert.deepEqual(mgr.list(), ['hallway.app.review']);
    await mgr.remove('hallway.app.review');
    assert.deepEqual(m.calls, ['launchctl bootout gui/501/hallway.app.review', 'launchctl enable gui/501/hallway.app.review']);
    assert.equal(fs.existsSync(path.join(d, 'hallway.app.review.plist')), false);
  });
});

describe('the systemd lifecycle (runner mocked)', () => {
  const show = (props: string) => (cmd: string, args: string[]) => (args[1] === 'show' ? { stdout: props } : undefined);

  test('write: the unit, then daemon-reload (only when it changed)', async () => {
    const d = tmp('hw-test-sd-');
    const m = mockRunner();
    const mgr = systemdManager({ dir: d, run: m.run });
    assert.equal(await mgr.write(reviewLinux), true);
    assert.equal(await mgr.write(reviewLinux), false);
    assert.deepEqual(m.calls, ['systemctl --user daemon-reload']);
    assert.equal(fs.readFileSync(path.join(d, 'hallway-app-review.service'), 'utf8'), renderUnit(reviewLinux));
    assert.deepEqual(mgr.list(), ['hallway.app.review']);
  });

  test('start: enable (RunAtLoad) or disable, then start', async () => {
    const m = mockRunner();
    const mgr = systemdManager({ dir: '/nonexistent', run: m.run });
    await mgr.start(reviewLinux);
    await mgr.start(adhoc);
    assert.deepEqual(m.calls, [
      'systemctl --user enable --quiet hallway-app-review.service',
      'systemctl --user start hallway-app-review.service',
      'systemctl --user disable --quiet hallway-app-demo.service',
      'systemctl --user start hallway-app-demo.service',
    ]);
  });

  test('stop: stop, and disable so the next login does not start it', async () => {
    const d = tmp('hw-test-sd-');
    const m = mockRunner();
    const mgr = systemdManager({ dir: d, run: m.run });
    await mgr.write(reviewLinux);
    m.calls.length = 0;
    await mgr.stop('hallway.app.review');
    assert.deepEqual(m.calls, ['systemctl --user stop hallway-app-review.service', 'systemctl --user disable --quiet hallway-app-review.service']);
  });

  test('restart and remove', async () => {
    const d = tmp('hw-test-sd-');
    const m = mockRunner();
    const mgr = systemdManager({ dir: d, run: m.run });
    await mgr.write(reviewLinux);
    m.calls.length = 0;
    await mgr.restart(reviewLinux);
    await mgr.remove('hallway.app.review');
    assert.deepEqual(m.calls, [
      'systemctl --user enable --quiet hallway-app-review.service',
      'systemctl --user restart hallway-app-review.service',
      'systemctl --user stop hallway-app-review.service',
      'systemctl --user disable --quiet hallway-app-review.service',
      'systemctl --user daemon-reload',
      'systemctl --user reset-failed hallway-app-review.service',
    ]);
    assert.equal(fs.existsSync(path.join(d, 'hallway-app-review.service')), false);
  });

  test('status from systemctl show', async () => {
    const running = await systemdManager({ dir: '/nonexistent', run: mockRunner(show('LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=99\nExecMainPID=99\nExecMainStatus=0\nUnitFileState=enabled\n')).run }).status('hallway.daemon');
    assert.deepEqual(running, { label: 'hallway.daemon', installed: false, loaded: true, running: true, pid: 99, lastExitCode: null, state: 'active (running)', enabled: true });
    const failed = await systemdManager({ dir: '/nonexistent', run: mockRunner(show('LoadState=loaded\nActiveState=failed\nSubState=failed\nMainPID=0\nExecMainPID=98\nExecMainStatus=1\nUnitFileState=disabled\n')).run }).status('hallway.daemon');
    assert.equal(failed.running, false);
    assert.equal(failed.lastExitCode, 1);
    assert.equal(failed.enabled, false);
    const none = await systemdManager({ dir: '/nonexistent', run: mockRunner(show('LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nExecMainPID=0\nExecMainStatus=0\n')).run }).status('hallway.daemon');
    assert.equal(none.loaded, false);
    assert.equal(none.lastExitCode, null);
  });

  test("a missing systemctl or an unreachable user instance is explained", async () => {
    await assert.rejects(systemdManager({ dir: '/x', run: mockRunner(() => ({ code: 127 })).run }).status('hallway.daemon'), /systemctl is not available/);
    const nobus = mockRunner(() => ({ code: 1, stderr: 'Failed to connect to bus: No medium found' }));
    await assert.rejects(systemdManager({ dir: '/x', run: nobus.run }).start(adhoc), /can't reach systemd's per-user instance/);
  });

  test('the platform layer hands out the right manager and unit directory', () => {
    const lin = platformFor('linux').services({ env: { XDG_CONFIG_HOME: '/xdg' }, home: '/home/someone' });
    assert.equal(lin.kind, 'systemd');
    assert.equal(lin.file('hallway.app.x'), '/xdg/systemd/user/hallway-app-x.service');
    const mac = platformFor('darwin').services({ env: {}, home: '/Users/someone' });
    assert.equal(mac.kind, 'launchd');
    assert.equal(mac.file('hallway.daemon'), '/Users/someone/Library/LaunchAgents/hallway.daemon.plist');
    assert.deepEqual(platformFor('darwin').openCommand('http://localhost:4255'), ['open', ['http://localhost:4255']]);
    assert.deepEqual(platformFor('linux').openCommand('http://localhost:4255'), ['xdg-open', ['http://localhost:4255']]);
  });
});

/** A fake machine: a stable Node install, an fnm per-shell symlink to it, and a Node script on PATH. */
function fakeMachine() {
  const root = tmp('hw-test-path-');
  const stable = path.join(root, 'fnm', 'node-versions', 'v22.9.0', 'installation', 'bin');
  const shell = path.join(root, 'state', 'fnm_multishells', '12345_1700000000000');
  const tools = path.join(root, 'tools');
  fs.mkdirSync(stable, { recursive: true });
  fs.mkdirSync(path.dirname(shell), { recursive: true });
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(stable, 'node'), '#!/bin/sh\necho v22.9.0\n', { mode: 0o755 });
  fs.symlinkSync(path.join(root, 'fnm', 'node-versions', 'v22.9.0', 'installation'), shell);
  fs.writeFileSync(path.join(tools, 'serve-it'), '#!/usr/bin/env node\nconsole.log(1)\n', { mode: 0o755 });
  fs.writeFileSync(path.join(tools, 'flags'), '#!/usr/bin/env -S node --no-warnings\n', { mode: 0o755 });
  fs.writeFileSync(path.join(tools, 'native'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(tools, 'not-exec'), '#!/bin/sh\n', { mode: 0o644 });
  const PATH = [path.join(shell, 'bin'), tools, path.join(root, 'gone'), 'relative/bin', '', '/usr/bin', '/bin'].join(':');
  return { root, stable, shell, tools, PATH };
}

describe('the PATH trap', { skip: onWindows("a POSIX machine: a ':'-separated PATH, exec bits and #! lines (the Windows equivalent is in schtasks.test.ts)") }, () => {
  test("node resolves through fnm's per-shell symlink to its stable install, with its version", () => {
    const m = fakeMachine();
    const node = resolveNode(m.PATH);
    assert.equal(node.path, path.join(m.stable, 'node'));
    assert.equal(node.version, 'v22.9.0');
  });

  test("PATH: node's bin first, no per-shell, relative or missing entries, then system dirs, no duplicates", () => {
    const m = fakeMachine();
    const p = servicePath(m.stable, m.PATH).split(':');
    assert.equal(p[0], m.stable);
    assert.ok(p.includes(m.tools));
    assert.ok(!p.some((d) => d.includes('fnm_multishells')), p.join(':'));
    assert.ok(!p.includes(path.join(m.root, 'gone')));
    assert.ok(!p.includes('relative/bin') && !p.includes(''));
    assert.equal(new Set(p).size, p.length);
    assert.ok(p.includes('/usr/bin'));
    assert.match(pathProblem(path.join(m.shell, 'bin')) ?? '', /per-shell/);
    assert.match(pathProblem('/no/such/dir') ?? '', /doesn't exist/);
    assert.match(pathProblem('rel') ?? '', /absolute/);
    assert.equal(pathProblem('/usr/bin'), null);
  });

  test('commands: node scripts run by the resolved node; binaries made absolute; failures explained', () => {
    const m = fakeMachine();
    const node = { path: path.join(m.stable, 'node'), version: 'v22.9.0' };
    assert.deepEqual(resolveCommand(['serve-it', '--port', '5100'], m.root, m.PATH, node), [node.path, path.join(m.tools, 'serve-it'), '--port', '5100']);
    assert.deepEqual(resolveCommand(['flags'], m.root, m.PATH, node), [node.path, '--no-warnings', path.join(m.tools, 'flags')]);
    assert.deepEqual(resolveCommand(['native', 'x'], m.root, m.PATH, node), [path.join(m.tools, 'native'), 'x']);
    assert.deepEqual(resolveCommand(['node', 'server.js'], m.root, m.PATH, node), [node.path, 'server.js']);
    assert.deepEqual(resolveCommand(['./tools/native'], m.root, m.PATH, node), [path.join(m.tools, 'native')]);
    assert.throws(() => resolveCommand(['nope-not-here'], m.root, m.PATH, node), /can't find `nope-not-here` on your PATH/);
    assert.throws(() => resolveCommand(['./tools/not-exec'], m.root, m.PATH, node), /isn't an executable file/);
    assert.throws(() => resolveCommand(['./missing'], m.root, m.PATH, node), /doesn't exist/);
    assert.equal(which('not-exec', m.PATH), null);
    assert.deepEqual(nodeShebang(path.join(m.tools, 'native')), null);
  });

  test('$PORT and $HOST in arguments are filled in; other variables are left alone', () => {
    assert.deepEqual(substitute(['--port', '$PORT', '--host=${HOST}', '$HOME', '$PORTS'], { PORT: '5100', HOST: '127.0.0.1' }), ['--port', '5100', '--host=127.0.0.1', '$HOME', '$PORTS']);
  });
});

describe('specs from the YAML', { skip: onWindows("a POSIX machine: a ':'-separated PATH, exec bits and #! lines (the Windows equivalent is in schtasks.test.ts)") }, () => {
  test('an app: resolved program, cwd, PATH, injected PORT/HOST/HOSTNAME, user env, logs', async () => {
    const m = fakeMachine();
    const { home, store, cleanup } = await tmpStore();
    cleanups.push(cleanup);
    const node = { path: path.join(m.stable, 'node'), version: 'v22.9.0' };
    await store.createApp('demo', { port: 5100, service: { command: ['native', '--port', '$PORT'], cwd: m.root, env: { DEBUG: '1', HOST: '0.0.0.0', PORT: '1' }, runAtLoad: false, keepAlive: true } });
    const spec = appSpec('demo', store.apps.get('demo')!.value!, home, { env: { PATH: m.PATH }, node });
    assert.equal(spec.label, 'hallway.app.demo');
    assert.deepEqual(spec.program, [path.join(m.tools, 'native'), '--port', '5100']);
    assert.equal(spec.cwd, m.root);
    assert.equal(spec.env.PATH.split(':')[0], m.stable);
    assert.equal(spec.env.PORT, '5100', 'PORT is always the app port');
    assert.equal(spec.env.HOST, '0.0.0.0', 'the user may move HOST on purpose');
    assert.equal(spec.env.HOSTNAME, '127.0.0.1');
    assert.equal(spec.env.DEBUG, '1');
    assert.equal(spec.stdout, path.join(home, 'logs', 'demo.out.log'));
    assert.equal(spec.stderr, path.join(home, 'logs', 'demo.err.log'));
    assert.equal(spec.runAtLoad, false);
    assert.equal(spec.keepAlive, true);
    assert.deepEqual(spec.node, node);
  });

  test("the daemon: node + the compiled CLI, serve --quiet, the data home passed on if it isn't the default", async () => {
    const d = tmp('hw-test-daemon-');
    const cli = path.join(d, 'cli.js');
    fs.writeFileSync(cli, '');
    const spec = daemonSpec(d, cli, { env: { PATH: '/usr/bin', HALLWAY_HOME: d } });
    assert.equal(spec.label, 'hallway.daemon');
    assert.deepEqual(spec.program.slice(1), [cli, 'serve', '--quiet']);
    assert.equal(spec.env.HALLWAY_HOME, d);
    assert.equal(spec.env.PORT, undefined, "the daemon's port comes from config.yaml, not the installing shell");
    assert.ok(spec.runAtLoad && spec.keepAlive);
    assert.equal(daemonSpec(d, cli, { env: { PATH: '/usr/bin' } }).env.HALLWAY_HOME, undefined);
  });
});

describe('Services: the lifecycle and the YAML (runner mocked)', { skip: onWindows("a POSIX machine: a ':'-separated PATH, exec bits and #! lines (the Windows equivalent is in schtasks.test.ts)") }, () => {
  async function setup() {
    const m = fakeMachine();
    const t = await tmpStore();
    cleanups.push(t.cleanup);
    const userHome = tmp('hw-test-user-');
    const runner = mockRunner((cmd, args) => (args[1] === 'show' ? { stdout: 'LoadState=not-found\nActiveState=inactive\n' } : undefined));
    const services = new Services({ store: t.store, platform: platformFor('linux'), run: runner.run, env: { PATH: m.PATH }, userHome, node: { path: path.join(m.stable, 'node'), version: 'v22.9.0' } });
    await t.store.createApp('demo', { port: 5100, expected: 'adhoc', service: { command: ['native'], cwd: m.root, runAtLoad: false, keepAlive: false } });
    return { ...t, m, runner, services, userHome };
  }

  test('startApp writes the unit and a manifest and starts it; stop and start move `expected`', async () => {
    const { store, services, runner, userHome, home } = await setup();
    const r = await services.startApp('demo');
    assert.equal(r.file, path.join(userHome, '.config', 'systemd', 'user', 'hallway-app-demo.service'));
    assert.ok(fs.existsSync(r.file));
    assert.ok(runner.calls.includes('systemctl --user start hallway-app-demo.service'));
    const manifest = services.readManifest('hallway.app.demo')!;
    assert.equal(manifest.node?.version, 'v22.9.0');
    assert.equal(manifest.file, r.file);
    assert.ok(manifest.path.startsWith(path.dirname(manifest.node!.path)));
    assert.ok(fs.existsSync(path.join(home, 'generated', 'services', 'hallway.app.demo.json')));
    assert.equal(store.apps.get('demo')!.value!.expected, 'adhoc');
    await services.stopApp('demo');
    assert.equal(store.apps.get('demo')!.value!.expected, 'stopped');
    await store.patchApp('demo', { service: { keepAlive: true } });
    await services.startApp('demo');
    assert.equal(store.apps.get('demo')!.value!.expected, 'running');
    assert.match(fs.readFileSync(path.join(home, 'apps', 'demo.yaml'), 'utf8'), /expected: running/);
  });

  test('removeApp drops the unit, the manifest and the service: block, keeping the app', async () => {
    const { store, services, userHome } = await setup();
    await services.startApp('demo');
    await services.removeApp('demo');
    assert.equal(fs.existsSync(path.join(userHome, '.config', 'systemd', 'user', 'hallway-app-demo.service')), false);
    assert.equal(services.readManifest('hallway.app.demo'), null);
    assert.equal(store.apps.get('demo')!.value!.service, null);
    assert.equal(store.apps.get('demo')!.value!.port, 5100);
  });

  test('regenerate rewrites changed units and reports apps that lost their service block', async () => {
    const { store, services } = await setup();
    await services.startApp('demo');
    assert.deepEqual(await services.regenerate(), [{ label: 'hallway.app.demo', changed: false, restarted: false }]);
    await store.patchApp('demo', { service: { env: { NEW: '1' } } });
    assert.deepEqual(await services.regenerate('demo'), [{ label: 'hallway.app.demo', changed: true, restarted: false }]);
    await store.patchApp('demo', { service: null });
    const r = await services.regenerate();
    assert.equal(r[0].label, 'hallway.app.demo');
    assert.match(r[0].error ?? '', /no service: block/);
    await assert.rejects(services.regenerate('demo'), /isn't a managed service/);
  });

  test('unmanaged, missing and broken apps are refused with a clear message', async () => {
    const { store, services, home } = await setup();
    await store.createApp('plain', { port: 5200 });
    assert.throws(() => services.appSpec('plain'), /isn't a managed service.*hallway service add plain/);
    assert.throws(() => services.appSpec('nope'), /no app 'nope'/);
    await store.createApp('daemon', { port: 5300, service: { command: ['native'] } });
    assert.throws(() => services.appSpec('daemon'), /can't be a managed service: its logs would be Hallway's own daemon's/);
    fs.writeFileSync(path.join(home, 'apps', 'broken.yaml'), 'port: [\n');
    store.loadAll();
    assert.throws(() => services.appSpec('broken'), /has errors; fix it first/);
    const unbuilt = new Services({ store, platform: platformFor('linux'), run: mockRunner().run, env: {}, cliScript: '/nonexistent/cli.js' });
    assert.throws(() => unbuilt.daemonSpec(), /build Hallway first/);
  });
});

describe('ports', () => {
  test('assignment skips declared ports, well-known ports and busy ones, within the range', async () => {
    const { store, cleanup } = await tmpStore();
    cleanups.push(cleanup);
    await store.patchConfig({ ports: { assignRange: [5172, 5180] } });
    await store.createApp('a', { port: 5172 });
    const busy = new Set([5175]);
    const p = await assignPort(store, { isFree: async (n) => !busy.has(n) });
    assert.ok(WELL_KNOWN_PORTS.has(5173) && WELL_KNOWN_PORTS.has(5174));
    assert.equal(p, 5176);
    busy.add(5176).add(5177).add(5178).add(5179).add(5180);
    await assert.rejects(assignPort(store, { isFree: async (n) => !busy.has(n) }), /no free port in ports.assignRange \[5172, 5180\]/);
  });
});

describe('logs', () => {
  test('tail reads the last lines; a missing file is empty', () => {
    const d = tmp('hw-test-logs-');
    const f = path.join(d, 'x.log');
    fs.writeFileSync(f, Array.from({ length: 100000 }, (_, i) => `line ${i}`).join('\n') + '\n');
    assert.equal(tailFile(f, 3), 'line 99997\nline 99998\nline 99999\n');
    assert.equal(tailFile(f, 0), '');
    assert.equal(tailFile(path.join(d, 'missing'), 5), '');
    fs.writeFileSync(f, 'no newline');
    assert.equal(tailFile(f, 5), 'no newline\n');
  });

  test('follow prints what is appended, and starts over after a truncation', async () => {
    const d = tmp('hw-test-follow-');
    const f = path.join(d, 'x.log');
    fs.writeFileSync(f, 'old\n');
    let got = '';
    const stop = followFiles([f], (s) => (got += s), { intervalMs: 20 });
    fs.appendFileSync(f, 'new\n');
    await new Promise((r) => setTimeout(r, 80));
    fs.truncateSync(f, 0);
    fs.appendFileSync(f, 'after\n');
    await new Promise((r) => setTimeout(r, 80));
    stop();
    assert.equal(got, 'new\nafter\n');
  });
});

describe('log rotation', () => {
  test('copy then truncate: generations shift, no rotated file is over the limit, small files are left alone', () => {
    const d = tmp('hw-test-rotate-');
    const f = path.join(d, 'demo.out.log');
    const opts = { maxBytes: 1024, generations: 2 };
    const fd = fs.openSync(f, 'a'); // as the service manager holds it: open for appending
    const line = (i: number) => `${String(i).padStart(6, '0')} ${'x'.repeat(40)}\n`;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 1000; i++) fs.writeSync(fd, line(round * 1000 + i));
      assert.equal(rotateFile(f, opts), true);
      assert.equal(fs.statSync(f).size, 0);
    }
    // the writer carries on at the start of the truncated file
    fs.writeSync(fd, 'after\n');
    fs.closeSync(fd);
    assert.equal(fs.readFileSync(f, 'utf8'), 'after\n');
    for (const g of [1, 2]) {
      const s = fs.statSync(`${f}.${g}`).size;
      assert.ok(s <= opts.maxBytes && s > 0, `generation ${g} is ${s} bytes`);
      assert.match(fs.readFileSync(`${f}.${g}`, 'utf8'), /^\d{6} x+\n/, 'starts on a whole line');
    }
    assert.equal(fs.existsSync(`${f}.3`), false, 'only two generations are kept');
    assert.match(fs.readFileSync(`${f}.1`, 'utf8'), /002999 x+\n$/, 'the newest generation ends with the newest line');
    assert.match(fs.readFileSync(`${f}.2`, 'utf8'), /001999 x+\n$/);
    fs.writeFileSync(path.join(d, 'small.err.log'), 'tiny\n');
    assert.deepEqual(rotateLogs(d, opts), []);
  });

  test('a 50 MB log (scaled: 5 MB against a 64 KiB limit) ends up as files no larger than the limit', () => {
    const d = tmp('hw-test-rotate-big-');
    const f = path.join(d, 'big.out.log');
    fs.writeFileSync(f, ('y'.repeat(99) + '\n').repeat(50_000));
    assert.deepEqual(rotateLogs(d, { maxBytes: 65536, generations: 3 }), [f]);
    for (const name of fs.readdirSync(d)) assert.ok(fs.statSync(path.join(d, name)).size <= 65536, name);
  });
});

// The real tools' opinion of the generated files, where this machine has them: `systemd-analyze verify` on Linux
// (CI's Ubuntu runners), `plutil -lint` on macOS. Skipped elsewhere.
describe("the platforms' own validators", () => {
  const has = (cmd: string) => which(cmd, process.env.PATH) !== null;

  test('systemd-analyze verify accepts a generated unit', { skip: !has('systemd-analyze') && 'no systemd-analyze here' }, async () => {
    const d = tmp('hw-test-verify-');
    const cwd = path.join(d, 'my app');
    fs.mkdirSync(cwd);
    const sh = fs.realpathSync(which('sh', process.env.PATH)!);
    for (const [name, spec] of [
      ['demo', { ...adhoc, cwd }],
      ['tricky', { ...tricky, cwd, program: [sh, ...tricky.program.slice(1)] }],
      ['review', { ...reviewLinux, cwd, program: [sh, '-c', 'true'] }],
    ] as [string, ServiceSpec][]) {
      const unit = path.join(d, `hallway-app-${name}.service`);
      fs.writeFileSync(unit, renderUnit({ ...spec, program: name === 'demo' ? [sh, '-c', 'exec sleep 1'] : spec.program, stdout: path.join(d, 'o.log'), stderr: path.join(d, 'e.log') }));
      const { execFileSync } = await import('node:child_process');
      try {
        execFileSync('systemd-analyze', ['verify', '--user', unit], { encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        const err = e as { stderr?: string; stdout?: string };
        // only complaints about our file count (the runner's own units may have unrelated warnings)
        const ours = `${err.stderr ?? ''}${err.stdout ?? ''}`.split('\n').filter((l) => l.includes(path.basename(unit)));
        assert.deepEqual(ours, [], `systemd-analyze verify ${name}`);
      }
    }
  });

  test('plutil -lint accepts the generated plists', { skip: !has('plutil') && 'no plutil here' }, async () => {
    const { execFileSync } = await import('node:child_process');
    for (const f of ['review.plist', 'demo.plist']) execFileSync('plutil', ['-lint', path.join(GOLDEN, f)]);
  });
});
