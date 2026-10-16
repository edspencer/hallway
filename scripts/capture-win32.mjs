// Prints the raw output of what server/platform/win32.ts runs, for the fixtures in test/fixtures/platform/win32-*
// (D59). Starts a listener of its own in a temp directory first, so there is a known process to describe. Windows only;
// run from a checkout after `npm run build`: node scripts/capture-win32.mjs
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { processScript } = await import('../dist/server/platform/win32.js');
const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hw-capture-')));
const child = spawn(process.execPath, ['-e', "require('http').createServer((q, s) => s.end('hi')).listen(0, '127.0.0.1', function () { console.log(this.address().port) })"], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((r) => child.stdout.once('data', (d) => r(Number(String(d).trim()))));
const show = (title, text) => console.log(`===== ${title}\n${text}\n===== end`);
try {
  show('listener', JSON.stringify({ pid: child.pid, port, dir }));
  for (const [title, cmd, args] of [
    ['netstat -ano -p TCP', 'netstat', ['-ano', '-p', 'TCP']],
    ['netstat -ano -p TCPv6', 'netstat', ['-ano', '-p', 'TCPv6']],
    ['tasklist /FO CSV /NH', 'tasklist', ['/FO', 'CSV', '/NH']],
    ['netsh int ipv4 show dynamicport tcp', 'netsh', ['int', 'ipv4', 'show', 'dynamicport', 'tcp']],
  ])
    show(title, execFileSync(cmd, args, { encoding: 'utf8' }));
  const t = Date.now();
  const script = processScript([child.pid, process.pid, 4]);
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8' });
  show(`processScript (${Date.now() - t} ms)`, out);
} finally {
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
