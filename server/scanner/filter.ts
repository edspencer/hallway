// Noise filtering (docs/04-apps-health-services.md, "Observed listeners", step 2). On the author's machine IDE and
// agent-tool helpers outnumbered real dev servers about ten to one, so this is what makes the observed tray usable.
import path from 'node:path';
import type { Listener } from '../platform/index.js';

/** `ignore.yaml`: listeners the user chose to hide. */
export interface IgnoreRules {
  ports: number[];
  processes: string[];
  /** Hide listeners whose cwd is this directory or inside it. */
  dirs: string[];
}

export const EMPTY_IGNORE: IgnoreRules = { ports: [], processes: [], dirs: [] };

/** IANA's dynamic/private range, where language servers and tool helpers live. */
export const EPHEMERAL = { from: 49152, to: 65535 } as const;

/**
 * Well-known listeners that are never web apps. `*` at the end matches a prefix. Linux truncates process names to 15
 * characters, which every entry here survives.
 */
export const NON_WEB_DAEMONS = [
  'postgres', 'postmaster', 'mysqld', 'mariadbd', 'redis-server', 'valkey-server', 'mongod', 'memcached',
  'sshd', 'rapportd', 'ControlCenter', 'sharingd', 'identityservicesd', 'cupsd', 'dnsmasq', 'systemd-resolve',
  // Docker Desktop's backend and vpnkit forward containers' published ports: shown, named by their container (D72)
  'rpcbind', 'containerd', 'dockerd', 'Docker Desktop', 'Dropbox', 'Spotify',
  // Windows (D59): the kernel's HTTP.sys listeners (WinRM on 5985, 47001) show as `System`, PID 4
  'System', 'svchost', 'lsass', 'wininit', 'services', 'spoolsv', 'MsMpEng',
];

/** Process names Hallway itself owns: its proxy (Caddy). Its own daemon is matched by PID and port. */
export const OWN_PROCESSES = ['caddy'];

export interface FilterOptions {
  minPort: number;
  includeEphemeralPorts: boolean;
  /** The OS's own ephemeral range (Platform.ephemeralPorts), hidden along with IANA's. */
  osEphemeral?: { from: number; to: number };
  ignore: IgnoreRules;
  /** Hallway's own PID and ports (the daemon, and under `npm run dev`, Vite next to it). */
  selfPid: number;
  selfPorts: readonly number[];
}

export type NoiseReason = 'invisible' | 'low-port' | 'ephemeral' | 'self' | 'daemon' | 'ignored';

const inRange = (port: number, r: { from: number; to: number }) => port >= r.from && port <= r.to;

export function matchesName(name: string | null, patterns: readonly string[]): boolean {
  if (!name) return false;
  return patterns.some((p) => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p));
}

export function isUnder(dir: string, parent: string): boolean {
  const rel = path.relative(parent, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Why a listener is noise, or null if it should be shown. Call without `cwd` before identifying (cheap checks), and
 * again with it afterwards (the `dirs` rule needs the working directory).
 */
export function noiseReason(l: Listener, opts: FilterOptions, cwd?: string | null): NoiseReason | null {
  // a socket whose owner we can't see: another user's process (lsof without root never lists these at all)
  if (l.pid === null) return 'invisible';
  if (l.pid === opts.selfPid || opts.selfPorts.includes(l.port)) return 'self';
  if (l.port < opts.minPort) return 'low-port';
  if (!opts.includeEphemeralPorts && (inRange(l.port, EPHEMERAL) || (opts.osEphemeral && inRange(l.port, opts.osEphemeral)))) return 'ephemeral';
  if (matchesName(l.process, OWN_PROCESSES)) return 'self';
  if (matchesName(l.process, NON_WEB_DAEMONS)) return 'daemon';
  const ig = opts.ignore;
  if (ig.ports.includes(l.port) || matchesName(l.process, ig.processes)) return 'ignored';
  if (cwd && ig.dirs.some((d) => isUnder(cwd, d))) return 'ignored';
  return null;
}
