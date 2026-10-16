// Hallway run from npx's cache (D61): the detector (server/services/transient.ts) on POSIX and Windows paths, every
// command that would write a job running Hallway's own CLI refusing before it writes anything, and doctor flagging a
// job that already does. The service manager's runner is mocked; nothing touches a real home.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCtx } from '../server/commands/index.ts';
import { diagnose } from '../server/commands/doctor.ts';
import { run as runCommand, service } from '../server/commands/services.ts';
import { reviveLost } from '../server/lost/actions.ts';
import { platformFor } from '../server/platform/index.ts';
import type { RunResult } from '../server/platform/services.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { DAEMON_LABEL, Services } from '../server/services/index.ts';
import { runApp } from '../server/services/run.ts';
import { transientInstall, transientMessage } from '../server/services/transient.ts';
import { exitWatchdog, tmpDir, tmpStore } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((f) => f()));

describe('transientInstall', () => {
  const where = (p: string) => transientInstall(p)?.where ?? null;

  test("npx's cache, POSIX and Windows", () => {
    assert.equal(where('/Users/me/.npm/_npx/0123abcd/node_modules/hallway/dist/server/cli.js'), "npx's cache");
    assert.equal(where('/home/me/.npm/_npx/0123abcd/node_modules/hallway'), "npx's cache");
    assert.equal(where('C:\\Users\\Me\\AppData\\Local\\npm-cache\\_npx\\0123abcd\\node_modules\\hallway\\dist\\server\\cli.js'), "npx's cache");
    assert.equal(where('c:/users/me/appdata/local/npm-cache/_NPX/1/node_modules/hallway'), "npx's cache");
    assert.equal(transientInstall('/home/me/.npm/_npx/1/node_modules/hallway')?.owner, 'npm');
  });

  test('pnpm dlx, bunx and yarn dlx', () => {
    assert.equal(where('/home/me/.cache/pnpm/dlx/abc123/1700000000-1234/node_modules/hallway/dist/server/cli.js'), "pnpm dlx's cache");
    assert.equal(where('/Users/me/Library/Caches/pnpm/dlx/abc/x/node_modules/hallway'), "pnpm dlx's cache");
    assert.equal(where('C:\\Users\\Me\\AppData\\Local\\pnpm-cache\\dlx\\abc\\x\\node_modules\\hallway'), "pnpm dlx's cache");
    assert.equal(where('/tmp/bunx-501-hallway@latest/node_modules/hallway/dist/server/cli.js'), "bunx's cache");
    assert.equal(where('C:\\Users\\Me\\AppData\\Local\\Temp\\bunx-1-hallway@latest\\node_modules\\hallway'), "bunx's cache");
    assert.equal(where('/tmp/dlx-12345/node_modules/hallway'), 'a temporary dlx directory');
    assert.equal(where('/tmp/xfs-1a2b3c4d/dlx-999/node_modules/hallway'), 'a temporary dlx directory');
  });

  test('lasting installs are not transient', () => {
    for (const p of [
      '/usr/local/lib/node_modules/hallway/dist/server/cli.js',
      '/opt/homebrew/lib/node_modules/hallway/dist/server/cli.js',
      '/home/me/.local/share/fnm/node-versions/v22.9.0/installation/lib/node_modules/hallway/dist/server/cli.js',
      '/home/me/.local/share/pnpm/global/5/node_modules/hallway/dist/server/cli.js',
      '/home/me/.bun/install/global/node_modules/hallway/dist/server/cli.js',
      'C:\\Users\\Me\\AppData\\Roaming\\npm\\node_modules\\hallway\\dist\\server\\cli.js',
      '/home/me/Code/hallway/dist/server/cli.js',
      '/home/me/Code/my_npx_tools/hallway/dist/server/cli.js',
      '/home/me/Code/dlx/hallway/dist/server/cli.js',
    ])
      assert.equal(transientInstall(p), null, p);
  });

  test('the message says what to do', () => {
    const t = transientInstall('/home/me/.npm/_npx/1/node_modules/hallway')!;
    assert.equal(
      transientMessage(t, 'hallway service install'),
      "Hallway is running from npx's cache, which npm can delete at any time. Install it first: `npm i -g hallway`, then run `hallway service install` again.",
    );
    assert.match(transientMessage(t), /then run the same command again with the installed `hallway`\.$/);
  });
});

function mockRunner() {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push([cmd, ...args].join(' '));
    return { code: 0, stdout: args[1] === 'show' ? 'LoadState=not-found\nActiveState=inactive\n' : '', stderr: '' };
  };
  return { calls, run };
}

