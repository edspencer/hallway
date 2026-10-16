// `npm run smoke:pack`: check the npm package as a user gets it. Packs it (prepack builds it), installs the tarball
// globally into a temp prefix, then runs the installed `hallway` from a temp directory with a throwaway HOME and
// HALLWAY_HOME: --version, --help, a usage error, `guide`, and the daemon (on a free port: the startup line, the data
// home it creates, /api/health, /api/state, /llms.txt, the dashboard's index.html and one of its assets, the favicon,
// the Host check). Cleans up after itself. Linux and macOS.
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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
  for (const f of ['package.json', 'LICENSE', 'README.md', 'AGENT-GUIDE.md', 'dist/server/cli.js', 'dist/web/index.html', 'dist/web/favicon.svg'])
    assert.ok(files.includes(f), `the package includes ${f}`);
  for (const f of files) assert.ok(!/^(src|server|test|scripts|website|docs)\//.test(f), `the package shouldn't include ${f}`);

  step(`installing ${path.basename(tarball)} into ${prefix}`);
  execFileSync('npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball], { stdio: ['ignore', 'ignore', 'inherit'] });

  const installed = path.join(prefix, 'lib', 'node_modules', 'hallway');
  const deps = fs.readdirSync(path.join(installed, 'node_modules'));
  for (const dev of ['react', 'react-dom', 'vite', 'tsx', 'typescript', '@changesets'])
    assert.ok(!deps.includes(dev), `${dev} is a build-time dependency; it shouldn't be installed`);

  step('--version, --help, usage errors');
  assert.equal(run('--version').trim(), pkg.version);
  assert.match(run('--help'), /^Usage: hallway \[serve\]/);
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

  step('ok');
} finally {
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
