// Something else on 443/80 (server/proxy/conflicts.ts, D71): each tool told from its listener and command line, as
// lsof/ps (macOS) and ss (Linux) report them in test/fixtures/conflicts/, with its own fix; one message per process
// (or tool), whatever ports it holds; the setup run that stops before anything changes, and `--port` for Caddy's own.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PortConflict } from '../shared/api.ts';
import { parseLsofListeners, darwinProcesses } from '../server/platform/darwin.ts';
import { parseSs } from '../server/platform/linux.ts';
import type { ProcessInfo, RawListener } from '../server/platform/listeners.ts';
import { platformFor } from '../server/platform/index.ts';
import { type WantedPort, conflictTitle, conflictsOf, formatConflict, identifyTool, shortCommand, whoHolds } from '../server/proxy/conflicts.ts';
import { chosenCaddyPorts, isOurForwarder, lowPortsFor, portChoice } from '../server/proxy/setup.ts';
import { ROOT } from './fixture.ts';

const DIR = path.join(ROOT, 'test', 'fixtures', 'conflicts');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const LOW: WantedPort[] = [443, 80].map((port) => ({ port, kind: 'standard' as const, oursIf: isOurForwarder }));
const HOME = '/Users/someone';

/** A platform whose listeners and processes are a fixture's. */
function fake(raw: RawListener[], info: Map<number, ProcessInfo>) {
  return { listListeners: async () => raw, processInfo: async (pids: number[]) => new Map([...info].filter(([p]) => pids.includes(p))) };
}

async function onMac(tool: string, container: (port: number) => Promise<string | null> = async () => null): Promise<PortConflict[]> {
  const raw = parseLsofListeners(read(`${tool}.lsof`));
  const pids = [...new Set(raw.map((r) => r.pid!))];
  const { holders } = await whoHolds(fake(raw, darwinProcesses(pids, read('ps.txt'), '', '')), LOW);
  return conflictsOf(holders, 'darwin', container, HOME);
}

