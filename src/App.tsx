// The dashboard (docs/05-ui.md): the hallway. One GET /api/state paints it, SSE keeps it live (src/live.ts), and the
// sections follow `dashboard.sections` in config.yaml: apps as doors, the observed tray ("Found running — not yet
// named"), and bookmarks by the front door. The tab title and favicon carry the status (D22).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppView, DashboardSection, ObservedListener, StateResponse } from '../shared/api';
import { useAmbientStatus } from './ambient';
import { Bookmarks, NewGroup } from './components/Bookmarks';
import { Door } from './components/Door';
import { Drawer } from './components/Drawer';
import { FirstRun, Unreachable } from './components/Empty';
import { Header } from './components/Header';
import { Help } from './components/Help';
import { ObservedTray, listenerName } from './components/Observed';
import { ProblemBanner } from './components/Problems';
import { Toasts, useToasts } from './components/Toasts';
import { focusFirstItem, useKeyboard, type KeyboardActions } from './keyboard';
import { matchScore } from './lib/filter';
import { displayUrl, homeDir, hostOf } from './lib/format';
import { countStates, subtitle } from './lib/status';
import { useLive } from './live';
import { useTheme } from './theme/theme';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http on a non-local name has no async clipboard: the old way still works
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** What the filter can find, with where Enter would take you. */
interface Hit {
  kind: 'app' | 'observed' | 'bookmark';
  key: string;
  url: string | null;
  score: number;
}

function findAll(state: StateResponse, q: string, home: string | null) {
  const apps = new Map<string, number>();
  const observed = new Map<string, number>();
  const bookmarks = new Map<string, Set<number>>();
  const hits: Hit[] = [];
  const short = (p: string | null | undefined) => (p && home && p.startsWith(home) ? p.slice(home.length) : p);
  for (const a of state.apps) {
    const id = a.identity;
    const s = matchScore(q, { fields: [a.name, a.slug, a.config?.port, a.url ? displayUrl(a.url) : null, subtitle(a), short(a.config?.project?.dir), short(id?.projectDir ?? id?.cwd), id?.repo, id?.branch, ...(a.config?.tags ?? [])] });
    if (s) (apps.set(a.slug, s), hits.push({ kind: 'app', key: a.slug, url: a.url, score: s }));
  }
  for (const o of state.observed) {
    const id = o.identity;
    const s = matchScore(q, { fields: [listenerName(o), o.port, o.title, short(id.projectDir ?? id.cwd), id.repo, id.branch, id.process] });
    if (s) (observed.set(o.id, s), o.http && hits.push({ kind: 'observed', key: o.id, url: `http://localhost:${o.port}`, score: s }));
  }
  for (const g of state.bookmarks) {
    const set = new Set<number>();
    g.config?.links.forEach((l, i) => {
      const s = matchScore(q, { fields: [l.title, hostOf(l.url), g.config!.title, l.description, ...l.tags] });
      if (s) (set.add(i), hits.push({ kind: 'bookmark', key: `${g.group}/${i}`, url: l.url, score: s }));
    });
    bookmarks.set(g.group, set);
  }
  return { apps, observed, bookmarks, hits };
}

