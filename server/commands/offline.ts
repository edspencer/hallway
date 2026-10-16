// The scanner, run once from the CLI when no daemon is running (`hallway scan`, `claim`, `ignore`): the same scanner
// module the daemon runs (server/scanner/), with the same filters, and the same claim the API does (server/api.ts).
import os from 'node:os';
import type { AppView, ClaimRequest, ObservedListener } from '../../shared/api.js';
import { claimFile } from '../api.js';
import { expandHome } from '../config.js';
import { ProviderRegistry } from '../providers.js';
import { createScanner } from '../scanner/index.js';
import { declaredView } from '../views.js';
import type { Ctx } from './context.js';

/** Scan now: listeners that aren't declared apps, minus ignore.yaml and the noise filters. */
export async function offlineObserved(ctx: Ctx): Promise<ObservedListener[]> {
  const store = ctx.store();
  const cfg = store.currentConfig();
  const known = new Set<number>();
  for (const e of store.apps.values()) if (e.value) known.add(e.value.port);
  const ig = store.currentIgnore();
  const ignore = { ports: ig.ports, processes: ig.processes, dirs: ig.dirs.map((d) => expandHome(d, os.homedir())) };
  // `hallway scan` is asked for explicitly, so it runs even with scan.enabled: false
  const scanner = createScanner({
    home: store.home,
    platform: ctx.platform(),
    settings: () => ({ ...cfg.scan, enabled: true }),
    ignore: () => ignore,
    knownPorts: () => known,
    selfPorts: () => [cfg.port],
  });
  const r = await scanner.scan();
  const { toObserved } = await import('../live.js');
  const taken = new Set(store.apps.keys());
  return [...r.listeners, ...r.other].filter((o) => !known.has(o.port)).map((o) => toObserved(o, taken));
}

/** Write apps/<slug>.yaml from an observation, as POST /api/observed/:id/claim does. */
export async function offlineClaim(ctx: Ctx, o: ObservedListener, req: ClaimRequest): Promise<AppView> {
  const store = ctx.store();
  const { value, header, footer } = claimFile(o, req);
  await store.createApp(req.slug, value, { header, footer });
  return declaredView({ store, providers: new ProviderRegistry() }, req.slug)!;
}
