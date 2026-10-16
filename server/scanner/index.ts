// The port scanner (docs/04-apps-health-services.md, "Observed listeners"; D11, D18): lists listening sockets through
// the platform (lsof on macOS, ss or /proc on Linux: server/platform/), filters out noise, sniffs HTTP, identifies
// each listener by its working directory, package and git branch, and records observations in state/observed.json.
//
// The scanner knows nothing about the HTTP API or the YAML store: the daemon hands it callbacks for what it needs
// (settings, ignore rules, the ports that belong to declared and discovered apps) and listens for results.
import os from 'node:os';
import path from 'node:path';
import type { Observation } from './types.js';
import { dataPaths } from '../config.js';
import { type Listener, type Platform, type ProcessInfo, bindScope, connectAddress, currentPlatform, mergeListeners } from '../platform/index.js';
import { EMPTY_IGNORE, type IgnoreRules, noiseReason } from './filter.js';
import { identify } from './identify.js';
import { ObservedStore, labelListeners, normaliseCommand, observationId, recordBoot } from './observations.js';
import { type Sniff, sniff } from './sniff.js';

export { suggestSlug } from './claim.js';
export { type FilterOptions, type IgnoreRules, noiseReason } from './filter.js';
export type { Observation } from './types.js';

/** `scan:` in config.yaml (docs/02-architecture.md). */
export interface ScanSettings {
  enabled: boolean;
  intervalSeconds: number;
  includeEphemeralPorts: boolean;
  minPort: number;
}

export const DEFAULT_SCAN: ScanSettings = { enabled: true, intervalSeconds: 120, includeEphemeralPorts: false, minPort: 1024 };

export interface ScanResult {
  scannedAt: string;
  /** Web listeners that are neither declared nor discovered: to claim or ignore. */
  listeners: Observation[];
  /** Listeners that didn't answer HTTP (the collapsed "other listeners" group). */
  other: Observation[];
  /** Listeners on ports that belong to declared or discovered apps, by port: they enrich the app instead. */
  known: Map<number, Observation>;
  /** How many listeners were dropped as noise, by reason (for `hallway doctor` and debugging). */
  dropped: Record<string, number>;
}

export interface ScannerOptions {
  /** The data home: observed.json and boot.json go in its state/. */
  home: string;
  platform?: Platform;
  settings?: () => ScanSettings;
  /** ignore.yaml's rules (the store's parsed copy), read on every scan. Default: ignore nothing. */
  ignore?: () => IgnoreRules;
  /** Ports owned by declared or discovered apps. */
  knownPorts?: () => Iterable<number>;
  /** Hallway's own ports (the daemon's). Its own PID is always excluded. */
  selfPorts?: () => readonly number[];
  /** Called after every scan. */
  onScan?: (result: ScanResult) => void;
  sniffTimeoutMs?: number;
  /** How long a PID's identity (cwd, project, git) is reused before it is looked up again. */
  identityTtlMs?: number;
  homeDir?: string;
  now?: () => number;
}

interface CachedIdentity {
  /** The PID's start time and name, so a reused PID isn't mistaken for the old process. */
  key: string;
  at: number;
  info: ProcessInfo;
  identity: Pick<Observation, 'project' | 'git'>;
}

