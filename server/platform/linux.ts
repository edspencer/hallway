// Linux: systemd user units, listeners from `ss` (falling back to /proc/net/tcp{,6}), boot time from /proc/stat's
// btime. Pulled forward from v2 so the daemon can be run and tested end to end on a Linux machine (D26). The parsers
// are pure functions over captured output, unit-tested on every OS.
import fs from 'node:fs';
import os from 'node:os';
// POSIX paths whatever OS this runs on, so this platform's logic is tested on Windows too
import { posix as path } from 'node:path';
import type { Platform, PortRange } from './index.js';
import { systemdManager, unitName } from './systemd.js';
import { type ProcessInfo, type RawListener, run, splitHostPort } from './listeners.js';
import { linuxFronting } from './fronting-linux.js';

/**
 * `ss -ltnpH`: `LISTEN 0 511 127.0.0.1:4567 0.0.0.0:* users:(("python3",pid=1234,fd=3))`. The users list is missing
 * for sockets whose owner we can't see; a socket shared by several processes (a pre-fork server) lists each.
 */
export function parseSs(text: string): RawListener[] {
  const out: RawListener[] = [];
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0] !== 'LISTEN') continue;
    const hp = splitHostPort(cols[3]);
    if (!hp) continue;
    const users = [...line.matchAll(/\("([^"]*)",pid=(\d+)/g)];
    if (!users.length) out.push({ pid: null, process: null, ...hp });
    for (const u of users) out.push({ pid: Number(u[2]), process: u[1], ...hp });
  }
  return out;
}

/** /proc/net/tcp's hex `0100007F:0947` (little-endian 32-bit words) → `127.0.0.1`, 2375. IPv6 is four such words. */
export function decodeProcAddress(hex: string): { address: string; port: number } | null {
  const [a, p] = hex.split(':');
  if (!a || !p) return null;
  const port = parseInt(p, 16);
  const words = a.match(/.{8}/g) ?? [];
  const bytes = words.flatMap((w) => (w.match(/../g) ?? []).reverse().map((b) => parseInt(b, 16)));
  let address: string;
  if (bytes.length === 4) address = bytes.join('.');
  else if (bytes.length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    address = compressV6(groups);
    if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(address)) address = bytes.slice(12).join('.'); // IPv4-mapped
  } else return null;
  return { address, port };
}

function compressV6(groups: string[]): string {
  // the longest run of two or more zero groups becomes `::`
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > bestLen) [best, bestLen] = [i, j - i];
    i = j;
  }
  if (bestLen < 2) return groups.join(':');
  return `${groups.slice(0, best).join(':')}::${groups.slice(best + bestLen).join(':')}`;
}

/** The LISTEN (`st` 0A) rows of /proc/net/tcp or tcp6, with their socket inodes. */
export function parseProcNetTcp(text: string): { address: string; port: number; inode: number }[] {
  const out: { address: string; port: number; inode: number }[] = [];
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10 || cols[3] !== '0A') continue;
    const hp = decodeProcAddress(cols[1]);
    if (hp) out.push({ ...hp, inode: Number(cols[9]) });
  }
  return out;
}

/** /proc/<pid>/stat: `1234 (comm with spaces) S 1 …` → comm, ppid, and starttime (clock ticks after boot, field 22). */
export function parseProcStat(text: string): { comm: string; ppid: number; startTicks: number } | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const rest = text.slice(close + 2).trim().split(/\s+/); // rest[0] is field 3 (state)
  const ppid = Number(rest[1]);
  const startTicks = Number(rest[19]);
  if (!Number.isFinite(ppid) || !Number.isFinite(startTicks)) return null;
  return { comm: text.slice(open + 1, close), ppid, startTicks };
}

/** /proc/stat's `btime <seconds>` → epoch ms. */
export function parseBtime(text: string): number | null {
  const m = /^btime\s+(\d+)/m.exec(text);
  return m ? Number(m[1]) * 1000 : null;
}

