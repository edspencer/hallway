// server/platform/win32.ts (D58, D59): the parsers over netstat, tasklist, netsh and the PowerShell script's JSON, and
// the command-line splitter. Pure functions over captured output (test/fixtures/platform/win32-*), run on every OS.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mergeListeners } from '../server/platform/listeners.ts';
import { parseDynamicPorts, parseNetstat, parseProcessJson, parseTasklist, processScript, splitCommandLine } from '../server/platform/win32.ts';
import { ROOT } from './fixture.ts';

const fixture = (name: string) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'platform', name), 'utf8');

describe('netstat -ano', () => {
  test('listening TCP sockets by their foreign address, whatever the state is called', () => {
    const text = [
      '',
      'Active Connections',
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012',
      '  TCP    127.0.0.1:4255         0.0.0.0:0              ABHÖREN         5520',
      '  TCP    127.0.0.1:4255         127.0.0.1:50123        ESTABLISHED     5520',
      '  TCP    10.1.0.4:50123         20.1.2.3:443           TIME_WAIT       0',
      '  TCP    [::]:5173              [::]:0                 LISTENING       7788',
      '  TCP    [::1]:4255             [::]:0                 LISTENING       5520',
      '  TCP    [fe80::1%7]:8080       [::]:0                 LISTENING       91',
      '  UDP    0.0.0.0:5353           *:*                                    2200',
      '',
    ].join('\r\n');
    assert.deepEqual(parseNetstat(text), [
      { pid: 1012, process: null, address: '0.0.0.0', port: 135 },
      { pid: 5520, process: null, address: '127.0.0.1', port: 4255 },
      { pid: 7788, process: null, address: '::', port: 5173 },
      { pid: 5520, process: null, address: '::1', port: 4255 },
      { pid: 91, process: null, address: 'fe80::1', port: 8080 },
    ]);
    assert.deepEqual(
      mergeListeners(parseNetstat(text)).find((l) => l.port === 4255),
      { pid: 5520, process: null, port: 4255, addresses: ['127.0.0.1', '::1'] },
    );
  });
});

describe('tasklist /FO CSV /NH', () => {
  test('PID → the short name, by column', () => {
    const names = parseTasklist('"System Idle Process","0","Services","0","8 K"\r\n"System","4","Services","0","1.234 K"\r\n"node.exe","5520","Console","1","45,000 K"\r\n"my ""odd"" app.EXE","9","Console","1","1 K"\r\n');
    assert.equal(names.get(5520), 'node');
    assert.equal(names.get(4), 'System');
    assert.equal(names.get(9), 'my "odd" app');
  });
});

describe('netsh int ipv4 show dynamicport tcp', () => {
  test('start and count, read positionally (the labels are localised)', () => {
    assert.deepEqual(parseDynamicPorts('\r\nProtocol tcp Dynamic Port Range\r\n---------------------------------\r\nStart Port      : 49152\r\nNumber of Ports : 16384\r\n'), { from: 49152, to: 65535 });
    assert.deepEqual(parseDynamicPorts('Startport       : 10000\nAnzahl Ports    : 1000\n'), { from: 10000, to: 10999 });
    assert.equal(parseDynamicPorts(''), null);
    assert.equal(parseDynamicPorts('Start Port : 60000\nNumber of Ports : 16384\n'), null);
  });
});

describe('Windows command lines', () => {
  test('the C runtime rules: quotes, escaped quotes, backslashes only special before a quote', () => {
    assert.deepEqual(splitCommandLine('"C:\\Program Files\\nodejs\\node.exe" server.js --port 5173'), ['C:\\Program Files\\nodejs\\node.exe', 'server.js', '--port', '5173']);
    assert.deepEqual(splitCommandLine('node.exe  "a b"  c\\d  "e\\"f"  g\\\\"h i"  j\\\\\\"k'), ['node.exe', 'a b', 'c\\d', 'e"f', 'g\\h i', 'j\\"k']);
    assert.deepEqual(splitCommandLine('C:\\tools\\x.exe "C:\\dir with space\\\\" next'), ['C:\\tools\\x.exe', 'C:\\dir with space\\', 'next']);
    assert.deepEqual(splitCommandLine('python -c "print(""hi"")"'), ['python', '-c', 'print("hi")']);
    assert.deepEqual(splitCommandLine('   '), []);
  });
});

