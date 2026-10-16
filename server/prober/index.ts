// The health prober (docs/04-apps-health-services.md, "Health states" and "Probing"; D12): the TCP-then-HTTP probe
// ladder for every declared and discovered app, every `probe.intervalSeconds` (±10 % jitter, at most
// `probe.concurrency` in flight; `probe.liveIntervalSeconds` while a dashboard is connected), flap damping, and state
// transitions reported as they happen. Each probe's outcome is also handed on as an uptime sample (server/health/).
//
// The prober doesn't read YAML or know about SSE: the daemon gives it a `targets()` callback and listens through
// `onTransition` / `onSample`.
import type { AppState } from '../../shared/api.js';
import { type ProbeOptions, type ProbeResult, type ProbeTarget, probe as probeOnce } from './probe.js';
import { type Classified, type Health, classify, initialHealth, step } from './state.js';

export type { Expected, ProbeResult, ProbeTarget } from './probe.js';
export type { Health } from './state.js';

/** `probe:` in config.yaml, plus `services.startGraceSeconds` (docs/02-architecture.md). */
export interface ProbeSettings {
  intervalSeconds: number;
  liveIntervalSeconds: number;
  timeoutMs: number;
  concurrency: number;
  failuresBeforeUnhealthy: number;
  startGraceSeconds: number;
}

export const DEFAULT_PROBE: ProbeSettings = {
  intervalSeconds: 60,
  liveIntervalSeconds: 15,
  timeoutMs: 5000,
  concurrency: 8,
  failuresBeforeUnhealthy: 2,
  startGraceSeconds: 30,
};

/** One probe, as stored by the uptime store. `starting` probes are not samples: there's nothing to judge yet. */
export interface Sample {
  slug: string;
  ts: number;
  state: Exclude<AppState, 'unknown'>;
  httpStatus: number | null;
  latencyMs: number | null;
}

export interface ProbeHealth extends Health {
  slug: string;
  lastProbe: (ProbeResult & { at: number }) | null;
}

export interface ProberOptions {
  /** The apps to probe, re-read on every refresh(). */
  targets: () => ProbeTarget[];
  settings?: () => ProbeSettings;
  /** Called when an app's shown state changes (not on every probe). */
  onTransition?: (slug: string, health: ProbeHealth, previous: AppState) => void;
  onSample?: (sample: Sample) => void;
  /** Replaceable for tests. */
  probe?: (t: ProbeTarget, o: ProbeOptions) => Promise<ProbeResult>;
  now?: () => number;
  random?: () => number;
}

/** A random factor in [0.9, 1.1): ±10 % jitter, so apps don't all get probed in the same instant. */
const jitter = (random: () => number) => 0.9 + random() * 0.2;

