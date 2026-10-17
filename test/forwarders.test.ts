// The jobs that give Caddy loopback 443 and 80 on macOS without root (D65): which ones a tier wants, their plist (a
// golden: launchd's `Sockets` and inetd mode), the launchd lifecycle for an on-demand job (runner mocked), and the
// Services side: loading exactly the wanted set, and refusing to point one at npx's cache (D61). Nothing here talks to
// a real launchd; CI's macOS fronted-mode job does.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchdManager, renderPlist } from '../server/platform/launchd.ts';
import { platformFor } from '../server/platform/index.ts';
import type { RunResult, ServiceSpec } from '../server/platform/services.ts';
import { Services } from '../server/services/index.ts';
import { forwardSpec, forwards } from '../server/services/spec.ts';
import { ROOT, rmTmp, tmpDir, tmpStore } from './fixture.ts';

const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'services');
function golden(name: string, text: string) {
  const file = path.join(GOLDEN, name);
  if (process.env.HALLWAY_UPDATE_GOLDEN) fs.writeFileSync(file, text);
  assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} changed; if on purpose: HALLWAY_UPDATE_GOLDEN=1 npm test`);
}

function mockRunner(answer: (cmd: string, args: string[]) => Partial<RunResult> | undefined = () => undefined) {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push([cmd, ...args].join(' '));
    return { code: 0, stdout: '', stderr: '', ...answer(cmd, args) };
  };
  return { calls, run };
}

const forwardHttps: ServiceSpec = {
  label: 'hallway.forward.https',
  description: 'Hallway: loopback 127.0.0.1:443 to Caddy on 4443',
  program: ['/opt/homebrew/Cellar/node/24.15.0/bin/node', '/opt/homebrew/lib/node_modules/hallway/dist/server/cli.js', 'forward', '4443'],
  cwd: '/Users/someone/.hallway',
  env: { PATH: '/opt/homebrew/Cellar/node/24.15.0/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
  runAtLoad: false,
  keepAlive: false,
  stdout: '/Users/someone/.hallway/logs/forward-https.out.log',
  stderr: '/Users/someone/.hallway/logs/forward-https.err.log',
  node: { path: '/opt/homebrew/Cellar/node/24.15.0/bin/node', version: 'v24.15.0' },
  socket: { address: '127.0.0.1', port: 443 },
};

describe('which forwarders', () => {
  test('HTTPS tiers: 443 and 80, on 127.0.0.1 and ::1, each to Caddy on 127.0.0.1', () => {
    assert.deepEqual(
      forwards({ httpsPort: 4443, httpPort: 4480 }, 'https').map((f) => `${f.label} ${f.address}:${f.port}>${f.to}`),
      ['hallway.forward.https 127.0.0.1:443>4443', 'hallway.forward.https6 ::1:443>4443', 'hallway.forward.http 127.0.0.1:80>4480', 'hallway.forward.http6 ::1:80>4480'],
    );
  });
  test('plain HTTP (No prompts): 80 only', () => {
    assert.deepEqual(forwards({ httpsPort: 4443, httpPort: 4480 }, 'http').map((f) => f.label), ['hallway.forward.http', 'hallway.forward.http6']);
  });
});

describe('the plist', () => {
  test("golden: launchd binds the socket (Sockets), runs the job inetd-style with Wait (it gets the listener on stdin), on demand", () => {
    golden('forward-https.plist', renderPlist(forwardHttps));
    const v6 = renderPlist({ ...forwardHttps, label: 'hallway.forward.https6', socket: { address: '::1', port: 443 } });
    assert.match(v6, /<key>SockNodeName<\/key> {5}<string>::1<\/string>/);
    assert.match(v6, /<key>SockFamily<\/key> {7}<string>IPv6<\/string>/);
  });
  test('a job without a socket has neither key', () => {
    const plain = renderPlist({ ...forwardHttps, socket: undefined });
    assert.ok(!/Sockets|inetdCompatibility/.test(plain));
  });
  test("forwardSpec: the installed CLI's `forward <port>`, by real path, with the job's own log files", () => {
    const dir = tmpDir('hw-test-fwdspec-');
    try {
      const cli = path.join(dir, 'cli.js');
      fs.writeFileSync(cli, '');
      const s = forwardSpec(forwards({ httpsPort: 4443, httpPort: 4480 }, 'https')[1], '/home/me/.hallway', cli, { env: { PATH: '/usr/bin' }, node: { path: '/usr/bin/node', version: 'v24.0.0' } });
      assert.deepEqual(s.program, ['/usr/bin/node', fs.realpathSync.native(cli), 'forward', '4443']);
      assert.deepEqual(s.socket, { address: '::1', port: 443 });
      assert.equal(s.runAtLoad, false);
      assert.equal(s.keepAlive, false);
      assert.match(s.stderr, /logs[/\\]forward-https6\.err\.log$/);
    } finally {
      rmTmp(dir);
    }
  });
});

describe('the launchd lifecycle of an on-demand job (runner mocked)', () => {
  const dir = '/nonexistent/LaunchAgents';
  const notLoaded = (_c: string, a: string[]) => (a[0] === 'print' ? { code: 113 } : undefined);
  const loaded = (_c: string, a: string[]) => (a[0] === 'print' ? { stdout: 'x = {\n\tstate = not running\n}' } : undefined);

  test('start: enable, bootstrap, and no kickstart (launchd starts it on a connection)', async () => {
    const m = mockRunner(notLoaded);
    await launchdManager({ dir, uid: 501, run: m.run }).start(forwardHttps);
    assert.deepEqual(m.calls, ['launchctl enable gui/501/hallway.forward.https', 'launchctl print gui/501/hallway.forward.https', `launchctl bootstrap gui/501 ${dir}/hallway.forward.https.plist`]);
  });
  test('start when loaded and idle: nothing more', async () => {
    const m = mockRunner(loaded);
    await launchdManager({ dir, uid: 501, run: m.run }).start(forwardHttps);
    assert.equal(m.calls.length, 2);
  });
  test('restart: unload and load again (launchd binds the socket afresh), never a kickstart', async () => {
    const m = mockRunner(loaded);
    await launchdManager({ dir, uid: 501, run: m.run }).restart(forwardHttps);
    assert.deepEqual(m.calls.slice(1), ['launchctl bootout gui/501/hallway.forward.https', 'launchctl enable gui/501/hallway.forward.https', `launchctl bootstrap gui/501 ${dir}/hallway.forward.https.plist`]);
  });
});

describe('Services: the forwarders', () => {
  const cleanups: (() => void)[] = [];
  after(() => cleanups.forEach((c) => c()));
  async function harness(cliUnder = 'lib/node_modules/hallway') {
    const t = await tmpStore();
    const root = tmpDir('hw-test-fwd-');
    cleanups.push(t.cleanup, () => rmTmp(root));
    const cliScript = path.join(root, ...cliUnder.split('/'), 'dist', 'server', 'cli.js');
    fs.mkdirSync(path.dirname(cliScript), { recursive: true });
    fs.writeFileSync(cliScript, '');
    const userHome = path.join(root, 'home');
    fs.mkdirSync(userHome);
    const runner = mockRunner((_c, a) => (a[0] === 'print' ? { code: 113 } : undefined));
    const services = new Services({ store: t.store, platform: platformFor('darwin'), run: runner.run, env: { PATH: '/usr/bin' }, userHome, cliScript, node: { path: process.execPath, version: process.version } });
    return { ...t, services, runner, agents: path.join(userHome, 'Library', 'LaunchAgents') };
  }

  test('forwardersUp loads exactly the set asked for: switching to plain HTTP removes the 443 ones', async () => {
    const h = await harness();
    await h.services.forwardersUp(forwards({ httpsPort: 4443, httpPort: 4480 }, 'https'));
    assert.deepEqual(h.services.forwardersInstalled(), ['hallway.forward.http', 'hallway.forward.http6', 'hallway.forward.https', 'hallway.forward.https6']);
    assert.match(fs.readFileSync(path.join(h.agents, 'hallway.forward.https6.plist'), 'utf8'), /<string>forward<\/string>\s*<string>4443<\/string>/);
    assert.ok(h.services.readManifest('hallway.forward.https'), 'a manifest, so doctor checks its Node and program like any job');
    await h.services.forwardersUp(forwards({ httpsPort: 4443, httpPort: 4480 }, 'http'));
    assert.deepEqual(h.services.forwardersInstalled(), ['hallway.forward.http', 'hallway.forward.http6']);
    assert.ok(h.runner.calls.some((c) => c.endsWith('bootout gui/' + (process.getuid?.() ?? 501) + '/hallway.forward.https')));
    await h.services.removeForwarders();
    assert.deepEqual(h.services.forwardersInstalled(), []);
  });

  test("they run Hallway's CLI, so never npx's (D61): cliProblem says so, and nothing is written", async () => {
    const h = await harness('.npm/_npx/0123abcd/node_modules/hallway');
    assert.match(h.services.cliProblem()!, /npx's cache.*then run `hallway setup` again/);
    await assert.rejects(h.services.forwardersUp(forwards({ httpsPort: 4443, httpPort: 4480 }, 'https')), /npx's cache/);
    assert.deepEqual(h.services.forwardersInstalled(), []);
    assert.equal((await harness()).services.cliProblem(), null, 'an installed CLI is fine');
  });

  test('regenerate rewrites a forwarder from config.yaml, like the daemon', async () => {
    const h = await harness();
    await h.store.patchConfig({ mode: 'fronted', proxy: { trust: 'user' } });
    await h.services.forwardersUp(forwards({ httpsPort: 4443, httpPort: 4480 }, 'https'));
    const r = await h.services.regenerate();
    assert.deepEqual(r.filter((x) => x.label.startsWith('hallway.forward.')).map((x) => x.error ?? 'ok'), ['ok', 'ok', 'ok', 'ok']);
  });
});
