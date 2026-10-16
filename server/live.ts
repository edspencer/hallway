// The live side of the daemon: the scanner (server/scanner/), the prober and the uptime store (server/health/),
// plugged into the core through one StateProvider and the event bus (D35). The core owns the files and the API; this
// turns what's happening right now into the shapes in shared/api.ts.
//
//   apps/*.yaml, config.yaml  ──(store)──▶ probe targets, scan and probe settings
//   prober transitions        ──▶ bus { type: 'state' }     scans that change the list ──▶ bus { type: 'observed' }
//   GET /api/state, /api/apps/:slug[/history], /api/observed, POST /api/scan ──▶ the provider below
//   boot.json says the machine rebooted ──▶ state/lost.json ──▶ bus { type: 'reboot' }  ("Lost at last reboot", D54)
import os from 'node:os';
import path from 'node:path';
import type { AppHealth, AppHistory, ListenerIdentity, LostItem, LostNotice, ObservedListener, ServerEvent } from '../shared/api.js';
import { dataPaths, expandHome } from './config.js';
import type { EventBus } from './events.js';
import { type HealthService, startHealth } from './health/index.js';
import { type Platform, currentPlatform } from './platform/index.js';
import type { ProbeHealth, ProbeTarget } from './prober/index.js';
import { type LostAppInput, type LostRecord, LostStore, computeLost } from './lost/index.js';
import type { ProviderRegistry } from './providers.js';
import { isListening } from './services/ports.js';
import { type Observation, type Scanner, createScanner, fallbackName, noiseReason, suggestSlug } from './scanner/index.js';
import type { Store } from './store/index.js';

export interface LiveOptions {
  store: Store;
  bus: EventBus;
  providers: ProviderRegistry;
  /** The daemon's own port, so the scanner doesn't report Hallway itself. */
  selfPorts?: readonly number[];
  platform?: Platform;
  /** Start the scanner (default true). Tests that only probe turn it off. */
  scan?: boolean;
}

/** A short explanation of a probe for people (`AppHealth.detail`). */
export function probeDetail(h: ProbeHealth): string | null {
  const p = h.lastProbe;
  if (!p) return null;
  if (h.starting) return 'starting';
  if (p.outcome === 'not-listening') return p.error === 'ECONNREFUSED' ? 'connection refused' : p.error === 'connect timed out' ? 'connect timed out' : `not listening (${p.error ?? 'no answer'})`;
  if (p.httpStatus === null) return p.error?.replace(/^no response in (\d+) ms$/, 'timed out after $1 ms') ?? 'no HTTP answer';
  return p.outcome === 'unhealthy' ? `HTTP ${p.httpStatus}` : null;
}

/** The address a listener is bound to, for people: a wildcard if it has one, else its first address. */
const bindAddress = (o: Observation) => o.addresses.find((a) => a === '*' || a === '0.0.0.0' || a === '::') ?? o.addresses[0] ?? null;

export function toIdentity(o: Observation): ListenerIdentity {
  return {
    pid: o.pid,
    ppid: o.ppid ?? null,
    process: o.process,
    command: o.command,
    cwd: o.cwd,
    projectDir: o.project?.root ?? null,
    name: o.project?.name ?? null,
    description: o.project?.description ?? null,
    repo: o.git?.repo ?? null,
    branch: o.git?.branch ?? null,
    worktree: o.git?.worktree ?? false,
    lastCommitAt: o.git?.lastCommitAt ?? null,
    framework: o.project?.framework ?? null,
    bindAddress: bindAddress(o),
    exposed: o.bind === 'all',
    orphaned: o.orphan,
    supervisor: o.supervisor ?? null,
    displayName: o.project ? null : fallbackName(o),
    startedAt: o.startedAt,
    label: o.label.includes(' @ ') ? o.label : null,
  };
}

export function toObserved(o: Observation, taken: ReadonlySet<string>): ObservedListener {
  return {
    id: o.id,
    port: o.port,
    http: o.kind === 'web',
    httpStatus: o.http?.status ?? null,
    title: o.http?.title ?? null,
    favicon: o.http?.favicon ?? null,
    firstSeen: o.firstSeen,
    lastSeen: o.lastSeen,
    identity: toIdentity(o),
    suggestedSlug: suggestSlug(o, taken),
  };
}

