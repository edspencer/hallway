// The page's data: one GET /api/state, then live updates over SSE (docs/02-architecture.md, "Live updates"). Each
// event is a hint about what changed; the matching resource is refetched rather than trusting the payload. Events
// that arrive together are coalesced into one round of requests. The stream reconnects with backoff, and a
// reconnect refetches everything, since events may have been missed.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppView, ServerEvent, StateResponse } from '../shared/api';
import { getApp, getBookmarks, getObserved, getState } from './api';

export type Connection = 'live' | 'connecting' | 'reconnecting';

export interface Live {
  state: StateResponse | null;
  /** The first load failed (the daemon isn't reachable): the page shows that instead. */
  failed: boolean;
  connection: Connection;
  /** Bumped when a bookmark group might have new icons: part of each chip's icon URL. */
  iconVersion: number;
  /** Put a write's answer on the page now, before its event comes back. */
  putApp(view: AppView): void;
  refresh(): Promise<void>;
}

/** Declared apps, then discovered ones, each by name (as the server sorts them, server/views.ts). */
function sortApps(apps: AppView[]) {
  const rank = (a: AppView) => (a.source === 'declared' ? 0 : 1);
  return apps.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

const BACKOFF_MS = [500, 1000, 2000, 5000, 10_000, 30_000];
/** The uptime bars move on every half hour without any event: refresh quietly now and then. */
const REFRESH_MS = 5 * 60_000;

export function useLive(): Live {
  const [state, setState] = useState<StateResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [iconVersion, setIconVersion] = useState(0);
  const loaded = useRef(false);
  const pending = useRef<{ full: boolean; apps: Set<string>; bookmarks: boolean; observed: boolean; timer: number | null }>({
    full: false,
    apps: new Set(),
    bookmarks: false,
    observed: false,
    timer: null,
  });

  const refresh = useCallback(async () => {
    try {
      const s = await getState();
      loaded.current = true;
      setState(s);
      setFailed(false);
    } catch {
      setState((prev) => {
        if (!prev) setFailed(true);
        return prev;
      });
    }
  }, []);

  const putApp = useCallback((view: AppView) => {
    setState((s) => {
      if (!s) return s;
      const apps = s.apps.filter((a) => a.slug !== view.slug);
      // a write's answer has no history; keep what the card already showed
      const old = s.apps.find((a) => a.slug === view.slug);
      apps.push(view.history || !old ? view : { ...view, history: old.history });
      return { ...s, apps: sortApps(apps) };
    });
  }, []);

  const flush = useCallback(async () => {
    const p = pending.current;
    p.timer = null;
    const { full, bookmarks, observed } = p;
    const slugs = [...p.apps];
    Object.assign(p, { full: false, bookmarks: false, observed: false, apps: new Set() });
    if (full) return refresh();
    try {
      const [apps, groups, obs] = await Promise.all([
        Promise.all(slugs.map(async (slug) => [slug, await getApp(slug)] as const)),
        bookmarks ? getBookmarks() : null,
        observed ? getObserved() : null,
      ]);
      setState((s) => {
        if (!s) return s;
        let list = s.apps;
        for (const [slug, view] of apps) {
          const old = list.find((a) => a.slug === slug);
          list = list.filter((a) => a.slug !== slug);
          if (view) list.push(view.history || !old ? view : { ...view, history: old.history });
        }
        return { ...s, apps: sortApps([...list]), bookmarks: groups ?? s.bookmarks, observed: obs ?? s.observed };
      });
      if (bookmarks) setIconVersion((v) => v + 1);
    } catch {
      // one resource failed: get everything instead
      void refresh();
    }
  }, [refresh]);

  const onEvent = useCallback(
    (e: ServerEvent) => {
      const p = pending.current;
      switch (e.type) {
        case 'app':
        case 'state':
        case 'thumb':
          p.apps.add(e.slug);
          break;
        case 'bookmarks':
          // a file that isn't a valid group name only shows up in the page-wide problems
          if (e.group) p.bookmarks = true;
          else p.full = true;
          break;
        case 'observed':
          // ignore.yaml changed: its problems are page-wide
          if (e.reason === 'ignored') p.full = true;
          else p.observed = true;
          break;
        default:
          // apps (the list, or a stray file), config (it changes every URL), reboot
          p.full = true;
      }
      p.timer ??= window.setTimeout(flush, 30);
    },
    [flush],
  );

  // the first load, and a quiet refresh now and then (and when a long-hidden tab comes back)
  useEffect(() => {
    void refresh();
    let hiddenAt = 0;
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
    const vis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) void refresh();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [refresh]);

  // the event stream, reconnecting with backoff
  useEffect(() => {
    let es: EventSource | null = null;
    let attempt = 0;
    let retry: number | null = null;
    let opened = false;
    let closed = false;
    const connect = () => {
      es = new EventSource('/api/events');
      es.addEventListener('hello', () => {
        // events may have been missed while disconnected (or the first load failed: the daemon is back)
        if (opened || !loaded.current) void refresh();
        opened = true;
        attempt = 0;
        setConnection('live');
      });
      es.addEventListener('change', (m) => {
        try {
          onEvent(JSON.parse((m as MessageEvent<string>).data) as ServerEvent);
        } catch {
          /* not an event we understand */
        }
      });
      es.onerror = () => {
        es?.close();
        if (closed) return;
        setConnection(opened ? 'reconnecting' : 'connecting');
        retry = window.setTimeout(connect, BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (retry) window.clearTimeout(retry);
    };
  }, [onEvent, refresh]);

  return { state, failed, connection, iconVersion, putApp, refresh };
}
