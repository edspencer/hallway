// server/platform/: the listener, process and boot-time parsers for both platforms, against hand-written fixtures in
// test/fixtures/platform/ (in the documented formats; the macOS ones have not been captured on a real Mac yet: see
// docs/11-research-notes.md). Nothing here touches the machine, so both platforms are checked on every OS.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseLsofCwd, parseLsofListeners, parsePs, parseSysctlBoottime } from '../server/platform/darwin.ts';
import {
  decodeProcAddress,
  isOrphan,
  parseBtime,
  parseCmdline,
  parseProcNetTcp,
  parseProcStat,
  parseSs,
} from '../server/platform/linux.ts';
import { bindScope, connectAddress, mergeListeners, splitHostPort } from '../server/platform/listeners.ts';
import { ROOT } from './fixture.ts';

const fixture = (name: string) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'platform', name), 'utf8');

describe('macOS (lsof, ps, sysctl)', () => {
  test('lsof -F pcLn: every listening socket with its PID and command', () => {
    const raw = parseLsofListeners(fixture('lsof-listen.txt'));
    assert.deepEqual(raw.slice(0, 5), [
      { pid: 412, process: 'ControlCenter', port: 7000, address: '*' },
      { pid: 412, process: 'ControlCenter', port: 5000, address: '*' },
      { pid: 412, process: 'ControlCenter', port: 7000, address: '::' },
      { pid: 1201, process: 'node', port: 4666, address: '127.0.0.1' },
      { pid: 1201, process: 'node', port: 4666, address: '::1' },
    ]);
    assert.ok(raw.some((r) => r.process === 'Code Helper (Plugin)' && r.port === 52144), 'names with spaces survive');
    assert.equal(raw.length, 11);
  });

  test('IPv4 and IPv6 sockets of one PID and port merge into one listener', () => {
    const merged = mergeListeners(parseLsofListeners(fixture('lsof-listen.txt')));
    const dash = merged.find((l) => l.port === 4666)!;
    assert.deepEqual(dash, { pid: 1201, process: 'node', port: 4666, addresses: ['127.0.0.1', '::1'] });
    assert.deepEqual(merged.find((l) => l.port === 7000)!.addresses, ['*', '::']);
    assert.deepEqual(
      merged.map((l) => l.port),
      [4567, 4666, 4670, 4671, 5000, 5432, 7000, 52144],
    );
  });

  test('lsof -d cwd -Fn: PID → working directory', () => {
    const cwds = parseLsofCwd(fixture('lsof-cwd.txt'));
    assert.equal(cwds.get(1201), '/Users/someone/Code/my-dashboard');
    assert.equal(cwds.get(1388), '/Users/someone/Code/my-dashboard-feature');
    assert.equal(cwds.size, 3);
  });

  test('ps -o pid=,ppid=,lstart=,command=: parent, local start time, full command', () => {
    const ps = parsePs(fixture('ps.txt'));
    assert.equal(ps.get(1201)!.ppid, 1);
    assert.equal(ps.get(1201)!.command, 'node dist/index.js');
    assert.equal(ps.get(1201)!.startTime, new Date(2026, 9, 2, 9, 14, 7).getTime()); // lstart is local time
    assert.equal(ps.get(1388)!.ppid, 1100);
    assert.match(ps.get(1388)!.command, /astro dev --port 4670 --host$/);
    assert.match(ps.get(2210)!.command, /-m http\.server 4567$/);
  });

  test('sysctl kern.boottime', () => {
    assert.equal(parseSysctlBoottime(fixture('sysctl-boottime.txt')), 1760000000250);
    assert.equal(parseSysctlBoottime('nonsense'), null);
  });
});

