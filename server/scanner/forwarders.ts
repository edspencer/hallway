// Port forwarders (D72): a listener held by a container tool's VM (Rancher Desktop's and Colima's Lima `ssh`, Docker
// Desktop's backend, OrbStack, Podman's gvproxy, `docker-proxy`), `kubectl port-forward` or an SSH tunnel isn't the app:
// it carries the port for something else. This names the tool from the process name and command line (pure), and
// asks the tool's own CLI, read-only, which container or Kubernetes service is behind each port (`lookupBehind`).
// A cluster's own components (the API server, kubelet…) are named from their well-known ports.
import os from 'node:os';
import path from 'node:path';
import type { ForwarderTool, ListenerVia } from '../../shared/api.js';
import { findTool } from '../platform/fronting.js';
import { run as runCommand } from '../platform/listeners.js';
import { identifyTool } from '../proxy/conflicts.js';

/** Processes that forward ports rather than serve them. Linux truncates names to 15 characters, hence the prefixes. */
const FORWARDER_PROCESS = /^(ssh|limactl|gvproxy|vpnkit|com\.docker\.|docker-proxy|rootlessport|slirp4netns|pasta|OrbStack|orbstack|kubectl|colima)/i;

/** The cluster's own processes, when Kubernetes runs on this machine directly (k3s on Linux). */
const CLUSTER_PROCESS = /^(k3s|kubelet|kube-apiserver|kube-proxy|kube-controller|kube-scheduler|etcd|containerd-shim)/i;

/** Tools that can run Kubernetes, and their kubectl context. */
const KUBE_CONTEXT: Partial<Record<ForwarderTool, string>> = {
  'rancher-desktop': 'rancher-desktop',
  colima: 'colima',
  orbstack: 'orbstack',
  'docker-desktop': 'docker-desktop',
};

/** Each tool's docker context, tried first so another tool's daemon isn't asked about this one's ports. */
const DOCKER_CONTEXT: Partial<Record<ForwarderTool, string>> = {
  'rancher-desktop': 'rancher-desktop',
  colima: 'colima',
  orbstack: 'orbstack',
  'docker-desktop': 'desktop-linux',
};

/** A Kubernetes cluster's own components, by their well-known ports (k3s and kubeadm alike). */
export const KUBERNETES_PORTS: Readonly<Record<number, string>> = {
  6443: 'API server',
  6444: 'API server (internal)',
  2379: 'etcd',
  2380: 'etcd peers',
  10010: 'container runtime streaming',
  10248: 'kubelet health',
  10249: 'kube-proxy metrics',
  10250: 'kubelet',
  10256: 'kube-proxy health',
  10257: 'controller manager',
  10258: 'cloud controller manager',
  10259: 'scheduler',
};

/** ssh's options that take an argument (`ssh -L 8080:localhost:80 -p 2222 me@host`). */
const SSH_ARG_OPTIONS = new Set('BbcDEeFIiJLlmOoPpQRSWw'.split(''));

/** Where an SSH tunnel goes: the destination argument, without the user. */
export function sshHost(argv: readonly string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return argv[i + 1]?.replace(/^.*@/, '') ?? null;
    if (a.startsWith('-')) {
      // `-L8080:…` carries its argument; `-L 8080:…` takes the next word; `-Nf` is flags only
      const flags = a.slice(1);
      const k = [...flags].findIndex((c) => SSH_ARG_OPTIONS.has(c));
      if (k !== -1 && k === flags.length - 1) i++;
      continue;
    }
    return a.replace(/^ssh:\/\//, '').replace(/^.*@/, '').replace(/:\d+$/, '') || null;
  }
  return null;
}

