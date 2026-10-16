// `npm run smoke:pack`: check the npm package as a user gets it. Packs it (prepack builds it), installs the tarball
// globally into a temp prefix, then runs the installed `hallway` from a temp directory with a throwaway HOME and
// HALLWAY_HOME: --version, --help, a usage error, `guide`, and the daemon (on a free port: the startup line, the data
// home it creates, /api/health, /api/state, /llms.txt, the dashboard's index.html and one of its assets, the favicon,
// the Host check). On Linux it also installs the daemon as a service and starts an app with `hallway run`, against a
// stand-in `systemctl` that really runs the units (test/fixtures/fake-systemctl; there is no systemd user instance
// to rely on in CI or a container). Cleans up after itself. Linux and macOS.
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hw-smoke-')));
const prefix = path.join(tmp, 'prefix');
const home = path.join(tmp, 'home');
const data = path.join(tmp, 'data');
const work = path.join(tmp, 'work'); // run from somewhere unrelated, so nothing depends on the cwd
for (const d of [prefix, home, data, work]) fs.mkdirSync(d);

const step = (s) => console.log(`smoke:pack: ${s}`);
const fake = path.join(root, 'test', 'fixtures', 'fake-systemctl');
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
let server;

// the installed bin, run as a user would: a fresh HOME and data home, none of this checkout's environment
const env = { ...process.env, HOME: home, HALLWAY_HOME: data };
for (const k of ['PORT', 'HALLWAY_DEV', 'HALLWAY_DEV_BIND', 'HALLWAY_DEV_ALLOWED_HOSTS', 'NODE_OPTIONS']) delete env[k];
const bin = path.join(prefix, 'bin', 'hallway');
const run = (...args) => execFileSync(bin, args, { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function fails(args, status, pattern) {
  try {
    run(...args);
  } catch (e) {
    assert.equal(e.status, status, `hallway ${args.join(' ')}: exit ${e.status}`);
    assert.match(e.stderr, pattern);
    return;
  }
  assert.fail(`hallway ${args.join(' ')} should have failed`);
}

async function get(base, p, type) {
  const res = await fetch(base + p);
  assert.equal(res.status, 200, `GET ${p}: ${res.status} ${await res.clone().text()}`);
  assert.match(res.headers.get('content-type') ?? '', type, `GET ${p}: content-type`);
  return res;
}

/** A GET with a chosen Host header (fetch can't set one). */
const statusWithHost = (url, host) =>
  new Promise((resolve, reject) => {
    http.get(url, { headers: { host } }, (res) => (res.resume(), resolve(res.statusCode))).on('error', reject);
  });

try {
  step('npm pack');
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  // prepack's build output comes first; the JSON starts at a line that is just "["
  const packed = JSON.parse(out.slice(out.search(/^\[$/m))).at(-1);
  const tarball = path.join(tmp, packed.filename);
  const files = packed.files.map((f) => f.path);
  for (const f of ['package.json', 'LICENSE', 'README.md', 'AGENT-GUIDE.md', 'dist/server/cli.js', 'dist/web/index.html', 'dist/web/favicon.svg', 'assets/fonts/Inter-Medium.ttf', 'assets/fonts/OFL-inter.txt'])
    assert.ok(files.includes(f), `the package includes ${f}`);
  for (const f of files) assert.ok(!/^(src|server|test|scripts|website|docs)\//.test(f), `the package shouldn't include ${f}`);

  step(`installing ${path.basename(tarball)} into ${prefix}`);
  execFileSync('npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball], { stdio: ['ignore', 'ignore', 'inherit'] });

  const installed = path.join(prefix, 'lib', 'node_modules', 'hallway');
  const deps = fs.readdirSync(path.join(installed, 'node_modules'));
  for (const dev of ['react', 'react-dom', 'vite', 'tsx', 'typescript', '@changesets'])
    assert.ok(!deps.includes(dev), `${dev} is a build-time dependency; it shouldn't be installed`);
  // v2 criterion 3: screenshots are opt-in (`hallway thumbs enable`, D56); a base install has no browser at all
  for (const browser of ['playwright', 'playwright-core', 'puppeteer', 'puppeteer-core'])
    assert.ok(!fs.existsSync(path.join(installed, 'node_modules', browser)), `${browser} shouldn't be installed`);
  const browserDirs = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => /(^|\/)(ms-playwright|chromium[^/]*|headless_shell)$/.test(String(f)));
  assert.deepEqual(browserDirs(prefix), [], 'no browser was downloaded into the install');

  step('--version, --help, usage errors');
  assert.equal(run('--version').trim(), pkg.version);
  assert.match(run('--help'), /^Usage: hallway \[command\]/);
  fails(['frobnicate'], 2, /unknown command 'frobnicate'/);
  fails(['--port', 'nope'], 2, /--port must be a port number/);

  step('guide');
  assert.match(run('guide'), /^# Hallway: a guide for coding agents[\s\S]*\| `port` \| number 1–65535 \| \*\*required\*\* \|/);
  assert.match(run('guide', '--snippet'), /^Never start a long-running dev or preview server directly/);

  step('serve');
  server = spawn(bin, ['--port', '0'], { cwd: work, env, stdio: ['ignore', 'pipe', 'inherit'] });
  let printed = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server didn't start: ${printed}`)), 30000);
    server.stdout.on('data', (d) => {
      printed += d;
      const m = printed.match(/^Hallway on (http:\/\/localhost:\d+)\nData home: .*\n/m);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    server.on('exit', (code) => reject(new Error(`the server exited (${code}): ${printed}`)));
  });
  step(`serving on ${base}`);
  assert.ok(printed.includes(`Data home: ${data}`), `the data home: ${printed}`);

  assert.deepEqual(await (await get(base, '/api/health', /json/)).json(), { ok: true, version: pkg.version });
  for (const f of ['config.yaml', 'ignore.yaml', '.gitignore', 'apps', 'bookmarks', 'state', 'backups']) assert.ok(fs.existsSync(path.join(data, f)), `the data home has ${f}`);
  fs.writeFileSync(path.join(data, 'apps', 'smoke.yaml'), 'name: Smoke\nport: 4567\n');
  // the watcher picks the file up (debounced)
  let state;
  for (let i = 0; i < 40 && !state?.apps.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    state = await (await get(base, '/api/state', /json/)).json();
  }
  assert.deepEqual(state.apps.map((a) => [a.slug, a.url]), [['smoke', 'http://localhost:4567']], 'a hand-written app file shows up');
  const llms = await (await get(base, '/llms.txt', /^text\/plain/)).text();
  assert.ok(llms.includes(`Data home: \`${data}\``) && llms.includes('`smoke`: Smoke, port 4567'), `llms.txt has live data: ${llms}`);
  const html = await (await get(base, '/', /html/)).text();
  assert.equal(html, fs.readFileSync(path.join(installed, 'dist', 'web', 'index.html'), 'utf8'));
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, 'index.html loads a script from /assets/');
  await get(base, asset, /javascript/);
  await get(base, '/favicon.svg', /^image\/svg\+xml/);
  await get(base, '/some/client/route', /html/);
  assert.equal(await statusWithHost(`${base}/api/health`, 'evil.example'), 403, 'a foreign Host is refused');

  server.kill();

  if (process.platform === 'linux') {
    step('services: hallway service install, hallway run (stand-in systemctl)');
    const svcEnv = { ...env, PATH: `${fake}:${env.PATH}`, FAKE_RESTART_SEC: '0.2' };
    delete svcEnv.XDG_CONFIG_HOME;
    const svc = (...args) => execFileSync(bin, args, { cwd: work, env: svcEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await freePort();
    fs.appendFileSync(path.join(data, 'config.yaml'), `port: ${port}\n`);
    assert.match(svc('service', 'install'), new RegExp(`It's running: http://localhost:${port}`));
    const unit = fs.readFileSync(path.join(home, '.config', 'systemd', 'user', 'hallway-daemon.service'), 'utf8');
    assert.ok(unit.includes(`${path.join(installed, 'dist', 'server', 'cli.js')} serve --quiet`), `the unit runs the installed CLI:\n${unit}`);
    assert.deepEqual(await (await get(`http://localhost:${port}`, '/api/health', /json/)).json(), { ok: true, version: pkg.version });
    assert.match(svc('service', 'status'), /Running: +yes/);
    fs.writeFileSync(path.join(work, 'server.js'), "require('http').createServer((q, s) => s.end('hi')).listen(Number(process.env.PORT), process.env.HOST)");
    const up = svc('run', 'smoke-run', '--', 'node', 'server.js');
    const url = up.match(/smoke-run is up: (http:\/\/localhost:\d+)/)?.[1];
    assert.ok(url, up);
    assert.equal(await (await fetch(url)).text(), 'hi');
    svc('service', 'rm', 'smoke-run');
    svc('service', 'uninstall');
    await assert.rejects(fetch(`http://localhost:${port}/api/health`), 'the daemon is gone after uninstall');
  }

  step('ok');
} finally {
  server?.kill();
  // anything the stand-in systemctl started and a failure left behind
  const state = path.join(home, '.fake-systemd');
  for (const f of fs.existsSync(state) ? fs.readdirSync(state) : [])
    if (/\.(pid|supervisor)$/.test(f))
      try {
        process.kill(Number(fs.readFileSync(path.join(state, f), 'utf8')), 'SIGKILL');
      } catch {
        /* already gone */
      }
  fs.rmSync(tmp, { recursive: true, force: true });
}
