// server/scanner/: noise filtering, ignore.yaml, identification (temp git repositories and worktrees), observation
// ids and labels, the observed and boot records, the HTTP sniff, claim drafts, and whole scans: over a fake platform,
// and once over the real one with a real server.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { ObservedListener } from '../shared/api.ts';
import { claimDraft, slugify, suggestSlug } from '../server/scanner/claim.ts';
import { type FilterOptions, EMPTY_IGNORE, noiseReason } from '../server/scanner/filter.ts';
import { gitInfo, guessFramework, identify, projectName, projectRoot, readmeTitle, repoName } from '../server/scanner/identify.ts';
import { parseIgnoreYaml } from '../server/scanner/ignore.ts';
import { ObservedStore, labelListeners, normaliseCommand, observationId, recordBoot } from '../server/scanner/observations.ts';
import { htmlFavicon, htmlTitle, sniff } from '../server/scanner/sniff.ts';
import { createScanner } from '../server/scanner/index.ts';
import { type Platform, type ProcessInfo, type RawListener, currentPlatform } from '../server/platform/index.ts';
import { tmpDir } from './fixture.ts';

const TMP = tmpDir('hw-test-scan-');
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'pipe' }).toString().trim();

/** ~/Code/my-dashboard with two linked worktrees, as in the motivating incident. */
const REPO = path.join(TMP, 'Code', 'my-dashboard');
const WT_A = path.join(TMP, 'Code', 'my-dashboard-a');
const WT_B = path.join(TMP, 'Code', 'my-dashboard-b');
before(() => {
  fs.mkdirSync(path.join(REPO, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(REPO, 'package.json'),
    JSON.stringify({ name: '@acme/my-dashboard', description: 'A dashboard', devDependencies: { astro: '^5' } }),
  );
  fs.writeFileSync(path.join(REPO, 'src', 'index.ts'), '');
  git(REPO, 'init', '-q', '-b', 'main');
  git(REPO, 'add', '-A');
  git(REPO, 'commit', '-qm', 'init');
  git(REPO, 'remote', 'add', 'origin', 'https://example.com/acme/my-dashboard.git');
  git(REPO, 'worktree', 'add', '-q', WT_A, '-b', 'branch-a');
  git(REPO, 'worktree', 'add', '-q', WT_B, '-b', 'branch-b');
});

const opts = (o: Partial<FilterOptions> = {}): FilterOptions => ({
  minPort: 1024,
  includeEphemeralPorts: false,
  ignore: EMPTY_IGNORE,
  selfPid: 999,
  selfPorts: [4255],
  ...o,
});
const L = (port: number, process: string | null = 'node', pid: number | null = 100) => ({ pid, process, port, addresses: ['127.0.0.1'] });

describe('noise filtering', () => {
  test('low ports, the ephemeral range, invisible owners, known daemons, Hallway itself and Caddy', () => {
    assert.equal(noiseReason(L(4567), opts()), null);
    assert.equal(noiseReason(L(631), opts()), 'low-port');
    assert.equal(noiseReason(L(52144), opts()), 'ephemeral');
    assert.equal(noiseReason(L(52144), opts({ includeEphemeralPorts: true })), null);
    assert.equal(noiseReason(L(49151), opts()), null);
    assert.equal(noiseReason(L(5432, 'postgres'), opts()), 'daemon');
    assert.equal(noiseReason(L(6000, 'com.docker.backend'), opts()), 'daemon');
    assert.equal(noiseReason(L(7000, 'ControlCenter'), opts()), 'daemon');
    assert.equal(noiseReason(L(4255), opts()), 'self');
    assert.equal(noiseReason(L(5555, 'node', 999), opts()), 'self');
    assert.equal(noiseReason(L(443, 'caddy'), opts({ minPort: 1 })), 'self');
    assert.equal(noiseReason(L(8080, null, null), opts()), 'invisible');
  });

  test('ignore.yaml: ports, process names (with a trailing *) and directories', () => {
    const ignore = { ports: [4567], processes: ['ruby*'], dirs: ['/home/someone/scratch'] };
    assert.equal(noiseReason(L(4567), opts({ ignore })), 'ignored');
    assert.equal(noiseReason(L(4600, 'ruby3.3'), opts({ ignore })), 'ignored');
    assert.equal(noiseReason(L(4600), opts({ ignore }), '/home/someone/scratch/x'), 'ignored');
    assert.equal(noiseReason(L(4600), opts({ ignore }), '/home/someone/scratch'), 'ignored');
    assert.equal(noiseReason(L(4600), opts({ ignore }), '/home/someone/scratchpad'), null);
  });

  test('parsing ignore.yaml: flow and block lists, comments, quotes, ~', () => {
    const rules = parseIgnoreYaml(
      ['# hide these', 'ports: [631, "5000", nope]   # AirPlay', 'processes:', '  - rapportd', "  - 'Control Center' # quoted", 'dirs:', '  - ~/scratch', 'other: [1]'].join('\n'),
      '/home/someone',
    );
    assert.deepEqual(rules, { ports: [631, 5000], processes: ['rapportd', 'Control Center'], dirs: ['/home/someone/scratch'] });
    assert.deepEqual(parseIgnoreYaml(''), EMPTY_IGNORE);
  });
});

describe('identification', () => {
  test('the project root is the nearest marker above the cwd, never ~ or /', () => {
    assert.equal(projectRoot(path.join(REPO, 'src'), '/nowhere'), REPO);
    assert.equal(projectRoot(REPO, REPO), null, 'the home directory itself is not a project');
    fs.mkdirSync(path.join(TMP, 'bare'), { recursive: true });
    assert.equal(projectRoot(path.join(TMP, 'bare'), TMP), null);
  });

  test('names from package.json, pyproject, go.mod, a README heading, else the directory', () => {
    assert.deepEqual(projectName(REPO), { name: '@acme/my-dashboard', description: 'A dashboard' });
    const py = path.join(TMP, 'py');
    fs.mkdirSync(py);
    fs.writeFileSync(path.join(py, 'pyproject.toml'), '[project]\nname = "slides"\ndescription = "Talk slides"\n');
    assert.deepEqual(projectName(py), { name: 'slides', description: 'Talk slides' });
    const go = path.join(TMP, 'go');
    fs.mkdirSync(go);
    fs.writeFileSync(path.join(go, 'go.mod'), 'module example.com/tools/status-page\n\ngo 1.23\n');
    assert.equal(projectName(go).name, 'status-page');
    const docs = path.join(TMP, 'docs-site');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'README.md'), 'Intro\n\n# The *Docs* Site\n');
    assert.equal(projectName(docs).name, 'The Docs Site');
    const plain = path.join(TMP, 'plain');
    fs.mkdirSync(plain);
    assert.equal(projectName(plain).name, 'plain');
    assert.equal(readmeTitle('no heading'), null);
  });

  test('framework: the command first, then dependencies', () => {
    assert.equal(guessFramework(['/usr/bin/python3', '-m', 'http.server', '4567'], null), 'python-http');
    assert.equal(guessFramework(['node', '/x/node_modules/.bin/vite', '--port', '5173'], null), 'vite');
    assert.equal(guessFramework(['python', 'manage.py', 'runserver'], null), 'django');
    assert.equal(guessFramework(['node', 'dist/index.js'], REPO), 'astro');
    assert.equal(guessFramework(['node', 'dist/index.js'], path.join(TMP, 'plain')), null);
  });

  test('git: toplevel, branch, last commit, remote; a linked worktree is detected', async () => {
    const main = (await gitInfo(REPO))!;
    assert.equal(main.toplevel, REPO);
    assert.equal(main.branch, 'main');
    assert.equal(main.worktree, false);
    assert.equal(main.repo, 'my-dashboard');
    assert.equal(main.remote, 'https://example.com/acme/my-dashboard.git');
    assert.match(main.lastCommitAt!, /^\d{4}-\d\d-\d\dT/);
    const a = (await gitInfo(WT_A))!;
    assert.equal(a.toplevel, WT_A);
    assert.equal(a.branch, 'branch-a');
    assert.equal(a.worktree, true);
    assert.equal(a.repo, 'my-dashboard', 'a worktree is named after its repository, not its own directory');
    assert.equal(a.commonDir, main.commonDir);
    assert.equal(await gitInfo(path.join(TMP, 'plain')), null);
  });

  test('a detached HEAD falls back to the short commit', async () => {
    const wt = path.join(TMP, 'Code', 'my-dashboard-detached');
    git(REPO, 'worktree', 'add', '-q', '--detach', wt);
    const g = (await gitInfo(wt))!;
    assert.match(g.branch!, /^[0-9a-f]{7,}$/);
  });

  test('repository names from the common git dir', () => {
    assert.equal(repoName('/x/my-app/.git'), 'my-app');
    assert.equal(repoName('/x/my-app.git'), 'my-app');
  });

  test('a directory with no project markers is the project itself (unless it is ~ or /)', async () => {
    const id = await identify(path.join(TMP, 'plain'), ['python3', '-m', 'http.server'], '/nowhere');
    assert.equal(id.project?.root, path.join(TMP, 'plain'));
    assert.equal(id.project?.name, 'plain');
    assert.equal(id.project?.framework, 'python-http');
    assert.equal((await identify('/', ['x'], '/nowhere')).project, null);
    assert.equal((await identify(TMP, ['x'], TMP)).project, null);
  });
});