export function App() {
  const live = useLive();
  const { state } = live;
  const [filter, setFilter] = useState('');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const toasts = useToasts();
  const filterRef = useRef<HTMLInputElement>(null);

  useTheme(state?.config.config.dashboard.theme);
  // the page is fully drawn from /api/state: a mark to measure against (acceptance criterion 12, docs/08-roadmap.md)
  const painted = useRef(false);
  useEffect(() => {
    if (!state || painted.current) return;
    painted.current = true;
    requestAnimationFrame(() => performance.mark('hallway:painted'));
  }, [state]);
  const counts = useMemo(() => (state && state.daemon.providers.health ? countStates(state.apps) : null), [state]);
  useAmbientStatus(counts, 'Hallway');

  const home = state ? homeDir(state.daemon.dataHome, state.daemon.dataHomeDisplay) : null;
  const q = filter.trim();
  const found = useMemo(() => (state && q ? findAll(state, q, home) : null), [state, q, home]);

  const copy = useCallback(
    async (url: string, what?: string) => {
      const ok = await copyText(url);
      toasts.push(ok ? `Copied ${what ? `${what}: ` : ''}${displayUrl(url)}` : 'Couldn’t copy: your browser blocked it', ok ? 'ok' : 'error');
    },
    [toasts],
  );

  const actions = useMemo<KeyboardActions>(
    () => ({
      focusFilter: () => filterRef.current?.focus(),
      escape: () => {
        if (help) return setHelp(false), true;
        if (drawer) return setDrawer(null), true;
        if (filter) return setFilter(''), filterRef.current?.blur(), true;
        return false;
      },
      toggleHelp: () => setHelp((h) => !h),
      copy: (url) => void copy(url),
      details: (slug) => setDrawer(slug),
      modal: () => help || !!drawer,
    }),
    [help, drawer, filter, copy],
  );
  useKeyboard(actions);

  const onFilterKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && found) {
      const targets = found.hits.filter((h) => h.url);
      if (targets.length === 1) {
        e.preventDefault();
        const url = targets[0]!.url!;
        if (e.metaKey || e.ctrlKey) window.open(url, '_blank', 'noopener');
        else window.location.href = url;
      } else if (targets.length > 1) {
        e.preventDefault();
        focusFirstItem();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusFirstItem();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (filter) setFilter('');
      else filterRef.current?.blur();
    }
  };

  if (!state) {
    if (live.failed) return <Unreachable onRetry={() => void live.refresh()} />;
    // the moment between the page and its one request: the doormat, no spinner
    return (
      <div className="hw-page hw-page--loading">
        <Header ref={filterRef} title="" counts={null} checking={false} connection="live" filter="" onFilter={() => {}} onFilterKey={() => {}} matches={null} onHelp={() => {}} />
      </div>
    );
  }

  const cfg = state.config.config;
  const title = cfg.dashboard.title ?? state.daemon.hostname ?? 'my machine';
  const checking = state.daemon.providers.health;
  const apps = found ? state.apps.filter((a) => found.apps.has(a.slug)) : state.apps;
  const observed: ObservedListener[] = found ? state.observed.filter((o) => found.observed.has(o.id)) : state.observed;
  const hasBookmarks = state.bookmarks.length > 0;
  const entityFiles = new Set([...state.apps.map((a) => a.file), ...state.bookmarks.map((g) => g.file)]);
  const banner = state.problems.filter((p) => !entityFiles.has(p.file));
  const nothing = !state.apps.length && !state.observed.some((o) => o.http);
  const takenSlugs = new Set(state.apps.map((a) => a.slug));
  const openApp = drawer ? state.apps.find((a) => a.slug === drawer) : undefined;
  const matches = found ? found.hits.filter((h) => h.url).length : null;

  // with no apps yet, the tray leads: that's where the first doors come from
  let order: DashboardSection[] = cfg.dashboard.sections;
  if (!state.apps.length && order.includes('observed')) order = ['observed', ...order.filter((s) => s !== 'observed')];

  const sections: Record<DashboardSection, () => React.ReactNode> = {
    apps: () =>
      state.apps.length > 0 && (!found || apps.length > 0) ? (
        <section key="apps" className="hw-section hw-apps" aria-labelledby="hw-apps-title">
          <header className="hw-section-head">
            <h2 id="hw-apps-title" className="hw-sign">
              Apps
            </h2>
            <span className="hw-section-count">{found ? `${apps.length} of ${state.apps.length}` : state.apps.length}</span>
            {!checking && <span className="hw-section-note">Health checks aren’t running, so no door has been checked yet.</span>}
          </header>
          <div className="hw-doors">
            {apps.map((a: AppView) => (
              <Door key={a.slug} app={a} checking={checking} onCopy={(u, w) => void copy(u, w)} onDetails={setDrawer} />
            ))}
          </div>
        </section>
      ) : null,
    observed: () =>
      state.daemon.providers.scanner && observed.length > 0 ? (
        <ObservedTray key="observed" observed={observed} home={home} lead={!state.apps.length} takenSlugs={takenSlugs} notify={toasts.push} />
      ) : null,
    bookmarks: () =>
      hasBookmarks ? <Bookmarks key="bookmarks" groups={state.bookmarks} visible={found?.bookmarks} filtering={!!found} iconVersion={live.iconVersion} notify={toasts.push} /> : null,
  };

  return (
    <div className="hw-page">
      <Header
        ref={filterRef}
        title={title}
        counts={counts ?? countStates(state.apps)}
        checking={checking}
        connection={live.connection}
        filter={filter}
        onFilter={setFilter}
        onFilterKey={onFilterKey}
        matches={matches}
        onHelp={() => setHelp(true)}
      />
      <main className="hw-main">
        <ProblemBanner problems={banner} />
        {nothing && !found ? <FirstRun state={state} /> : null}
        {order.map((s) => sections[s]?.())}
        {found && matches === 0 && (
          <p className="hw-nomatch">
            Nothing matches “{q}”. <button type="button" className="hw-link" onClick={() => setFilter('')}>Clear the filter</button>
          </p>
        )}
        {!hasBookmarks && !found && cfg.dashboard.sections.includes('bookmarks') && <AddBookmarks taken={new Set()} notify={toasts.push} />}
      </main>
      <footer className="hw-footer">
        <span>
          Hallway <span className="hw-num">v{state.daemon.version}</span>
        </span>
        <span>
          Files in <code>{state.daemon.dataHomeDisplay}</code>
        </span>
        <a className="hw-link" href="/agent-guide.md">
          Agent guide
        </a>
        <button type="button" className="hw-link" onClick={() => setHelp(true)}>
          Shortcuts <kbd>?</kbd>
        </button>
      </footer>
      {openApp && <Drawer app={openApp} state={state} home={home} onClose={() => setDrawer(null)} onCopy={(t, w) => void copy(t, w)} onSaved={live.putApp} />}
      {help && <Help onClose={() => setHelp(false)} />}
      <Toasts items={toasts.items} />
    </div>
  );
}

/** With no bookmarks the section is hidden; this quiet line is the way to start one. */
function AddBookmarks({ taken, notify }: { taken: Set<string>; notify(t: string, tone?: 'ok' | 'error'): void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="hw-section hw-addbookmarks">
      {open ? (
        <NewGroup taken={taken} onDone={() => setOpen(false)} notify={notify} />
      ) : (
        <button type="button" className="hw-btn hw-btn--quiet" onClick={() => setOpen(true)}>
          + Add bookmarks: the remote things you can never remember the URL of
        </button>
      )}
    </section>
  );
}
