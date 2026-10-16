// "Lost at last reboot" (D54): the lost-set computation (fake boot times, observations, apps, health samples),
// state/lost.json across daemon restarts, dismissal, the actions with the service manager's runner mocked (the mock
// "starts" a job by opening a real listener on its port, so `hallway run`'s wait for the port is exercised), the API,
// llms.txt, MCP's get_status, and `hallway lost`.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { LostActionResponse, LostResponse, ServerEvent, StateResponse } from '../shared/api.ts';
import { makeCtx } from '../server/commands/index.ts';
import { createApp } from '../server/index.ts';
import { startLive } from '../server/live.ts';
import { LostStore, computeLost, observedCommand, type LostAppInput } from '../server/lost/index.ts';
import { type Platform, type ProcessInfo, type RawListener, currentPlatform, platformFor } from '../server/platform/index.ts';
import { ProviderRegistry } from '../server/providers.ts';
import type { Observation } from '../server/scanner/types.ts';
import { Services } from '../server/services/index.ts';
import { exitWatchdog, tmpDir, tmpStore, rmTmp } from './fixture.ts';

await exitWatchdog();

const cleanups: (() => void | Promise<void>)[] = [];
after(async () => {
  for (const c of cleanups.reverse()) await c();
});

const BOOT_OLD = Date.parse('2026-09-21T08:00:00Z');
const BOOT_NEW = Date.parse('2026-09-28T20:05:00Z');
const iso = (t: number) => new Date(t).toISOString();
const LAST_SCAN = BOOT_NEW - 3600_000; // the last scan before the machine went down

function obs(o: Partial<Observation> & { id: string; port: number }): Observation {
  return {
    pid: 100,
    ppid: 1,
    process: 'node',
    addresses: ['127.0.0.1'],
    bind: 'loopback',
    kind: 'web',
    http: { status: 200, title: null, favicon: null },
    command: `node server.js --port ${o.port}`,
    argv: ['node', 'server.js', '--port', String(o.port)],
    cwd: '/home/me/Code/thing',
    startedAt: iso(BOOT_OLD + 60_000),
    orphan: true,
    project: { root: '/home/me/Code/thing', name: 'thing', description: null, framework: null },
    git: null,
    label: 'thing',
    firstSeen: iso(BOOT_OLD + 60_000),
    lastSeen: iso(LAST_SCAN),
    ...o,
  };
}

const app = (a: Partial<LostAppInput> & { slug: string; port: number }): LostAppInput => ({ name: a.slug, managed: false, command: null, cwd: null, projectDir: null, ...a });

