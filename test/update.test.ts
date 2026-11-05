// `hallway update` (the CLI contract's §5, D76): what's Hallway's own around the reference sequence, which
// test/contract-update.test.ts covers. Pausing and resuming the jobs that run Hallway's code (every job on Windows),
// `--check` against a stand-in registry, and the scoped flags. The whole sequence against a real registry and real
// service managers is the conformance runner's (ci.yml).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { makeCtx } from '../server/commands/index.ts';
import { diagnose } from '../server/commands/doctor.ts';
import { update, updateJobs } from '../server/commands/update.ts';
import { VERSION } from '../server/config.ts';
import { readUpdateCheck } from '../server/contract/update-check.ts';
import type { Platform } from '../server/platform/index.ts';
import type { ServiceManager, ServiceSpec, ServiceStatus } from '../server/platform/services.ts';
import { DAEMON_LABEL, Services, appLabel } from '../server/services/index.ts';
import { tmpDir, tmpStore } from './fixture.ts';

const cleanups: (() => unknown)[] = [];
after(async () => {
  for (const f of cleanups) await f();
});

/** A service manager that remembers what it was asked, with jobs that are running or not. */
function fakeManager(kind: ServiceManager['kind'], dir: string, running: Set<string>) {
  const calls: string[] = [];
  const m: ServiceManager = {
    kind,
    noun: 'job',
    lifetime: '',
    file: (label) => path.join(dir, `${label}.job`),
    render: (spec) => JSON.stringify(spec),
    readPath: () => null,
    readEnv: () => ({}),
    async write(spec) {
      calls.push(`write ${spec.label}`);
      fs.writeFileSync(m.file(spec.label), m.render(spec));
      return false;
    },
    async start(spec: ServiceSpec) {
      calls.push(`start ${spec.label}`);
      running.add(spec.label);
    },
    async stop(label, opts) {
      calls.push(`stop ${label}${opts?.disable === false ? '' : ' (disable)'}`);
      running.delete(label);
    },
    async restart(spec) {
      calls.push(`restart ${spec.label}`);
    },
    async status(label): Promise<ServiceStatus> {
      const installed = fs.existsSync(m.file(label));
      return { label, installed, loaded: installed, running: running.has(label), pid: null, lastExitCode: null, state: null, enabled: null };
    },
    async remove(label) {
      calls.push(`remove ${label}`);
    },
    list: () =>
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.job'))
        .map((f) => f.slice(0, -4))
        .sort(),
  };
  return { m, calls };
}

async function rig(kind: ServiceManager['kind']) {
  const t = await tmpStore();
  const dir = tmpDir('hw-test-update-jobs-');
  cleanups.push(t.cleanup, () => fs.rmSync(dir, { recursive: true, force: true }));
  const cliScript = path.join(dir, 'cli.js');
  fs.writeFileSync(cliScript, '');
  for (const slug of ['web', 'shop', 'idle']) {
    await t.store.createApp(slug, { port: 5100 + slug.length, service: { command: [process.execPath, '-e', '1'], cwd: dir, runAtLoad: true, keepAlive: true } });
  }
  const running = new Set([DAEMON_LABEL, appLabel('web'), appLabel('shop')]);
  const f = fakeManager(kind, dir, running);
  const services = new Services({ store: t.store, platform: { services: () => f.m } as unknown as Platform, env: { PATH: '' }, cliScript, node: { path: process.execPath, version: process.version } });
  // the jobs, as they'd be on disk
  for (const label of [DAEMON_LABEL, appLabel('web'), appLabel('shop'), appLabel('idle')]) fs.writeFileSync(f.m.file(label), '{}');
  let out = '';
  let err = '';
  const ctx = makeCtx({ home: t.home, env: { PATH: '' }, out: (s) => void (out += s), err: (s) => void (err += s) });
  ctx.services = () => services;
  const jobs = async (verb: string) => {
    out = err = '';
    const code = await updateJobs(ctx, [verb], {});
    return { code, out, err };
  };
  return { ...t, services, running, calls: f.calls, jobs, ctx, get err() { return err; }, get out() { return out; } };
}

