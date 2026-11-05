// The `hallway` CLI: argument parsing (server/args.ts), and the real binary run from source via tsx against a
// throwaway data home: --version, --help, usage errors (exit 2), serve and its port errors (exit 1).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { UsageError, check, parseArgs } from '../server/args.ts';
import { exitWatchdog, ROOT, onWindows, tmpDir, rmTmp, stopChild } from './fixture.ts';
import { VERSION, tildify } from '../server/config.ts';

await exitWatchdog();

const HOME = tmpDir('hw-test-cli-');
after(() => rmTmp(HOME));

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
    assert.deepEqual(parseArgs(['guide', '--snippet']), { pos: ['guide'], flags: { snippet: '1' } });
    assert.deepEqual(parseArgs(['lost', 'dismiss', '--all']), { pos: ['lost', 'dismiss'], flags: { all: '1' } });
    // tail's -n, and the data home for one command (D74)
    assert.deepEqual(parseArgs(['service', 'logs', '-n', '20', '-f']), { pos: ['service', 'logs'], flags: { lines: '20', follow: '1' } });
    assert.deepEqual(parseArgs(['--data-dir', '/tmp/x', 'status']), { pos: ['status'], flags: { 'data-dir': '/tmp/x' } });
    assert.throws(() => parseArgs(['logs', 'demo', '-n']), /-n needs a value/);
  });

  test('every option a command accepts is one the parser knows', () => {
    // a command's check() allowing a flag the parser rejects first makes the flag unusable (`lost dismiss --all` was)
    const dir = path.join(ROOT, 'server', 'commands');
    const allowed = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/check\([^,]+,\s*flags,\s*\[([^\]]*)\]/g)) {
        for (const q of m[1].matchAll(/'([^']+)'/g)) allowed.add(q[1]);
      }
    }
    assert.ok(allowed.size > 10, `found only ${allowed.size} options`);
    for (const flag of allowed) {
      const parsed = (() => {
        try {
          return parseArgs([`--${flag}`, 'x']);
        } catch (e) {
          return e as Error;
        }
      })();
      assert.ok(!(parsed instanceof Error), `--${flag} is accepted by a command but the parser says: ${(parsed as Error).message}`);
    }
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
  test('a reader that goes away (`hallway guide | head -1`) ends it quietly, not with a stack trace', async () => {
    const child = spawn(process.execPath, [...CLI, 'guide'], { env: cliEnv({}), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.destroy();
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const code = await new Promise<number | null>((r) => child.on('close', (c) => r(c)));
    assert.equal(stderr, '');
    assert.equal(code, 0);
  });

  test('busy with nothing running: exit 3, and --json says running: false (the CLI contract, D75)', async () => {
    const home = tmpDir('hw-test-cli-busy-');
    try {
      const r = await hallway(['busy'], { HALLWAY_HOME: home });
      assert.equal(r.code, 3);
      assert.equal(r.stdout, "Hallway isn't running.\n");
      const j = await hallway(['busy', '--json'], { HALLWAY_HOME: home });
      assert.equal(j.code, 3);
      assert.deepEqual(JSON.parse(j.stdout), { running: false, busy: false });
      assert.equal((await hallway(['busy', 'extra'], { HALLWAY_HOME: home })).code, 2);
    } finally {
      rmTmp(home);
    }
  });

  test('--version and --help', async () => {
    const v = await hallway(['--version']);
    assert.equal(v.code, 0, v.stderr);
    assert.equal(v.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
    const h = await hallway(['--help']);
    assert.equal(h.code, 0);
    assert.match(h.stdout, /^Usage: hallway \[command\]/);
    assert.match(h.stdout, /--port <n> +the port \(default 4255, or \$PORT, or port: in config.yaml\)/);
    // the development-only overrides are never advertised
    assert.doesNotMatch(h.stdout, /HALLWAY_DEV|--host|--bind/);
  });

  test('--data-dir: the data home for this command, over $HALLWAY_HOME (D74)', async () => {
    const other = tmpDir('hw-test-datadir-');
    try {
      const r = await hallway(['app', 'add', 'elsewhere', '--port', '3999', '--data-dir', other]);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(other, 'apps', 'elsewhere.yaml')));
      assert.equal(fs.existsSync(path.join(HOME, 'apps', 'elsewhere.yaml')), false);
      const ls = await hallway(['--data-dir', other, 'app', 'ls', '--json']);
      assert.ok(JSON.parse(ls.stdout).apps.some((a: { slug: string }) => a.slug === 'elsewhere'), ls.stdout);
      assert.equal((await hallway(['app', 'ls', '--data-dir='])).code, 2);
    } finally {
      rmTmp(other);
    }
  });

  test('service status with nothing installed exits 4, even where the service manager is missing', async () => {
    // a throwaway HOME, so the unit directory is too, and a PATH with node alone: no systemctl or launchctl to find
    const home = tmpDir('hw-test-nosvc-');
    try {
      const bin = path.join(home, 'bin');
      fs.mkdirSync(bin);
      fs.symlinkSync(process.execPath, path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node'));
      const r = await hallway(['service', 'status', '--json'], { HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'local'), PATH: bin, XDG_CONFIG_HOME: '' });
      assert.equal(r.code, 4, r.stderr);
      assert.equal(JSON.parse(r.stdout).installed, false);
      const logs = await hallway(['service', 'logs'], { HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'local'), PATH: bin, XDG_CONFIG_HOME: '' });
      assert.equal(logs.code, 4, logs.stderr);
      assert.match(logs.stderr, /hallway logs daemon/);
    } finally {
      rmTmp(home);
    }
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

  test('a port already in use by something else exits 1 with a friendly message', async () => {
    // it accepts connections and never answers HTTP: serve asks whether it's a Hallway (no), then says so. Reading the
    // sockets lets them close when the CLI exits, so close() below can finish
    const blocker = net.createServer((s) => s.resume());
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as net.AddressInfo).port;
    try {
      const r = await hallway(['serve', '--port', String(port)]);
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, new RegExp(`^hallway: port ${port} is already in use by something that isn't Hallway; pick another with --port <n>`));
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
      const url = out.match(/^Hallway \S+: (http:\/\/localhost:\d+)$/m)?.[1];
      assert.ok(url, out);
      assert.match(out, new RegExp(`^Data home: ${tildify(HOME).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
      const res = await fetch(`${url}/api/health`);
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { ok: boolean }).ok, true);
      // not a terminal: no banner and no colour, but the hint that local domains are off (D63)
      assert.ok(!out.includes('█') && !out.includes('\x1b['), out);
      assert.ok(out.startsWith(`Hallway ${VERSION}: http://localhost:`), out);

      // `hallway busy` finds it through runtime.json (D75): idle, so 0
      const idle = await hallway(['busy']);
      assert.equal(idle.code, 0, idle.stderr);
      assert.equal(idle.stdout, "Hallway isn't busy.\n");
      const doc = await hallway(['busy', '--json']);
      assert.equal(doc.code, 0);
      assert.deepEqual(JSON.parse(doc.stdout), { running: true, busy: false, url: url!.replace('localhost', '127.0.0.1'), version: VERSION, counts: { setup: 0, app: 0 } });
      assert.equal(doc.stderr, "Hallway isn't busy.\n");

      // `npx hallway` with the service already running: say where it is, exit 0 (not EADDRINUSE)
      const again = await hallway(['serve', '--port', url!.split(':').pop()!]);
      assert.equal(again.code, 0, again.stderr);
      assert.match(again.stdout, new RegExp(`^Hallway is already running at ${url!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, version \\d`));
      assert.equal(again.stderr, '');
    } finally {
      await stopChild(child);
    }
  });
  test('serve creates the data home on first run and uses port: from config.yaml', async () => {
    const home = path.join(HOME, 'fresh');
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const free = (probe.address() as net.AddressInfo).port;
    await new Promise((r) => probe.close(r));
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'config.yaml'), `version: 1\nport: ${free}\n`);
    const child = spawn(process.execPath, CLI, { env: cliEnv({ HALLWAY_HOME: home }), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
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
      assert.ok(out.startsWith(`Hallway ${VERSION}: http://localhost:${free}\n`), out);
      for (const d of ['apps', 'bookmarks', 'state', 'cache', 'generated', 'logs', 'backups', '.gitignore', 'ignore.yaml']) assert.ok(fs.existsSync(path.join(home, d)), d);
      assert.equal(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'), `version: 1\nport: ${free}\n`, 'never replaced');
    } finally {
      await stopChild(child);
    }
  });

  // the CLI contract's §8 (D77): a clean stop removes runtime.json and exits 0. Windows has no SIGTERM to send, so the
  // IPC message (what Hallway's supervisor sends) runs on every OS, and the signals everywhere else
  for (const how of ['stop message', 'SIGTERM', 'SIGINT'] as const)
    test(`serve stops cleanly on ${how === 'stop message' ? 'the IPC message "stop"' : how}: exit 0, runtime.json removed`, { skip: how === 'stop message' ? false : onWindows('no POSIX signals to send'), timeout: 30_000 }, async () => {
      const home = path.join(HOME, `stop-${how.replace(/\W/g, '')}`);
      fs.mkdirSync(home);
      const child = spawn(process.execPath, [...CLI, '--port', '0'], { env: cliEnv({ HALLWAY_HOME: home }), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      try {
        let err = '';
        child.stderr!.on('data', (d) => (err += d));
        await new Promise<void>((resolve, reject) => {
          let buf = '';
          const timer = setTimeout(() => reject(new Error(`no startup line: ${buf}`)), 15000);
          child.stdout!.on('data', (d) => {
            buf += d;
            if (/Data home: /.test(buf)) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.on('exit', (code) => reject(new Error(`exited ${code}: ${buf}`)));
        });
        const runtime = path.join(home, 'runtime.json');
        for (let i = 0; i < 50 && !fs.existsSync(runtime); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(fs.existsSync(runtime), 'runtime.json written once it listens');
        const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
        if (how === 'stop message') child.send('stop');
        else child.kill(how);
        const code = await Promise.race([exited, new Promise<'hung'>((r) => setTimeout(() => r('hung'), 15000).unref())]);
        assert.equal(code, 0, `exit ${code}; stderr: ${err}`);
        assert.ok(!fs.existsSync(runtime), 'runtime.json removed');
        assert.match(err, new RegExp(`hallway: stopped \\(${how}\\)`));
      } finally {
        await stopChild(child);
      }
    });

  test('guide prints AGENT-GUIDE.md with the reference; --snippet just the paragraph', async () => {
    const g = await hallway(['guide']);
    assert.equal(g.code, 0, g.stderr);
    assert.match(g.stdout, /^# Hallway: a guide for coding agents/);
    assert.match(g.stdout, /\| `port` \| number 1–65535 \| \*\*required\*\* \|/);
    assert.ok(g.stdout.includes(tildify(HOME)), 'names the data home');
    const s = await hallway(['guide', '--snippet']);
    assert.equal(s.code, 0, s.stderr);
    assert.match(s.stdout, /^Never start a long-running dev or preview server directly/);
    assert.equal((await hallway(['guide', 'extra'])).code, 2);
    assert.equal((await hallway(['serve', '--snippet'])).code, 2);
  });
});
