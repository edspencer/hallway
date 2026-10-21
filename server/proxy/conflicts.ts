// Something else on 443/80 (or on Caddy's own ports), for `hallway setup`, doctor and the dashboard (D71). Setup
// never fights for a port: it names what holds it, the tool it belongs to when the command line says (Rancher Desktop's
// Lima VM forwarding Traefik, Docker Desktop, Colima, OrbStack, Podman, Lima, nginx, Apache, another Caddy), that tool's
// own way to let go of it, and, when only 443/80 are in the way, Caddy's own port as the way to coexist
// (`hallway setup --port 4443`). One message per process, whatever ports it holds. Pure, except `whoHolds` (lsof/ss
// and ps through the platform) and `containerOn` (a read-only `docker ps`).
import os from 'node:os';
import type { PortConflict, PortHolder } from '../../shared/api.js';
import { type Platform, type Runner, mergeListeners } from '../platform/index.js';
import { bindScope } from '../platform/listeners.js';
import { findTool } from '../platform/fronting.js';

/** A listener on a wanted port that isn't Hallway's, before it's sorted into one entry per process. */
export interface Holder {
  port: number;
  kind: PortConflict['kind'];
  pid: number | null;
  process: string | null;
  command: string | null;
  addresses: string[];
}

/** The ports to look at: what each is for, and how to tell Hallway's own listener (a forwarder, its Caddy) on it. */
export interface WantedPort {
  port: number;
  kind: PortConflict['kind'];
  oursIf?: (command: string) => boolean;
}

/** Who listens on the wanted ports and isn't Hallway, as the OS reports it. Also which ports had anyone at all (so
 *  the caller knows when lsof saw nothing and a connection is worth trying). */
export async function whoHolds(platform: Pick<Platform, 'listListeners' | 'processInfo'>, want: readonly WantedPort[]): Promise<{ holders: Holder[]; seen: Set<number> }> {
  const listeners = mergeListeners(await platform.listListeners());
  const pids = [...new Set(listeners.map((l) => l.pid).filter((p): p is number => p !== null))];
  const info = pids.length ? await platform.processInfo(pids) : new Map();
  const holders: Holder[] = [];
  const seen = new Set<number>();
  for (const w of want)
    for (const l of listeners.filter((x) => x.port === w.port)) {
      seen.add(w.port);
      const command = l.pid ? (info.get(l.pid)?.command ?? null) : null;
      if (w.oursIf && command && w.oursIf(command)) continue;
      holders.push({ port: w.port, kind: w.kind, pid: l.pid, process: l.process, command, addresses: l.addresses });
    }
  return { holders, seen };
}

interface Tool {
  id: PortHolder;
  name: string;
  /** Matched against the process name and the command line together. */
  test: RegExp;
  /** Port forwards from a VM or containers: `docker ps` may name the container. */
  containers?: boolean;
}

