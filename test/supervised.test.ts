// Supervised vs orphaned, and naming a listener whose directory says nothing (D62): `launchctl list` and
// /proc/<pid>/cgroup against fixtures, the known non-project directories, and a whole scan of the three shapes that
// were misreported: a LaunchAgent in its own project directory, a `brew services` job started in the Homebrew prefix
// (a git repository on branch `stable`), and a job started in `/` that answers HTTP on every interface.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { darwinProcesses, parseLaunchctlList } from '../server/platform/darwin.ts';
import { parseCgroupService } from '../server/platform/linux.ts';
import { type Platform, type RawListener, currentPlatform } from '../server/platform/index.ts';
import { identify, nonProjectDir } from '../server/scanner/identify.ts';
import { fallbackName, supervisorName } from '../server/scanner/observations.ts';
import { suggestSlug } from '../server/scanner/claim.ts';
import { createScanner } from '../server/scanner/index.ts';
import { toIdentity } from '../server/live.ts';
import { ROOT, exitWatchdog, onWindows, tmpDir } from './fixture.ts';

exitWatchdog();

const fixture = (name: string) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'platform', name), 'utf8');
const POSIX = { skip: onWindows('POSIX working directories (/, /opt/homebrew)') };

describe('macOS: launchd jobs', () => {
  test('`launchctl list` → PID → label, skipping jobs that are not running', () => {
    assert.deepEqual(
      [...parseLaunchctlList(fixture('launchctl-list.txt'))],
      [
        [1201, 'com.example.api'],
        [3302, 'homebrew.mxcl.llm-server'],
        [512, 'application.com.example.Editor.1234567.1234570'],
      ],
    );
    assert.equal(parseLaunchctlList('').size, 0);
  });

  test('PPID 1 is orphaned only when the PID is not a loaded job', () => {
    const m = darwinProcesses([1201, 1388, 2210, 9999], fixture('ps.txt'), fixture('lsof-cwd.txt'), fixture('launchctl-list.txt'));
    assert.equal(m.get(1201)!.orphan, false, 'a LaunchAgent is PPID 1 by design');
    assert.deepEqual(m.get(1201)!.supervisor, { manager: 'launchd', label: 'com.example.api' });
    assert.equal(m.get(2210)!.orphan, true, 'PPID 1 and no job: a true orphan');
    assert.equal(m.get(2210)!.supervisor, null);
    assert.equal(m.get(1388)!.orphan, false, 'its parent is alive');
    assert.equal(m.has(9999), false);
    // no launchctl output (it failed, or nothing had PPID 1 so it wasn't run): PPID 1 is all there is to go on
    assert.equal(darwinProcesses([1201], fixture('ps.txt'), '', '').get(1201)!.orphan, true);
  });
});

describe('Linux: systemd services by cgroup', () => {
  test('the innermost unit counts, and only a .service', () => {
    assert.equal(parseCgroupService('0::/user.slice/user-1000.slice/user@1000.service/app.slice/api.service\n'), 'api.service');
    assert.equal(parseCgroupService('0::/system.slice/nginx.service\n'), 'nginx.service');
    assert.equal(parseCgroupService('0::/system.slice/hallway-app-web.service\n'), 'hallway-app-web.service');
    // a terminal: a login session, or an app scope under the user manager
    assert.equal(parseCgroupService('0::/user.slice/user-1000.slice/session-3.scope\n'), null);
    assert.equal(parseCgroupService('0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-org.example.Terminal-1234.scope\n'), null);
    assert.equal(parseCgroupService('0::/user.slice/user-1000.slice/user@1000.service/init.scope\n'), null);
    assert.equal(parseCgroupService('0::/user.slice/user-1000.slice/user@1000.service\n'), null);
    assert.equal(parseCgroupService('0::/system.slice/docker-0123abcd.scope\n'), null);
    assert.equal(parseCgroupService('0::/\n'), null);
    // cgroup v1: systemd's own hierarchy
    assert.equal(parseCgroupService('12:pids:/system.slice/api.service\n1:name=systemd:/system.slice/api.service\n'), 'api.service');
    assert.equal(parseCgroupService('1:name=systemd:/user.slice/user-1000.slice/session-2.scope\n'), null);
    assert.equal(parseCgroupService(''), null);
  });
});

