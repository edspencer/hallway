// The `hallway` CLI: argument parsing (server/args.ts), and the real binary run from source via tsx against a
// throwaway data home: --version, --help, usage errors (exit 2), serve and its port errors (exit 1).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { UsageError, check, parseArgs } from '../server/args.ts';
import { ROOT, tmpDir } from './fixture.ts';

const HOME = tmpDir('hw-test-cli-');
after(() => fs.rmSync(HOME, { recursive: true, force: true }));

function cliEnv(env: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env };
  for (const k of ['PORT', 'HALLWAY_DEV', 'HALLWAY_DEV_BIND', 'HALLWAY_DEV_ALLOWED_HOSTS']) delete e[k];
  return Object.assign(e, { HALLWAY_HOME: HOME }, env);
}
const CLI = ['--import', 'tsx', path.join(ROOT, 'server/cli.ts')];

const hallway = (args: string[], env: Record<string, string> = {}) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
    execFile(process.execPath, [...CLI, ...args], { env: cliEnv(env), cwd: ROOT, timeout: 20000 }, (err, stdout, stderr) =>
      res({ code: err ? Number((err as any).code ?? 1) : 0, stdout, stderr }),
    );
  });

describe('parseArgs', () => {
  test('positionals, boolean flags and value flags in both spellings', () => {
    assert.deepEqual(parseArgs([]), { pos: [], flags: {} });
    assert.deepEqual(parseArgs(['serve', '--port', '5050', '-q']), { pos: ['serve'], flags: { port: '5050', quiet: '1' } });
    assert.deepEqual(parseArgs(['--port=0', '--quiet']), { pos: [], flags: { port: '0', quiet: '1' } });
    assert.deepEqual(parseArgs(['-h']), { pos: [], flags: { help: '1' } });
    assert.deepEqual(parseArgs(['-v']), { pos: [], flags: { version: '1' } });
  });

  test('unknown options and missing values are usage errors', () => {
    assert.throws(() => parseArgs(['--frob']), (e) => e instanceof UsageError && /unknown option --frob/.test(e.message));
    assert.throws(() => parseArgs(['-x']), /unknown option -x/);
    assert.throws(() => parseArgs(['--port']), /--port needs a value/);
  });

  test('check() limits options and arguments per command', () => {
    assert.doesNotThrow(() => check('serve', { port: '1' }, ['port', 'quiet'], [], 0));
    assert.throws(() => check('serve', { frob: '1' }, ['port'], [], 0), /serve doesn't take --frob/);
    assert.throws(() => check('serve', {}, [], ['extra'], 0), /unexpected argument 'extra'/);
  });
});

describe('hallway CLI', () => {
  test('--version and --help', async () => {
    const v = await hallway(['--version']);
    assert.equal(v.code, 0, v.stderr);
    assert.equal(v.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
    const h = await hallway(['--help']);
    assert.equal(h.code, 0);
    assert.match(h.stdout, /^Usage: hallway \[serve\]/);
    assert.match(h.stdout, /--port <n> +the port \(default 4255, or \$PORT\)/);
    // the development-only overrides are never advertised
    assert.doesNotMatch(h.stdout, /HALLWAY_DEV|--host|--bind/);
  });

  test('usage errors exit 2 with the usage', async () => {
    for (const [args, msg] of [
      [['frobnicate'], /unknown command 'frobnicate'/],
      [['--frob'], /unknown option --frob/],
      [['serve', 'extra'], /unexpected argument 'extra'/],
      [['--port', 'nope'], /--port must be a port number/],
      [['--port', '70000'], /--port must be a port number/],
    ] as const) {
      const r = await hallway([...args]);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, msg);
      assert.match(r.stderr, /Usage: hallway/);
    }
    const env = await hallway([], { PORT: 'abc' });
    assert.equal(env.code, 2);
    assert.match(env.stderr, /PORT must be a port number/);
  });

  test('a port already in use exits 1 with a friendly message', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as net.AddressInfo).port;
    try {
      const r = await hallway(['serve', '--port', String(port)]);
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, new RegExp(`^hallway: port ${port} is already in use; pick another with --port <n>`));
      assert.doesNotMatch(r.stderr, /Usage:/);
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  test('serve prints the URL and the data home, and answers /api/health', async () => {
    const child = spawn(process.execPath, [...CLI, '--port', '0'], { env: cliEnv({}), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const out = await new Promise<string>((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error(`no startup line: ${buf}`)), 15000);
        child.stdout.on('data', (d) => {
          buf += d;
          if (/Data home: /.test(buf)) {
            clearTimeout(timer);
            resolve(buf);
          }
        });
        child.on('exit', (code) => reject(new Error(`exited ${code}: ${buf}`)));
      });
      const url = out.match(/^Hallway on (http:\/\/localhost:\d+)$/m)?.[1];
      assert.ok(url, out);
      assert.match(out, new RegExp(`^Data home: ${HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
      const res = await fetch(`${url}/api/health`);
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { ok: boolean }).ok, true);
    } finally {
      child.kill();
    }
  });
});