describe('who holds 443/80 on a Mac, by tool (D71)', () => {
  test("Rancher Desktop: its Lima VM's ssh forwarding Traefik on *:443 and *:80 is one message, with Traefik's switch", async () => {
    const [c, ...more] = await onMac('rancher-desktop');
    assert.equal(more.length, 0, '443 and 80 from one process: one message');
    assert.deepEqual([c.tool?.id, c.ports, c.pid, c.exposed], ['rancher-desktop', [443, 80], 7090, true]);
    assert.equal(c.command, 'ssh: ~/Library/Application Support/rancher-desktop/lima/0/ssh.sock [mux]');
    assert.match(c.fix[0], /Preferences → Kubernetes and untick "Enable Traefik"/);
    assert.match(c.fix[1], /`rdctl set --kubernetes\.options\.traefik=false`/);
    assert.equal(conflictTitle(c), 'Ports 443 and 80 are taken by Rancher Desktop');
    assert.equal(
      formatConflict(c),
      [
        "Ports 443 and 80 are taken by Rancher Desktop: Rancher Desktop (ssh, pid 7090: ssh: ~/Library/Application Support/rancher-desktop/lima/0/ssh.sock [mux]), listening on *, so reachable from your network, not just this machine. Hallway won't fight it for the ports.",
        '  To free it: in Rancher Desktop, open Preferences → Kubernetes and untick "Enable Traefik": Traefik is its Kubernetes ingress, and it holds 80 and 443 (or untick "Enable Kubernetes" if you don\'t use it)',
        '  or, from a terminal: `rdctl set --kubernetes.options.traefik=false`',
      ].join('\n'),
    );
  });

  test('Rancher Desktop with a container publishing 443: the container, not Traefik', async () => {
    const [c] = await onMac('rancher-desktop', async (p) => (p === 443 ? 'web-proxy' : null));
    assert.equal(c.container, 'web-proxy');
    assert.deepEqual(c.fix, ['stop the container publishing it: `docker stop web-proxy` (or publish it on another port, e.g. `-p 8443:443`)']);
  });

  test('Docker Desktop: com.docker.backend, the container named by `docker ps`', async () => {
    const [c] = await onMac('docker-desktop', async () => 'my-ingress');
    assert.deepEqual([c.tool?.name, c.ports, c.exposed, c.container], ['Docker Desktop', [443], true, 'my-ingress']);
    assert.match(formatConflict(c), /^Port 443 is taken by Docker Desktop: Docker Desktop \(com\.docke, pid 812: \/Applications\/Docker\.app\/Contents\/MacOS\/com\.docker\.backend services\), for the container my-ingress, listening on \*, ::/);
  });

  test('Docker Desktop with no docker CLI to ask: how to find the container', async () => {
    const [c] = await onMac('docker-desktop');
    assert.equal(c.container, null);
    assert.match(c.fix[0], /`docker ps --filter publish=443` names it/);
  });

  test('Colima: its ssh mux on loopback only (not exposed)', async () => {
    const [c] = await onMac('colima');
    assert.deepEqual([c.tool?.id, c.ports, c.exposed], ['colima', [443, 80], false]);
    assert.match(formatConflict(c), /listening on 127\.0\.0\.1, ::1\. Hallway won't fight it/);
    assert.match(c.fix.join(' '), /docker ps --filter publish=443/);
  });

  test('OrbStack: OrbStack Helper', async () => {
    const [c] = await onMac('orbstack');
    assert.deepEqual([c.tool?.id, c.process, c.ports], ['orbstack', 'OrbStack ', [443, 80]]);
    assert.match(c.fix.join(' '), /kubectl get svc -A/);
  });

  test('Lima: limactl hostagent', async () => {
    const [c] = await onMac('lima');
    assert.equal(c.tool?.id, 'lima');
    assert.match(c.fix[0], /`limactl list` names them/);
  });

  test("nginx: master and worker are one message, with Homebrew's way to stop it", async () => {
    const all = await onMac('nginx');
    assert.equal(all.length, 1);
    assert.deepEqual([all[0].tool?.id, all[0].ports, all[0].pid], ['nginx', [443, 80], 990]);
    assert.match(all[0].fix[0], /`brew services stop nginx`/);
  });

  test('anything else: named by process and pid, with a generic fix', async () => {
    const [c] = await onMac('node');
    assert.equal(c.tool, null);
    assert.equal(conflictTitle(c), 'Port 443 is taken by node');
    assert.match(formatConflict(c), /node \(pid 4321: node ~\/Code\/my-app\/server\.js\), listening on 127\.0\.0\.1\./);
    assert.deepEqual(c.fix, ["stop it if you don't need it (`kill 4321`), or move it to another port"]);
  });

  test("Hallway's own forwarders aren't conflicts", async () => {
    const raw: RawListener[] = [{ pid: 77, process: 'node', port: 443, address: '127.0.0.1' }];
    const info = new Map([[77, { pid: 77, ppid: 1, command: '/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/hallway/dist/server/cli.js forward 4443', argv: null, cwd: null, startTime: null, orphan: false, supervisor: null }]]) as Map<number, ProcessInfo>;
    const { holders, seen } = await whoHolds(fake(raw, info), LOW);
    assert.deepEqual([holders, [...seen]], [[], [443]]);
  });

  test("a holder nobody can see (root's): sudo lsof names it", async () => {
    const [c] = await conflictsOf([{ port: 443, kind: 'standard', pid: null, process: null, command: null, addresses: [] }], 'darwin');
    assert.equal(conflictTitle(c), "Port 443 is taken by a process you can't see");
    assert.match(formatConflict(c), /^Port 443 is taken by a process you can't see \(another user's, perhaps root's\)\. Hallway won't fight it for the port\.\n/);
    assert.match(c.fix[0], /sudo lsof -nP -iTCP:443 -sTCP:LISTEN/);
  });
});

describe('who holds 443/80 on Linux', () => {
  test("Docker's two docker-proxy processes are one message; nginx is another, with systemctl", async () => {
    const raw = parseSs(read('linux.ss'));
    const info = new Map<number, ProcessInfo>(
      [
        [2201, '/usr/bin/docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 443 -container-ip 172.17.0.2 -container-port 443'],
        [2208, '/usr/bin/docker-proxy -proto tcp -host-ip :: -host-port 443 -container-ip 172.17.0.2 -container-port 443'],
        [1100, 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;'],
      ].map(([pid, command]) => [pid as number, { pid: pid as number, ppid: 1, command: command as string, argv: null, cwd: null, startTime: null, orphan: false, supervisor: null } as ProcessInfo]),
    );
    const { holders } = await whoHolds(fake(raw, info), LOW);
    const all = await conflictsOf(holders, 'linux', async () => 'proxy');
    assert.deepEqual(
      all.map((c) => [c.tool?.name, c.ports, c.addresses, c.container]),
      [
        ['Docker', [443], ['0.0.0.0', '::'], 'proxy'],
        ['nginx', [80], ['0.0.0.0'], null],
      ],
    );
    assert.match(all[1].fix[0], /sudo systemctl stop nginx/);
  });
});

describe('identifying a tool', () => {
  test('from the process name and command line', () => {
    const id = (p: string | null, c: string | null) => identifyTool(p, c)?.id ?? null;
    assert.equal(id('ssh', 'ssh: /Users/a/Library/Application Support/rancher-desktop/lima/0/ssh.sock [mux]'), 'rancher-desktop');
    assert.equal(id('limactl', '/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/lima/bin/limactl hostagent 0'), 'rancher-desktop');
    assert.equal(id('ssh', 'ssh: /Users/a/.colima/_lima/colima/ssh.sock [mux]'), 'colima');
    assert.equal(id('gvproxy', '/opt/homebrew/Cellar/podman/5.2.0/libexec/podman/gvproxy -listen-qemu …'), 'podman');
    assert.equal(id('httpd', '/usr/sbin/httpd -D FOREGROUND'), 'apache');
    assert.equal(id('caddy', '/opt/homebrew/opt/caddy/bin/caddy run --config /opt/homebrew/etc/Caddyfile'), 'caddy');
    assert.equal(id('ssh', 'ssh -N -L 443:localhost:8443 example.com'), null);
  });

  test('a command line is shortened with ~ for the home directory', () => {
    assert.equal(shortCommand('/Users/a/x', '/Users/a'), '~/x');
    assert.equal(shortCommand('x'.repeat(100))!.length, 88);
  });
});

describe('--port: links on Caddy\'s own port (D71)', () => {
  const mac = platformFor('darwin');
  const linux = platformFor('linux');
  const proxy = { httpsPort: 4443, httpPort: 4480 };
  test('the standard port or Caddy\'s, per tier and platform', () => {
    assert.equal(portChoice(mac, 'user', proxy, 4443), 'caddy');
    assert.equal(portChoice(mac, 'user', proxy, 443), 'standard');
    assert.equal(portChoice(mac, 'none', proxy, 4480), 'caddy');
    assert.equal(portChoice(mac, 'none', proxy, 80), 'standard');
    assert.match(portChoice(mac, 'none', proxy, 4443) as string, /--port is 80 \(the default\) or Caddy's own port, 4480/);
    assert.match(portChoice(mac, 'user', proxy, 8443) as string, /--port is 443 \(the default\) or Caddy's own port, 4443 \(proxy\.httpsPort/);
    assert.match(portChoice(linux, 'user', proxy, 443) as string, /can't have port 443 on Linux/);
    assert.equal(portChoice(linux, 'system', proxy, 4443), 'caddy');
    assert.match(portChoice(linux, 'user', proxy, 8443) as string, /^--port is Caddy's own port here, 4443/);
  });

  const cfg = (over: { mode?: 'direct' | 'fronted'; trust?: 'user' | 'system' | 'none' | null; publicPort?: number; scheme?: 'https' | 'http' }) => ({
    mode: over.mode ?? 'fronted',
    proxy: { caddy: null, httpsPort: 4443, httpPort: 4480, publicPort: over.publicPort ?? 443, trust: over.trust === undefined ? 'user' : over.trust, scheme: over.scheme ?? 'https' },
  }) as never;

  test('the choice is remembered from config.yaml, and only where 443/80 were possible', () => {
    assert.equal(chosenCaddyPorts(mac, cfg({ publicPort: 4443 })), true);
    assert.equal(chosenCaddyPorts(mac, cfg({ publicPort: 443 })), false);
    assert.equal(chosenCaddyPorts(mac, cfg({ trust: 'none', scheme: 'http', publicPort: 4480 })), true);
    // Linux's User certificate always carries the port: not a choice, so System-wide gets its redirect
    assert.equal(chosenCaddyPorts(linux, cfg({ publicPort: 4443 })), false);
    assert.equal(lowPortsFor(linux, 'system', cfg({ publicPort: 4443 })), 'redirect');
    assert.equal(chosenCaddyPorts(linux, cfg({ trust: 'system', publicPort: 4443 })), true);
    // hand-set before the tiers (D47)
    assert.equal(chosenCaddyPorts(linux, cfg({ mode: 'direct', trust: null, publicPort: 4443 })), true);
  });

  test('--port wins over what config.yaml chose; without it, the choice is kept', () => {
    assert.equal(lowPortsFor(mac, 'user', cfg({ publicPort: 4443 })), 'none');
    assert.equal(lowPortsFor(mac, 'user', cfg({ publicPort: 4443 }), 'standard'), 'sockets');
    assert.equal(lowPortsFor(mac, 'user', cfg({}), 'caddy'), 'none');
    assert.equal(lowPortsFor(mac, 'user', cfg({})), 'sockets');
  });
});

describe('setup with Rancher Desktop on 443/80 (D71)', () => {
  /** macOS with Rancher Desktop's ssh on *:443 and *:80, a Caddy that says its version, and a service manager that
   *  records anything that would change the machine. */
  async function rig() {
    const { tmpStore, tmpDir } = await import('./fixture.ts');
    const s = await tmpStore();
    const dir = tmpDir('hw-test-conflict-');
    fs.writeFileSync(path.join(dir, 'caddy'), '#!/bin/sh\necho v2.11.2\n', { mode: 0o755 });
    const raw = parseLsofListeners(read('rancher-desktop.lsof'));
    const mac = platformFor('darwin');
    const platform = { ...mac, ...fake(raw, darwinProcesses([7090], read('ps.txt'), '', '')) };
    const changed: string[] = [];
    const services = new Proxy({ forwardersInstalled: () => [], helperInstalled: () => false, cliProblem: () => null } as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void changed.push(`${k}(${a.length})`)),
    });
    let out = '';
    const deps = {
      store: s.store,
      platform,
      services: () => services,
      env: { PATH: dir },
      userHome: dir,
      query: async () => ({ code: 0, stdout: 'v2.11.2', stderr: '' }),
      out: (x: string) => void (out += x),
      exec: async (argv: string[]) => (changed.push(argv.join(' ')), 0),
      isRoot: false,
      probe443: async () => 'other' as const,
      atScreen: async () => true,
      container: async () => null,
      tlds: null,
      confirm: { yes: true },
    };
    return { s, dir, deps, changed, out: () => out };
  }

  test("the dashboard's Turn on stops before changing anything, says why ('ports', not Touch ID) and offers Caddy's port", async () => {
    const { setupUnattended, SetupError } = await import('../server/proxy/setup.ts');
    const { rmTmp } = await import('./fixture.ts');
    const r = await rig();
    try {
      const err = (await setupUnattended(r.deps as never, 'user').then(() => null, (e: unknown) => e)) as InstanceType<typeof SetupError>;
      assert.ok(err instanceof SetupError);
      assert.equal(err.reason, 'ports');
      assert.equal(err.altPort, 4443);
      assert.deepEqual(err.conflicts.map((c) => [c.tool?.id, c.ports]), [['rancher-desktop', [443, 80]]]);
      assert.equal(err.message.match(/Hallway won't fight it/g)?.length, 1, 'one message for both ports');
      assert.match(err.message, /`hallway setup --trust user --port 4443` \(links become https:\/\/<app>\.localhost:4443/);
      assert.deepEqual(r.changed, [], 'no job installed, no command run');
      assert.equal(r.out(), '');
      assert.equal(r.s.store.currentConfig().mode, 'direct');
    } finally {
      rmTmp(r.dir);
      r.s.cleanup();
    }
  });

  test('`hallway setup` stops the same way, before the plan runs', async () => {
    const { setup } = await import('../server/proxy/setup.ts');
    const { rmTmp } = await import('./fixture.ts');
    const r = await rig();
    try {
      assert.equal(await setup(r.deps as never, { trust: 'user' }), 1);
      assert.match(r.out(), /✗ Ports 443 and 80 are taken by Rancher Desktop[\s\S]*Then run `hallway setup` again\.\n    Or leave it running[\s\S]*Setup stopped before doing anything\.\n$/);
      assert.deepEqual(r.changed, []);
    } finally {
      rmTmp(r.dir);
      r.s.cleanup();
    }
  });

  test('--port 4443 coexists: no forwarders, links carry :4443, nothing refused', async () => {
    const { setup } = await import('../server/proxy/setup.ts');
    const { rmTmp } = await import('./fixture.ts');
    const r = await rig();
    try {
      assert.equal(await setup(r.deps as never, { trust: 'user', port: 4443, print: true }), 0);
      const text = r.out();
      assert.ok(!/✗/.test(text), text);
      assert.ok(!/launchd hold/.test(text));
      assert.match(text, /! Links carry Caddy's own port, :4443, and nothing is put on 443 and 80\. `hallway setup --port 443` moves them to 443/);
      assert.match(text, /links become https:\/\/<app>\.localhost:4443/);
      assert.match(text, /Check https:\/\/hallway\.localhost:4443 answers, with Hallway's certificate/);
    } finally {
      rmTmp(r.dir);
      r.s.cleanup();
    }
  });
});