describe('directories that say nothing about what runs in them', () => {
  test('/, ~, prefixes and system directories; not projects below the plain ones', POSIX, () => {
    const home = '/home/someone';
    for (const d of ['/', home, '/opt/homebrew', '/opt/homebrew/var/llm', '/usr/local', '/usr/local/Homebrew', '/home/linuxbrew/.linuxbrew', '/usr/lib/x', '/Library/Something', `${home}/Library/Application Support/x`, '/tmp', '/var'])
      assert.equal(nonProjectDir(d, home), true, d);
    for (const d of [`${home}/Code/my-app`, '/usr/local/src/my-app', '/tmp/demo', '/var/www/site', '/srv/app', '/opt/my-app'])
      assert.equal(nonProjectDir(d, home), false, d);
  });

  test('Windows system directories', () => {
    assert.equal(nonProjectDir('C:\\Windows\\System32', 'C:\\Users\\someone'), true);
    assert.equal(nonProjectDir('C:\\Program Files (x86)\\Example', 'C:\\Users\\someone'), true);
  });

  test('a git repository in a prefix is not a project, nor is anything under it', POSIX, async () => {
    // stands in for /opt/homebrew: a git repository on branch `stable`, passed as the home directory so it's excluded
    const prefix = tmpDir('hw-prefix-');
    fs.mkdirSync(path.join(prefix, '.git'));
    fs.mkdirSync(path.join(prefix, 'var'));
    assert.deepEqual(await identify(prefix, ['llm-server', 'serve'], prefix), { project: null, git: null });
    assert.deepEqual(await identify('/opt/homebrew', ['llm-server', 'serve'], '/nowhere'), { project: null, git: null });
    assert.deepEqual(await identify('/', ['node', 'server.js'], '/nowhere'), { project: null, git: null });
  });

  test('names from the supervisor, else the executable, never a bare runtime', () => {
    assert.equal(supervisorName('homebrew.mxcl.llm-server'), 'llm-server');
    assert.equal(supervisorName('com.example.api'), 'api');
    assert.equal(supervisorName('application.com.example.Editor.1234567.1234570'), 'Editor');
    assert.equal(supervisorName('api.service'), 'api');
    assert.equal(supervisorName('standalone'), 'standalone');
    assert.equal(fallbackName({ supervisor: { manager: 'launchd', label: 'com.example.powd' }, argv: ['node', 'x.js'], process: 'node' }), 'powd');
    assert.equal(fallbackName({ supervisor: null, argv: ['/opt/homebrew/bin/llm-server', 'serve'], process: 'llm-server' }), 'llm-server');
    assert.equal(fallbackName({ supervisor: null, argv: ['C:\\Tools\\llm-server.exe'], process: 'llm-server.exe' }), 'llm-server');
    assert.equal(fallbackName({ supervisor: null, argv: ['/usr/bin/node', 'server.js'], process: 'node' }), null);
    assert.equal(fallbackName({ supervisor: null, argv: ['python3.12', '-m', 'http.server'], process: 'python3.12' }), null);
    assert.equal(fallbackName({ supervisor: null, argv: null, process: null }), null);
  });
});

function listen(server: net.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) })),
  );
}