describe('update-jobs pause and resume: what runs from the package is stopped before npm, and started after (D76)', () => {
  test('on Windows, every running job: the daemon and the running apps, stopped without disabling, then started again', async () => {
    const r = await rig('schtasks');
    const p = await r.jobs('pause');
    assert.equal(p.code, 0, p.err);
    assert.deepEqual(JSON.parse(p.out), { daemon: true, paused: [appLabel('shop'), appLabel('web')] });
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith('stop')),
      [`stop ${DAEMON_LABEL}`, `stop ${appLabel('shop')}`, `stop ${appLabel('web')}`],
      'never disabled, and the idle app left alone',
    );
    assert.equal(r.running.size, 0);
    assert.ok(fs.existsSync(r.services.pausedFile()));

    r.calls.length = 0;
    const s = await r.jobs('resume');
    assert.equal(s.code, 0, s.err);
    const doc = JSON.parse(s.out);
    assert.deepEqual(doc.started, [appLabel('shop'), appLabel('web')]);
    assert.deepEqual(doc.errors, []);
    // every app's job rewritten in this version's format; the daemon's is `service install --refresh`'s
    for (const slug of ['web', 'shop', 'idle']) assert.ok(r.calls.includes(`write ${appLabel(slug)}`), slug);
    assert.ok(!r.calls.includes(`start ${appLabel('idle')}`), "a job that wasn't running stays stopped");
    assert.ok(!r.calls.some((c) => c.endsWith(DAEMON_LABEL) && /^(start|restart)/.test(c)), r.calls.join('\n'));
    assert.deepEqual([...r.running].sort(), [appLabel('shop'), appLabel('web')]);
    assert.equal(fs.existsSync(r.services.pausedFile()), false);
  });

  test('on macOS and Linux, only the daemon: an app job runs the app, not Hallway', async () => {
    for (const kind of ['systemd', 'launchd'] as const) {
      const r = await rig(kind);
      const p = await r.jobs('pause');
      assert.deepEqual(JSON.parse(p.out), { daemon: true, paused: [] }, kind);
      assert.deepEqual(r.calls.filter((c) => c.startsWith('stop')), [`stop ${DAEMON_LABEL}`], kind);
      assert.ok(r.running.has(appLabel('web')), `${kind}: the apps keep running`);
      const s = await r.jobs('resume');
      assert.deepEqual(JSON.parse(s.out).started, [], kind);
    }
  });

  test("resume says which app couldn't come back, and exits 1 (update reports it, and doesn't roll back for it)", async () => {
    const r = await rig('schtasks');
    await r.jobs('pause');
    fs.writeFileSync(path.join(r.home, 'apps', 'web.yaml'), 'port: [not valid\n');
    r.store.loadAll();
    const s = await r.jobs('resume');
    assert.equal(s.code, 1);
    assert.match(s.err, /hallway\.app\.web/);
    assert.deepEqual(JSON.parse(s.out).started, [appLabel('shop')]);
  });

  test('update-jobs needs pause or resume', async () => {
    const r = await rig('systemd');
    await assert.rejects(r.jobs('other'), /update-jobs needs pause or resume/);
  });
});

/** A registry that knows one package, `hallway`, at `latest`. */
async function stubRegistry(latest: string) {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    asked.push(req.url ?? '');
    const body = req.url === '/-/package/hallway/dist-tags' ? { latest } : req.url === `/hallway/${latest}` ? { name: 'hallway', version: latest, engines: { node: '>=22.13' } } : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? { error: 'not found' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked };
}

