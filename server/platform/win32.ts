// Windows: supported where feasible, best effort (D58). Nothing here needs administrator rights. Listeners come from
// `netstat -ano` and process names from `tasklist` (both fast, and parsed without relying on their localised words);
// command lines, parents and start times from one PowerShell call per scan (Win32_Process), which also reads each
// process's working directory out of its PEB, as psutil does (D59). Managed services refuse with a message for now,
// and fronted mode is unsupported (setup refuses before doing anything). Checked on GitHub's hosted Windows runners;
// everything else is "unverified on a real Windows desktop" in docs/11-research-notes.md. The parsers are pure
// functions over captured output (test/fixtures/platform/win32-*), tested on every OS.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
// Windows paths whatever OS this runs on, so this platform's logic is tested on macOS and Linux too
import { win32 as path } from 'node:path';
import type { Platform, PortRange } from './index.js';
import { FrontingUnsupported, type Fronting } from './fronting.js';
import { type ProcessInfo, type RawListener, run, splitHostPort } from './listeners.js';
import { type ServiceManager, ServiceManagerError, type ServiceStatus } from './services.js';

/**
 * `netstat -ano`: `  TCP    127.0.0.1:4255    0.0.0.0:0    LISTENING    1234`. The state word is localised (`ABHÖREN`,
 * `ÉCOUTE`, …), so a listening row is told by its foreign address instead: only a listening TCP socket has `0.0.0.0:0`
 * or `[::]:0` there. UDP rows have no state column and are skipped.
 */
export function parseNetstat(text: string): RawListener[] {
  const out: RawListener[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length !== 5 || cols[0].toUpperCase() !== 'TCP') continue;
    if (cols[2] !== '0.0.0.0:0' && cols[2] !== '[::]:0') continue;
    const hp = splitHostPort(cols[1]);
    const pid = Number(cols[4]);
    if (!hp || !Number.isInteger(pid)) continue;
    // PID 0 is the System Idle Process: a socket whose owner is gone (TIME_WAIT leftovers), never a listener to show
    if (pid === 0) continue;
    out.push({ pid, process: null, ...hp });
  }
  return out;
}

/** One CSV line's fields (tasklist quotes every field; a quote inside one is doubled). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"]|"")*)"(?:,|$)/g;
  for (let m; (m = re.exec(line)); ) out.push(m[1].replace(/""/g, '"'));
  return out;
}

/** The short name people know a process by: `node.exe` → `node` (as lsof and ss show it). */
export const shortName = (image: string) => image.replace(/\.exe$/i, '');

/** `tasklist /FO CSV /NH`: `"node.exe","1234","Console","1","45,000 K"` → PID → short name. Columns, not words. */
export function parseTasklist(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const f = csvFields(line.trim());
    if (f.length < 2) continue;
    const pid = Number(f[1]);
    if (Number.isInteger(pid) && f[0]) out.set(pid, shortName(f[0]));
  }
  return out;
}

/**
 * A Windows command line → argv, by the rules the C runtime (and CommandLineToArgvW) use: whitespace separates,
 * double quotes group, `\"` is a literal quote, and backslashes are literal unless they precede a quote (2n
 * backslashes + `"` → n backslashes and a quote that groups; 2n+1 → n and a literal quote). The program name (the
 * first word) takes no escapes: everything up to the closing quote, or the first whitespace.
 */
export function splitCommandLine(cmd: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = cmd.length;
  while (i < n && /\s/.test(cmd[i])) i++;
  if (i >= n) return out;
  // argv[0]
  if (cmd[i] === '"') {
    const end = cmd.indexOf('"', i + 1);
    out.push(end < 0 ? cmd.slice(i + 1) : cmd.slice(i + 1, end));
    i = end < 0 ? n : end + 1;
  } else {
    let j = i;
    while (j < n && !/\s/.test(cmd[j])) j++;
    out.push(cmd.slice(i, j));
    i = j;
  }
  for (;;) {
    while (i < n && /\s/.test(cmd[i])) i++;
    if (i >= n) break;
    let arg = '';
    let quoted = false;
    while (i < n && (quoted || !/\s/.test(cmd[i]))) {
      if (cmd[i] === '\\') {
        let k = i;
        while (k < n && cmd[k] === '\\') k++;
        const count = k - i;
        if (cmd[k] === '"') {
          arg += '\\'.repeat(Math.floor(count / 2));
          if (count % 2) {
            arg += '"';
            i = k + 1;
          } else i = k;
        } else {
          arg += '\\'.repeat(count);
          i = k;
        }
      } else if (cmd[i] === '"') {
        // `""` inside a quoted run is a literal quote (the msvcrt rule since 2008)
        if (quoted && cmd[i + 1] === '"') {
          arg += '"';
          i += 2;
        } else {
          quoted = !quoted;
          i++;
        }
      } else arg += cmd[i++];
    }
    out.push(arg);
  }
  return out;
}

