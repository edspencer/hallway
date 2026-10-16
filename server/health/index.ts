// Health: the prober (server/prober/) feeding the uptime store (./uptime.ts), with the store's hourly rollup and
// pruning on a timer. The one call the daemon makes to get probing, state transitions and history going.
import path from 'node:path';
import { dataPaths } from '../config.js';
import { type ProbeHealth, type ProbeSettings, type ProbeTarget, createProber } from '../prober/index.js';
import type { AppState } from '../../shared/api.js';
import { UptimeStore, type Window } from './uptime.js';

export { UptimeStore, WINDOWS, type UptimeBucket, type UptimeHistory, type Window } from './uptime.js';

export interface HealthOptions {
  home: string;
  targets: () => ProbeTarget[];
  settings?: () => ProbeSettings;
  /** An app's shown state changed: emit `{ type: 'state', slug, state }`. */
  onState?: (slug: string, health: ProbeHealth, previous: AppState) => void;
  /** Default state/health.sqlite in the data home. */
  file?: string;
}

const HOUR = 3600_000;

export async function startHealth(opts: HealthOptions) {
  const store = await UptimeStore.open(opts.file ?? path.join(dataPaths(opts.home).state, 'health.sqlite'));
  const prober = createProber({
    targets: opts.targets,
    settings: opts.settings,
    onSample: (s) => store.add(s),
    onTransition: (slug, h, prev) => opts.onState?.(slug, h, prev),
  });
  store.prune();
  const maintenance = setInterval(() => store.prune(), HOUR);
  maintenance.unref();
  prober.start();
  return {
    prober,
    store,
    history: (slug: string, window: Window = '24h') => store.history(slug, window),
    stop() {
      clearInterval(maintenance);
      prober.stop();
      store.close();
    },
  };
}

export type HealthService = Awaited<ReturnType<typeof startHealth>>;