describe('Linux (ss, /proc)', () => {
  test('ss -ltnpH: listeners with owners; unowned sockets have no PID; shared sockets list each process', () => {
    const raw = parseSs(fixture('ss-ltnpH.txt'));
    assert.deepEqual(raw[0], { pid: 2210, process: 'python3', port: 4567, address: '0.0.0.0' });
    assert.deepEqual(raw.find((r) => r.port === 53), { pid: null, process: null, port: 53, address: '127.0.0.53' });
    assert.deepEqual(raw.find((r) => r.port === 4670)?.address, '*');
    const gunicorn = raw.filter((r) => r.port === 8080);
    assert.deepEqual(gunicorn.map((g) => [g.pid, g.address]), [[900, '127.0.0.1'], [901, '127.0.0.1']]);
    assert.deepEqual(mergeListeners(raw).find((l) => l.port === 4666)?.addresses, ['127.0.0.1', '::1']);
  });

  test('/proc/net/tcp: only LISTEN rows, hex addresses decoded', () => {
    assert.deepEqual(parseProcNetTcp(fixture('proc-net-tcp.txt')), [
      { address: '127.0.0.1', port: 4674, inode: 41001 },
      { address: '0.0.0.0', port: 4567, inode: 41002 },
      { address: '127.0.0.53', port: 53, inode: 1200 },
    ]);
  });

  test('/proc/net/tcp6: ::1, ::, IPv4-mapped and a global address', () => {
    assert.deepEqual(
      parseProcNetTcp(fixture('proc-net-tcp6.txt')).map((r) => [r.address, r.port]),
      [['::1', 4674], ['::', 22], ['127.0.0.1', 8080], ['2001:db8::1', 8081]],
    );
    assert.equal(decodeProcAddress('nonsense'), null);
  });

  test('/proc/<pid>/stat: ppid and start ticks, even with spaces and parentheses in the name', () => {
    assert.deepEqual(parseProcStat(fixture('proc-pid-stat.txt')), { comm: 'node', ppid: 1100, startTicks: 123456 });
    assert.deepEqual(parseProcStat(fixture('proc-pid-stat-parens.txt')), { comm: 'Web Content (x)', ppid: 1, startTicks: 98765 });
    assert.equal(parseProcStat(''), null);
  });

  test('/proc/stat btime and /proc/<pid>/cmdline', () => {
    assert.equal(parseBtime(fixture('proc-stat.txt')), 1760000000000);
    assert.equal(parseBtime('cpu 1 2 3'), null);
    assert.deepEqual(parseCmdline('python3\0-m\0http.server\x004567\0'), ['python3', '-m', 'http.server', '4567']);
    assert.deepEqual(parseCmdline('node\0my file.js\0'), ['node', 'my file.js']);
  });

  test('orphans: adopted by PID 1 or by a systemd --user subreaper', () => {
    assert.equal(isOrphan(1, null), true);
    assert.equal(isOrphan(1234, 'systemd'), true);
    assert.equal(isOrphan(1234, 'bash'), false);
    assert.equal(isOrphan(1234, 'PM2 v6.0.0: God'), false);
  });
});

describe('addresses', () => {
  test('host:port splitting', () => {
    assert.deepEqual(splitHostPort('127.0.0.1:4666'), { address: '127.0.0.1', port: 4666 });
    assert.deepEqual(splitHostPort('[::1]:4666'), { address: '::1', port: 4666 });
    assert.deepEqual(splitHostPort('*:4666'), { address: '*', port: 4666 });
    assert.deepEqual(splitHostPort('[fe80::1%en0]:80'), { address: 'fe80::1', port: 80 });
    assert.deepEqual(splitHostPort('[::ffff:127.0.0.1]:80'), { address: '127.0.0.1', port: 80 });
    assert.equal(splitHostPort('127.0.0.1:*'), null);
    assert.equal(splitHostPort('*:0'), null);
  });

  test('bind scope and where to connect', () => {
    assert.equal(bindScope(['127.0.0.1', '::1']), 'loopback');
    assert.equal(bindScope(['*']), 'all');
    assert.equal(bindScope(['::', '127.0.0.1']), 'all');
    assert.equal(bindScope(['192.168.1.20']), 'address');
    assert.equal(connectAddress(['*']), '127.0.0.1');
    assert.equal(connectAddress(['::1']), '::1');
    assert.equal(connectAddress(['127.0.0.1', '::1']), '127.0.0.1');
    assert.equal(connectAddress(['192.168.1.20']), '192.168.1.20');
  });
});