describe('computeLost', () => {
  const base = { bootTime: BOOT_NEW, previousBootTime: BOOT_OLD, windowMs: 5 * 60_000, apps: [] as LostAppInput[], listening: () => false };

  test('alive in the last scans before the boot, and not listening now', () => {
    const records = [
      obs({ id: 'a', port: 5173, label: 'viz @ feature/new-chart' }),
      obs({ id: 'b', port: 5174, lastSeen: iso(LAST_SCAN - 2 * 60_000) }), // one slow scan earlier: still counts
      obs({ id: 'stopped-days-ago', port: 5175, lastSeen: iso(LAST_SCAN - 2 * 86400_000) }),
      obs({ id: 'previous-boot', port: 5176, lastSeen: iso(BOOT_OLD - 60_000) }),
      obs({ id: 'after-boot', port: 5177, lastSeen: iso(BOOT_NEW + 60_000) }),
      obs({ id: 'came-back', port: 5178 }),
    ];
    const lost = computeLost({ ...base, records, listening: ({ id }) => id === 'came-back' });
    assert.deepEqual(lost.map((l) => l.id).sort(), ['a', 'b']);
    const a = lost.find((l) => l.id === 'a')!;
    assert.equal(a.label, 'viz @ feature/new-chart');
    assert.deepEqual(a.command, ['node', 'server.js', '--port', '5173']);
    assert.equal(a.cwd, '/home/me/Code/thing');
    assert.equal(a.slug, null);
  });

  test('a declared app on the port names it, and its service: block is the command', () => {
    const records = [obs({ id: 'a', port: 5173 }), obs({ id: 'older', port: 5173, lastSeen: iso(LAST_SCAN - 60_000), command: 'vite' })];
    const apps = [app({ slug: 'docs', name: 'Docs deck', port: 5173, managed: true, command: ['npm', 'run', 'dev'], cwd: '/home/me/Code/docs' })];
    const lost = computeLost({ ...base, records, apps });
    assert.equal(lost.length, 1, 'one item per port: the latest observation');
    assert.equal(lost[0].id, 'a');
    assert.equal(lost[0].slug, 'docs');
    assert.equal(lost[0].label, 'Docs deck');
    assert.deepEqual(lost[0].command, ['npm', 'run', 'dev']);
    assert.equal(lost[0].cwd, '/home/me/Code/docs');
  });

  test('apps the scanner never recorded: from the last health sample before the boot', () => {
    const apps = [app({ slug: 'up', port: 6001, projectDir: '/srv/up' }), app({ slug: 'off', port: 6002 }), app({ slug: 'old', port: 6003 }), app({ slug: 'none', port: 6004 })];
    const samples: Record<string, { state: 'healthy' | 'stopped'; ts: number }> = {
      up: { state: 'healthy', ts: LAST_SCAN },
      off: { state: 'stopped', ts: LAST_SCAN },
      old: { state: 'healthy', ts: BOOT_OLD - 1000 },
    };
    const lost = computeLost({ ...base, records: [], apps, lastSample: (s) => samples[s] ?? null });
    assert.deepEqual(lost.map((l) => l.id), ['app:up']);
    assert.equal(lost[0].cwd, '/srv/up');
    assert.equal(lost[0].observation, null);
    // listening again: not lost
    assert.deepEqual(computeLost({ ...base, records: [], apps, lastSample: (s) => samples[s] ?? null, listening: ({ port }) => port === 6001 }), []);
  });

  test('nothing recorded: nothing lost', () => {
    assert.deepEqual(computeLost({ ...base, records: [] }), []);
  });

  test('observedCommand: argv, else the command line split', () => {
    assert.deepEqual(observedCommand({ argv: ['a', 'b c'], command: 'x' }), ['a', 'b c']);
    assert.deepEqual(observedCommand({ argv: null, command: ' python3  -m http.server ' }), ['python3', '-m', 'http.server']);
    assert.equal(observedCommand({ argv: null, command: null }), null);
  });
});

describe('LostStore', () => {
  test('kept across instances until dismissed; the file goes with the last item', () => {
    const dir = tmpDir('hw-test-lost-');
    cleanups.push(() => rmTmp(dir));
    const file = path.join(dir, 'state', 'lost.json');
    const s = new LostStore(file);
    assert.equal(s.get(), null);
    const item = (id: string) => ({ id, port: 1, slug: null, label: id, observation: null, command: null, cwd: null, firstSeen: null, lastSeen: null });
    s.replace({ version: 1, bootTime: iso(BOOT_NEW), previousBootTime: iso(BOOT_OLD), detectedAt: iso(BOOT_NEW + 1), items: [item('a'), item('b'), item('c')] });
    assert.deepEqual(new LostStore(file).get()?.items.map((i) => i.id), ['a', 'b', 'c']);
    assert.equal(s.dismiss('b'), 1);
    assert.equal(s.dismiss('nope'), 0);
    assert.deepEqual(new LostStore(file).get()?.items.map((i) => i.id), ['a', 'c']);
    s.setSlug('a', 'my-a');
    assert.equal(new LostStore(file).item('a')?.slug, 'my-a');
    assert.equal(s.dismiss(), 2);
    assert.equal(fs.existsSync(file), false);
    assert.equal(new LostStore(file).get(), null);
    fs.writeFileSync(file, 'not json');
    assert.equal(new LostStore(file).get(), null, 'unreadable: start empty');
  });
});

/** A port nothing is listening on. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 10_000) {
  const t0 = Date.now();
  while (!(await ok())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * A data home that has been through a reboot: observed.json says what was running at the end of the last boot,
 * boot.json says when that boot was, and the fake platform boots at BOOT_NEW with only `listening` listening.
 */
