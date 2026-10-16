// The managed-service routes (v1): GET /api/apps/:slug/logs and POST /api/apps/:slug/service/:action, with the
// service manager's runner mocked (nothing is started).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/index.ts';
import { platformFor } from '../server/platform/index.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { Services } from '../server/services/index.ts';
import { onWindows, tmpDir, tmpStore } from './fixture.ts';

const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((c) => c()));

async function setup() {
  const s = await tmpStore();
  cleanups.push(s.cleanup);
  const userHome = tmpDir('hw-test-api-user-');
  cleanups.push(() => fs.rmSync(userHome, { recursive: true, force: true }));
  const calls: string[] = [];
  const services = new Services({
    store: s.store,
    platform: platformFor('linux'),
    env: { PATH: process.env.PATH },
    userHome,
    run: async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { code: 0, stdout: args[1] === 'show' ? 'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=42\n' : '', stderr: '' };
    },
  });
  const app = createApp({ store: s.store, bus: s.bus, providers: new ProviderRegistry(), webDist: null, services: () => services });
  const req = (p: string, init: RequestInit = {}) => app.request(p, { ...init, headers: { host: 'localhost:4255', ...(init.method === 'POST' ? { 'content-type': 'application/json' } : {}) } });
  await s.store.createApp('demo', { port: 5100, expected: 'adhoc', service: { command: ['sh', '-c', 'true'], cwd: s.home, runAtLoad: false, keepAlive: false } });
  await s.store.createApp('plain', { port: 5101 });
  return { ...s, calls, req, app };
}

describe('service routes', () => {
  test('logs: both files, tailed', async () => {
    const { req, home } = await setup();
    fs.writeFileSync(path.join(home, 'logs', 'demo.out.log'), 'one\ntwo\nthree\n');
    const r = await req('/api/apps/demo/logs?lines=2');
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    assert.equal(body.out.text, 'two\nthree\n');
    assert.equal(body.err.text, '');
    assert.equal((await req('/api/apps/nope/logs')).status, 404);
    assert.equal((await req('/api/apps/demo/logs?lines=x')).status, 400);
  });

  test('start / stop / restart a managed app, updating expected', { skip: onWindows("a POSIX machine: a ':'-separated PATH, exec bits and #! lines (the Windows equivalent is in schtasks.test.ts)") }, async () => {
    const { req, calls, store } = await setup();
    let r = await req('/api/apps/demo/service/stop', { method: 'POST', body: '{}' });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(store.apps.get('demo')!.value!.expected, 'stopped');
    assert.ok(calls.includes('systemctl --user stop hallway-app-demo.service'));
    r = await req('/api/apps/demo/service/start', { method: 'POST', body: '{}' });
    assert.equal(r.status, 200);
    assert.equal(store.apps.get('demo')!.value!.expected, 'adhoc');
    const body = (await r.json()) as any;
    assert.equal(body.service.running, true);
    r = await req('/api/apps/demo/service/restart', { method: 'POST', body: '{}' });
    assert.equal(r.status, 200);
    assert.ok(calls.includes('systemctl --user restart hallway-app-demo.service'));
  });

  test('refusals: unmanaged (409), unknown app or action (404), cross-origin (403), not JSON (415)', async () => {
    const { req, app } = await setup();
    const plain = await req('/api/apps/plain/service/start', { method: 'POST', body: '{}' });
    assert.equal(plain.status, 409);
    assert.match(((await plain.json()) as any).error, /isn't a managed service/);
    assert.equal((await req('/api/apps/nope/service/start', { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await req('/api/apps/demo/service/frob', { method: 'POST', body: '{}' })).status, 404);
    const cross = await app.request('/api/apps/demo/service/stop', { method: 'POST', body: '{}', headers: { host: 'localhost:4255', origin: 'https://evil.example', 'content-type': 'application/json' } });
    assert.equal(cross.status, 403);
    const form = await app.request('/api/apps/demo/service/stop', { method: 'POST', body: 'x', headers: { host: 'localhost:4255', 'content-type': 'text/plain' } });
    assert.equal(form.status, 415);
  });
});
