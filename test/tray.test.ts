// The observed tray's grouping (D73, src/lib/tray.ts): which group each listener lands in, the order, what's folded,
// how rows are headed inside a repository (branch, package or script), the words for what a port answers, and the
// fields the filter matches on. Pure, under node.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { HttpAnswer, ListenerIdentity, ListenerRole, ListenerVia, ObservedListener } from '../shared/api.ts';
import { answerText, foldSummary, machineWord, openable, rowContext, rowLabels, rowName, searchFields, shortLocation, trayGroups } from '../src/lib/tray.ts';

const IDENTITY: ListenerIdentity = {
  pid: 1, ppid: 1, process: 'node', command: null, cwd: null, projectDir: null, name: null, description: null, repo: null, branch: null,
  worktree: false, lastCommitAt: null, framework: null, bindAddress: '127.0.0.1', exposed: false, orphaned: false, supervisor: null,
  displayName: null, startedAt: null, label: null, via: null, app: null, tool: null, script: null,
};

let n = 0;
function obs(port: number, role: ListenerRole, name: string, kind: HttpAnswer['kind'] = 'page', identity: Partial<ListenerIdentity> = {}): ObservedListener {
  return {
    id: `id${n++}`, port, http: kind !== 'not-http', httpStatus: null, title: null, favicon: null, name, role,
    answer: { kind, status: kind === 'not-http' ? null : 200, tls: false, location: null }, url: `http://localhost:${port}`,
    firstSeen: '', lastSeen: '', identity: { ...IDENTITY, ...identity }, suggestedSlug: null,
  };
}
const rancher = (x: Partial<ListenerVia> = {}): ListenerVia => ({ tool: { id: 'rancher-desktop', name: 'Rancher Desktop' }, container: null, kubernetes: null, ...x });

// a busy machine, in generic form: a repository with a worktree, three scripts in one checkout, a monorepo, a tool run
// from npx, an installed app, Rancher Desktop's containers and cluster, two desktop apps, and something unidentified
const MACHINE: ObservedListener[] = [
  obs(5571, 'project', 'storefront', 'page', { repo: 'storefront', branch: 'main', projectDir: '/c/storefront', script: 'vite' }),
  obs(5572, 'project', 'storefront', 'page', { repo: 'storefront', branch: 'feature/cart', projectDir: '/c/storefront-cart', script: 'vite', worktree: true }),
  obs(4001, 'project', 'checkout-e2e', 'redirect', { repo: 'checkout-e2e', branch: 'test/payments', projectDir: '/c/checkout-e2e', script: 'rig/proxy.mjs' }),
  obs(9393, 'project', 'checkout-e2e', 'sign-in', { repo: 'checkout-e2e', branch: 'test/payments', projectDir: '/c/checkout-e2e', script: 'rig/auth.js' }),
  obs(9395, 'project', 'checkout-e2e', 'api', { repo: 'checkout-e2e', branch: 'test/payments', projectDir: '/c/checkout-e2e', script: 'rig/api.mjs', orphaned: true }),
  obs(3001, 'project', 'memory-mcp', 'api', { repo: 'memory', branch: 'agent/recall', projectDir: '/c/memory/packages/mcp', script: 'src/index.ts' }),
  obs(7700, 'project', 'memory-worker', 'not-http', { repo: 'memory', branch: 'agent/recall', projectDir: '/c/memory/packages/worker' }),
  obs(5622, 'app', 'Local Review', 'page', { tool: 'local-review', repo: 'payments-api', branch: 'feature/refunds', projectDir: '/c/payments-api' }),
  obs(7233, 'app', 'Notebook', 'page', { tool: '@example/notebook', projectDir: '/home/someone/.notebook/service' }),
  obs(3000, 'forwarded', 'juice-shop', 'page', { via: rancher({ container: { name: 'juice-shop', image: 'bkimminich/juice-shop' } }), exposed: true }),
  obs(5432, 'forwarded', 'postgres', 'not-http', { via: rancher({ container: { name: 'postgres', image: 'postgres:16' } }) }),
  obs(4010, 'forwarded', 'Rancher Desktop :4010', 'api', { via: rancher() }),
  obs(6443, 'cluster', 'Kubernetes API server', 'sign-in', { via: rancher({ kubernetes: { name: 'API server', namespace: null, system: true } }) }),
  obs(10250, 'cluster', 'Kubernetes kubelet', 'sign-in', { via: rancher({ kubernetes: { name: 'kubelet', namespace: null, system: true } }) }),
  obs(6107, 'internal', 'Rancher Desktop', 'sign-in', { app: { name: 'Rancher Desktop', bundleId: 'io.rancherdesktop.app' } }),
  obs(8769, 'internal', 'Example Verify', 'empty', { app: { name: 'Example Verify', bundleId: 'com.example.verify' } }),
  obs(4555, 'other', 'mystery :4555', 'not-http'),
];