async function rebooted() {
  const s = await tmpStore();
  cleanups.push(s.cleanup);
  await s.store.patchConfig({ scan: { includeEphemeralPorts: true, minPort: 1 } });
  const projDir = tmpDir('hw-test-lost-proj-');
  const docsDir = tmpDir('hw-test-lost-docs-');
  cleanups.push(() => rmTmp(projDir), () => rmTmp(docsDir));
  fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ name: 'scratch-pad' }));
  const [pViz, pDocs, pGone] = await Promise.all([freePort(), freePort(), freePort()]);
  await s.store.createApp('docs', { name: 'Docs deck', port: pDocs, expected: 'adhoc', service: { command: ['node', 'serve.js'], cwd: docsDir, runAtLoad: false, keepAlive: false } });

  const records: Observation[] = [
    obs({ id: 'viz00000000000001', port: pViz, label: 'scratch-pad', cwd: projDir, argv: ['node', 'dev.js'], command: 'node dev.js', project: { root: projDir, name: 'scratch-pad', description: null, framework: null } }),
    obs({ id: 'docs0000000000001', port: pDocs, label: 'docs', cwd: docsDir }),
    obs({ id: 'gone0000000000001', port: pGone, label: 'no command', argv: null, command: null, cwd: '/nonexistent/dir' }),
  ];
  const state = path.join(s.home, 'state');
  fs.writeFileSync(path.join(state, 'observed.json'), JSON.stringify({ version: 1, updatedAt: iso(LAST_SCAN), observations: Object.fromEntries(records.map((r) => [r.id, r])) }));
  fs.writeFileSync(path.join(state, 'boot.json'), JSON.stringify({ bootTime: iso(BOOT_OLD), checkedAt: iso(LAST_SCAN) }));

  // what is listening now, and who: the mock runner below adds to it when it "starts" a job
  const raw: RawListener[] = [];
  const info = new Map<number, ProcessInfo>();
  const platform = {
    ...currentPlatform(),
    listListeners: async () => raw,
    processInfo: async (pids: number[]) => new Map(pids.filter((p) => info.has(p)).map((p) => [p, info.get(p)!])),
    bootTime: async () => BOOT_NEW,
  } satisfies Platform;

  // systemd, mocked: `start`/`restart` of hallway-app-<slug> opens a real HTTP listener on the app's port
  const servers = new Map<string, http.Server>();
  const calls: string[] = [];
  let nextPid = 500;
  const userHome = tmpDir('hw-test-lost-user-');
  cleanups.push(() => rmTmp(userHome));
  const services = new Services({
    store: s.store,
    platform: platformFor('linux'),
    env: { PATH: process.env.PATH },
    userHome,
    run: async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      const unit = args.find((a) => a.startsWith('hallway-app-'));
      const slug = unit?.replace(/^hallway-app-|\.service$/g, '');
      if (slug && (args[1] === 'start' || args[1] === 'restart') && !servers.has(slug)) {
        const c = s.store.apps.get(slug)!.value!;
        const srv = http.createServer((_q, res) => res.end('<title>Back</title>'));
        await new Promise<void>((r) => srv.listen(c.port, '127.0.0.1', () => r()));
        servers.set(slug, srv);
        const pid = nextPid++;
        raw.push({ pid, process: c.service!.command[0], port: c.port, address: '127.0.0.1' });
        info.set(pid, { pid, ppid: 1, command: c.service!.command.join(' '), argv: c.service!.command, cwd: c.service!.cwd ?? null, startTime: Date.now(), orphan: true });
      }
      const running = !!slug && servers.has(slug);
      return { code: 0, stdout: args[1] === 'show' ? `LoadState=loaded\nActiveState=${running ? 'active' : 'inactive'}\nSubState=${running ? 'running' : 'dead'}\nMainPID=${running ? 42 : 0}\n` : '', stderr: '' };
    },
  });
  cleanups.push(async () => {
    for (const srv of servers.values()) await new Promise<void>((r) => (srv.close(() => r()), srv.closeAllConnections()));
  });

  const providers = new ProviderRegistry();
  const events: ServerEvent[] = [];
  s.bus.subscribe((e) => events.push(e));
  const start = async () => {
    const live = await startLive({ store: s.store, bus: s.bus, providers, platform });
    await live.ready;
    await live.lostReady;
    return live;
  };
  const web = createApp({ store: s.store, bus: s.bus, providers, webDist: null, services: () => services });
  const req = (p: string, init: RequestInit = {}) => web.request(p, { ...init, headers: { host: 'localhost:4255', 'content-type': 'application/json', ...init.headers } });
  const lost = async () => ((await (await req('/api/lost')).json()) as LostResponse).lost;
  return { ...s, start, req, lost, events, calls, ports: { pViz, pDocs, pGone }, projDir, docsDir, providers };
}

