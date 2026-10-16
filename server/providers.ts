// The seams the daemon core leaves for the modules that produce live data (server/prober/, server/health/,
// server/scanner/, discovery adapters, the thumbnailer). The core owns the files and the API; these modules own what
// is happening right now. Each registers a provider when the daemon starts:
//
//   import { registerStateProvider } from '../providers.js';
//   const off = registerStateProvider({ name: 'prober', appHealth: (slug) => current.get(slug) ?? null });
//
// and emits events on the bus (server/events.ts) when something the dashboard shows changes:
//
//   import { bus } from '../events.js';
//   bus.emit({ type: 'state', slug, state: 'down' });    // a health transition (not every probe)
//   bus.emit({ type: 'observed', reason: 'scan' });       // the observed list changed
//
// Every method is optional and synchronous where the dashboard reads it (keep the latest results in memory; GET
// /api/state must answer in milliseconds). Several providers can be registered; for each slot the first one that
// returns a non-null answer wins, in registration order. A provider that throws is skipped for that call (and
// logged), never taking the API down.
import type { AppConfig, AppHealth, AppHistory, DiscoveredApp, HistoryWindow, ListenerIdentity, LostNotice, ObservedListener } from '../shared/api.js';
import type { LostRecord } from './lost/index.js';

/** What the API tells a provider about a declared app. */
export interface AppRef {
  slug: string;
  config: AppConfig;
}

export interface StateProvider {
  /** For logs and error messages: `prober`, `scanner`, `uptime`, `paddock-pm`. */
  name: string;
  /** An app's current health (the prober). Null: no data yet. */
  appHealth?(slug: string): AppHealth | null;
  /** Uptime buckets and latency for a window (the uptime store). Null: no data. */
  appHistory?(slug: string, window: HistoryWindow): AppHistory | null;
  /** The process listening on an app's port (the scanner's enrichment of declared/discovered apps). */
  appIdentity?(app: { slug: string; port: number; host: string }): ListenerIdentity | null;
  /** Listeners that are neither declared nor discovered, with ignore.yaml already applied (the scanner). */
  observed?(): ObservedListener[];
  /** One observation by id, for claim and ignore. Defaults to searching `observed()`. */
  observation?(id: string): ObservedListener | null;
  /** Run a scan now (`POST /api/scan`). Resolves when it's done. */
  scan?(): Promise<void>;
  /** Apps from other tools' registries (discovery adapters). */
  discovered?(): DiscoveredApp[];
  /** A thumbnail for an app (`GET /api/apps/:slug/thumb`). */
  thumb?(slug: string): { body: Uint8Array; contentType: string; etag: string } | null;
  /** A managed service is being started by the daemon: give it the start grace period (`◐ starting`, not down). */
  serviceStarting?(slug: string): boolean;
  /** "Lost at last reboot": the notice, with each item's `back` worked out now (server/live.ts). Null: nothing lost. */
  lost?(): LostNotice | null;
  /** One lost item as recorded (with the observation it came from), for the actions. */
  lostRecord?(id: string): LostRecord | null;
  /** Dismiss one lost item, or all of them. Returns how many went (0 for an unknown id). */
  dismissLost?(id?: string): number | null;
  /** Something was done about a lost item (it was registered as `slug`): rescan, then tell the dashboards. */
  lostChanged?(id: string, slug: string): Promise<void>;
  /** A bookmark's favicon (`GET /api/bookmarks/:group/icon?url=`), from its `url` and `icon:` (the thumbnailer). */
  bookmarkIcon?(link: { url: string; icon: string }, group?: string): { body: Uint8Array; contentType: string; etag: string } | null;
}

export class ProviderRegistry {
  private list: StateProvider[] = [];

  /** Plug a provider in. Returns a function that unplugs it. */
  register(p: StateProvider): () => void {
    this.list.push(p);
    return () => {
      this.list = this.list.filter((x) => x !== p);
    };
  }

  /** Is any provider filling this slot? */
  has(slot: Exclude<keyof StateProvider, 'name'>): boolean {
    return this.list.some((p) => typeof p[slot] === 'function');
  }

  /** The first non-null answer for a slot. */
  first<K extends Exclude<keyof StateProvider, 'name'>>(slot: K, ...args: Parameters<NonNullable<StateProvider[K]>>): NonNullable<ReturnType<NonNullable<StateProvider[K]>>> | null {
    for (const p of this.list) {
      const fn = p[slot] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof fn !== 'function') continue;
      try {
        const v = fn.apply(p, args);
        if (v !== null && v !== undefined) return v as never;
      } catch (e) {
        process.stderr.write(`hallway: provider ${p.name}.${String(slot)} failed: ${(e as Error).message}\n`);
      }
    }
    return null;
  }

  /** Every provider's answer for a list slot, concatenated. */
  all<K extends 'observed' | 'discovered'>(slot: K): NonNullable<ReturnType<NonNullable<StateProvider[K]>>> {
    const out: unknown[] = [];
    for (const p of this.list) {
      const fn = p[slot] as (() => unknown[]) | undefined;
      if (typeof fn !== 'function') continue;
      try {
        out.push(...(fn.call(p) ?? []));
      } catch (e) {
        process.stderr.write(`hallway: provider ${p.name}.${slot} failed: ${(e as Error).message}\n`);
      }
    }
    return out as never;
  }

  /** Every provider's `scan()`, together. False if none can scan. */
  async scan(): Promise<boolean> {
    const scanners = this.list.filter((p) => typeof p.scan === 'function');
    await Promise.all(scanners.map((p) => p.scan!()));
    return scanners.length > 0;
  }

  observation(id: string): ObservedListener | null {
    return this.first('observation', id) ?? this.all('observed').find((o) => o.id === id) ?? null;
  }
}

/** The daemon's registry. Tests make their own. */
export const providers = new ProviderRegistry();

/** Plug a provider into the running daemon. Returns a function that unplugs it. */
export function registerStateProvider(p: StateProvider): () => void {
  return providers.register(p);
}