describe('trayGroups', () => {
  const groups = trayGroups(MACHINE, 'darwin');
  test('groups in order: your projects, apps on this Mac, each forwarding tool, app internals, other', () => {
    assert.deepEqual(groups.map((g) => g.title), ['Your projects', 'Apps on this Mac', 'Rancher Desktop', 'App internals', 'Other']);
    assert.deepEqual(groups.map((g) => g.rows.length), [7, 2, 5, 2, 1]);
    assert.equal(trayGroups(MACHINE, 'linux')[1].title, 'Apps on this computer');
    assert.equal(machineWord('win32'), 'this PC');
  });
  test("a repository's checkouts and worktrees are one set; sets with pages first", () => {
    const p = groups[0];
    assert.deepEqual(p.sets.map((s) => `${s.title}: ${s.rows.map((o) => o.port).join(' ')}`), ['storefront: 5571 5572', 'checkout-e2e: 9393 4001 9395', 'memory: 3001 7700']);
  });
  test('rows: pages first, then sign-ins, redirects, APIs, … not HTTP last', () => {
    const fwd = groups[2];
    assert.deepEqual(fwd.sets[0].rows.map((o) => o.port), [3000, 4010, 5432]);
  });
  test("a tool's cluster folds away under it; app internals and an all-quiet Other fold whole", () => {
    const fwd = groups[2];
    assert.equal(fwd.blurb, 'Containers and Kubernetes');
    assert.deepEqual(fwd.sets.map((s) => [s.title, s.folded, s.rows.length]), [[null, false, 3], ['Kubernetes', true, 2]]);
    assert.equal(groups[3].folded, true);
    assert.equal(groups[4].folded, true, 'nothing in it serves a page');
    assert.equal(trayGroups([obs(4555, 'other', 'Mystery', 'page')])[0].folded, false, 'a page is worth seeing');
    assert.equal(groups[0].folded, false);
  });
  test('one group alone; nothing at all', () => {
    assert.deepEqual(trayGroups([MACHINE[0]]).map((g) => g.title), ['Your projects']);
    assert.deepEqual(trayGroups([]), []);
  });
  test('an SSH tunnel and k3s itself get their own groups', () => {
    const ssh = obs(8080, 'forwarded', 'Tunnel to build.example.com', 'page', { via: { tool: { id: 'ssh', name: 'SSH tunnel' }, container: null, kubernetes: null, host: 'build.example.com' } });
    const k3s = obs(6443, 'cluster', 'Kubernetes API server', 'sign-in', { via: { tool: { id: 'kubernetes', name: 'Kubernetes' }, container: null, kubernetes: { name: 'API server', namespace: null, system: true } } });
    assert.deepEqual(trayGroups([ssh, k3s]).map((g) => `${g.key} ${g.blurb}`), ['forwarded:ssh Ports forwarded over SSH', 'forwarded:kubernetes The cluster’s own components']);
  });
  test('folded groups say what they hold', () => {
    assert.equal(foldSummary(groups[3]), 'Rancher Desktop, Example Verify');
  });
});