describe('after a reboot', () => {
  test('the notice: computed once, in /api/state, kept across daemon restarts, dismissed', { timeout: 30_000 }, async () => {
    const r = await rebooted();
    let live = await r.start();
    const reboot = r.events.filter((e) => e.type === 'reboot');
    assert.equal(reboot.length, 1);
    assert.deepEqual(reboot[0].type === 'reboot' && reboot[0].lost.sort(), ['docs0000000000001', 'gone0000000000001', 'viz00000000000001']);

    const state = (await (await r.req('/api/state')).json()) as StateResponse;
    assert.equal(state.lost?.bootTime, iso(BOOT_NEW));
    assert.equal(state.lost?.previousBootTime, iso(BOOT_OLD));
    const byId = new Map(state.lost!.items.map((i) => [i.id, i]));
    const viz = byId.get('viz00000000000001')!;
    assert.equal(viz.slug, null);
    assert.equal(viz.suggestedSlug, 'scratch-pad');
    assert.equal(viz.identity.cwd, r.projDir);
    assert.deepEqual(viz.command, ['node', 'dev.js']);
    assert.equal(viz.back, false);
    const docs = byId.get('docs0000000000001')!;
    assert.equal(docs.slug, 'docs');
    assert.equal(docs.label, 'Docs deck');
    assert.equal(docs.managed, true);
    assert.ok(fs.existsSync(path.join(r.home, 'state', 'lost.json')));

    // llms.txt and MCP's get_status list it (read-only)
    const llms = await (await r.req('/llms.txt')).text();
    assert.match(llms, /Lost at the last reboot/);
    assert.match(llms, /viz00000000000001.*scratch-pad/);

    // the daemon restarts within the same boot: the notice is still there, and no new reboot is announced
    await live.stop();
    r.events.length = 0;
    live = await r.start();
    assert.equal(r.events.filter((e) => e.type === 'reboot').length, 0);
    assert.equal((await r.lost())?.items.length, 3);

    // the directory it ran in has gone: refused, plainly, with nothing written
    fs.renameSync(r.projDir, `${r.projDir}-moved`);
    const moved = await r.req('/api/lost/viz00000000000001/restart', { method: 'POST', body: '{}' });
    assert.equal(moved.status, 409);
    assert.match(((await moved.json()) as any).error, /scratch-pad ran in .*, which doesn't exist any more/);
    assert.equal(r.store.apps.has('scratch-pad'), false);
    fs.renameSync(`${r.projDir}-moved`, r.projDir);

    // dismiss one, then all
    let res = await r.req('/api/lost/gone0000000000001/dismiss', { method: 'POST', body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).dismissed, 1);
    assert.equal((await r.lost())?.items.length, 2);
    assert.ok(r.events.some((e) => e.type === 'reboot'));
    assert.equal((await r.req('/api/lost/gone0000000000001/dismiss', { method: 'POST', body: '{}' })).status, 404);
    res = await r.req('/api/lost/dismiss', { method: 'POST', body: '{}' });
    assert.equal(((await res.json()) as any).dismissed, 2);
    assert.equal(await r.lost(), null);
    assert.equal(((await (await r.req('/api/state')).json()) as StateResponse).lost, null);
    assert.equal(fs.existsSync(path.join(r.home, 'state', 'lost.json')), false);
    await live.stop();
  });

  test('restart once and make it a service, through `hallway run`; refusals', { timeout: 30_000 }, async () => {
    const r = await rebooted();
    const live = await r.start();
    cleanups.push(() => live.stop());
    const post = (p: string, body: unknown = {}) => r.req(p, { method: 'POST', body: JSON.stringify(body) });

    // an observed one with no app: registered on its own port with what was recorded, then run once (not persistent)
    let res = await post('/api/lost/viz00000000000001/restart');
    let body = (await res.json()) as LostActionResponse;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true, body.reason ?? '');
    assert.equal(body.slug, 'scratch-pad');
    assert.equal(body.port, r.ports.pViz);
    assert.equal(body.persist, false);
    const c = r.store.apps.get('scratch-pad')!.value!;
    assert.equal(c.port, r.ports.pViz);
    assert.deepEqual(c.service?.command, ['node', 'dev.js']);
    assert.equal(c.service?.runAtLoad, false);
    assert.equal(c.service?.keepAlive, false);
    assert.equal(c.expected, 'adhoc');
    assert.ok(c.project?.dir);
    assert.ok(r.calls.some((x) => /systemctl --user (re)?start hallway-app-scratch-pad\.service/.test(x)), r.calls.join('\n'));
    // it's back (the action rescans), and it's still listed until dismissed
    const viz = body.lost?.items.find((i) => i.id === 'viz00000000000001');
    assert.equal(viz?.back, true);
    assert.equal(viz?.slug, 'scratch-pad');

    // a declared app with a service: block: made a service, so it starts at login and restarts
    res = await post('/api/lost/docs0000000000001/service');
    body = (await res.json()) as LostActionResponse;
    assert.equal(body.ok, true, body.reason ?? '');
    assert.equal(body.persist, true);
    const d = r.store.apps.get('docs')!.value!;
    assert.equal(d.service?.runAtLoad, true);
    assert.equal(d.service?.keepAlive, true);
    assert.deepEqual(d.service?.command, ['node', 'serve.js'], 'the recorded command is kept');
    assert.equal(d.expected, 'running');
    await until('docs is back', async () => !!(await r.lost())?.items.find((i) => i.id === 'docs0000000000001')?.back);

    // no command recorded: refused, nothing written
    res = await post('/api/lost/gone0000000000001/restart');
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as any).error, /no command was recorded/);
    // unknown id, bad slug, bad body, and not JSON (the security middleware)
    assert.equal((await post('/api/lost/nope/restart')).status, 404);
    assert.equal((await r.req('/api/lost/gone0000000000001/restart', { method: 'POST', body: '{nope' })).status, 400);
    assert.equal((await r.req('/api/lost/gone0000000000001/restart', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await post('/api/lost/gone0000000000001/frob')).status, 404);
  });

  test('`hallway lost` without a daemon: lists state/lost.json and dismisses', { timeout: 30_000 }, async () => {
    const r = await rebooted();
    const live = await r.start();
    await live.stop();
    let out = '';
    const ctx = makeCtx({ home: r.home, out: (t) => void (out += t), err: (t) => void (out += t) });
    // no daemon on config.yaml's port in this throwaway home (nothing listening on it is a Hallway)
    await r.store.patchConfig({ port: await freePort() });
    const { COMMANDS } = await import('../server/commands/index.ts');
    assert.equal(await COMMANDS.lost(ctx, [], {}, undefined), 0);
    assert.match(out, /Lost at the last reboot/);
    assert.match(out, /viz00000000000001/);
    assert.match(out, /node dev\.js/);
    assert.match(out, /The daemon isn't running/);
    out = '';
    assert.equal(await COMMANDS.lost(ctx, ['dismiss', String(r.ports.pViz)], {}, undefined), 0);
    assert.match(out, /Dismissed scratch-pad/);
    out = '';
    assert.equal(await COMMANDS.lost(ctx, [], { json: 'true' }, undefined), 0);
    assert.equal(JSON.parse(out).lost.items.length, 2);
    out = '';
    assert.equal(await COMMANDS.lost(ctx, ['dismiss'], { all: 'true' }, undefined), 0);
    assert.match(out, /Dismissed 2 items/);
    await assert.rejects(COMMANDS.lost(ctx, ['dismiss'], {}, undefined), /needs <id\|port>, or --all/);
    await assert.rejects(COMMANDS.lost(ctx, ['restart', 'x'], {}, undefined), /the daemon isn't running/);
  });
});
