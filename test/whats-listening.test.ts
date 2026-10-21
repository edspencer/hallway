// What each listener is (D73): port forwarders and what's behind them (`docker ps`, `nerdctl ps`, `podman ps`,
// `kubectl get svc` against fixtures, the tools' CLIs mocked), a cluster's own ports, desktop apps' internal ports,
// tools run from npx or a global install, the script a runtime runs, what `GET /` answered (over TLS too), names and
// roles, and a whole macOS-shaped scan of a machine running Rancher Desktop. Generic names throughout.
import { after, describe, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import type { ListenerVia } from '../shared/api.ts';
import { darwinProcesses } from '../server/platform/darwin.ts';
import { type Platform, type RawListener, currentPlatform } from '../server/platform/index.ts';
import { bundleName, desktopApp, toolPackage } from '../server/scanner/apps.ts';
import { answerOf, isGenericName, nameOf, roleOf, scriptOf } from '../server/scanner/describe.ts';
import { forwarderOf, lookupBehind, parseContainers, parseServices, publishedPorts, sshHost } from '../server/scanner/forwarders.ts';
import { guessFramework } from '../server/scanner/identify.ts';
import { createScanner } from '../server/scanner/index.ts';
import { sniff } from '../server/scanner/sniff.ts';
import type { Observation } from '../server/scanner/types.ts';
import { toObserved } from '../server/live.ts';
import { ROOT, exitWatchdog, onWindows, rmTmp, tmpDir as makeTmp } from './fixture.ts';

exitWatchdog();
const dirs: string[] = [];
const tmpDir = (prefix: string) => (dirs.push(makeTmp(prefix)), dirs.at(-1)!);
after(() => dirs.forEach(rmTmp));

const FIX = path.join(ROOT, 'test', 'fixtures', 'forwarders');
const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8');
const POSIX = { skip: onWindows('POSIX paths and executables') };
// Rancher Desktop's Lima ssh, as macOS's ps prints it (the mux retitles itself) and as lsof names it
const LIMA_MUX = 'ssh: /Users/someone/Library/Application Support/rancher-desktop/lima/0/ssh.sock [mux]';

describe('forwarders: which tool holds the port', () => {
  test("Rancher Desktop's Lima ssh mux, macOS (argv split on spaces) and Linux", () => {
    assert.deepEqual(forwarderOf('ssh', LIMA_MUX, LIMA_MUX.split(' '))?.tool, { id: 'rancher-desktop', name: 'Rancher Desktop' });
    assert.deepEqual(forwarderOf('ssh', LIMA_MUX, [LIMA_MUX])?.tool, { id: 'rancher-desktop', name: 'Rancher Desktop' });
  });
  test('Colima, OrbStack, Docker Desktop, docker-proxy, Podman, a bare Lima', () => {
    const tool = (process: string, command: string) => forwarderOf(process, command, command.split(' '))?.tool.id ?? null;
    assert.equal(tool('ssh', 'ssh -F /Users/someone/.colima/_lima/colima/ssh.config -N lima-colima'), 'colima');
    assert.equal(tool('OrbStack Helper', '/Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper.app/Contents/MacOS/OrbStack Helper vmgr'), 'orbstack');
    assert.equal(tool('com.docker.backend', '/Applications/Docker.app/Contents/MacOS/com.docker.backend'), 'docker-desktop');
    assert.equal(tool('docker-proxy', '/usr/bin/docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 8080'), 'docker-desktop');
    assert.equal(tool('gvproxy', '/opt/homebrew/Cellar/podman/5.2.0/libexec/podman/gvproxy -listen-qemu unix:///tmp/qmp'), 'podman');
    assert.equal(tool('ssh', 'ssh -F /Users/someone/.lima/default/ssh.config lima-default'), 'lima');
  });
  test('an SSH tunnel names its host; `kubectl port-forward` its service', () => {
    const t = forwarderOf('ssh', 'ssh -N -L 8080:localhost:80 -p 2222 me@build.example.com', ['ssh', '-N', '-L', '8080:localhost:80', '-p', '2222', 'me@build.example.com']);
    assert.deepEqual(t?.tool, { id: 'ssh', name: 'SSH tunnel' });
    assert.equal(t?.host, 'build.example.com');
    assert.equal(sshHost(['ssh', '-L8080:localhost:80', '-Nf', 'ssh://deploy@db.example.com:2200']), 'db.example.com');
    const k = forwarderOf('kubectl', 'kubectl port-forward -n design svc/storybook 6006:80', ['kubectl', 'port-forward', '-n', 'design', 'svc/storybook', '6006:80']);
    assert.deepEqual(k?.kubernetes, { name: 'storybook', namespace: 'design', system: false });
    assert.equal(forwarderOf('kubectl', 'kubectl get pods', ['kubectl', 'get', 'pods']), null, 'kubectl that isn\'t forwarding');
  });
  test('k3s itself is the cluster; anything else serves its own port', () => {
    assert.equal(forwarderOf('k3s-server', '/usr/local/bin/k3s server', ['/usr/local/bin/k3s', 'server'])?.tool.id, 'kubernetes');
    assert.equal(forwarderOf('node', 'node server.js', ['node', 'server.js']), null);
    assert.equal(forwarderOf('Rancher Desktop', '/Applications/Rancher Desktop.app/Contents/MacOS/Rancher Desktop', null), null, 'the app is not its own VM');
  });
});

describe("what's behind a forwarded port: the tools' own listings", () => {
  test('published host ports, ranges included, IPv6 duplicates once', () => {
    assert.deepEqual(publishedPorts('0.0.0.0:3000->3000/tcp, :::3000->3000/tcp'), [3000]);
    assert.deepEqual(publishedPorts('127.0.0.1:5544-5546->5544-5546/tcp'), [5544, 5545, 5546]);
    assert.deepEqual(publishedPorts('80/tcp'), [], 'exposed but not published');
    assert.deepEqual(publishedPorts('0.0.0.0:5353->53/udp'), []);
  });
  test('`docker ps --format {{json .}}`', () => {
    assert.deepEqual(
      parseContainers(fixture('docker-ps.jsonl')).map((p) => `${p.port} ${p.name} ${p.image}`),
      ['3000 juice-shop bkimminich/juice-shop:latest', '9001 minio minio/minio:latest', '8014 identity quay.io/keycloak/keycloak:26.0', '5432 postgres postgres:16', '5544 queue example/queue:3', '5545 queue example/queue:3', '5546 queue example/queue:3', '2224 git-server example/git-server:1'],
    );
  });
  test('`nerdctl ps --format {{json .}}` and `podman ps --format json`', () => {
    assert.deepEqual(parseContainers(fixture('nerdctl-ps.jsonl')), [{ port: 9001, name: 'minio', image: 'docker.io/minio/minio:latest' }]);
    assert.deepEqual(
      parseContainers(fixture('podman-ps.json')).map((p) => `${p.port} ${p.name}`),
      ['6380 cache', '8080 web', '8081 web'],
    );
    assert.deepEqual(parseContainers('WARNING: something\n'), []);
    assert.deepEqual(parseContainers(''), []);
  });
  test('`kubectl get svc -A -o json`: LoadBalancer ports and NodePorts, TCP only', () => {
    assert.deepEqual(
      parseServices(fixture('kubectl-svc.json')).map((s) => `${s.port} ${s.namespace}/${s.name}`),
      ['80 kube-system/traefik', '31080 kube-system/traefik', '443 kube-system/traefik', '31443 kube-system/traefik', '6006 design/storybook', '30090 ops/metrics'],
    );
    assert.deepEqual(parseServices('not json'), []);
  });

  /** A home with Rancher Desktop's CLIs in ~/.rd/bin (their output comes from the mocked runner). */
  function rdHome(clis: string[]) {
    const home = tmpDir('hw-rd-home-');
    fs.mkdirSync(path.join(home, '.rd', 'bin'), { recursive: true });
    for (const c of clis) fs.writeFileSync(path.join(home, '.rd', 'bin', c), '#!/bin/sh\n', { mode: 0o755 });
    return home;
  }
  const rancher = (ports: number[]) => new Map<number, ListenerVia>(ports.map((p) => [p, { tool: { id: 'rancher-desktop', name: 'Rancher Desktop' }, container: null, kubernetes: null }]));
  // the ports Rancher Desktop's ssh held on a real Mac: containers' and the k3s cluster's own (D73)
  const ALL = [2224, 3000, 5432, 5544, 5546, 8014, 9001, 6443, 6444, 9000, 10010, 10248, 10249, 10250, 10256, 10257, 10258, 10259];

  test("Rancher Desktop: containers by `docker --context rancher-desktop ps`, the cluster's ports by number, the rest of the VM's to the cluster", POSIX, async () => {
    const home = rdHome(['docker', 'kubectl']);
    const calls: string[] = [];
    const vias = rancher(ALL);
    await lookupBehind(vias, {
      home,
      env: { PATH: '' },
      run: async (cmd, args) => {
        calls.push(`${path.basename(cmd)} ${args.join(' ')}`);
        if (cmd.endsWith('docker') && args[1] === 'rancher-desktop') return { ok: true, stdout: fixture('docker-ps.jsonl') };
        if (cmd.endsWith('kubectl')) return { ok: true, stdout: fixture('kubectl-svc.json') };
        return { ok: false, stdout: '' };
      },
    });
    const at = (p: number) => vias.get(p)!;
    assert.equal(at(3000).container?.name, 'juice-shop');
    assert.equal(at(5432).container?.name, 'postgres', "a container's well-known port is still the container's");
    assert.equal(at(5546).container?.name, 'queue');
    assert.equal(at(2224).container?.name, 'git-server', 'not HTTP, but a container all the same');
    assert.deepEqual(at(6443).kubernetes, { name: 'API server', namespace: null, system: true });
    assert.deepEqual(at(10259).kubernetes, { name: 'scheduler', namespace: null, system: true });
    assert.deepEqual(at(10010).kubernetes, { name: 'container runtime streaming', namespace: null, system: true });
    assert.deepEqual(at(9000).kubernetes, { name: 'component', namespace: null, system: true }, "9000 isn't a container's here, so it's the cluster's");
    assert.ok(calls.every((c) => !c.startsWith('kubectl') || c.includes('--context rancher-desktop')), 'never the current kubectl context');
    assert.ok(calls.some((c) => c.startsWith('docker --context rancher-desktop ps')));
  });
  test('a Kubernetes LoadBalancer service by `kubectl get svc`; a container on a cluster port is the container', POSIX, async () => {
    const home = rdHome(['docker', 'kubectl']);
    const vias = rancher([6006, 6443]);
    await lookupBehind(vias, {
      home,
      env: { PATH: '' },
      run: async (cmd) => (cmd.endsWith('kubectl') ? { ok: true, stdout: fixture('kubectl-svc.json') } : { ok: true, stdout: '{"Names":"my-api","Image":"example/api","Ports":"0.0.0.0:6443->443/tcp"}\n' }),
    });
    assert.deepEqual(vias.get(6006)!.kubernetes, { name: 'storybook', namespace: 'design', system: false });
    assert.equal(vias.get(6443)!.container?.name, 'my-api');
    assert.equal(vias.get(6443)!.kubernetes, null);
  });
  test('no docker and no kubectl: still the tool’s, the containers unnamed, the cluster’s well-known ports named', POSIX, async () => {
    const home = rdHome([]);
    let ran = 0;
    const vias = rancher([3000, 9000, 6443]);
    await lookupBehind(vias, { home, env: { PATH: '' }, run: async () => (ran++, { ok: true, stdout: '' }) });
    assert.equal(ran, 0, 'nothing to run');
    assert.equal(vias.get(3000)!.container, null);
    assert.equal(vias.get(3000)!.kubernetes, null);
    assert.equal(vias.get(9000)!.kubernetes, null, "without a listing, 9000 can't be ruled out as a container");
    assert.equal(vias.get(6443)!.kubernetes?.name, 'API server');
  });
  test("Rancher Desktop's containerd engine: nerdctl", POSIX, async () => {
    const home = rdHome(['nerdctl']);
    const vias = rancher([9001]);
    await lookupBehind(vias, { home, env: { PATH: '' }, run: async (cmd) => (cmd.endsWith('nerdctl') ? { ok: true, stdout: fixture('nerdctl-ps.jsonl') } : { ok: false, stdout: '' }) });
    assert.equal(vias.get(9001)!.container?.name, 'minio');
  });
  test('SSH tunnels and port-forwards are never looked up', async () => {
    let ran = 0;
    const vias = new Map<number, ListenerVia>([[8080, { tool: { id: 'ssh', name: 'SSH tunnel' }, container: null, kubernetes: null, host: 'build.example.com' }]]);
    await lookupBehind(vias, { run: async () => (ran++, { ok: true, stdout: '' }) });
    assert.equal(ran, 0);
  });
});

describe('desktop apps and tools', () => {
  const HOME = '/Users/someone';
  test("an app's bundle in its command line names it, helpers included", () => {
    assert.deepEqual(desktopApp('/Applications/Rancher Desktop.app/Contents/MacOS/Rancher Desktop', { manager: 'launchd', label: 'application.io.rancherdesktop.app.1234.5678' }, '/', null, HOME), { name: 'Rancher Desktop', bundleId: 'io.rancherdesktop.app' });
    assert.deepEqual(desktopApp('/Applications/Example Verify.app/Contents/MacOS/Example Verify', null, `${HOME}/Library/Containers/com.example.verify/Data`, null, HOME), { name: 'Example Verify', bundleId: 'com.example.verify' });
    assert.equal(desktopApp('/Applications/Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin) --type=utility', null, '/', null, HOME)?.name, 'Code');
  });
  test('only a launchd label or a data container: the bundle id, humanised', () => {
    assert.deepEqual(desktopApp(null, { manager: 'launchd', label: 'application.com.example.verify.111.222' }, null, null, HOME), { name: 'Example Verify', bundleId: 'com.example.verify' });
    assert.equal(desktopApp(null, null, `${HOME}/Library/Containers/ABCDE12345.com.example.notes/Data`, null, HOME)?.bundleId, 'com.example.notes');
    assert.equal(bundleName('io.rancherdesktop.app'), 'Rancherdesktop');
    assert.equal(bundleName('com.example.mobile'), 'Example Mobile');
  });
  test('Linux and Windows install directories; an Electron app under development is the project', () => {
    assert.equal(desktopApp('/opt/Example Chat/example-chat --type=renderer', null, '/', null, '/home/someone')?.name, 'Example Chat');
    assert.equal(desktopApp('/opt/homebrew/bin/llm-server', null, '/', null, HOME), null);
    assert.equal(desktopApp('/opt/hostedtoolcache/node/22.13.0/x64/bin/node server.js', null, '/home/runner/app', null, '/home/runner'), null, 'a runtime in /opt runs your project');
    assert.equal(desktopApp('/opt/python3.12/bin/python3.12 -m http.server', null, '/srv/x', null, '/home/someone'), null);
    assert.equal(desktopApp('"C:\\Program Files\\Example\\Example Sync\\sync.exe" --background', null, null, null, 'C:\\Users\\someone')?.name, 'Example Sync');
    assert.equal(desktopApp('"C:\\Program Files\\nodejs\\node.exe" server.js', null, 'C:\\Users\\someone\\code\\app', null, 'C:\\Users\\someone'), null, 'node from Program Files runs your project');
    const proj = `${HOME}/code/my-electron`;
    assert.equal(desktopApp(`${proj}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`, null, proj, proj, HOME), null);
    assert.equal(desktopApp('node server.js', null, `${HOME}/code/app`, `${HOME}/code/app`, HOME), null);
  });
  test('a package run from npx, a global install, pipx or uv is the tool; the project’s own dependencies are not', () => {
    assert.equal(toolPackage(['node', `${HOME}/.npm/_npx/4f1c2e9a/node_modules/.bin/local-review`]), 'local-review');
    assert.equal(toolPackage(['node', `${HOME}/.npm/_npx/4f1c2e9a/node_modules/local-review/dist/cli.js`]), 'local-review');
    assert.equal(toolPackage(['/opt/homebrew/bin/node', '/opt/homebrew/lib/node_modules/@example/notebook/packages/server/dist/cli/notebook.js', 'start']), '@example/notebook');
    assert.equal(toolPackage(['python3', `${HOME}/.local/pipx/venvs/datasette/bin/datasette`, 'serve']), 'datasette');
    assert.equal(toolPackage(['python3', `${HOME}/.local/share/uv/tools/marimo/bin/marimo`, 'edit']), 'marimo');
    assert.equal(toolPackage(['node', `${HOME}/code/shop/node_modules/.bin/vite`]), null);
    assert.equal(toolPackage(['node', `${HOME}/code/mono/node_modules/.pnpm/vite@7.0.0/node_modules/vite/bin/vite.js`]), null);
    assert.equal(toolPackage(null), null);
  });
  test('the script a runtime runs', () => {
    assert.equal(scriptOf(['node', 'rig/a.mjs'], '/x'), 'rig/a.mjs');
    assert.equal(scriptOf(['node', '/x/rig/b.js'], '/x'), 'rig/b.js');
    assert.equal(scriptOf(['node', '--require', '/x/node_modules/tsx/dist/preflight.cjs', 'src/index.ts', '--config', 'c.json'], '/x/packages/mcp'), 'src/index.ts');
    assert.equal(scriptOf(['node', '/x/node_modules/.bin/vite', '--port', '5173'], '/x'), 'vite');
    assert.equal(scriptOf(['python3', '-m', 'http.server', '8000'], '/x'), 'http.server');
    assert.equal(scriptOf(['npm', 'run', 'dev'], '/x'), 'dev');
    assert.equal(scriptOf(['node', '-e', 'require("http")…'], '/x'), null);
    assert.equal(scriptOf(['/usr/local/bin/llm-server', 'serve'], '/'), null, 'a binary names itself');
  });
});

describe('framework: only what the process runs (D73)', () => {
  test('a tsx server in a project with vite among its devDependencies is not vite; express in dependencies is express', () => {
    const dir = tmpDir('hw-fw-');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mcp', devDependencies: { vite: '^7', tsx: '^4' } }));
    assert.equal(guessFramework(['node', '--require', 'tsx/cjs', 'src/index.ts'], dir), null);
    assert.equal(guessFramework(['node', path.join(dir, 'node_modules/.bin/vite')], dir), 'vite');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^5' }, devDependencies: { vite: '^7' } }));
    assert.equal(guessFramework(['node', 'server.js'], dir), 'express');
  });
});

describe('what `GET /` answered', () => {
  const h = (status: number, contentType: string | null, extra: Partial<NonNullable<Observation['http']>> = {}) => ({ status, title: null, favicon: null, contentType, location: null, tls: false, ...extra });
  test('page, API, sign-in, redirect, error, nothing at /, not HTTP', () => {
    assert.equal(answerOf(h(200, 'text/html', { title: 'Shop' })).kind, 'page');
    assert.equal(answerOf(h(200, 'application/json')).kind, 'api');
    assert.equal(answerOf(h(401, 'application/json')).kind, 'sign-in');
    assert.equal(answerOf(h(403, 'application/xml')).kind, 'sign-in');
    assert.equal(answerOf(h(302, 'text/html', { location: '/realms/master/protocol/openid-connect/auth?x' })).kind, 'sign-in');
    assert.deepEqual(answerOf(h(308, null, { location: 'https://docs.example.com/' })), { kind: 'redirect', status: 308, tls: false, location: 'https://docs.example.com/' });
    assert.equal(answerOf(h(503, 'application/json')).kind, 'error');
    assert.equal(answerOf(h(404, 'text/plain')).kind, 'empty');
    assert.equal(answerOf(h(404, 'application/json')).kind, 'api');
    assert.equal(answerOf(h(400, 'text/plain', { tls: true })).tls, true);
    assert.equal(answerOf(null).kind, 'not-http');
    // a record from before 0.10: no content type, but a title means HTML
    assert.equal(answerOf({ status: 200, title: 'Old', favicon: null }).kind, 'page');
  });

  // a throwaway self-signed certificate, made here rather than kept in the repository
  const cert = (() => {
    try {
      const dir = tmpDir('hw-tls-');
      execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
      return { key: fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), cert: fs.readFileSync(path.join(dir, 'c.pem'), 'utf8') };
    } catch {
      return null;
    }
  })();
  test('a port that only speaks HTTPS is asked again over TLS; a Go-style "use HTTPS" 400 too', { skip: cert ? false : 'needs openssl to make a certificate' }, async () => {
    const tls = cert!;
    const secure = https.createServer(tls, (_q, res) => (res.writeHead(401, { 'content-type': 'application/json' }), res.end('{}')));
    // plain HTTP that says it wants TLS, and isn't TLS either: the 400 is what's left
    const goStyle = http.createServer((_q, res) => (res.writeHead(400, { 'content-type': 'text/plain' }), res.end('Client sent an HTTP request to an HTTPS server.\n')));
    const listen = (s: net.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port)));
    const [sp, gp] = await Promise.all([listen(secure), listen(goStyle)]);
    try {
      assert.deepEqual(await sniff('127.0.0.1', sp, { timeoutMs: 1500 }), { status: 401, title: null, favicon: null, contentType: 'application/json', location: null, tls: true });
      const g = await sniff('127.0.0.1', gp, { timeoutMs: 1500 });
      assert.equal(g?.status, 400);
      assert.equal(g?.tls, false);
    } finally {
      secure.close();
      goStyle.close();
    }
  });
});

