// The CLI's file and discovery commands, run as the real binary (from source) against a throwaway data home and with
// no daemon: app add|ls|rm, bookmark add|ls|rm, scan → claim → ignore against a real listener, status, doctor. Both
// OSes (the scanner uses lsof on macOS and ss or /proc on Linux).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { exitWatchdog, ROOT, tmpDir, rmTmp, stopChild } from './fixture.ts';

await exitWatchdog();

const ROOTDIR = tmpDir('hw-test-cmds-');
const HOME = path.join(ROOTDIR, 'home');
const DATA = path.join(ROOTDIR, 'data');
fs.mkdirSync(HOME);

function env(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['PORT', 'HALLWAY_DEV', 'HALLWAY_DEV_BIND', 'HALLWAY_DEV_ALLOWED_HOSTS', 'XDG_CONFIG_HOME', 'NODE_ENV']) delete e[k];
  return { ...e, HOME, HALLWAY_HOME: DATA };
}
const hallway = (args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
    execFile(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/cli.ts'), ...args], { env: env(), cwd: ROOT, timeout: 60000 }, (err, stdout, stderr) =>
      res({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });

const free = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer().once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

after(() => rmTmp(ROOTDIR));

describe('hallway app and bookmark commands', () => {
  test('app add (with an assigned port), app ls --json, refusals, app rm', async () => {
    const a = await hallway(['app', 'add', 'notes', '--name', 'Notes', '--expected', 'adhoc', '--health', '/health']);
    assert.equal(a.code, 0, a.stderr);
    const port = Number(/on port (\d+)/.exec(a.stdout)![1]);
    assert.ok(port >= 5100 && port <= 5999);
    assert.match(fs.readFileSync(path.join(DATA, 'apps', 'notes.yaml'), 'utf8'), /health:\n  path: \/health/);
    assert.equal((await hallway(['app', 'add', 'notes'])).code, 1, 'exists');
    assert.equal((await hallway(['app', 'add', 'x', '--expected', 'sometimes'])).code, 2);
    assert.equal((await hallway(['app', 'add', 'x', '--health', 'health'])).code, 2);
    const ls = JSON.parse((await hallway(['app', 'ls', '--json'])).stdout);
    assert.deepEqual(ls.apps.map((x: { slug: string; config: { port: number } }) => [x.slug, x.config.port]), [['notes', port]]);
    const rm = await hallway(['app', 'rm', 'notes']);
    assert.equal(rm.code, 0, rm.stderr);
    assert.match(rm.stdout.replaceAll('\\', '/'), /moved to .*backups\/removed\//);
    assert.equal(fs.existsSync(path.join(DATA, 'apps', 'notes.yaml')), false);
  });

  test('bookmark add keeps the file\'s comments; ls numbers from 1; rm by number and by URL', async () => {
    fs.mkdirSync(path.join(DATA, 'bookmarks'), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'bookmarks', 'prod.yaml'), '# my production links\ntitle: Production\nlinks: []\n');
    assert.equal((await hallway(['bookmark', 'add', 'prod', 'https://admin.example.com', '--title', 'Admin'])).code, 0);
    assert.equal((await hallway(['bookmark', 'add', 'prod', 'https://status.example.com'])).code, 0);
    assert.equal((await hallway(['bookmark', 'add', 'prod', 'not a url'])).code, 1);
    const text = fs.readFileSync(path.join(DATA, 'bookmarks', 'prod.yaml'), 'utf8');
    assert.match(text, /^# my production links/);
    assert.match(text, /links:\n  - url: https:\/\/admin\.example\.com\n    title: Admin\n  - url: https:\/\/status\.example\.com\n/);
    const ls = await hallway(['bookmark', 'ls']);
    assert.match(ls.stdout, /prod +1 +Admin +https:\/\/admin\.example\.com/);
    assert.match(ls.stdout, / +2 +status\.example\.com +https:\/\/status\.example\.com/);
    assert.equal((await hallway(['bookmark', 'rm', 'prod', '1'])).code, 0);
    assert.equal((await hallway(['bookmark', 'rm', 'prod', 'https://nope.example.com'])).code, 1);
    assert.equal((await hallway(['bookmark', 'rm', 'prod', 'https://status.example.com'])).code, 0);
    const json = JSON.parse((await hallway(['bookmark', 'ls', '--json'])).stdout);
    assert.deepEqual(json.groups[0].config.links, []);
    assert.equal((await hallway(['bookmark', 'rm', 'prod', '0'])).code, 2, 'numbers start at 1');
  });
});

describe('scan, claim, ignore and status without a daemon', () => {
  let server: ChildProcess;
  let port = 0;
  const dir = path.join(ROOTDIR, 'scratch-site');

  before(async () => {
    fs.mkdirSync(dir, { recursive: true });
    for (let p = 4600 + Math.floor(Math.random() * 300); !port; p++) if (await free(p)) port = p;
    server = spawn(process.execPath, ['-e', `require('http').createServer((q, s) => s.end('<title>Scratch</title>')).listen(${port}, '127.0.0.1')`], { cwd: dir, stdio: 'ignore' });
    for (let i = 0; i < 50 && (await free(port)); i++) await new Promise((r) => setTimeout(r, 100));
  });
  after(() => stopChild(server));

  test('scan --json finds the listener, labelled with its directory', async () => {
    const r = await hallway(['scan', '--json']);
    assert.equal(r.code, 0, r.stderr);
    const o = JSON.parse(r.stdout).observed.find((x: { port: number }) => x.port === port);
    assert.ok(o, `port ${port} in ${r.stdout.slice(0, 2000)}`);
    assert.equal(fs.realpathSync(o.identity.cwd), fs.realpathSync(dir));
  });

  test('claim <port> writes the app with that port; status probes it; ignore <port> needs no scan', async () => {
    const c = await hallway(['claim', String(port), '--slug', 'scratch', '--json']);
    assert.equal(c.code, 0, c.stderr);
    assert.equal(JSON.parse(c.stdout).config.port, port);
    const y = fs.readFileSync(path.join(DATA, 'apps', 'scratch.yaml'), 'utf8');
    assert.match(y, new RegExp(`^port: ${port}$`, 'm'));
    assert.match(y, /^expected: adhoc$/m);
    const s = JSON.parse((await hallway(['status', 'scratch', '--json'])).stdout);
    assert.equal(s.health.state, 'healthy');
    assert.equal((await hallway(['claim', String(port)])).code, 1, 'claimed listeners are no longer observed');
    const i = await hallway(['ignore', '4999']);
    assert.equal(i.code, 0, i.stderr);
    assert.match(fs.readFileSync(path.join(DATA, 'ignore.yaml'), 'utf8'), /ports: \[ 4999 \]/);
    assert.equal((await hallway(['ignore', '4999', '--by', 'colour'])).code, 2);
  });

  test('doctor --json: the data home and files pass; it exits 0 with only warnings', async () => {
    const r = await hallway(['doctor', '--json']);
    const d = JSON.parse(r.stdout);
    const by = (id: string) => d.checks.find((c: { id: string }) => c.id === id);
    assert.equal(by('data-home').status, 'pass');
    assert.equal(by('networking').status, 'skip');
    assert.equal(r.code, d.ok ? 0 : 1);
  });
});
