// What `/api/busy` counts (the CLI contract's busy check, SPEC §4; D75): work a restart of the daemon would cut short.
// Two kinds, both run by the daemon itself: `setup`, the dashboard's Turn on for local domains (its job, server/proxy/
// status.ts), and `app`, an app's start, stop or restart asked of the daemon (the dashboard's buttons, the Lost banner's
// restart). A `hallway start <slug>` in a terminal runs in its own process, so a daemon restart doesn't touch it, and
// isn't counted. In memory only, so asking is cheap.

import type { ProviderRegistry } from './providers.js';

export type BusyKind = 'setup' | 'app';

/** The CLI's words for each kind: `Hallway is busy: 1 local-domains setup is running.` */
export const BUSY_NOUNS: Record<BusyKind, [string, string]> = {
  setup: ['local-domains setup', 'local-domains setups'],
  app: ['app start, stop or restart', 'app starts, stops or restarts'],
};

export class BusyTracker {
  private n = new Map<BusyKind, number>();

  /** Run `fn`, counted as one `kind` of work until it settles. */
  async track<T>(kind: BusyKind, fn: () => Promise<T>): Promise<T> {
    this.n.set(kind, this.count(kind) + 1);
    try {
      return await fn();
    } finally {
      this.n.set(kind, this.count(kind) - 1);
    }
  }

  count(kind: BusyKind): number {
    return this.n.get(kind) ?? 0;
  }
}

/** What `/api/busy` answers with, and what a stopping daemon waits for (D77): the setup job and the app operations. */
export function busyCounts(tracker: BusyTracker, providers: ProviderRegistry): Record<BusyKind, number> {
  return { setup: providers.first('frontingSetup')?.state === 'running' ? 1 : 0, app: tracker.count('app') };
}

/** `1 app start, stop or restart`, `1 local-domains setup and 2 app starts, stops or restarts`. */
export function describeBusy(counts: Record<BusyKind, number>): string {
  return (Object.keys(BUSY_NOUNS) as BusyKind[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${BUSY_NOUNS[k][counts[k] === 1 ? 0 : 1]}`)
    .join(' and ');
}