describe('names and roles', () => {
  const base: Observation = {
    id: 'x', port: 4000, pid: 1, ppid: 1, process: 'node', addresses: ['127.0.0.1'], bind: 'loopback', kind: 'web', http: null, command: null, argv: null,
    cwd: '/', startedAt: null, orphan: false, supervisor: null, project: null, git: null, label: '', firstSeen: '', lastSeen: '',
  };
  const HOME = '/Users/someone';
  test('generic names', () => {
    for (const n of ['service', 'app', 'ssh', 'mobile', 'node', 'server', 'web', 'API']) assert.ok(isGenericName(n), n);
    for (const n of ['storefront', 'llm-server', 'Paddock']) assert.ok(!isGenericName(n), n);
  });
  test("an app in a dot-directory called `service` is its page's title, an app on this machine", () => {
    const o: Observation = { ...base, project: { root: `${HOME}/.notebook/service`, name: 'service', description: null, framework: null }, http: { status: 200, title: 'Notebook', favicon: null } };
    assert.equal(nameOf(o), 'Notebook');
    assert.equal(roleOf(o, HOME), 'app');
  });
  test('a tool run in a repository: its title, an app; the repository is context', () => {
    const o: Observation = { ...base, tool: 'local-review', project: { root: `${HOME}/code/payments-api`, name: 'payments-api', description: null, framework: null }, http: { status: 200, title: 'Local Review', favicon: null } };
    assert.equal(nameOf(o), 'Local Review');
    assert.equal(roleOf(o, HOME), 'app');
    assert.equal(nameOf({ ...o, http: null }), 'local-review');
  });
  test('forwarded: the container, a Kubernetes service, a cluster component, or unidentified', () => {
    const via = (x: Partial<ListenerVia>): ListenerVia => ({ tool: { id: 'rancher-desktop', name: 'Rancher Desktop' }, container: null, kubernetes: null, ...x });
    assert.equal(nameOf({ ...base, via: via({ container: { name: 'juice-shop', image: 'bkimminich/juice-shop' } }) }), 'juice-shop');
    assert.equal(roleOf({ ...base, via: via({ container: { name: 'juice-shop', image: null } }) }, HOME), 'forwarded');
    assert.equal(nameOf({ ...base, via: via({ kubernetes: { name: 'kubelet', namespace: null, system: true } }) }), 'Kubernetes kubelet');
    assert.equal(roleOf({ ...base, via: via({ kubernetes: { name: 'kubelet', namespace: null, system: true } }) }, HOME), 'cluster');
    assert.equal(nameOf({ ...base, via: via({}) }), 'Rancher Desktop :4000');
    assert.equal(nameOf({ ...base, via: via({}), http: { status: 200, title: 'Account Login', favicon: null } }), 'Account Login');
  });
  test('a desktop app is internal, named by the app', () => {
    const o: Observation = { ...base, app: { name: 'Example Verify', bundleId: 'com.example.verify' } };
    assert.equal(nameOf(o), 'Example Verify');
    assert.equal(roleOf(o, HOME), 'internal');
  });
  test('a project keeps its name; a supervised job with no project is an app; nothing known is other', () => {
    assert.equal(roleOf({ ...base, project: { root: `${HOME}/code/shop`, name: 'shop', description: null, framework: null } }, HOME), 'project');
    assert.equal(roleOf({ ...base, supervisor: { manager: 'launchd', label: 'com.example.api' } }, HOME), 'app');
    assert.equal(roleOf(base, HOME), 'other');
  });
});