/** A complete observation for the pure-function tests. */
function obs(o: Partial<ObservedListener> = {}): ObservedListener {
  return {
    id: 'x',
    port: 4567,
    pid: 100,
    process: 'node',
    addresses: ['127.0.0.1'],
    bind: 'loopback',
    kind: 'web',
    http: { status: 200, title: null, favicon: null },
    command: 'node dist/index.js',
    argv: ['node', 'dist/index.js'],
    cwd: '/home/someone/Code/my-app',
    startedAt: null,
    orphan: true,
    project: { root: '/home/someone/Code/my-app', name: 'my-app', description: null, framework: null },
    git: null,
    label: 'my-app',
    firstSeen: '',
    lastSeen: '',
    ...o,
  };
}

describe('observations', () => {
  test('ids survive a restart (new PID, a different path to the same executable) but not a new port or project', () => {
    const a = observationId('/p', 4666, normaliseCommand(['/usr/local/bin/node', 'dist/index.js'], null));
    const b = observationId('/p', 4666, normaliseCommand(['node', 'dist/index.js'], null));
    const c = observationId('/p', 4670, normaliseCommand(['node', 'dist/index.js'], null));
    const d = observationId('/q', 4666, normaliseCommand(['node', 'dist/index.js'], null));
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.notEqual(a, d);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(normaliseCommand(null, '  /opt/bin/astro   dev  --port 4666 '), 'astro dev --port 4666');
  });

  test('worktree siblings are labelled repo @ branch; everything else by project name', () => {
    const g = (toplevel: string, branch: string, worktree: boolean) => ({
      toplevel, repo: 'my-dashboard', branch, lastCommitAt: null, worktree, commonDir: '/c/my-dashboard/.git', remote: null,
    });
    const list = [
      obs({ port: 4666, git: g('/c/my-dashboard', 'main', false), project: { root: '/c/my-dashboard', name: 'my-dashboard', description: null, framework: null } }),
      obs({ port: 4670, git: g('/c/wt-a', 'branch-a', true) }),
      obs({ port: 4671, git: g('/c/wt-b', 'branch-b', true) }),
      obs({ port: 5173 }),
      obs({ port: 9000, project: null, process: 'ruby' }),
    ];
    labelListeners(list);
    assert.deepEqual(
      list.map((l) => l.label),
      ['my-dashboard @ main', 'my-dashboard @ branch-a', 'my-dashboard @ branch-b', 'my-app', 'ruby :9000'],
    );
    // the main checkout alone is just its name; two servers from one checkout are not siblings
    const alone = [obs({ git: g('/c/my-dashboard', 'main', false) }), obs({ port: 4568, git: g('/c/my-dashboard', 'main', false) })];
    labelListeners(alone);
    assert.deepEqual(alone.map((l) => l.label), ['my-app', 'my-app']);
  });

  test('observed.json keeps first-seen across scans and updates last-seen', () => {
    const file = path.join(TMP, 'state-obs', 'observed.json');
    const s1 = new ObservedStore(file);
    s1.record([obs({ id: 'a' })], Date.parse('2026-10-01T00:00:00Z'));
    const s2 = new ObservedStore(file);
    s2.record([obs({ id: 'a', pid: 200 }), obs({ id: 'b' })], Date.parse('2026-10-02T00:00:00Z'));
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.observations.a.firstSeen, '2026-10-01T00:00:00.000Z');
    assert.equal(saved.observations.a.lastSeen, '2026-10-02T00:00:00.000Z');
    assert.equal(saved.observations.a.pid, 200);
    assert.equal(saved.observations.b.firstSeen, '2026-10-02T00:00:00.000Z');
    // a year later, both have aged out
    new ObservedStore(file).record([], Date.parse('2027-10-02T00:00:00Z'));
    assert.deepEqual(new ObservedStore(file).all(), []);
  });

  test('boot.json: records the boot time and notices a reboot', () => {
    const file = path.join(TMP, 'state-boot', 'boot.json');
    const boot1 = Date.parse('2026-10-01T08:00:00Z');
    assert.equal(recordBoot(file, boot1).rebooted, false, 'first run');
    assert.equal(recordBoot(file, boot1 + 2000).rebooted, false, 'clock jitter is not a reboot');
    const r = recordBoot(file, Date.parse('2026-10-05T08:00:00Z'));
    assert.equal(r.rebooted, true);
    assert.equal(r.previous?.bootTime, '2026-10-01T08:00:02.000Z');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).bootTime, '2026-10-05T08:00:00.000Z');
  });
});