/** What the PowerShell script prints for one process. */
export interface WinProcessRecord {
  pid: number;
  ppid: number | null;
  name: string | null;
  exe: string | null;
  commandLine: string | null;
  /** Epoch ms. */
  created: number | null;
  cwd: string | null;
  /** The parent is still running and started before this process (so its PID wasn't reused). */
  parentAlive: boolean;
}

/** The PowerShell script's JSON (one object, or an array of them, or nothing) → ProcessInfo by PID. */
export function parseProcessJson(text: string): Map<number, ProcessInfo> {
  const out = new Map<number, ProcessInfo>();
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, '').trim() || '[]');
  } catch {
    return out;
  }
  for (const r of (Array.isArray(data) ? data : [data]) as Partial<WinProcessRecord>[]) {
    if (!r || typeof r.pid !== 'number') continue;
    const argv = r.commandLine ? splitCommandLine(r.commandLine) : null;
    out.set(r.pid, {
      pid: r.pid,
      ppid: typeof r.ppid === 'number' ? r.ppid : null,
      command: r.commandLine?.trim() || r.exe || null,
      argv: argv?.length ? argv : r.exe ? [r.exe] : null,
      cwd: typeof r.cwd === 'string' && r.cwd ? trimDirSlash(r.cwd) : null,
      startTime: typeof r.created === 'number' ? r.created : null,
      // Windows doesn't re-parent: a process whose parent has exited (the terminal or agent session that started it)
      // keeps the dead PID as its parent
      orphan: r.parentAlive === false,
    });
  }
  return out;
}

/** `C:\Code\app\` → `C:\Code\app`, but `C:\` stays a root. */
const trimDirSlash = (d: string) => (/^[A-Za-z]:\\$/.test(d) ? d : d.replace(/[\\/]+$/, ''));

/**
 * `netsh int ipv4 show dynamicport tcp`: `Start Port      : 49152` / `Number of Ports : 16384`. The labels are
 * localised; the two numbers come in that order in every language, so they're read positionally.
 */
export function parseDynamicPorts(text: string): PortRange | null {
  const nums = [...text.matchAll(/:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]));
  if (nums.length < 2) return null;
  const [from, count] = nums;
  const to = from + count - 1;
  return from >= 1 && count >= 1 && to <= 65535 ? { from, to } : null;
}

/** Windows' default dynamic range since Vista: IANA's. */
export const WINDOWS_EPHEMERAL = { from: 49152, to: 65535 } as const;

/**
 * Reads a process's current directory from its PEB: NtQueryInformationProcess → PEB → ProcessParameters →
 * CurrentDirectory.DosPath, with PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, which the user's own
 * non-elevated processes grant to them without administrator rights (psutil's approach). 64-bit processes only: a
 * 32-bit (WOW64) one's PEB has other offsets, and it reports null. Offsets for x64: PEB+0x20 ProcessParameters,
 * RTL_USER_PROCESS_PARAMETERS+0x38 CurrentDirectory (a UNICODE_STRING: Length, MaximumLength, padding, Buffer).
 */
const PEB_READER = `
using System;
using System.Runtime.InteropServices;
public static class HallwayPeb {
  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr ExitStatus; public IntPtr Peb; public IntPtr Affinity; public IntPtr Priority; public IntPtr Pid; public IntPtr ParentPid; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI pbi, int len, out int ret);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool IsWow64Process(IntPtr h, out bool wow);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  static byte[] Read(IntPtr h, IntPtr addr, int n) {
    byte[] b = new byte[n]; IntPtr got;
    if (!ReadProcessMemory(h, addr, b, (IntPtr)n, out got) || (long)got != n) return null;
    return b;
  }
  public static string Cwd(int pid) {
    if (IntPtr.Size != 8) return null;
    IntPtr h = OpenProcess(0x1000 | 0x0010, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      bool wow; if (IsWow64Process(h, out wow) && wow) return null;
      PBI pbi = new PBI(); int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(typeof(PBI)), out ret) != 0 || pbi.Peb == IntPtr.Zero) return null;
      byte[] pp = Read(h, pbi.Peb + 0x20, 8); if (pp == null) return null;
      IntPtr parms = (IntPtr)BitConverter.ToInt64(pp, 0);
      byte[] us = Read(h, parms + 0x38, 16); if (us == null) return null;
      int len = BitConverter.ToUInt16(us, 0);
      IntPtr buf = (IntPtr)BitConverter.ToInt64(us, 8);
      if (len == 0 || len > 65534 || buf == IntPtr.Zero) return null;
      byte[] s = Read(h, buf, len); if (s == null) return null;
      return System.Text.Encoding.Unicode.GetString(s);
    } catch { return null; } finally { CloseHandle(h); }
  }
}`;