describe('rowLabels', () => {
  const groups = trayGroups(MACHINE, 'darwin');
  const set = (title: string) => groups[0].sets.find((s) => s.title === title)!;
  const labels = (title: string) => [...rowLabels(set(title)).values()].map((l) => `${l.title}${l.mono ? '' : ' (name)'}${l.detail ? ` · ${l.detail}` : ''}`);
  test("a checkout and its worktree: by branch", () => {
    assert.deepEqual(labels('storefront'), ['main', 'feature/cart']);
    assert.equal(set('storefront').detail, null, 'different branches: none in the heading');
  });
  test('several servers in one checkout: by script, the shared branch in the heading', () => {
    assert.equal(set('checkout-e2e').detail, '@ test/payments');
    assert.deepEqual(labels('checkout-e2e'), ['rig/auth.js', 'rig/proxy.mjs', 'rig/api.mjs']);
  });
  test("a monorepo's packages: by package", () => {
    assert.deepEqual(labels('memory'), ['memory-mcp (name)', 'memory-worker (name)']);
  });
  test('outside a repository: the name and its context; an unidentified forward says so', () => {
    const fwd = groups[2].sets[0];
    assert.deepEqual([...rowLabels(fwd).values()].map((l) => `${l.title} · ${l.detail}`), ['juice-shop · bkimminich/juice-shop', 'Unidentified forward · null', 'postgres · postgres:16']);
  });
  test("a tool's context is where it runs; an installed app's, its directory", () => {
    const t = (p: string) => p.replace('/home/someone', '~');
    assert.equal(rowContext(MACHINE[7], t), 'local-review, in payments-api @ feature/refunds');
    assert.equal(rowContext(MACHINE[8], t), '@example/notebook, in ~/.notebook/service');
    assert.equal(rowContext(MACHINE[15], t), 'com.example.verify');
  });
});

describe('answers', () => {
  const a = (kind: HttpAnswer['kind'], x: Partial<HttpAnswer> = {}): HttpAnswer => ({ kind, status: 200, tls: false, location: null, ...x });
  test('in words', () => {
    assert.equal(answerText(a('page')), 'Web page');
    assert.equal(answerText(a('api')), 'API');
    assert.equal(answerText(a('sign-in', { status: 401 })), 'Needs sign-in');
    assert.equal(answerText(a('redirect', { status: 308, location: '/app/' })), 'Redirects to /app/');
    assert.equal(answerText(a('redirect', { status: 308, location: 'https://docs.example.com/x' })), 'Redirects to docs.example.com');
    assert.equal(answerText(a('error', { status: 503 })), 'Error 503');
    assert.equal(answerText(a('empty', { status: 404 })), 'Nothing at /');
    assert.equal(answerText(a('empty', { status: 400 })), 'HTTP 400');
    assert.equal(answerText(a('not-http', { status: null })), 'Not HTTP');
    assert.equal(shortLocation('/a/very/long/path/that/goes/on/and/on'), '/a/very/long/path/that/…');
  });
  test('only what a browser can show gets Open', () => {
    assert.deepEqual(MACHINE.filter(openable).map((o) => o.port), [5571, 5572, 4001, 9393, 5622, 7233, 3000, 6443, 10250, 6107]);
  });
  test('an unidentified forward is called that', () => {
    assert.equal(rowName(MACHINE[11]), 'Unidentified forward');
    assert.equal(rowName(MACHINE[9]), 'juice-shop');
  });
});

describe('searchFields: one place for what a row can be found by', () => {
  test('name first, then port, group, repository, branch, script, tool, app, container and image, forwarder…', () => {
    const groups = trayGroups(MACHINE, 'darwin');
    const f = searchFields(MACHINE[9], groups[2]);
    assert.equal(f[0], 'juice-shop');
    for (const x of [3000, 'Rancher Desktop', 'bkimminich/juice-shop', 'Web page']) assert.ok(f.includes(x), String(x));
    const s = searchFields(MACHINE[4], groups[0]);
    for (const x of ['checkout-e2e', 'test/payments', 'rig/api.mjs', 'Your projects']) assert.ok(s.includes(x), x);
  });
});
