// The Windows scanner for real (D59), as whoever runs it: starts a listener in a directory of its own, then asks the
// built win32 platform for listeners and process details, and prints one JSON verdict line. CI runs it twice: as the
// runner's administrator, and as a fresh standard user through a scheduled task (scripts/scanner-real-win.ps1), which
// is the case that matters: reading another process's working directory without administrator rights.
// Needs only dist/server/platform (no dependencies): node scripts/scanner-real-win.mjs [<dist dir>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'dist'));
const { win32 } = await import(pathToFileURL(path.join(dist, 'server', 'platform', 'win32.js')).href);
const { mergeListeners } = await import(pathToFileURL(path.join(dist, 'server', 'platform', 'listeners.js')).href);

const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(process.env.HW_WORK ?? os.tmpdir(), 'hw-scan-')));
const child = spawn(process.execPath, ['-e', "require('http').createServer((q, s) => s.end('hi')).listen(0, '127.0.0.1', function () { console.log(this.address().port) })"], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((r) => child.stdout.once('data', (d) => r(Number(String(d).trim()))));
const verdict = { user: os.userInfo().username, port, pid: child.pid, dir };
try {
  let t = Date.now();
  const listeners = mergeListeners(await win32.listListeners());
  verdict.listMs = Date.now() - t;
  const ours = listeners.find((l) => l.port === port);
  verdict.listed = ours ?? null;
  // ours, plus every other listener's process: those belong to SYSTEM, services or the administrator, and must come
  // back without a working directory rather than fail
  const others = [...new Set(listeners.map((l) => l.pid).filter((p) => p && p !== child.pid))];
  t = Date.now();
  const info = await win32.processInfo([child.pid, ...others]);
  verdict.infoMs = Date.now() - t;
  verdict.info = info.get(child.pid) ?? null;
  verdict.others = { asked: others.length, described: others.filter((p) => info.has(p)).length, withCwd: others.filter((p) => info.get(p)?.cwd).length };
  verdict.ok = !!ours && ours.process === 'node' && verdict.info?.cwd === dir && /node/i.test(verdict.info?.command ?? '') && verdict.info?.orphan === false;
} catch (e) {
  verdict.error = String(e?.stack ?? e);
} finally {
  child.kill();
}
console.log(JSON.stringify(verdict));
process.exitCode = verdict.ok ? 0 : 1;