/** An identity for a lost app the scanner never recorded: what its file says. */
function appOnlyIdentity(r: LostRecord): ListenerIdentity {
  return {
    pid: null,
    ppid: null,
    process: r.command?.[0] ? path.basename(r.command[0]) : null,
    command: r.command?.join(' ') ?? null,
    cwd: r.cwd,
    projectDir: null,
    name: r.label,
    description: null,
    repo: null,
    branch: null,
    worktree: false,
    lastCommitAt: null,
    framework: null,
    bindAddress: null,
    exposed: false,
    orphaned: false,
    supervisor: null,
    displayName: null,
    startedAt: null,
    label: null,
  };
}

/** The declared apps, as the lost-set computation wants them. */
export function lostApps(store: Store): LostAppInput[] {
  const out: LostAppInput[] = [];
  for (const [slug, e] of store.apps) {
    const c = e.value;
    if (!c) continue;
    out.push({ slug, name: c.name, port: c.port, managed: !!c.service, command: c.service?.command ?? null, cwd: c.service?.cwd ? expandHome(c.service.cwd, os.homedir()) : null, projectDir: c.project?.dir ? expandHome(c.project.dir, os.homedir()) : null });
  }
  return out;
}

/** Probe targets from the declared apps with a good config. (Discovered apps join when an adapter exists.) */
export function probeTargets(store: Store): ProbeTarget[] {
  const out: ProbeTarget[] = [];
  for (const [slug, e] of store.apps) {
    const c = e.value;
    if (!c) continue;
    out.push({
      slug,
      port: c.port,
      host: c.host,
      expected: c.expected,
      ...(c.health ? { health: { path: c.health.path, ...(c.health.expectStatus === null ? {} : { expectStatus: c.health.expectStatus }) } } : {}),
    });
  }
  return out;
}

/** What makes the observed list look different: worth an `observed` event. */
const listKey = (list: Observation[]) => list.map((o) => `${o.id}:${o.kind}:${o.label}:${o.http?.title ?? ''}`).sort().join('|');

