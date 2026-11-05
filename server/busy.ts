// What `/api/busy` counts (the CLI contract's busy check, SPEC §4; D75): work a restart of the daemon would cut short.
// Two kinds, both run by the daemon itself: `setup`, the dashboard's Turn on for local domains (its job, server/proxy/
// status.ts), and `app`, an app's start, stop or restart asked of the daemon (the dashboard's buttons, the Lost banner's
// restart). A `hallway start <slug>` in a terminal runs in its own process, so a daemon restart doesn't touch it, and
// isn't counted. In memory only, so asking is cheap.

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