/** A data home, a user home, and a built CLI at `<root>/<under>/dist/server/cli.js`. */
async function setup(under: string, platform: 'linux' | 'win32' = 'linux') {
  const t = await tmpStore();
  const root = tmpDir('hw-test-transient-');
  cleanups.push(t.cleanup, () => fs.rmSync(root, { recursive: true, force: true }));
  const cliScript = path.join(root, ...under.split('/'), 'dist', 'server', 'cli.js');
  fs.mkdirSync(path.dirname(cliScript), { recursive: true });
  fs.writeFileSync(cliScript, '');
  const userHome = path.join(root, 'home');
  fs.mkdirSync(userHome);
  const runner = mockRunner();
  const env = { PATH: '', LOCALAPPDATA: path.join(root, 'local') };
  const services = new Services({ store: t.store, platform: platformFor(platform), run: runner.run, env, userHome, cliScript, node: { path: process.execPath, version: process.version } });
  let out = '';
  const ctx = makeCtx({ home: t.home, env, cwd: root, out: (s) => void (out += s), err: (s) => void (out += s), run: runner.run, platform: platformFor(platform) });
  ctx.services = () => services;
  return { ...t, root, cliScript, userHome, runner, services, ctx, output: () => out };
}
const NPX = '.npm/_npx/0123abcd/node_modules/hallway';

describe("refusing to write a job that runs Hallway from npx's cache", () => {
  test('service install, restart and regenerate refuse for the daemon, and write nothing', async () => {
    const { services, ctx, runner, userHome } = await setup(NPX);
    const msg = /Hallway is running from npx's cache, which npm can delete at any time\. Install it first: `npm i -g hallway`, then run `hallway service install` again\.$/;
    await assert.rejects(service(ctx, ['install'], {}, undefined), msg);
    assert.throws(() => services.daemonSpec(), msg);
    await assert.rejects(services.installDaemon(), msg);
    assert.deepEqual(runner.calls.filter((c) => !c.includes(' show ')), []);
    assert.equal(fs.existsSync(path.join(userHome, '.config', 'systemd', 'user', 'hallway-daemon.service')), false);
    assert.equal(services.readManifest(DAEMON_LABEL), null);
    // an installed daemon job can't be rewritten from npx either
    const unit = path.join(userHome, '.config', 'systemd', 'user', 'hallway-daemon.service');
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, '[Service]\n');
    const r = await services.regenerate();
    assert.equal(r.length, 1);
    assert.match(r[0].error ?? '', msg);
    assert.equal(fs.readFileSync(unit, 'utf8'), '[Service]\n');
  });

  test('uninstall still works from npx', async () => {
    const { services } = await setup(NPX);
    await services.uninstallDaemon();
  });

  test("on Linux and macOS an app's job doesn't run Hallway, so `hallway run` from npx is fine", async () => {
    const { services } = await setup(NPX);
    services.refuseTransient(); // no throw
    services.refuseTransient('hallway.app.demo');
  });

  test("on Windows every job runs `hallway supervise`: run, service add and Lost's revive refuse before writing an app file", async () => {
    const { services, ctx, store, home, root } = await setup(NPX, 'win32');
    const msg = /Hallway is running from npx's cache, which npm can delete at any time\. Install it first: `npm i -g hallway`, then run the same command again with the installed `hallway`\.$/;
    await assert.rejects(runApp(services, { slug: 'demo', command: ['node', 'server.js'] }, { cwd: root }), msg);
    await assert.rejects(runCommand(ctx, ['demo'], {}, ['node', 'server.js']), msg);
    assert.equal(fs.existsSync(path.join(home, 'apps', 'demo.yaml')), false);
    await store.createApp('plain', { port: 5200 });
    await assert.rejects(service(ctx, ['add', 'plain'], {}, ['node', 'server.js']), msg);
    assert.ok(!store.apps.get('plain')!.value!.service);
    const providers = new ProviderRegistry();
    providers.register({ name: 'test', lostRecord: () => ({ command: ['node', 'server.js'], cwd: root }), lost: () => ({ items: [{ id: 'x', label: 'x', port: 5300, suggestedSlug: 'x', identity: {} }] }) } as never);
    await assert.rejects(reviveLost({ services, providers } as never, 'x', true, {}), msg);
    assert.equal(fs.existsSync(path.join(home, 'apps', 'x.yaml')), false);
  });

  test('a lasting install writes the daemon job as before', async () => {
    const { services, cliScript } = await setup('global/lib/node_modules/hallway');
    const r = await services.installDaemon();
    assert.equal(r.spec.program[1], fs.realpathSync.native(cliScript));
    assert.ok(fs.existsSync(r.file));
  });
});

describe('doctor', () => {
  test("flags an existing job that runs Hallway from npx's cache", async () => {
    const { services, ctx, runner } = await setup('global/lib/node_modules/hallway');
    await services.installDaemon();
    const check = async () => (await diagnose(ctx, runner.run)).filter((c) => c.id === 'job-transient' || (c.id === 'job' && c.message.startsWith(DAEMON_LABEL)));
    assert.deepEqual((await check()).map((c) => c.id), ['job']);
    // as if it had been installed by `npx hallway service install` before this check existed
    const f = services.manifestFile(DAEMON_LABEL);
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    m.program[1] = '/home/me/.npm/_npx/0123abcd/node_modules/hallway/dist/server/cli.js';
    fs.writeFileSync(f, JSON.stringify(m));
    const [c] = await check();
    assert.equal(c.id, 'job-transient');
    assert.equal(c.status, 'warn');
    assert.match(c.message, /^hallway\.daemon runs Hallway from npx's cache, which npm can delete at any time/);
    assert.equal(c.fix, '`npm i -g hallway && hallway service regenerate`');
  });
});