/** What `kubectl port-forward` forwards: `svc/web` → `web`, with its namespace (`-n`). */
function portForwardTarget(argv: readonly string[]): { name: string; namespace: string | null } | null {
  const i = argv.indexOf('port-forward');
  if (i === -1) return null;
  let namespace: string | null = null;
  let name: string | null = null;
  for (let j = i + 1; j < argv.length; j++) {
    const a = argv[j];
    if (a === '-n' || a === '--namespace') namespace = argv[++j] ?? null;
    else if (a.startsWith('--namespace=')) namespace = a.slice(12);
    else if (a.startsWith('-')) continue;
    else if (!name) name = a.replace(/^(svc|service|pod|po|deploy|deployment|statefulset|sts)\//, '');
  }
  return name ? { name, namespace } : null;
}

/**
 * The tool forwarding this listener's port, or null when it serves the port itself. Looks only at the process: which
 * container or service is behind the port is `lookupBehind`'s.
 */
export function forwarderOf(process: string | null, command: string | null, argv: readonly string[] | null): ListenerVia | null {
  const exe = argv?.[0] ? argv[0].split(/[\\/]/).at(-1)! : null;
  const names = [process, exe].filter((n): n is string => !!n);
  const words = argv ?? command?.split(/\s+/) ?? [];
  const via = (id: ForwarderTool, name: string, rest: Partial<ListenerVia> = {}): ListenerVia => ({ tool: { id, name }, container: null, kubernetes: null, ...rest });
  if (names.some((n) => CLUSTER_PROCESS.test(n))) return via('kubernetes', 'Kubernetes');
  if (!names.some((n) => FORWARDER_PROCESS.test(n))) return null;
  if (names.some((n) => /^kubectl/i.test(n))) {
    const target = portForwardTarget(words);
    return target ? via('kubectl', 'kubectl port-forward', { kubernetes: { ...target, system: false } }) : null;
  }
  const tool = identifyTool(process, command);
  if (tool?.containers) return via(tool.id, tool.name);
  if (names.some((n) => /^ssh$/i.test(n))) return via('ssh', 'SSH tunnel', { host: sshHost(words) });
  if (names.some((n) => /^(docker-proxy)$/i.test(n))) return via('docker-desktop', 'Docker');
  if (names.some((n) => /^(rootlessport|gvproxy)$/i.test(n))) return via('podman', 'Podman');
  return null;
}

/** A port a container publishes on the host. */
export interface Published {
  port: number;
  name: string;
  image: string | null;
}

/** A Kubernetes service reachable on a host port (a LoadBalancer's port, or a NodePort). */
export interface ServicePort {
  port: number;
  name: string;
  namespace: string | null;
}

/** `0.0.0.0:3000->3000/tcp, :::3000->3000/tcp, 127.0.0.1:8000-8001->8000-8001/tcp` → the host ports. */
export function publishedPorts(ports: string): number[] {
  const out = new Set<number>();
  for (const m of ports.matchAll(/:(\d+)(?:-(\d+))?->\d+(?:-\d+)?\/tcp/gi)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let p = from; p <= to && p - from < 1024; p++) out.add(p);
  }
  return [...out];
}

/**
 * `docker ps --format '{{json .}}'` or `nerdctl ps --format '{{json .}}'` (one object per line, `Ports` a string), or
 * `podman ps --format json` (one array, `Ports` a list): which container publishes which host port.
 */