describe('hallway update, from this checkout (the tests run from one, which can\'t update itself)', () => {
  const run = async (flags: Record<string, string>, latest = '99.0.0') => {
    const t = await tmpStore();
    cleanups.push(t.cleanup);
    const reg = await stubRegistry(latest);
    let out = '';
    let err = '';
    const ctx = makeCtx({ home: t.home, env: { ...process.env, npm_config_registry: reg.url, NO_COLOR: '1' }, out: (s) => void (out += s), err: (s) => void (err += s) });
    const code = await update(ctx, [], flags, undefined, { runCli: () => assert.fail('nothing runs a CLI before step 9') });
    return { code, out, err, home: t.home, reg };
  };

  test('--check --json: one document, a checkout that runs `git pull`; the notice on stderr; the cache written for status', async () => {
    const r = await run({ check: '1', json: '1' });
    assert.equal(r.code, 0, r.err);
    const doc = JSON.parse(r.out);
    assert.equal(doc.current, VERSION);
    assert.equal(doc.target, '99.0.0');
    assert.equal(doc.updateAvailable, true);
    assert.equal(doc.installMethod, 'checkout');
    assert.equal(doc.canUpdate, false);
    assert.equal(doc.changelog, 'https://github.com/edspencer/hallway/releases/tag/v99.0.0');
    assert.match(r.err, /Hallway 99\.0\.0 is available \(you have /);
    assert.match(r.err, /git pull && npm install && npm run build/);
    assert.equal(readUpdateCheck(r.home)?.target, '99.0.0');
    assert.ok(r.reg.asked.includes('/-/package/hallway/dist-tags'));
  });

  test('--yes: exits 5, saying what to run instead, and stops nothing', async () => {
    const r = await run({ yes: '1' });
    assert.equal(r.code, 5, r.err);
    assert.match(r.err, /^hallway: this install can't update itself: it's/m);
  });

  test('up to date: exits 0, says so', async () => {
    const r = await run({ yes: '1' }, VERSION);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`Hallway ${VERSION.replace(/\./g, '\\.')} is up to date`));
  });

  test("scoped flags: update takes its own, and the others don't take update's", async () => {
    const t = await tmpStore();
    cleanups.push(t.cleanup);
    const ctx = makeCtx({ home: t.home });
    await assert.rejects(update(ctx, [], { refresh: '1' }, undefined), /update doesn't take --refresh/);
    await assert.rejects(update(ctx, [], { port: '1' }, undefined), /update doesn't take --port/);
    await assert.rejects(update(ctx, ['now'], {}, undefined), /unexpected argument 'now'/);
    await assert.rejects(update(ctx, [], { to: '' }, undefined), /--to needs a version or a dist-tag/);
    const { busy } = await import('../server/commands/busy.ts');
    await assert.rejects(busy(ctx, [], { check: '1' }), /busy doesn't take --check/);
  });
});

describe("doctor's update check (the CLI contract's §1, D76)", () => {
  const run = async (registry: string, o: { offline?: boolean; home?: 'exists' | 'missing' } = {}) => {
    const t = await tmpStore();
    cleanups.push(t.cleanup);
    const home = o.home === 'missing' ? path.join(t.home, 'not-yet') : t.home;
    let err = '';
    const ctx = makeCtx({ home, env: { ...process.env, npm_config_registry: registry, NO_COLOR: '1' }, err: (s) => void (err += s), out: () => {} });
    const checks = await diagnose(ctx, async () => ({ code: 1, stdout: '', stderr: '' }), { offline: o.offline });
    return { check: checks.find((c) => c.id === 'update'), err, home };
  };

  test('a newer version: a warning with the command for this install, the notice on stderr, the cache written for status', async () => {
    const reg = await stubRegistry('99.0.0');
    const r = await run(reg.url);
    assert.equal(r.check?.status, 'warn');
    assert.match(r.check!.message, /Hallway 99\.0\.0 is available/);
    assert.match(r.check!.fix!, /git pull/, 'the tests run from a checkout');
    assert.match(r.err, /Hallway 99\.0\.0 is available \(you have .*\)\.\n {2}Run: git pull/);
    assert.equal(readUpdateCheck(r.home)?.updateAvailable, true);
  });

  test("up to date: a pass; a data home that doesn't exist yet isn't created for the cache", async () => {
    const reg = await stubRegistry(VERSION);
    const r = await run(reg.url, { home: 'missing' });
    assert.equal(r.check?.status, 'pass');
    assert.equal(fs.existsSync(r.home), false);
    assert.equal(r.err, '');
  });

  test("the registry can't be reached: a warning, not a failure; --offline doesn't ask", async () => {
    const reg = await stubRegistry('99.0.0');
    const dead = await run('http://127.0.0.1:9');
    assert.equal(dead.check?.status, 'warn');
    assert.match(dead.check!.fix!, /--offline/);
    const before = reg.asked.length;
    const off = await run(reg.url, { offline: true });
    assert.equal(off.check?.status, 'skip');
    assert.equal(reg.asked.length, before);
  });
});
