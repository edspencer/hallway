// Listening sockets and the processes behind them: the types both platforms produce, the helpers they share, and the
// IPv4/IPv6 merge (docs/04-apps-health-services.md, "Observed listeners", step 1). The OS-specific parsers live in
// darwin.ts and linux.ts as pure functions over captured command output, so both are unit-tested on every OS.
import { execFile } from 'node:child_process';

/** One listening TCP socket as the OS reports it: a PID can have several (IPv4 and IPv6, several addresses). */
export interface RawListener {
  /** Null when the owning process can't be seen (another user's, without root). */
  pid: number | null;
  /** The short process name (lsof's `c`, ss's `users:(("name",…))`, /proc/<pid>/comm). */
  process: string | null;
  port: number;
  /** The bound address: `127.0.0.1`, `::1`, `0.0.0.0`, `::`, `*`, or a specific one. */
  address: string;
}

/** Every socket a process listens on for one port, merged across address families. */
export interface Listener {
  pid: number | null;
  process: string | null;
  port: number;
  /** Sorted, de-duplicated. */
  addresses: string[];
}

/** The service manager keeping a process running: a loaded launchd job, or a systemd unit whose cgroup it's in. */
export interface Supervisor {
  manager: 'launchd' | 'systemd';
  /** The job's label (`com.example.api`) or the unit's name (`api.service`). */
  label: string;
}

/** What the scanner needs to know about the process behind a listener. Fields the OS won't tell us are null. */
export interface ProcessInfo {
  pid: number;
  ppid: number | null;
  /** The full command line as one string, for display. */
  command: string | null;
  /** The argv, when the OS gives it exactly (Linux /proc/<pid>/cmdline); otherwise the command split on whitespace. */
  argv: string[] | null;
  /** The process's working directory: the primary identifier (the command line often isn't one). */
  cwd: string | null;
  /** Epoch milliseconds. */
  startTime: number | null;
  /**
   * The parent has been replaced by init or a subreaper, i.e. the session that launched it is gone (PPID 1 under
   * launchd; on Linux, PID 1 or a `systemd --user` manager that adopted it) and no service manager supervises it. A
   * LaunchAgent or a systemd service has the same parent as a true orphan, so `supervisor` is what tells them apart.
   */
  orphan: boolean;
  /** What keeps it running, when a service manager does (absent: not looked up, as on Windows). */
  supervisor?: Supervisor | null;
}

/** Merge a PID's sockets on one port (IPv4 + IPv6, or several addresses) into one listener, ordered by port then PID. */
export function mergeListeners(raw: RawListener[]): Listener[] {
  const byKey = new Map<string, Listener>();
  for (const r of raw) {
    const key = `${r.pid ?? '?'}:${r.port}`;
    const l = byKey.get(key);
    if (l) {
      if (!l.addresses.includes(r.address)) l.addresses.push(r.address);
      l.process ??= r.process;
    } else byKey.set(key, { pid: r.pid, process: r.process, port: r.port, addresses: [r.address] });
  }
  const out = [...byKey.values()];
  for (const l of out) l.addresses.sort();
  return out.sort((a, b) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0));
}

/** `127.0.0.1:4666` / `[::1]:4666` / `*:4666` / `127.0.0.53%lo:53` → address and port; null if it isn't one. */
export function splitHostPort(s: string): { address: string; port: number } | null {
  const m = /^(?:\[([^\]]+)\]|(.*)):(\d+)$/.exec(s.trim());
  if (!m) return null;
  let address = (m[1] ?? m[2]).replace(/%.*$/, ''); // drop an interface scope (`%lo`)
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (v4mapped) address = v4mapped[1];
  const port = Number(m[3]);
  return port > 0 && port <= 65535 ? { address, port } : null;
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;
const WILDCARD = new Set(['*', '0.0.0.0', '::']);

/** How exposed a listener is: loopback only, every interface (reachable from the network), or specific addresses. */
export function bindScope(addresses: string[]): 'loopback' | 'all' | 'address' {
  if (addresses.some((a) => WILDCARD.has(a))) return 'all';
  if (addresses.length && addresses.every((a) => LOOPBACK.test(a))) return 'loopback';
  return 'address';
}

/** The address to connect to when probing a listener: loopback when it's bound there or everywhere. */
export function connectAddress(addresses: string[]): string {
  if (addresses.some((a) => WILDCARD.has(a) || a.startsWith('127.'))) return '127.0.0.1';
  if (addresses.includes('::1')) return '::1';
  return addresses[0] ?? '127.0.0.1';
}

/** Run a command and resolve with its stdout ('' if it fails or isn't installed: a missing tool is not a crash). */
export function run(
  cmd: string,
  args: string[],
  { timeoutMs = 10_000, env = {} as Record<string, string> } = {},
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      // LC_ALL=C: English, fixed-format dates from `ps -o lstart`
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANG: 'C', ...env } },
      (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? '') }),
    );
  });
}