describe('claim', () => {
  test('slugs from the package name; reserved and taken ones get a suffix', () => {
    assert.equal(slugify('@acme/My_Dashboard'), 'my-dashboard');
    assert.equal(suggestSlug(obs()), 'my-app');
    assert.equal(suggestSlug(obs(), new Set(['my-app'])), 'my-app-2');
    assert.equal(suggestSlug(obs({ project: { root: '/x', name: 'Hallway', description: null, framework: null } })), 'hallway-app');
    assert.equal(suggestSlug(obs({ project: null, process: null, port: 4567 })), 'app-4567');
    const wt = obs({ label: 'my-app @ branch-a', git: { toplevel: '/x', repo: 'my-app', branch: 'branch-a', lastCommitAt: null, worktree: true, commonDir: '/c', remote: null } });
    assert.equal(suggestSlug(wt), 'my-app-branch-a');
  });

  test('the YAML keeps the observed port, is adhoc, records the dir, and comments out the command', () => {
    const { slug, yaml } = claimDraft(
      obs({ port: 4666, project: { root: '/home/someone/Code/my-app', name: 'my-app', description: 'Does: things', framework: null } }),
      {},
      new Set(),
      { home: '/home/someone', now: new Date('2026-10-16T12:00:00Z') },
    );
    assert.equal(slug, 'my-app');
    assert.equal(
      yaml,
      [
        '# Claimed from a listener Hallway observed on port 4666 (2026-10-16).',
        'name: my-app',
        'description: "Does: things"',
        'port: 4666',
        'expected: adhoc',
        'project:',
        '  dir: "~/Code/my-app"',
        '',
        '# The command it was running with. Uncomment to have Hallway keep it running as a service (v1).',
        '# service:',
        '#   command: ["node", "dist/index.js"]',
        '#   cwd: "~/Code/my-app"',
        '',
      ].join('\n'),
    );
  });

  test('options, an IPv6-only listener, and invalid input', () => {
    const { yaml } = claimDraft(obs({ addresses: ['::1'], bind: 'loopback' }), { slug: 'deck', name: 'Talk deck', expected: 'running' });
    assert.match(yaml, /^name: Talk deck$/m);
    assert.match(yaml, /^host: "::1"$/m);
    assert.match(yaml, /^expected: running$/m);
    assert.throws(() => claimDraft(obs(), { slug: 'Not Valid' }), /not a valid slug/);
    assert.throws(() => claimDraft(obs(), { slug: 'api' }), /reserved/);
    assert.throws(() => claimDraft(obs(), { expected: 'sometimes' as 'adhoc' }), /expected must be/);
  });
});