describe('a scan of a Mac running Rancher Desktop (macOS output, the CLIs mocked)', () => {
  test('one ssh mux, many ports: named by container or cluster component, never orphaned; desktop apps internal; tools apps', POSIX, async () => {
    const home = tmpDir('hw-rd-scan-');
    fs.mkdirSync(path.join(home, '.rd', 'bin'), { recursive: true });
    for (const c of ['docker', 'kubectl']) fs.writeFileSync(path.join(home, '.rd', 'bin', c), '#!/bin/sh\n', { mode: 0o755 });
    const repo = path.join(home, 'code', 'payments-api');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'payments-api' }));
    const svc = path.join(home, '.notebook', 'service');
    fs.mkdirSync(svc, { recursive: true });
    fs.writeFileSync(path.join(svc, 'package.json'), JSON.stringify({ name: 'service' }));
    const mux = LIMA_MUX.replace('/Users/someone', home);
    const ports = [2224, 3000, 5432, 6443, 9000, 10250];
    const raw: RawListener[] = [
      ...ports.map((port) => ({ pid: 7090, process: 'ssh', port, address: port === 3000 || port === 6443 || port === 10250 ? '*' : '127.0.0.1' })),
      // ports nothing on a developer's machine is likely to hold: they're sniffed for real (and refuse)
      { pid: 812, process: 'Rancher Desktop', port: 46107, address: '127.0.0.1' },
      { pid: 913, process: 'Example Verify', port: 48769, address: '127.0.0.1' },
      { pid: 7233, process: 'node', port: 47233, address: '127.0.0.1' },
      { pid: 5622, process: 'node', port: 45622, address: '127.0.0.1' },
    ];
    const ps = [
      ` 7090     1 Thu Oct  2 09:14:07 2026     ${mux}`,
      '  812     1 Thu Oct  2 09:14:07 2026     /Applications/Rancher Desktop.app/Contents/MacOS/Rancher Desktop',
      '  913     1 Thu Oct  2 09:14:07 2026     /Applications/Example Verify.app/Contents/MacOS/Example Verify',
      ` 7233     1 Thu Oct  2 09:14:07 2026     /opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@example/notebook/packages/server/dist/cli/notebook.js start`,
      ` 5622   600 Thu Oct  2 09:14:07 2026     node ${home}/.npm/_npx/4f1c2e9a/node_modules/.bin/local-review`,
    ].join('\n');
    const cwd = `p7090\nfcwd\nn/\np812\nfcwd\nn/\np913\nfcwd\nn${home}/Library/Containers/com.example.verify/Data\np7233\nfcwd\nn${svc}\np5622\nfcwd\nn${repo}\n`;
    const launchctl = 'PID\tStatus\tLabel\n812\t0\tapplication.io.rancherdesktop.app.1.2\n913\t0\tapplication.com.example.verify.3.4\n7233\t0\tcom.example.notebook\n';
    const platform = { ...currentPlatform(), listListeners: async () => raw, processInfo: async (pids: number[]) => darwinProcesses(pids, ps, cwd, launchctl), bootTime: async () => null } satisfies Platform;
    const scanner = createScanner({
      home: path.join(home, 'data'),
      platform,
      homeDir: home,
      env: { PATH: '' },
      settings: () => ({ enabled: true, intervalSeconds: 120, includeEphemeralPorts: true, minPort: 1024 }),
      sniffTimeoutMs: 300,
      query: async (cmd) => (cmd.endsWith('docker') ? { ok: true, stdout: fixture('docker-ps.jsonl') } : cmd.endsWith('kubectl') ? { ok: true, stdout: '{"items":[]}' } : { ok: false, stdout: '' }),
    });
    const r = await scanner.scan();
    const all = [...r.listeners, ...r.other];
    const by = (port: number) => toObserved(all.find((o) => o.port === port)!, new Set(), home);
    const row = (port: number) => {
      const o = by(port);
      return `${o.role} ${o.name}${o.identity.orphaned ? ' orphaned' : ''}${o.identity.exposed ? ' exposed' : ''}`;
    };
    assert.equal(row(3000), 'forwarded juice-shop exposed');
    assert.equal(row(5432), 'forwarded postgres');
    assert.equal(row(2224), 'forwarded git-server');
    assert.equal(row(6443), 'cluster Kubernetes API server exposed');
    assert.equal(row(10250), 'cluster Kubernetes kubelet exposed');
    assert.equal(row(9000), 'cluster Kubernetes component');
    assert.equal(row(46107), 'internal Rancher Desktop');
    assert.equal(row(48769), 'internal Example Verify');
    assert.equal(row(47233), 'app @example/notebook');
    assert.equal(by(47233).identity.supervisor?.label, 'com.example.notebook');
    assert.equal(row(45622), 'app local-review');
    assert.equal(by(45622).identity.tool, 'local-review');
    assert.equal(by(3000).identity.via?.container?.image, 'bkimminich/juice-shop:latest');
  });
});