export function createProber(opts: ProberOptions) {
  const settings = opts.settings ?? (() => DEFAULT_PROBE);
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const doProbe = opts.probe ?? probeOnce;

  interface Entry {
    target: ProbeTarget;
    key: string;
    health: ProbeHealth;
    timer: NodeJS.Timeout | null;
    nextAt: number;
    inFlight: boolean;
    /** Epoch ms until which "not listening" counts as starting, not down. */
    graceUntil: number;
  }
  const entries = new Map<string, Entry>();
  let live = false;
  let running = false;
  let active = 0;
  const waiting: (() => void)[] = [];

  // live mode only ever speeds probing up: a normal interval set below the live one wins
  const interval = () => {
    const s = settings();
    return (live ? Math.min(s.liveIntervalSeconds, s.intervalSeconds) : s.intervalSeconds) * 1000;
  };

  async function slot() {
    if (active < Math.max(1, settings().concurrency)) {
      active++;
      return;
    }
    await new Promise<void>((res) => waiting.push(res));
  }
  function release() {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight on
    else active--;
  }

  function schedule(e: Entry, delayMs: number) {
    if (!running || entries.get(e.target.slug) !== e) return;
    if (e.timer) clearTimeout(e.timer);
    e.nextAt = now() + delayMs;
    e.timer = setTimeout(() => {
      e.timer = null;
      void run(e);
    }, delayMs);
    e.timer.unref?.();
  }

  async function run(e: Entry): Promise<void> {
    if (e.inFlight) return;
    e.inFlight = true;
    await slot();
    let result: ProbeResult;
    try {
      result = await doProbe(e.target, { timeoutMs: settings().timeoutMs });
    } catch (err) {
      result = { outcome: 'unhealthy', httpStatus: null, latencyMs: null, error: (err as Error).message };
    } finally {
      release();
      e.inFlight = false;
    }
    // removed or replaced while the probe was out
    if (entries.get(e.target.slug) !== e) return;
    const t = now();
    const c: Classified = classify(result.outcome, e.target.expected, t < e.graceUntil);
    const prev = e.health.state;
    const { next, changed } = step(e.health, c, t, settings().failuresBeforeUnhealthy);
    e.health = { ...e.health, ...next, lastProbe: { ...result, at: t } };
    if (c !== 'starting')
      opts.onSample?.({ slug: e.target.slug, ts: t, state: c, httpStatus: result.httpStatus, latencyMs: result.latencyMs });
    if (changed) opts.onTransition?.(e.target.slug, e.health, prev);
    schedule(e, interval() * jitter(random));
  }

  /** Pick up added, removed and changed targets. New or changed ones are probed straight away. */
  function refresh() {
    const seen = new Set<string>();
    for (const target of opts.targets()) {
      seen.add(target.slug);
      const key = JSON.stringify(target);
      const old = entries.get(target.slug);
      if (old && old.key === key) continue;
      if (old?.timer) clearTimeout(old.timer);
      // a new port or host is a different thing to probe: start from unknown. A new `expected` only re-judges.
      const fresh = !old || old.target.port !== target.port || old.target.host !== target.host;
      const e: Entry = {
        target,
        key,
        health: fresh ? { slug: target.slug, ...initialHealth(now()), lastProbe: null } : old.health,
        timer: null,
        nextAt: 0,
        inFlight: false,
        graceUntil: old?.graceUntil ?? 0,
      };
      entries.set(target.slug, e);
      // spread the first round over a couple of seconds rather than a burst
      schedule(e, old ? 0 : Math.round(random() * Math.min(2000, interval())));
    }
    for (const [slug, e] of entries)
      if (!seen.has(slug)) {
        if (e.timer) clearTimeout(e.timer);
        entries.delete(slug);
      }
  }

  return {
    start() {
      running = true;
      refresh();
    },
    stop() {
      running = false;
      for (const e of entries.values()) if (e.timer) clearTimeout(e.timer);
      entries.clear();
    },
    refresh,
    /**
     * Whether a dashboard is connected over SSE. Going live pulls every app's next probe in to within the live
     * interval, so the page feels live straight away.
     */
    setLive(on: boolean) {
      if (on === live) return;
      live = on;
      if (!on) return;
      const soon = interval();
      for (const e of entries.values()) if (!e.inFlight && e.nextAt - now() > soon) schedule(e, soon * random());
    },
    /**
     * A managed service was just (re)started: for `services.startGraceSeconds`, not listening counts as `starting`
     * rather than `down`. Probes it straight away.
     */
    markStarting(slug: string) {
      const e = entries.get(slug);
      if (!e) return;
      e.graceUntil = now() + settings().startGraceSeconds * 1000;
      schedule(e, 0);
    },
    /** Probe one app now (e.g. after its YAML changed). */
    probeNow(slug: string) {
      const e = entries.get(slug);
      if (e) schedule(e, 0);
    },
    health(slug: string): ProbeHealth | null {
      return entries.get(slug)?.health ?? null;
    },
    all(): ProbeHealth[] {
      return [...entries.values()].map((e) => e.health);
    },
  };
}

export type Prober = ReturnType<typeof createProber>;