/** Start a server on a free loopback port; resolves with the port and a close function. */
function listen(server: net.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      }),
    ),
  );
}

describe('HTTP sniff', () => {
  test('title and favicon from the page head', () => {
    assert.equal(htmlTitle('<head><title>\n  Dash &amp; co &#x2014; home </title>'), 'Dash & co — home');
    assert.equal(htmlTitle('<p>no title</p>'), null);
    assert.equal(htmlFavicon('<link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/favicon.ico">'), '/favicon.ico');
    assert.equal(htmlFavicon("<link rel=apple-touch-icon href='/t.png'><link href=/i.svg rel=icon>"), '/i.svg');
    assert.equal(htmlFavicon('<link rel="apple-touch-icon" href="/t.png">'), '/t.png');
    assert.equal(htmlFavicon(''), null);
  });

  test('a web server: status, title and favicon; a redirect is not followed', async () => {
    let host = '';
    const s = await listen(
      http.createServer((req, res) => {
        host = req.headers.host ?? '';
        if (req.url === '/') {
          res.writeHead(302, { location: '/login', 'content-type': 'text/html' });
          return res.end('<html><head><title>Redirecting</title><link rel="icon" href="/f.png"></head>');
        }
        res.end('login');
      }),
    );
    try {
      assert.deepEqual(await sniff('127.0.0.1', s.port), { status: 302, title: 'Redirecting', favicon: '/f.png' });
      assert.equal(host, `localhost:${s.port}`);
    } finally {
      await s.close();
    }
  });

  test('a listener that never speaks HTTP is not a web app', async () => {
    const silent = await listen(net.createServer((sock) => sock.resume()));
    const garbage = await listen(net.createServer((sock) => sock.resume().end('SSH-2.0-OpenSSH_9.9\r\n')));
    try {
      assert.equal(await sniff('127.0.0.1', silent.port, { timeoutMs: 300 }), null);
      assert.equal(await sniff('127.0.0.1', garbage.port, { timeoutMs: 1000 }), null);
    } finally {
      await silent.close();
      await garbage.close();
    }
  });
});