export async function startLive({ store, bus, providers, selfPorts = [], platform, scan = true }: LiveOptions) {
  const home = store.home;
  const config = () => store.currentConfig();
  const knownPorts = () => new Set(probeTargets(store).map((t) => t.port));
  const osEphemeral = () => (platform ?? currentPlatform()).ephemeralPorts();
  const ignore = () => {
    const ig = store.currentIgnore();
    return { ports: ig.ports, processes: ig.processes, dirs: ig.dirs.map((d) => expandHome(d, os.homedir())) };
  };

  // health transitions and scans can tell that a lost item is back, once what that needs is in place (below)
  let lostWired = false;
  const health: HealthService = await startHealth({
    home,
    targets: () => probeTargets(store),
    settings: () => ({ ...config().probe, startGraceSeconds: config().services.startGraceSeconds }),
    onState: (slug, h) => {
      bus.emit({ type: 'state', slug, state: h.state });
      if (lostWired) lostMaybeBack();
    },
  });

  let lastKey = '';
  const lostStore = new LostStore(path.join(dataPaths(home).state, 'lost.json'));
  let lastBackKey = '';
  const scanner: Scanner | null = scan
    ? createScanner({
        home,
        platform,
        settings: () => config().scan,
        ignore,
        knownPorts,
        selfPorts: () => selfPorts,
        onScan: (r) => {
          const key = listKey([...r.listeners, ...r.other]);
          if (key !== lastKey) bus.emit({ type: 'observed', reason: 'scan' });
          lastKey = key;
          if (lostWired) lostMaybeBack();
        },
      })
    : null;

  /** The latest scan's unknown listeners, with today's ignore rules and declared ports applied (a claim or an
   * ignore takes effect at once, without waiting for the next scan). Nothing while `scan.enabled` is off: the last
   * scan before it was turned off would otherwise stay in the tray for good, ageing. */
  function observed(): Observation[] {
    const r = scanner?.last();
    const cfg = config().scan;
    if (!r || !cfg.enabled) return [];
    const known = knownPorts();
    const opts = { minPort: cfg.minPort, includeEphemeralPorts: cfg.includeEphemeralPorts, osEphemeral: osEphemeral(), ignore: ignore(), selfPid: process.pid, selfPorts };
    return [...r.listeners, ...r.other].filter(
      (o) => !known.has(o.port) && !noiseReason({ pid: o.pid, process: o.process, port: o.port, addresses: o.addresses }, opts, o.cwd),
    );
  }
  /** Any listener on a port, declared or not, from the latest scan. */
  function onPort(port: number): Observation | null {
    const r = scanner?.last();
    if (!r || !config().scan.enabled) return null;
    return r.known.get(port) ?? r.listeners.find((o) => o.port === port) ?? r.other.find((o) => o.port === port) ?? null;
  }

  /** Every listener in the latest scan, declared or not, noise filtered but before ignore rules and declared ports. */
  function allListening(): Observation[] | null {
    const r = scanner?.last();
    if (!r) return null;
    return [...r.listeners, ...r.other, ...r.known.values()];
  }
  const appOnPort = (port: number) => [...store.apps].find(([, e]) => e.value?.port === port)?.[0] ?? null;
  /** Is something listening for a lost item again? The same process (by id), or anything on its app's port. */
  function isBack(r: LostRecord): boolean {
    const slug = appOnPort(r.port) ?? (r.slug && store.apps.has(r.slug) ? r.slug : null);
    if (slug) {
      const st = health.prober.health(slug)?.state;
      if (st === 'healthy' || st === 'unhealthy') return true;
    }
    const now = allListening();
    if (!now) return false;
    return now.some((o) => o.id === r.id || (slug !== null && o.port === r.port));
  }
  const backKey = () => (lostStore.get()?.items ?? []).filter(isBack).map((i) => i.id).join(',');
  /** A lost item came back (or went again) after a scan or a health transition: the banner's rows change. */
  function lostMaybeBack() {
    const back = backKey();
    if (back !== lastBackKey && lostStore.get()) bus.emit({ type: 'reboot', lost: lostStore.get()!.items.map((i) => i.id) });
    lastBackKey = back;
  }
  lostWired = true;

  function lostItem(r: LostRecord, taken: ReadonlySet<string>): LostItem {
    const slug = appOnPort(r.port) ?? (r.slug && store.apps.has(r.slug) ? r.slug : null);
    const o = r.observation;
    return {
      id: r.id,
      port: r.port,
      label: (slug && store.apps.get(slug)?.value?.name) || r.label,
      slug,
      managed: !!(slug && store.apps.get(slug)?.value?.service),
      title: o?.http?.title ?? null,
      identity: o ? toIdentity(o) : appOnlyIdentity(r),
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      back: isBack(r),
      suggestedSlug: slug ? null : o ? suggestSlug(o, taken) : null,
      command: r.command,
      cwd: r.cwd,
    };
  }
  function lostNotice(): LostNotice | null {
    const f = lostStore.get();
    if (!f) return null;
    const taken = new Set(store.apps.keys());
    return { bootTime: f.bootTime, previousBootTime: f.previousBootTime, detectedAt: f.detectedAt, items: f.items.map((r) => lostItem(r, taken)) };
  }

  /**
   * After a reboot: what was running at the end of the last boot and isn't now, into state/lost.json (replacing the
   * last notice), and a `reboot` event. Services that start at login may still be starting when the daemon's first
   * scan runs, so if one of them isn't listening yet, wait out the start grace period and scan again first.
   */
  async function noticeReboot(boot: { bootTime: string | null; previous: { bootTime: string } | null }) {
    const bootTime = Date.parse(boot.bootTime ?? '');
    if (!Number.isFinite(bootTime)) return;
    const atLogin = lostApps(store).filter((a) => store.apps.get(a.slug)?.value?.service?.runAtLoad);
    if (scanner && atLogin.length && allListening() && atLogin.some((a) => !allListening()!.some((o) => o.port === a.port))) {
      await new Promise((r) => setTimeout(r, config().services.startGraceSeconds * 1000).unref());
      if (stopped) return;
      await scanner.scan().catch(() => {});
    }
    const now = allListening();
    const records = scanner?.history() ?? [];
    const apps = lostApps(store);
    // without a scan (scanning is off) look at each port once
    const ports = new Set<number>();
    if (!now) {
      const candidates = new Set([...records.map((o) => o.port), ...apps.map((a) => a.port)]);
      await Promise.all([...candidates].map(async (p) => ((await isListening(p, '127.0.0.1')) || (await isListening(p, '::1'))) && ports.add(p)));
    }
    if (stopped) return;
    const items = computeLost({
      records,
      bootTime,
      previousBootTime: boot.previous ? Date.parse(boot.previous.bootTime) : null,
      listening: ({ id, port, slug }) => (now ? now.some((o) => o.id === id || (slug !== null && o.port === port)) : ports.has(port)),
      apps,
      lastSample: (slug) => health.store.lastBefore(slug, bootTime),
      windowMs: 2 * config().scan.intervalSeconds * 1000 + 60_000,
    });
    lostStore.replace({ version: 1, bootTime: new Date(bootTime).toISOString(), previousBootTime: boot.previous?.bootTime ?? null, detectedAt: new Date().toISOString(), items });
    lastBackKey = backKey();
    bus.emit({ type: 'reboot', lost: items.map((i) => i.id) });
  }

  // history is a few dozen small queries; /api/state asks for every app's on every load, so keep each for a moment
  const historyCache = new Map<string, { at: number; v: AppHistory }>();
  const HISTORY_TTL_MS = 5000;

  const unregister = providers.register({
    name: 'live',
    appHealth(slug): AppHealth | null {
      const h = health.prober.health(slug);
      if (!h) return null;
      const s = health.store.summary(slug);
      return {
        state: h.state,
        ...(h.starting ? { starting: true } : {}),
        since: h.lastProbe ? new Date(h.since).toISOString() : null,
        checkedAt: h.lastProbe ? new Date(h.lastProbe.at).toISOString() : null,
        httpStatus: h.lastProbe?.httpStatus ?? null,
        latencyMs: h.lastProbe?.latencyMs ?? null,
        detail: probeDetail(h),
        uptime24h: s.uptime,
        latencyP50: s.latencyP50,
      };
    },
    appHistory(slug, window): AppHistory | null {
      const key = `${slug}\0${window}`;
      const hit = historyCache.get(key);
      if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.v;
      const v = health.store.history(slug, window);
      historyCache.set(key, { at: Date.now(), v });
      return v;
    },
    appIdentity({ port }) {
      const o = onPort(port);
      return o ? toIdentity(o) : null;
    },
    serviceStarting: (slug: string) => {
      health.prober.markStarting(slug);
      return true;
    },
    lost: lostNotice,
    lostRecord: (id: string) => lostStore.item(id),
    dismissLost: (id?: string) => {
      const n = lostStore.dismiss(id);
      if (n) bus.emit({ type: 'reboot', lost: lostStore.get()?.items.map((i) => i.id) ?? [] });
      return n;
    },
    lostChanged: async (id: string, slug: string) => {
      lostStore.setSlug(id, slug);
      await scanner?.scan().catch(() => {});
      lastBackKey = backKey();
      bus.emit({ type: 'reboot', lost: lostStore.get()?.items.map((i) => i.id) ?? [] });
    },
    ...(scanner
      ? {
          observed: () => {
            const taken = new Set(store.apps.keys());
            return observed().map((o) => toObserved(o, taken));
          },
          observation: (id: string) => {
            const o = observed().find((x) => x.id === id);
            return o ? toObserved(o, new Set(store.apps.keys())) : null;
          },
          scan: async () => {
            await scanner.scan();
          },
        }
      : {}),
  });

  // Config and app files change under us (API writes and hand edits alike): re-read the probe targets. This is an
  // internal subscriber, as are the thumbnailer and the proxy, so `bus.size` counts open dashboards only. Turning the
  // scanner off empties the tray, and turning it back on scans straight away rather than after a whole interval.
  let scanEnabled = config().scan.enabled;
  const onEvent = (e: ServerEvent) => {
    if (e.type === 'app' || e.type === 'apps' || e.type === 'config') {
      health.prober.refresh();
      historyCache.clear();
    }
    if (e.type === 'config' && scanner && config().scan.enabled !== scanEnabled) {
      scanEnabled = config().scan.enabled;
      if (scanEnabled) scanner.scan().catch(() => {});
      bus.emit({ type: 'observed', reason: 'config' });
    }
  };
  const unsubscribe = bus.subscribe(onEvent, { internal: true });
  const liveTimer = setInterval(() => health.prober.setLive(bus.size > 0), 2000);
  liveTimer.unref();

  // the first scan takes a couple of seconds (sniffs time out at 2 s): don't hold the daemon's start-up for it
  let stopped = false;
  const ready = scanner ? scanner.start() : Promise.resolve(null);
  ready.catch(() => {});
  const lostReady = ready.then((boot) => (boot?.rebooted ? noticeReboot(boot) : undefined)).catch((e) => process.stderr.write(`hallway: working out what the reboot lost failed: ${(e as Error).message}\n`));

  return {
    health,
    scanner,
    /** Resolves after the first scan, with what state/boot.json said (a reboot is v1's "Lost at last reboot"). */
    ready,
    /** Resolves once a reboot's lost set (if there was a reboot) is in state/lost.json. */
    lostReady,
    lost: lostStore,
    observed,
    async stop() {
      stopped = true;
      clearInterval(liveTimer);
      unsubscribe();
      unregister();
      scanner?.stop();
      health.stop();
    },
  };
}

export type Live = Awaited<ReturnType<typeof startLive>>;