// Order matters: Rancher Desktop and Colima run Lima, so they come before it; the VM tools before the web servers
const TOOLS: Tool[] = [
  { id: 'rancher-desktop', name: 'Rancher Desktop', test: /rancher-desktop|Rancher Desktop\.app/i, containers: true },
  { id: 'colima', name: 'Colima', test: /[/.]colima\b|\bcolima\b/i, containers: true },
  { id: 'orbstack', name: 'OrbStack', test: /orbstack/i, containers: true },
  { id: 'docker-desktop', name: 'Docker Desktop', test: /Docker\.app|com\.docker\.|vpnkit/i, containers: true },
  { id: 'docker-desktop', name: 'Docker', test: /docker-proxy|\bdockerd\b/i, containers: true },
  { id: 'podman', name: 'Podman', test: /gvproxy|podman/i, containers: true },
  { id: 'lima', name: 'Lima', test: /\blimactl\b|[/.]lima\b|\/\.lima\//i, containers: true },
  { id: 'nginx', name: 'nginx', test: /\bnginx\b/i },
  { id: 'apache', name: 'Apache', test: /\bhttpd\b|\bapache2?\b|apachectl/i },
  { id: 'caddy', name: 'another Caddy', test: /\bcaddy\b/i },
];

/** The tool a listener belongs to, from its process name and command line; null when nothing says. */
export function identifyTool(process: string | null, command: string | null): { id: PortHolder; name: string; containers: boolean } | null {
  const text = `${process ?? ''}\n${command ?? ''}`;
  const t = TOOLS.find((x) => x.test.test(text));
  return t ? { id: t.id, name: t.name, containers: !!t.containers } : null;
}

/** Ports, as people say them: `443`, `443 and 80`. */
const portList = (ports: readonly number[]) => (ports.length < 2 ? String(ports[0]) : `${ports.slice(0, -1).join(', ')} and ${ports[ports.length - 1]}`);

/** A command line as messages show it: the home directory as `~`, at most 90 characters. */
export function shortCommand(command: string | null, home = os.homedir()): string | null {
  if (!command) return null;
  let c = command.trim();
  if (home && home !== '/') c = c.split(home + '/').join('~/');
  return c.length > 90 ? c.slice(0, 87) + '…' : c;
}

/** What to do about one holder, in order: the tool's own way to let go of the port, the container if `docker ps`
 *  named one, and a generic way for anything else. */
export function fixFor(c: Pick<PortConflict, 'ports' | 'pid' | 'kind' | 'container'>, toolId: PortHolder | null, platformId: Platform['id']): string[] {
  const ports = portList(c.ports);
  const mac = platformId === 'darwin';
  const one = c.ports[0];
  const container = c.container ? [`stop the container publishing it: \`docker stop ${c.container}\` (or publish it on another port, e.g. \`-p 8443:${one}\`)`] : [];
  const dockerPs = `a container publishing ${ports}: \`docker ps --filter publish=${one}\` names it; stop it, or publish it on another port (e.g. \`-p 8443:${one}\`)`;
  if (c.kind === 'hallway') {
    const base = c.pid ? `stop it (pid ${c.pid})` : 'stop it';
    return [`${base}, or give Hallway other ports in config.yaml (proxy.httpsPort, proxy.httpPort, domain.dnsPort)`];
  }
  switch (toolId) {
    case 'rancher-desktop':
      if (container.length) return container;
      return [
        'in Rancher Desktop, open Preferences → Kubernetes and untick "Enable Traefik": Traefik is its Kubernetes ingress, and it holds 80 and 443 (or untick "Enable Kubernetes" if you don\'t use it)',
        'or, from a terminal: `rdctl set --kubernetes.options.traefik=false`',
      ];
    case 'docker-desktop':
      return container.length ? container : [dockerPs];
    case 'colima':
      return container.length ? container : [dockerPs, 'or, if it\'s Colima\'s Kubernetes, a service of type LoadBalancer on that port: `kubectl get svc -A` lists them'];
    case 'orbstack':
      return container.length ? container : [dockerPs, 'or, if it\'s OrbStack\'s Kubernetes, a service of type LoadBalancer on that port: `kubectl get svc -A` lists them'];
    case 'podman':
      return container.length ? container.map((s) => s.replace('docker stop', 'podman stop')) : [dockerPs.replace(/docker ps/, 'podman ps')];
    case 'lima':
      return container.length ? container : [`a port forward from a Lima VM: \`limactl list\` names them; stop the container or server publishing ${ports} in it, or \`limactl stop <name>\``];
    case 'nginx':
      return [mac ? '`brew services stop nginx` if Homebrew runs it (otherwise `sudo nginx -s stop`)' : '`sudo systemctl stop nginx` (and `sudo systemctl disable nginx` to keep it off)', `or change its \`listen ${one}\` lines to another port`];
    case 'apache':
      return [mac ? '`sudo apachectl stop` (macOS\'s own Apache), or `brew services stop httpd` if Homebrew runs it' : '`sudo systemctl stop apache2` (or `httpd`)', `or change its \`Listen ${one}\` line to another port`];
    case 'caddy':
      return [mac ? '`brew services stop caddy` if Homebrew runs it' : '`sudo systemctl stop caddy` if your package manager runs it', 'Hallway runs its own Caddy, so another one only needs 80 and 443 for sites of its own'];
    default:
      if (!c.pid) return [`it isn't yours to see (root's, perhaps): \`sudo lsof -nP -iTCP:${one} -sTCP:LISTEN\` names it; stop it`];
      return [`stop it if you don't need it (\`kill ${c.pid}\`), or move it to another port`];
  }
}

/** Holders → one conflict per process, or per tool when one is recognised (443 and 80 held by the same ssh are one
 *  message, and so are nginx's master and workers, or Docker's two docker-proxy processes), each with its tool and
 *  fix. `container` names the container publishing a port, when `docker ps` can tell. */
export async function conflictsOf(holders: readonly Holder[], platformId: Platform['id'], container: (port: number) => Promise<string | null> = async () => null, home = os.homedir()): Promise<PortConflict[]> {
  const byProcess = new Map<string, Holder[]>();
  for (const h of holders) {
    const key = `${h.kind} ${identifyTool(h.process, h.command)?.id ?? h.pid ?? `?${h.port}`}`;
    byProcess.set(key, [...(byProcess.get(key) ?? []), h]);
  }
  const out: PortConflict[] = [];
  for (const hs of byProcess.values()) {
    const h = hs[0];
    const ports = [...new Set(hs.map((x) => x.port))].sort((a, b) => (a === 443 ? -1 : b === 443 ? 1 : a - b));
    const addresses = [...new Set(hs.flatMap((x) => x.addresses))].sort();
    const tool = identifyTool(h.process, h.command);
    let name: string | null = null;
    if (tool?.containers && h.kind === 'standard') for (const p of ports) if ((name = await container(p))) break;
    const c: PortConflict = {
      ports,
      kind: h.kind,
      pid: h.pid,
      process: h.process,
      command: shortCommand(h.command, home),
      addresses,
      exposed: addresses.length > 0 && bindScope(addresses) !== 'loopback',
      tool: tool ? { id: tool.id, name: tool.name } : null,
      container: name,
      fix: [],
    };
    c.fix = fixFor(c, tool?.id ?? null, platformId);
    out.push(c);
  }
  return out;
}

/** Which container publishes `port`, asked of `docker` (read-only, at most a few seconds: a stopped Docker can hang
 *  the CLI); null when there's no docker, no daemon, or no such container. */
export function containerOn(run: Runner, env: NodeJS.ProcessEnv, extraDirs: readonly string[], home = os.homedir()): (port: number) => Promise<string | null> {
  // Docker Desktop, Rancher Desktop and OrbStack put their CLI in places a LaunchAgent's PATH doesn't have
  const docker = findTool('docker', env.PATH, [...extraDirs, '/usr/local/bin', `${home}/.rd/bin`, `${home}/.orbstack/bin`, '/Applications/Docker.app/Contents/Resources/bin']);
  return async (port) => {
    if (!docker) return null;
    const r = await Promise.race([run(docker, ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}']), new Promise<null>((res) => setTimeout(() => res(null), 4000).unref())]);
    if (!r || r.code !== 0) return null;
    const names = r.stdout.trim().split('\n').filter(Boolean);
    return names.length ? names.join(', ') : null;
  };
}

/** The holder, for people: `Rancher Desktop (ssh, pid 7090: ssh: ~/Library/…)`. */
export function holderText(c: PortConflict): string {
  if (!c.pid) return "a process you can't see (another user's, perhaps root's)";
  const proc = `${c.process ?? 'a process'}, pid ${c.pid}`;
  const what = c.tool ? `${c.tool.name} (${proc}${c.command ? `: ${c.command}` : ''})` : `${c.process ?? 'a process'} (pid ${c.pid}${c.command ? `: ${c.command}` : ''})`;
  return c.container ? `${what}, for the container ${c.container}` : what;
}

/** Where it listens, for people: `on *: reachable from your network, not just this machine`. */
export function exposureText(c: PortConflict): string {
  if (!c.addresses.length) return '';
  const where = c.addresses.join(', ');
  return c.exposed ? `listening on ${where}, so reachable from your network, not just this machine` : `listening on ${where}`;
}

/** The headline: `Ports 443 and 80 are taken by Rancher Desktop`. */
export function conflictTitle(c: PortConflict): string {
  const ports = c.ports.length > 1 ? `Ports ${portList(c.ports)} are` : `Port ${c.ports[0]} is`;
  const who = c.tool ? c.tool.name : c.pid ? (c.process ?? 'another process') : "a process you can't see";
  return `${ports} taken by ${who}`;
}

/** One conflict as setup prints it: the headline with who and where, then what to do, one line each. `indent` starts
 *  every line after the first. */
export function formatConflict(c: PortConflict, indent = '  '): string {
  const who = c.pid ? `: ${holderText(c)}` : " (another user's, perhaps root's)";
  const lines = [`${conflictTitle(c)}${who}${c.addresses.length ? `, ${exposureText(c)}` : ''}. Hallway won't fight it for the port${c.ports.length > 1 ? 's' : ''}.`];
  c.fix.forEach((f, i) => lines.push(`${indent}${i === 0 ? 'To free it: ' : ''}${f}${/[.)`]$/.test(f) ? '' : '.'}`));
  return lines.join('\n');
}

/** The way to coexist (D71), as setup prints it after the conflicts: links on Caddy's own port. */
export function altPortText(altPort: number, standard: number, command: string, example: string): string {
  return `Or leave it running and give Hallway's links Caddy's own port, ${altPort}: \`${command}\` (links become ${example}; \`hallway setup --port ${standard}\` moves them back once ${standard} is free).`;
}