/** /proc/<pid>/cmdline: NUL-separated argv. */
export function parseCmdline(text: string): string[] {
  const parts = text.split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

/** Whether a process was orphaned: adopted by PID 1, or by a subreaper (`systemd --user` is the usual one). */
export function isOrphan(ppid: number, parentComm: string | null): boolean {
  return ppid <= 1 || parentComm === 'systemd' || parentComm === 'init';
}

/** The USER_HZ that /proc/<pid>/stat counts in: 100 on every mainstream Linux, but asked once anyway. */
let clockTicks: Promise<number> | undefined;
const ticksPerSecond = () => (clockTicks ??= run('getconf', ['CLK_TCK']).then(({ stdout }) => Number(stdout.trim()) || 100));

const read = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

/** Socket inode → PID, by reading every /proc/<pid>/fd we're allowed to (the same thing `ss -p` does). */
function socketOwners(wanted: Set<number>, procRoot: string): Map<number, number> {
  const owners = new Map<number, number>();
  if (!wanted.size) return owners;
  let pids: string[];
  try {
    pids = fs.readdirSync(procRoot).filter((d) => /^\d+$/.test(d));
  } catch {
    return owners;
  }
  for (const pid of pids) {
    let fds: string[];
    try {
      fds = fs.readdirSync(path.join(procRoot, pid, 'fd'));
    } catch {
      continue; // gone, or not ours
    }
    for (const fd of fds) {
      let link: string;
      try {
        link = fs.readlinkSync(path.join(procRoot, pid, 'fd', fd));
      } catch {
        continue;
      }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && wanted.has(Number(m[1])) && !owners.has(Number(m[1]))) owners.set(Number(m[1]), Number(pid));
    }
  }
  return owners;
}

/** Listeners from /proc/net/tcp{,6}, their owners found through /proc/<pid>/fd: for machines without `ss`. */
export function listFromProc(procRoot = '/proc'): RawListener[] {
  const rows = [
    ...parseProcNetTcp(read(path.join(procRoot, 'net', 'tcp')) ?? ''),
    ...parseProcNetTcp(read(path.join(procRoot, 'net', 'tcp6')) ?? ''),
  ];
  const owners = socketOwners(new Set(rows.map((r) => r.inode)), procRoot);
  return rows.map(({ address, port, inode }) => {
    const pid = owners.get(inode) ?? null;
    const comm = pid === null ? null : read(path.join(procRoot, String(pid), 'comm'))?.trim() || null;
    return { pid, process: comm, port, address };
  });
}

let hasSs: boolean | undefined;

/** Linux's default `net.ipv4.ip_local_port_range`. */
export const LINUX_EPHEMERAL = { from: 32768, to: 60999 } as const;

/** `/proc/sys/net/ipv4/ip_local_port_range` ("32768\t60999"), or null if it doesn't look like a range. */
export function parseLocalPortRange(text: string): PortRange | null {
  const m = /^\s*(\d{1,5})\s+(\d{1,5})\s*$/.exec(text);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  return from >= 1 && from <= to && to <= 65535 ? { from, to } : null;
}

let ephemeral: PortRange | undefined;

export const linux: Platform = {
  id: 'linux',
  serviceManager: 'systemd',
  listenerSource: 'ss',
  // `systemctl --user` reads units from $XDG_CONFIG_HOME/systemd/user (default ~/.config/systemd/user).
  userServiceDir: (env = process.env, home = os.homedir()) =>
    path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'systemd', 'user'),
  // hallway.daemon → hallway-daemon.service, hallway.app.<slug> → hallway-app-<slug>.service (D40)
  serviceFileName: unitName,
  services: ({ run, env = process.env, home = os.homedir() } = {}) => systemdManager({ dir: linux.userServiceDir(env, home), run }),
  openCommand: (url) => ['xdg-open', [url]],
  fronting: linuxFronting,
  ephemeralPorts() {
    if (ephemeral) return ephemeral;
    let text = '';
    try {
      text = fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8');
    } catch {
      /* no /proc: the default */
    }
    return (ephemeral = parseLocalPortRange(text) ?? LINUX_EPHEMERAL);
  },

  async listListeners() {
    if (hasSs !== false) {
      const ss = await run('ss', ['-ltnpH']);
      hasSs = ss.ok;
      if (ss.ok) return parseSs(ss.stdout);
    }
    return listFromProc();
  },

  async processInfo(pids) {
    const out = new Map<number, ProcessInfo>();
    const [hz, btime] = await Promise.all([ticksPerSecond(), linux.bootTime()]);
    for (const pid of pids) {
      const stat = parseProcStat(read(`/proc/${pid}/stat`) ?? '');
      if (!stat) continue; // gone
      let cwd: string | null = null;
      try {
        cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      } catch {
        /* not ours to read */
      }
      const argv = parseCmdline(read(`/proc/${pid}/cmdline`) ?? '');
      const parent = stat.ppid > 1 ? parseProcStat(read(`/proc/${stat.ppid}/stat`) ?? '') : null;
      out.set(pid, {
        pid,
        ppid: stat.ppid,
        command: argv.length ? argv.join(' ') : null,
        argv: argv.length ? argv : null,
        cwd,
        startTime: btime === null ? null : btime + Math.round((stat.startTicks / hz) * 1000),
        orphan: isOrphan(stat.ppid, parent?.comm ?? null),
      });
    }
    return out;
  },

  async bootTime() {
    return parseBtime(read('/proc/stat') ?? '');
  },
};