describe('a whole scan over a fake platform', () => {
  test('filters, identifies, labels worktree siblings, separates known and non-HTTP ports, and records', async () => {
    const page = (title: string) =>
      http.createServer((_q, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(`<title>${title}</title>`);
      });
    const [a, b, plainSrv, tcp, known] = await Promise.all([
      listen(page('A')),
      listen(page('B')),
      listen(page('Directory listing')),
      listen(net.createServer((sock) => sock.resume())),
      listen(page('Known')),
    ]);
    const raw: RawListener[] = [
      { pid: 11, process: 'node', port: a.port, address: '127.0.0.1' },
      { pid: 11, process: 'node', port: a.port, address: '::1' },
      { pid: 12, process: 'node', port: b.port, address: '127.0.0.1' },
      { pid: 13, process: 'python3', port: plainSrv.port, address: '127.0.0.1' },
      { pid: 14, process: 'node', port: tcp.port, address: '127.0.0.1' },
      { pid: 15, process: 'node', port: known.port, address: '127.0.0.1' },
      { pid: 16, process: 'postgres', port: 5432, address: '127.0.0.1' },
      { pid: 17, process: 'cupsd', port: 631, address: '127.0.0.1' },
      { pid: 18, process: 'node', port: 4999, address: '127.0.0.1' }, // under an ignored dir
    ];
    const cwd: Record<number, string> = { 11: WT_A, 12: WT_B, 13: path.join(TMP, 'plain'), 14: REPO, 15: REPO, 18: path.join(TMP, 'go') };
    let infoCalls = 0;
    const platform = {
      ...currentPlatform(),
      listListeners: async () => raw,
      processInfo: async (pids: number[]) => {
        infoCalls++;
        return new Map(
          pids.map((pid): [number, ProcessInfo] => [
            pid,
            { pid, ppid: 1, command: 'node dist/index.js', argv: ['node', 'dist/index.js'], cwd: cwd[pid] ?? null, startTime: 1, orphan: true },
          ]),
        );
      },
      bootTime: async () => Date.parse('2026-10-01T08:00:00Z'),
    } satisfies Platform;
    const home = path.join(TMP, 'home-fake');
    const results: unknown[] = [];
    const scanner = createScanner({
      home,
      platform,
      homeDir: '/nowhere',
      // the OS picks the test servers' ports, which on macOS are in the ephemeral range (that rule has its own test)
      settings: () => ({ enabled: true, intervalSeconds: 120, includeEphemeralPorts: true, minPort: 1024 }),
      knownPorts: () => [known.port],
      ignore: () => ({ ports: [], processes: [], dirs: [path.join(TMP, 'go')] }),
      sniffTimeoutMs: 500,
      onScan: (r) => results.push(r),
    });
    try {
      const r = await scanner.scan();
      assert.deepEqual(
        r.listeners.map((l) => [l.port, l.label]),
        [
          [a.port, 'my-dashboard @ branch-a'],
          [b.port, 'my-dashboard @ branch-b'],
          [plainSrv.port, 'plain'],
        ].sort((x, y) => (x[0] as number) - (y[0] as number)),
      );
      const wa = r.listeners.find((l) => l.port === a.port)!;
      assert.equal(wa.cwd, WT_A);
      assert.deepEqual(wa.addresses, ['127.0.0.1', '::1']);
      assert.equal(wa.http?.title, 'A');
      assert.equal(wa.project?.framework, 'astro');
      assert.equal(wa.orphan, true);
      assert.deepEqual(r.other.map((l) => l.port), [tcp.port]);
      assert.deepEqual([...r.known.keys()], [known.port]);
      assert.deepEqual(r.dropped, { daemon: 1, 'low-port': 1, ignored: 1 });
      assert.equal(results.length, 1);
      assert.equal(scanner.last(), r);
      assert.equal(scanner.observation(wa.id)?.port, a.port);

      // the second scan reuses identities (one processInfo call per scan, no fresh git lookups) and keeps the ids
      await scanner.scan();
      assert.equal(infoCalls, 2);
      assert.deepEqual(scanner.last()!.listeners.map((l) => l.id), r.listeners.map((l) => l.id));
      const saved = JSON.parse(fs.readFileSync(path.join(home, 'state', 'observed.json'), 'utf8'));
      assert.ok(saved.observations[wa.id]);

      // start() records the boot time and scans
      const boot = await scanner.start();
      scanner.stop();
      assert.equal(boot.bootTime, '2026-10-01T08:00:00.000Z');
      assert.ok(fs.existsSync(path.join(home, 'state', 'boot.json')));
    } finally {
      scanner.stop();
      await Promise.all([a, b, plainSrv, tcp, known].map((s) => s.close()));
    }
  });
});

