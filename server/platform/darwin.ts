// macOS: launchd LaunchAgents in the gui/<uid> domain, listeners from `lsof`, boot time from `sysctl kern.boottime`
// (docs/04-apps-health-services.md). The primary platform. The parsers below are pure functions over the commands'
// output, unit-tested on every OS; the lsof/ps/sysctl calls themselves are "unverified on macOS" until run on a Mac
// (docs/11-research-notes.md).
import os from 'node:os';
import path from 'node:path';
import type { Platform } from './index.js';
import { type ProcessInfo, type RawListener, run, splitHostPort } from './listeners.js';

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

/** `sysctl -n kern.boottime` → `{ sec = 1760000000, usec = 123456 } Thu Oct  9 10:00:00 2026` → epoch ms. */
export function parseSysctlBoottime(text: string): number | null {
  const m = /sec\s*=\s*(\d+)(?:,\s*usec\s*=\s*(\d+))?/.exec(text);
  return m ? Number(m[1]) * 1000 + Math.floor(Number(m[2] ?? 0) / 1000) : null;
}

export const darwin: Platform = {
  id: 'darwin',
  serviceManager: 'launchd',
  listenerSource: 'lsof',
  // LaunchAgents start at login, not boot: right for a laptop.
  userServiceDir: (_env = process.env, home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents'),
  serviceFileName: (label) => `${label}.plist`,

  // Without root, lsof sees only the current user's processes: the intended scope.
  async listListeners() {
    // lsof exits 1 when it finds nothing; the output is still right
    return parseLsofListeners((await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcLn'])).stdout);
  },

  async processInfo(pids) {
    const out = new Map<number, ProcessInfo>();
    if (!pids.length) return out;
    const list = pids.join(',');
    const [ps, cwd] = await Promise.all([
      run('ps', ['-o', 'pid=,ppid=,lstart=,command=', '-p', list]),
      run('lsof', ['-a', '-p', list, '-d', 'cwd', '-Fn']),
    ]);
    const procs = parsePs(ps.stdout);
    const cwds = parseLsofCwd(cwd.stdout);
    for (const pid of pids) {
      const p = procs.get(pid);
      if (!p && !cwds.has(pid)) continue;
      out.set(pid, {
        pid,
        ppid: p?.ppid ?? null,
        command: p?.command ?? null,
        // ps joins argv with spaces, so this split is lossy for arguments that contain one
        argv: p?.command ? p.command.split(/\s+/) : null,
        cwd: cwds.get(pid) ?? null,
        startTime: p?.startTime ?? null,
        // reparented to launchd: the session that started it is gone (a LaunchAgent is PPID 1 too, by design)
        orphan: p?.ppid === 1,
      });
    }
    return out;
  },

  async bootTime() {
    return parseSysctlBoottime((await run('sysctl', ['-n', 'kern.boottime'])).stdout);
  },
};