/** The PowerShell that describes `pids`: one JSON array of WinProcessRecord on stdout, UTF-8. */
export function processScript(pids: number[]): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${PEB_READER}
'@
$all = @{}
foreach ($p in (Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate)) { $all[[int]$p.ProcessId] = $p }
$ms = { param($d) if ($d) { ([DateTimeOffset]$d).ToUnixTimeMilliseconds() } else { $null } }
$out = foreach ($id in @(${pids.map((p) => Math.trunc(p)).join(',')})) {
  $p = $all[$id]
  if (-not $p) { continue }
  $created = & $ms $p.CreationDate
  $parent = $all[[int]$p.ParentProcessId]
  $parentCreated = if ($parent) { & $ms $parent.CreationDate } else { $null }
  [pscustomobject]@{
    pid = $id; ppid = [int]$p.ParentProcessId; name = $p.Name; exe = $p.ExecutablePath; commandLine = $p.CommandLine
    created = $created; cwd = [HallwayPeb]::Cwd($id)
    parentAlive = [bool]($parent -and ($null -eq $parentCreated -or $null -eq $created -or $parentCreated -le $created))
  }
}
ConvertTo-Json -Compress -Depth 2 -InputObject @($out)
`;
}

/** Run a PowerShell script without a profile, passed encoded so nothing in it needs quoting. */
export function powershell(script: string, timeoutMs = 30_000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeoutMs });
}

let ephemeral: PortRange | undefined;

export const WINDOWS_SERVICES_UNSUPPORTED = "managed services aren't supported on Windows yet: start the server yourself and register it (hallway claim <port>)";
export const WINDOWS_FRONTING_UNSUPPORTED = "fronted mode isn't supported on Windows: apps keep their http://localhost:<port> addresses";

function unsupportedServices(dir: string): ServiceManager {
  const refuse = async (): Promise<never> => {
    throw new ServiceManagerError(WINDOWS_SERVICES_UNSUPPORTED);
  };
  return {
    kind: 'schtasks',
    unsupported: WINDOWS_SERVICES_UNSUPPORTED,
    file: (label) => path.join(dir, `${label}.xml`),
    render: () => {
      throw new ServiceManagerError(WINDOWS_SERVICES_UNSUPPORTED);
    },
    readPath: () => null,
    write: refuse,
    start: refuse,
    stop: refuse,
    restart: refuse,
    remove: refuse,
    status: async (label): Promise<ServiceStatus> => ({ label, installed: false, loaded: false, running: false, pid: null, lastExitCode: null, state: null, enabled: null }),
    list: () => [],
  };
}

const refuseFronting = (): never => {
  throw new FrontingUnsupported(WINDOWS_FRONTING_UNSUPPORTED);
};

export const win32Fronting: Fronting = {
  unsupported: WINDOWS_FRONTING_UNSUPPORTED,
  redirect: refuseFronting,
  unredirect: refuseFronting,
  trust: refuseFronting,
  untrust: refuseFronting,
  resolver: refuseFronting,
  unresolver: refuseFronting,
  installed: () => ({ redirect: [], trust: [], resolver: [] }),
  userServiceNoun: 'scheduled task',
  detect: () => ({ nft: null, certutil: null, systemctl: null, resolved: false, caStore: null }),
  helperDirs: [],
  installHelper: () => ({ advice: WINDOWS_FRONTING_UNSUPPORTED }),
};

export const win32: Platform = {
  id: 'win32',
  serviceManager: 'schtasks',
  listenerSource: 'netstat',
  // where the scheduled tasks' definitions are kept (D58); nothing is written there yet
  userServiceDir: (env = process.env, home = os.homedir()) =>
    path.join(env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.join(home, 'AppData', 'Local'), 'hallway', 'tasks'),
  serviceFileName: (label) => `${label}.xml`,
  services: ({ env = process.env, home = os.homedir() } = {}) => unsupportedServices(win32.userServiceDir(env, home)),
  // `start` is a cmd built-in and would need quoting for `&`; the URL handler takes the URL as one argument
  openCommand: (url) => ['rundll32', ['url.dll,FileProtocolHandler', url]],
  fronting: win32Fronting,
  ephemeralPorts() {
    if (ephemeral) return ephemeral;
    let text = '';
    try {
      text = execFileSync('netsh', ['int', 'ipv4', 'show', 'dynamicport', 'tcp'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      /* no netsh (not Windows, or locked down): the default */
    }
    return (ephemeral = parseDynamicPorts(text) ?? WINDOWS_EPHEMERAL);
  },
  async listListeners() {
    const [v4, v6, tasks] = await Promise.all([run('netstat', ['-ano', '-p', 'TCP']), run('netstat', ['-ano', '-p', 'TCPv6']), run('tasklist', ['/FO', 'CSV', '/NH'])]);
    const names = parseTasklist(tasks.stdout);
    return parseNetstat(`${v4.stdout}\n${v6.stdout}`).map((l) => ({ ...l, process: l.pid === null ? null : (names.get(l.pid) ?? null) }));
  },
  async processInfo(pids) {
    if (!pids.length) return new Map();
    const r = await powershell(processScript(pids));
    return parseProcessJson(r.stdout);
  },
  async bootTime() {
    return Math.round(Date.now() - os.uptime() * 1000);
  },
};
