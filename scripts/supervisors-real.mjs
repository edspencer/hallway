// `node scripts/supervisors-real.mjs`: supervised vs orphaned against the machine's REAL service manager (D62). It
// starts one listener as a real job (a LaunchAgent in launchd's gui/<uid> domain on macOS, a transient systemd user
// service on Linux) and one as a true orphan (its parent shell exits), then runs `hallway scan --json` and checks that
// the job is reported as supervised (`launchd: <label>` / `systemd: <unit>`), not orphaned, and the orphan as orphaned.
// CI only, like services-real.mjs: it loads a job into the real service manager, so it refuses to run unless CI=true
// and HALLWAY_REAL_SERVICES=1. It removes everything it starts. Windows has nothing to check yet (D62): it says so.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CI !== 'true' || process.env.HALLWAY_REAL_SERVICES !== '1') {
  console.error('supervisors-real: refusing to run outside CI (set CI=true and HALLWAY_REAL_SERVICES=1 on a throwaway machine)');
  process.exit(2);
}
if (process.platform === 'win32') {
  console.log('supervisors-real: skipped on Windows (no service-manager lookup there; a process whose parent is alive is not orphaned)');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'server', 'cli.js');
assert.ok(fs.existsSync(cli), 'build first (npm run build)');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hw-sup-')));
const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const server = path.join(work, 'server.cjs');
fs.writeFileSync(server, "require('node:http').createServer((q, r) => r.end('<title>ok</title>')).listen(Number(process.argv[2]), '127.0.0.1');\n");
const env = { ...process.env, HALLWAY_HOME: path.join(tmp, 'data') };
for (const k of ['PORT', 'HALLWAY_DEV', 'HALLWAY_DEV_BIND', 'HALLWAY_DEV_ALLOWED_HOSTS', 'NODE_OPTIONS']) delete env[k];
const step = (s) => console.log(`supervisors-real: ${s}`);
// every call has a timeout: a hang here would otherwise hold the job until GitHub cancels it
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isFree = (port) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});
// below every OS's ephemeral range, which the scanner hides by default
async function freePort(not) {
  for (;;) {
    const p = 20000 + Math.floor(Math.random() * 9000);
    if (p !== not && (await isFree(p))) return p;
  }
}
const listening = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1').once('connect', () => (s.destroy(), resolve(true))).once('error', () => resolve(false));
  s.setTimeout(2000, () => (s.destroy(), resolve(false)));
});
async function until(what, fn, ms = 20000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

const supPort = await freePort();
const orphanPort = await freePort(supPort);
const node = process.execPath;
const uid = process.getuid();
const label = process.platform === 'darwin' ? 'com.example.hallway-supervised' : 'hallway-supervised-check.service';
const cleanups = [];

try {
  if (process.platform === 'darwin') {
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${server}</string><string>${supPort}</string></array>
  <key>WorkingDirectory</key><string>${work}</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
`);
    cleanups.push(() => (sh('launchctl', ['bootout', `gui/${uid}/${label}`]), fs.rmSync(plist, { force: true })));
    sh('launchctl', ['bootstrap', `gui/${uid}`, plist]);
    step(`loaded the LaunchAgent ${label} on :${supPort}`);
    // a true orphan: the shell that starts it exits, and launchd (PID 1) adopts it. Only node is backgrounded: with
    // `cd … && node … &`, macOS's sh backgrounds the whole list as a subshell that stays alive as node's parent
    step('starting the orphan');
    execFileSync('/bin/sh', ['-c', `cd "${work}" || exit 1; "${node}" "${server}" ${orphanPort} </dev/null >/dev/null 2>&1 &`], { stdio: 'ignore', timeout: 30_000 });
  } else {
    sh('systemd-run', ['--user', `--unit=${label}`, `--working-directory=${work}`, node, server, String(supPort)]);
    cleanups.push(() => sh('systemctl', ['--user', 'stop', label]));
    step(`started the transient user service ${label} on :${supPort}`);
    // a true orphan, as a terminal makes one: in a scope (not a service), its shell exits, the user manager adopts it
    sh('systemd-run', ['--user', '--scope', '--unit=hallway-orphan-check', '/bin/sh', '-c', `cd "${work}" || exit 1; "${node}" "${server}" ${orphanPort} </dev/null >/dev/null 2>&1 &`]);
  }
  step('waiting for both to listen');
  await until(`:${supPort}`, () => listening(supPort));
  await until(`:${orphanPort}`, () => listening(orphanPort));
  step(`the orphan is on :${orphanPort}`);

  step('hallway scan --json');
  const { observed } = JSON.parse(execFileSync(node, [cli, 'scan', '--json'], { cwd: work, env, encoding: 'utf8', timeout: 60_000 }));
  const at = (port) => observed.find((o) => o.port === port);
  const sup = at(supPort);
  const orphan = at(orphanPort);
  console.log(JSON.stringify({ supervised: sup?.identity, orphan: orphan?.identity }, null, 2));
  assert.ok(sup, `the scan found :${supPort}`);
  assert.ok(orphan, `the scan found :${orphanPort}`);
  const manager = process.platform === 'darwin' ? 'launchd' : 'systemd';
  assert.deepEqual(sup.identity.supervisor, { manager, label }, `:${supPort} is supervised by ${manager}: ${label}`);
  assert.equal(sup.identity.orphaned, false, 'a supervised job is not orphaned');
  assert.equal(orphan.identity.supervisor, null, 'nothing supervises the orphan');
  assert.equal(orphan.identity.orphaned, true, 'the orphan is orphaned');
  const text = execFileSync(node, [cli, 'scan'], { cwd: work, env, encoding: 'utf8', timeout: 60_000 });
  assert.match(text, new RegExp(`${manager}: ${label.replace(/\./g, '\\.')}`), '`hallway scan` shows the supervisor');
  step(`ok: ${manager}: ${label} is supervised, the orphan is orphaned`);
} finally {
  for (const c of cleanups.reverse()) {
    try {
      c();
    } catch {
      /* already gone */
    }
  }
  // the orphan: nothing else will stop it
  try {
    const pid = execFileSync('lsof', ['-t', `-iTCP:${orphanPort}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 10_000 }).trim();
    for (const p of pid.split(/\s+/).filter(Boolean)) process.kill(Number(p));
  } catch {
    /* gone, or no lsof: the runner is thrown away anyway */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
