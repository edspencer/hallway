// The in-process event bus and the SSE stream (docs/02-architecture.md, "Live updates"; Local Review's events.ts and
// /api/events). Anything that changes what the dashboard shows emits a ServerEvent; GET /api/events pushes each one to
// every open dashboard, which refetches what it names. Producers: the store (API writes), the file watcher (hand
// edits), and the providers (the prober's `state` transitions, the scanner's `observed`, the thumbnailer's `thumb`).
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ServerEvent } from '../shared/api.js';

export type { ServerEvent };
type Listener = (e: ServerEvent) => void;

/** How long a burst of changes to one thing is gathered into one event. */
export const DEBOUNCE_MS = 150;
/** The SSE heartbeat: a `: ping` comment when nothing else was sent for this long. */
export const HEARTBEAT_MS = 25_000;

export class EventBus {
  private listeners = new Set<Listener>();
  private passive = new Set<Listener>();
  private timers = new Map<string, { t: NodeJS.Timeout; fn: () => ServerEvent | ServerEvent[] | null | void }>();

  /**
   * `passive`: a listener that isn't someone watching (the MCP server's change notifications), so it doesn't count in
   * `size` and doesn't make the prober think a dashboard is open.
   */
  subscribe(l: Listener, { passive = false } = {}): () => void {
    (passive ? this.passive : this.listeners).add(l);
    return () => {
      this.listeners.delete(l);
      this.passive.delete(l);
    };
  }

  /** How many subscribers (open dashboards, mostly): the prober probes faster while there are any. */
  get size() {
    return this.listeners.size;
  }

  emit(e: ServerEvent) {
    for (const l of [...this.listeners, ...this.passive]) {
      try {
        l(e);
      } catch {
        /* a broken listener mustn't stop the others */
      }
    }
  }

  /**
   * Debounce per key: emit `e` (or whatever `e()` returns, computed when the timer fires) `ms` after the last call
   * with this key, so a burst of file events (an editor's write-rename-chmod, a `git checkout`) becomes one push.
   */
  emitSoon(key: string, e: ServerEvent | (() => ServerEvent | ServerEvent[] | null | void), ms = DEBOUNCE_MS) {
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev.t);
    const fn = typeof e === 'function' ? e : () => e;
    const t = setTimeout(() => {
      this.timers.delete(key);
      let out: ServerEvent | ServerEvent[] | null | void;
      try {
        out = fn();
      } catch (err) {
        process.stderr.write(`hallway: [events] ${key}: ${(err as Error).message}\n`);
        return;
      }
      for (const ev of Array.isArray(out) ? out : out ? [out] : []) this.emit(ev);
    }, ms);
    this.timers.set(key, { t, fn });
  }

  /** Run every pending debounced emit now (shutdown, tests). */
  flush() {
    for (const [key, { t, fn }] of [...this.timers]) {
      clearTimeout(t);
      this.timers.delete(key);
      const out = fn();
      for (const ev of Array.isArray(out) ? out : out ? [out] : []) this.emit(ev);
    }
  }

  /** Drop pending debounced emits. */
  cancel() {
    for (const { t } of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

/** The daemon's bus. Tests make their own. */
export const bus = new EventBus();

/**
 * `GET /api/events`: a `hello` event, then each ServerEvent as a `change` event with an incrementing id, and a
 * `: ping` comment every `heartbeatMs` of silence. Exactly Local Review's loop.
 */
export function sseHandler(b: EventBus, heartbeatMs = HEARTBEAT_MS) {
  return (c: Context) =>
    streamSSE(c, async (stream) => {
      let id = 0;
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const unsub = b.subscribe((e) => {
        queue.push(JSON.stringify(e));
        wake?.();
      });
      stream.onAbort(() => {
        unsub();
        wake?.();
      });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ t: Date.now() }) });
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ event: 'change', data: queue.shift()!, id: String(++id) });
        let timer: NodeJS.Timeout | undefined;
        await new Promise<void>((res) => {
          wake = res;
          timer = setTimeout(res, heartbeatMs); // heartbeat
        });
        clearTimeout(timer); // woken early: don't leave a 25 s timer behind (it would hold a stopping daemon open)
        wake = null;
        if (!queue.length && !stream.aborted) await stream.write(': ping\n\n');
      }
      unsub();
    });
}