export function parseContainers(stdout: string): Published[] {
  const out: Published[] = [];
  const add = (names: unknown, image: unknown, ports: number[]) => {
    const name = (Array.isArray(names) ? names[0] : typeof names === 'string' ? names.split(',')[0] : '')?.trim().replace(/^\//, '');
    if (!name) return;
    for (const port of ports) out.push({ port, name, image: typeof image === 'string' && image ? image : null });
  };
  const text = stdout.trim();
  if (!text) return out;
  if (text.startsWith('[')) {
    try {
      for (const c of JSON.parse(text) as Record<string, unknown>[]) {
        const ports = Array.isArray(c.Ports)
          ? (c.Ports as Record<string, unknown>[]).flatMap((p) => {
              const host = Number(p.host_port ?? p.hostPort);
              const range = Math.max(1, Number(p.range ?? 1));
              return (p.protocol ?? 'tcp') === 'tcp' && host ? Array.from({ length: Math.min(range, 1024) }, (_, k) => host + k) : [];
            })
          : typeof c.Ports === 'string'
            ? publishedPorts(c.Ports)
            : [];
        add(c.Names, c.Image, ports);
      }
    } catch {
      /* not JSON after all */
    }
    return out;
  }
  for (const line of text.split('\n')) {
    try {
      const c = JSON.parse(line) as Record<string, unknown>;
      add(c.Names, c.Image, typeof c.Ports === 'string' ? publishedPorts(c.Ports) : []);
    } catch {
      /* a warning line */
    }
  }
  return out;
}

/** `kubectl get svc -A -o json`: the host ports its services are reachable on (a LoadBalancer's port, a NodePort). */
export function parseServices(stdout: string): ServicePort[] {
  const out: ServicePort[] = [];
  let doc: { items?: { metadata?: { name?: string; namespace?: string }; spec?: { type?: string; ports?: { port?: number; nodePort?: number; protocol?: string }[] } }[] };
  try {
    doc = JSON.parse(stdout);
  } catch {
    return out;
  }
  for (const s of doc.items ?? []) {
    const name = s.metadata?.name;
    const type = s.spec?.type;
    if (!name || (type !== 'LoadBalancer' && type !== 'NodePort')) continue;
    for (const p of s.spec?.ports ?? []) {
      if ((p.protocol ?? 'TCP') !== 'TCP') continue;
      const ns = s.metadata?.namespace ?? null;
      if (type === 'LoadBalancer' && p.port) out.push({ port: p.port, name, namespace: ns });
      if (p.nodePort) out.push({ port: p.nodePort, name, namespace: ns });
    }
  }
  return out;
}

export type QueryRunner = (cmd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; stdout: string }>;

export interface BehindOptions {
  run?: QueryRunner;
  env?: NodeJS.ProcessEnv;
  home?: string;
  timeoutMs?: number;
}

/** Where each tool keeps its CLIs, which a LaunchAgent's PATH doesn't have. Searched before PATH: the tool's own CLI
 *  talks to the tool's own engine. */
function toolDirs(id: ForwarderTool, home: string): string[] {
  switch (id) {
    case 'rancher-desktop':
      return [path.join(home, '.rd', 'bin')];
    case 'orbstack':
      return [path.join(home, '.orbstack', 'bin')];
    case 'docker-desktop':
      return ['/Applications/Docker.app/Contents/Resources/bin', '/usr/local/bin'];
    default:
      return ['/opt/homebrew/bin', '/usr/local/bin'];
  }
}

/**
 * Which container or Kubernetes service is behind each forwarded port, asked of the tool's own CLIs: `docker ps` and
 * `nerdctl ps` (Rancher Desktop has one or the other, depending on its engine), `podman ps`, and `kubectl get svc` in
 * the tool's own context (never the current one, which may be a real cluster). Read-only, a few seconds at most each,
 * once per scan and only for tools that are forwarding something. Ports that are a cluster's own components, and that
 * no container publishes, are named by their number.
 */
export async function lookupBehind(vias: Map<number, ListenerVia>, opts: BehindOptions = {}): Promise<void> {
  const run = opts.run ?? ((cmd, args, o) => runCommand(cmd, args, { timeoutMs: o?.timeoutMs }));
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const tools = new Map<ForwarderTool, number[]>();
  for (const [port, v] of vias) {
    if (v.tool.id === 'ssh' || v.tool.id === 'kubectl' || v.tool.id === 'kubernetes') continue;
    tools.set(v.tool.id, [...(tools.get(v.tool.id) ?? []), port]);
  }
  await Promise.all(
    [...tools].map(async ([id, ports]) => {
      const dirs = toolDirs(id, home);
      // the tool's own directories first, then PATH
      const find = (name: string) => findTool(name, dirs.join(path.delimiter), []) ?? findTool(name, env.PATH, []);
      const ask = async (cli: string | null, args: string[], context?: string) => {
        if (!cli) return '';
        if (context) {
          const r = await run(cli, ['--context', context, ...args], { timeoutMs });
          if (r.ok) return r.stdout;
        }
        const r = await run(cli, args, { timeoutMs });
        return r.ok ? r.stdout : '';
      };
      const json = ['ps', '--format', '{{json .}}'];
      const outputs = await Promise.all([
        ask(find('docker'), json, DOCKER_CONTEXT[id]),
        id === 'rancher-desktop' || id === 'lima' || id === 'colima' ? ask(find('nerdctl'), json) : '',
        id === 'podman' ? ask(find('podman'), ['ps', '--format', 'json']) : '',
      ]);
      const published = new Map<number, Published>();
      for (const out of outputs) for (const p of parseContainers(out)) if (!published.has(p.port)) published.set(p.port, p);
      for (const port of ports) {
        const c = published.get(port);
        if (c) vias.get(port)!.container = { name: c.name, image: c.image };
      }
      const context = KUBE_CONTEXT[id];
      const left = ports.filter((p) => !published.has(p) && !(KUBERNETES_PORTS[p] && context));
      if (!context || !left.length) return;
      const kubectl = find('kubectl');
      if (!kubectl) return;
      const r = await run(kubectl, ['--context', context, 'get', 'svc', '--all-namespaces', '--output', 'json', '--request-timeout', '3s'], { timeoutMs });
      if (!r.ok) return;
      const services = new Map(parseServices(r.stdout).map((s) => [s.port, s]));
      for (const port of left) {
        const s = services.get(port);
        if (s) vias.get(port)!.kubernetes = { name: s.name, namespace: s.namespace, system: false };
      }
    }),
  );
  // a cluster's own components: by port, when nothing published it (a container on 6443 is the container)
  for (const [port, v] of vias) {
    const system = KUBERNETES_PORTS[port];
    if (system && !v.container && !v.kubernetes && (v.tool.id === 'kubernetes' || KUBE_CONTEXT[v.tool.id] || v.tool.id === 'lima'))
      v.kubernetes = { name: system, namespace: null, system: true };
  }
}