describe('a real scan on this machine', () => {
  test('finds a server started in a temp directory, with its cwd and project', { timeout: 30_000 }, async (t) => {
    const dir = path.join(TMP, 'real-app');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'real-app' }));
    const child = spawn(
      process.execPath,
      ['-e', "const s=require('http').createServer((q,r)=>r.end('<title>Real</title>')).listen(0,'127.0.0.1',()=>console.log(s.address().port))"],
      { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      const port = await new Promise<number>((resolve, reject) => {
        child.stdout!.once('data', (d) => resolve(Number(String(d).trim())));
        child.once('exit', () => reject(new Error('server exited')));
      });
      const scanner = createScanner({
        home: path.join(TMP, 'home-real'),
        // the OS picked the port, possibly in the ephemeral range
        settings: () => ({ enabled: true, intervalSeconds: 120, includeEphemeralPorts: true, minPort: 1024 }),
      });
      const r = await scanner.scan();
      const found = [...r.listeners, ...r.other].find((l) => l.port === port);
      if (!found && currentPlatform().id === 'darwin' && !r.listeners.length && !r.other.length)
        return t.skip('lsof listed nothing (sandboxed runner?)');
      assert.ok(found, `port ${port} not found`);
      assert.equal(found.pid, child.pid);
      assert.equal(found.cwd, dir);
      assert.equal(found.project?.name, 'real-app');
      assert.equal(found.kind, 'web');
      assert.equal(found.label, 'real-app');
    } finally {
      child.kill();
    }
  });
});
