// macOS: launchd LaunchAgents in the gui/<uid> domain, listeners from `lsof`, boot time from `sysctl kern.boottime`
// (docs/04-apps-health-services.md). The primary platform. The parsers below are pure functions over the commands'
// output, unit-tested on every OS; the lsof/ps/sysctl calls themselves are "unverified on macOS" until run on a Mac
// (docs/11-research-notes.md).
import os from 'node:os';
// POSIX paths whatever OS this runs on, so this platform's logic is tested on Windows too
import { posix as path } from 'node:path';
import type { Platform } from './index.js';
import { launchdManager } from './launchd.js';
import { type ProcessInfo, type RawListener, run, splitHostPort } from './listeners.js';
import { darwinFronting } from './fronting-darwin.js';

/**
 * `lsof -nP -iTCP -sTCP:LISTEN -F pcLn`: one field per line, a type letter then the value. A process set (`p` PID,
 * `c` command, `L` login) is followed by its file sets (`f` descriptor, `n` name = `addr:port`).
 */
export function parseLsofListeners(text: string): RawListener[] {
  const out: RawListener[] = [];
  let pid: number | null = null;
  let proc: string | null = null;
  for (const line of text.split('\n')) {
    const tag = line[0];
    const v = line.slice(1);
    if (tag === 'p') {
      pid = Number(v) || null;
      proc = null;
    } else if (tag === 'c') proc = v;
    else if (tag === 'n') {
      // a listening socket's name is its local address; `->` would be a connection (not asked for, but cheap to skip)
      if (v.includes('->')) continue;
      const hp = splitHostPort(v);
      if (hp) out.push({ pid, process: proc, ...hp });
    }
  }
  return out;
}

/** `lsof -a -p <pid,pid…> -d cwd -Fn` → PID → working directory. */
export function parseLsofCwd(text: string): Map<number, string> {
  const out = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1)) || null;
    else if (line[0] === 'n' && pid !== null && !out.has(pid)) out.set(pid, line.slice(1));
  }
  return out;
}

/**
 * `ps -o pid=,ppid=,lstart=,command= -p <pid,pid…>` under LC_ALL=C. `lstart` is the fixed five-word form
 * `Thu Oct 16 10:00:00 2026` (day of month space-padded), in local time.
 */
export function parsePs(text: string): Map<number, { ppid: number; startTime: number | null; command: string }> {
  const out = new Map<number, { ppid: number; startTime: number | null; command: string }>();
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    const t = new Date(m[3].replace(/\s+/g, ' ')).getTime();
    out.set(Number(m[1]), { ppid: Number(m[2]), startTime: Number.isNaN(t) ? null : t, command: m[4].trim() });
  }
  return out;
}

/**
 * `launchctl list`: `PID\tStatus\tLabel` under a header, `-` for a job that isn't running → PID → label. Run as the
 * user, it lists the jobs loaded in the user's own domain (the LaunchAgents, `brew services` ones included), which is
 * where any process this user's lsof can see would come from. Root's LaunchDaemons aren't listed, and needn't be:
 * their processes belong to another user, so lsof doesn't show their sockets anyway.
 */
export function parseLaunchctlList(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split('\n')) {
    const m = /^(\d+)\s+\S+\s+(\S.*?)\s*$/.exec(line);
    if (m && Number(m[1]) > 0) out.set(Number(m[1]), m[2]);
  }
  return out;
}

/** `sysctl -n kern.boottime` → `{ sec = 1760000000, usec = 123456 } Thu Oct  9 10:00:00 2026` → epoch ms. */
export function parseSysctlBoottime(text: string): number | null {
  const m = /sec\s*=\s*(\d+)(?:,\s*usec\s*=\s*(\d+))?/.exec(text);
  return m ? Number(m[1]) * 1000 + Math.floor(Number(m[2] ?? 0) / 1000) : null;
}

/** `ps`, `lsof -d cwd` and `launchctl list` output → ProcessInfo by PID (pure, so it's tested on every OS). */
export function darwinProcesses(pids: number[], psText: string, cwdText: string, launchctlText: string): Map<number, ProcessInfo> {
  const out = new Map<number, ProcessInfo>();
  const procs = parsePs(psText);
  const cwds = parseLsofCwd(cwdText);
  const jobs = parseLaunchctlList(launchctlText);
  for (const pid of pids) {
    const p = procs.get(pid);
    if (!p && !cwds.has(pid)) continue;
    const job = jobs.get(pid);
    out.set(pid, {
      pid,
      ppid: p?.ppid ?? null,
      command: p?.command ?? null,
      // ps joins argv with spaces, so this split is lossy for arguments that contain one
      argv: p?.command ? p.command.split(/\s+/) : null,
      cwd: cwds.get(pid) ?? null,
      startTime: p?.startTime ?? null,
      // reparented to launchd and not one of its jobs (a LaunchAgent is PPID 1 too): the session that started it is gone
      orphan: p?.ppid === 1 && !job,
      supervisor: job ? { manager: 'launchd', label: job } : null,
    });
  }
  return out;
}

export const darwin: Platform = {
  id: 'darwin',
  serviceManager: 'launchd',
  listenerSource: 'lsof',
  // LaunchAgents start at login, not boot: right for a laptop.
  userServiceDir: (_env = process.env, home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents'),
  serviceFileName: (label) => `${label}.plist`,
  services: ({ run, env = process.env, home = os.homedir() } = {}) => launchdManager({ dir: darwin.userServiceDir(env, home), uid: process.getuid?.() ?? 501, run }),
  openCommand: (url) => ['open', [url]],
  fronting: darwinFronting,
  // macOS's default net.inet.ip.portrange.first/last is IANA's range; a changed sysctl isn't read (unverified on macOS)
  ephemeralPorts: () => ({ from: 49152, to: 65535 }),

  // Without root, lsof sees only the current user's processes: the intended scope.
  async listListeners() {
    // lsof exits 1 when it finds nothing; the output is still right
    return parseLsofListeners((await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcLn'])).stdout);
  },

  async processInfo(pids) {
    if (!pids.length) return new Map();
    const list = pids.join(',');
    const [ps, cwd] = await Promise.all([
      run('ps', ['-o', 'pid=,ppid=,lstart=,command=', '-p', list]),
      run('lsof', ['-a', '-p', list, '-d', 'cwd', '-Fn']),
    ]);
    // launchd is the parent of every job it runs as well as of every true orphan, and only a job's own process is in
    // its list: ask once per scan, and only when something here has PPID 1
    const launchctl = /^\s*\d+\s+1\s/m.test(ps.stdout) ? (await run('launchctl', ['list'])).stdout : '';
    return darwinProcesses(pids, ps.stdout, cwd.stdout, launchctl);
  },

  async bootTime() {
    return parseSysctlBoottime((await run('sysctl', ['-n', 'kern.boottime'])).stdout);
  },
};