/** At most this many sniffs in flight. */
const SNIFF_CONCURRENCY = 8;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export function createScanner(opts: ScannerOptions) {
  const platform = opts.platform ?? currentPlatform();
  const paths = dataPaths(opts.home);
  const settings = opts.settings ?? (() => DEFAULT_SCAN);
  const ignore = opts.ignore ?? (() => EMPTY_IGNORE);
  const now = opts.now ?? Date.now;
  const homeDir = opts.homeDir ?? os.homedir();
  const ttl = opts.identityTtlMs ?? 10 * 60_000;
  const store = new ObservedStore(path.join(paths.state, 'observed.json'));
  const cache = new Map<number, CachedIdentity>();
  let last: ScanResult | null = null;
  let running: Promise<ScanResult> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;

  async function identifyAll(listeners: Listener[]): Promise<Map<number, CachedIdentity>> {
    const pids = [...new Set(listeners.map((l) => l.pid!))];
    const t = now();
    const infos = await platform.processInfo(pids);
    const out = new Map<number, CachedIdentity>();
    await Promise.all(
      pids.map(async (pid) => {
        const info = infos.get(pid);
        if (!info) return;
        const key = `${info.startTime ?? ''}:${info.command ?? ''}`;
        const hit = cache.get(pid);
        if (hit && hit.key === key && t - hit.at < ttl) {
          out.set(pid, { ...hit, info });
          return;
        }
        const entry = { key, at: t, info, identity: await identify(info.cwd, info.argv, homeDir) };
        cache.set(pid, entry);
        out.set(pid, entry);
      }),
    );
    // forget PIDs that are no longer listening
    for (const pid of cache.keys()) if (!pids.includes(pid)) cache.delete(pid);
    return out;
  }

  async function doScan(): Promise<ScanResult> {
    const s = settings();
    const filterOpts = {
      minPort: s.minPort,
      includeEphemeralPorts: s.includeEphemeralPorts,
      ignore: ignore(),
      selfPid: process.pid,
      selfPorts: opts.selfPorts?.() ?? [],
    };
    const known = new Set(opts.knownPorts?.() ?? []);
    const dropped: Record<string, number> = {};
    const drop = (reason: string) => (dropped[reason] = (dropped[reason] ?? 0) + 1);

    const listeners = mergeListeners(await platform.listListeners()).filter((l) => {
      const reason = noiseReason(l, filterOpts);
      if (reason) drop(reason);
      return !reason;
    });
    const ids = await identifyAll(listeners);
    const kept = listeners.filter((l) => {
      const id = ids.get(l.pid!);
      if (!id) return drop('gone'), false;
      const reason = noiseReason(l, filterOpts, id.info.cwd);
      if (reason) drop(reason);
      return !reason;
    });
    const sniffs = await mapLimit(kept, SNIFF_CONCURRENCY, (l) =>
      sniff(connectAddress(l.addresses), l.port, { timeoutMs: opts.sniffTimeoutMs ?? 2000 }),
    );

    const t = now();
    const all = kept.map((l, i) => toObserved(l, ids.get(l.pid!)!, sniffs[i], t));
    labelListeners(all);
    store.record(all, t);
    const result: ScanResult = {
      scannedAt: new Date(t).toISOString(),
      listeners: all.filter((o) => o.kind === 'web' && !known.has(o.port)),
      other: all.filter((o) => o.kind === 'other' && !known.has(o.port)),
      known: new Map(all.filter((o) => known.has(o.port)).map((o) => [o.port, o])),
      dropped,
    };
    last = result;
    opts.onScan?.(result);
    return result;
  }

  /** Scan now. Concurrent calls share one scan. */
  function scan(): Promise<ScanResult> {
    running ??= doScan().finally(() => (running = null));
    return running;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      if (settings().enabled) await scan().catch((e) => process.stderr.write(`hallway: scan failed: ${(e as Error).message}\n`));
      schedule();
    }, settings().intervalSeconds * 1000);
    timer.unref();
  }

  return {
    scan,
    /** The latest scan, or null before the first one finishes. */
    last: () => last,
    /** A recorded observation by id: live or not (observed.json keeps everything seen in the last 90 days). */
    observation: (id: string) => last?.listeners.find((o) => o.id === id) ?? last?.other.find((o) => o.id === id) ?? store.get(id) ?? null,
    /** Every recorded observation, live or not. */
    history: () => store.all(),
    /** Record the boot time in state/boot.json and scan straight away, then every `scan.intervalSeconds`. */
    async start() {
      stopped = false;
      const boot = recordBoot(path.join(paths.state, 'boot.json'), await platform.bootTime(), now());
      if (settings().enabled) await scan().catch((e) => process.stderr.write(`hallway: scan failed: ${(e as Error).message}\n`));
      schedule();
      return boot;
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type Scanner = ReturnType<typeof createScanner>;

function toObserved(l: Listener, id: CachedIdentity, http: Sniff | null, t: number): Observation {
  const { info, identity } = id;
  const norm = normaliseCommand(info.argv, info.command);
  const at = new Date(t).toISOString();
  return {
    id: observationId(identity.project?.root ?? info.cwd, l.port, norm),
    port: l.port,
    pid: l.pid,
    ppid: info.ppid,
    process: l.process,
    addresses: l.addresses,
    bind: bindScope(l.addresses),
    kind: http ? 'web' : 'other',
    http,
    command: info.command,
    argv: info.argv,
    cwd: info.cwd,
    startedAt: info.startTime === null ? null : new Date(info.startTime).toISOString(),
    orphan: info.orphan,
    project: identity.project,
    git: identity.git,
    label: '',
    firstSeen: at,
    lastSeen: at,
  };
}