describe("the PowerShell script's JSON", () => {
  test('command line split, cwd without its trailing backslash, start time, orphan when the parent is gone', () => {
    const json = JSON.stringify([
      { pid: 5520, ppid: 4000, name: 'node.exe', exe: 'C:\\Program Files\\nodejs\\node.exe', commandLine: '"C:\\Program Files\\nodejs\\node.exe" server.js', created: 1760000000000, cwd: 'C:\\Code\\my-app\\', parentAlive: true },
      { pid: 77, ppid: 12, name: 'python.exe', exe: 'C:\\Python\\python.exe', commandLine: null, created: null, cwd: null, parentAlive: false },
      { pid: 78, ppid: 12, name: 'x.exe', exe: null, commandLine: null, created: null, cwd: 'D:\\', parentAlive: true },
    ]);
    const m = parseProcessJson(`\uFEFF${json}\r\n`);
    assert.deepEqual(m.get(5520), {
      pid: 5520,
      ppid: 4000,
      command: '"C:\\Program Files\\nodejs\\node.exe" server.js',
      argv: ['C:\\Program Files\\nodejs\\node.exe', 'server.js'],
      cwd: 'C:\\Code\\my-app',
      startTime: 1760000000000,
      orphan: false,
    });
    // another user's process without administrator rights: no command line, no cwd; the executable path stands in
    assert.deepEqual(m.get(77), { pid: 77, ppid: 12, command: 'C:\\Python\\python.exe', argv: ['C:\\Python\\python.exe'], cwd: null, startTime: null, orphan: true });
    assert.equal(m.get(78)?.cwd, 'D:\\');
  });

  test('one object rather than an array, nothing, or junk', () => {
    assert.equal(parseProcessJson(JSON.stringify({ pid: 1, ppid: 0, cwd: 'C:\\x', parentAlive: true })).get(1)?.cwd, 'C:\\x');
    assert.equal(parseProcessJson('').size, 0);
    assert.equal(parseProcessJson('Add-Type : error').size, 0);
  });

  test('the script only ever contains integer PIDs', () => {
    const s = processScript([12, 3.7, 4]);
    assert.ok(s.includes('@(12,3,4)'));
  });
});

describe('captured on a GitHub Windows runner (scripts/capture-win32.mjs, 2026-10-16)', () => {
  const known = JSON.parse(fixture('win32-listener.json')) as { pid: number; port: number; dir: string };

  test('netstat: every LISTENING row and nothing else; the known listener, named by tasklist', () => {
    const tcp = fixture('win32-netstat-tcp.txt');
    const tcp6 = fixture('win32-netstat-tcpv6.txt');
    const raw = parseNetstat(`${tcp}\n${tcp6}`);
    assert.equal(raw.length, (`${tcp}\n${tcp6}`.match(/LISTENING/g) ?? []).length);
    const names = parseTasklist(fixture('win32-tasklist.csv'));
    assert.equal(names.get(known.pid), 'node');
    assert.equal(names.get(4), 'System');
    const ours = mergeListeners(raw).find((l) => l.port === known.port);
    assert.deepEqual(ours, { pid: known.pid, process: null, port: known.port, addresses: ['127.0.0.1'] });
    // WinRM's HTTP listener belongs to the kernel (HTTP.sys): PID 4
    assert.ok(raw.some((l) => l.port === 5985 && l.pid === 4));
  });

  test('netsh: the default dynamic range', () => {
    assert.deepEqual(parseDynamicPorts(fixture('win32-netsh-dynamicport.txt')), { from: 49152, to: 65535 });
  });

  test("the PowerShell script: the listener's cwd (from its PEB), command line, parent; System has neither", () => {
    const m = parseProcessJson(fixture('win32-processes.json'));
    const p = m.get(known.pid)!;
    assert.equal(p.cwd, known.dir);
    assert.match(p.argv![0], /node\.exe$/);
    assert.equal(p.argv![1], '-e');
    assert.match(p.argv![2], /^require\('http'\)/);
    assert.equal(p.orphan, false);
    assert.ok(p.startTime! > Date.UTC(2026, 0, 1));
    assert.equal(m.get(p.ppid!)?.cwd, 'D:\\a\\hallway\\hallway');
    assert.deepEqual(m.get(4), { pid: 4, ppid: 0, command: null, argv: null, cwd: null, startTime: m.get(4)!.startTime, orphan: false });
  });
});