describe('a scan of the three misreported shapes (macOS output)', () => {
  test('supervised, not orphaned; named by supervisor or executable; exposed explained by its address', POSIX, async () => {
    const home = tmpDir('hw-sup-home-');
    // a LaunchAgent running from its own project directory under ~
    const svcDir = path.join(home, '.example', 'service');
    fs.mkdirSync(svcDir, { recursive: true });
    fs.writeFileSync(path.join(svcDir, 'package.json'), JSON.stringify({ name: 'service', description: 'A background service' }));
    const plain = path.join(home, 'Code', 'scratch');
    fs.mkdirSync(plain, { recursive: true });

    const page = (title: string) => http.createServer((_q, res) => (res.setHeader('content-type', 'text/html'), res.end(`<title>${title}</title>`)));
    const [svc, llm, installed, orphan] = await Promise.all([
      listen(page('Service')),
      listen(net.createServer((s) => s.resume())),
      listen(page('Example is installed')),
      listen(page('Scratch')),
    ]);
    const raw: RawListener[] = [
      { pid: 7233, process: 'node', port: svc.port, address: '127.0.0.1' },
      { pid: 3302, process: 'llm-server', port: llm.port, address: '127.0.0.1' },
      { pid: 2055, process: 'node', port: installed.port, address: '*' },
      { pid: 4410, process: 'python3', port: orphan.port, address: '127.0.0.1' },
    ];
    const ps = [
      ' 7233     1 Thu Oct  2 09:14:07 2026     node dist/index.js',
      ' 3302     1 Thu Oct  2 09:14:07 2026     /opt/homebrew/opt/llm-server/bin/llm-server serve',
      ' 2055     1 Thu Oct  2 09:14:07 2026     /usr/local/bin/node /Users/someone/Library/Application/powd.js',
      ' 4410     1 Thu Oct  2 09:14:07 2026     python3 -m http.server',
    ].join('\n');
    const cwd = `p7233\nfcwd\nn${svcDir}\np3302\nfcwd\nn/opt/homebrew\np2055\nfcwd\nn/\np4410\nfcwd\nn${plain}\n`;
    const launchctl = 'PID\tStatus\tLabel\n7233\t0\tcom.example.service\n3302\t0\thomebrew.mxcl.llm-server\n2055\t0\tcom.example.powd\n';
    const platform = {
      ...currentPlatform(),
      listListeners: async () => raw,
      processInfo: async (pids: number[]) => darwinProcesses(pids, ps, cwd, launchctl),
      bootTime: async () => null,
    } satisfies Platform;
    const scanner = createScanner({
      home: path.join(home, 'data'),
      platform,
      homeDir: home,
      settings: () => ({ enabled: true, intervalSeconds: 120, includeEphemeralPorts: true, minPort: 1024 }),
      sniffTimeoutMs: 500,
    });
    try {
      const r = await scanner.scan();
      const all = [...r.listeners, ...r.other];
      const by = (port: number) => all.find((o) => o.port === port)!;

      const s = by(svc.port);
      // its project is called `service`, which says nothing: the page's title names it (D73)
      assert.equal(s.label, 'Service');
      assert.equal(s.orphan, false);
      assert.deepEqual(toIdentity(s).supervisor, { manager: 'launchd', label: 'com.example.service' });
      assert.equal(toIdentity(s).displayName, null, 'it has a project');

      const l = by(llm.port);
      assert.equal(l.kind, 'other');
      assert.equal(l.project, null);
      assert.equal(l.git, null, 'the prefix is a git repository, but not this server');
      assert.equal(l.label, 'llm-server');
      assert.equal(l.orphan, false);
      assert.equal(toIdentity(l).displayName, 'llm-server');
      assert.equal(suggestSlug(l), 'llm-server');

      const i = by(installed.port);
      assert.equal(i.project, null);
      assert.equal(i.label, 'powd');
      assert.equal(i.http?.title, 'Example is installed');
      assert.equal(i.orphan, false);
      assert.equal(toIdentity(i).exposed, true);
      assert.equal(toIdentity(i).bindAddress, '*');
      assert.deepEqual(toIdentity(i).supervisor, { manager: 'launchd', label: 'com.example.powd' });

      const o = by(orphan.port);
      assert.equal(o.orphan, true, 'PPID 1 and no job: still an orphan');
      assert.equal(o.supervisor, null);
      assert.equal(o.label, 'scratch');
    } finally {
      scanner.stop();
      await Promise.all([svc, llm, installed, orphan].map((x) => x.close()));
    }
  });
});
