// The detail drawer (docs/05-ui.md, "Detail drawer"): everything known about one app. Its identity (the process
// behind the port), uptime over 24 h / 7 d / 90 d with latency, its file (with an editor link) and an inline form for
// the common fields, written through the API with If-Match so an edit made on disk meanwhile is never overwritten
// silently, and any problem with its file.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppHistory, AppView, Expected, HistoryWindow, StateResponse } from '../../shared/api';
import { getHistory, patchApp, thumbUrl } from '../api';
import { paintFor } from '../lib/colour';
import { ORPHANED_HINT, ago, displayUrl, duration, exposedHint, millis, percent, supervisedBy, tildify } from '../lib/format';
import { STATE_META, doorState, isScanning } from '../lib/status';
import { CloseIcon, CopyIcon, ExternalIcon } from './icons';
import { LatencyChart } from './LatencyChart';
import { ProblemNote } from './Problems';
import { StateMark } from './StateMark';
import { Tile, isGlyph, useImageColour } from './Tile';
import { UptimeBar } from './UptimeBar';

export interface DrawerProps {
  app: AppView;
  state: StateResponse;
  home: string | null;
  onClose(): void;
  onCopy(text: string, what: string): void;
  onSaved(view: AppView): void;
}

const WINDOWS: { w: HistoryWindow; label: string }[] = [
  { w: '24h', label: '24 h' },
  { w: '7d', label: '7 days' },
  { w: '90d', label: '90 days' },
];

export function Drawer({ app, state, home, onClose, onCopy, onSaved }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const s = doorState(app);
  const checking = state.daemon.providers.health;
  const thumb = app.thumb ? thumbUrl(app.slug, app.thumb) : null;
  // the drawer already says what a generated card says, so it shows only a favicon or a screenshot (D55)
  const kind = thumb ? (app.thumbKind ?? 'favicon') : null;
  const colour = useImageColour(kind === 'card' ? null : thumb);
  const glyph = isGlyph(app.config?.icon) ? app.config!.icon : null;

  // focus moves into the drawer, stays there, and goes back where it was when it closes
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]')];
      if (!f.length) return;
      const [first, last] = [f[0]!, f[f.length - 1]!];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      before?.focus?.();
    };
  }, [app.slug]);

  const h = app.health;
  return (
    <div className="hw-drawer-wrap">
      <div className="hw-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="hw-drawer" role="dialog" aria-modal="true" aria-labelledby="hw-drawer-title" tabIndex={-1} ref={ref} style={{ '--paint': paintFor(app.slug, colour) } as CSSProperties}>
        <header className={`hw-drawer-head hw-door--${!checking && s === 'unknown' ? 'unchecked' : s}`}>
          <Tile name={app.name} src={kind === 'favicon' ? thumb : null} glyph={glyph} className="hw-drawer-tile" />
          <div className="hw-drawer-titles">
            <h2 id="hw-drawer-title">{app.name}</h2>
            {(app.identity?.label ?? app.config?.description) && <p className="hw-drawer-sub">{app.identity?.label ?? app.config?.description}</p>}
            {app.url && (
              <a className="hw-drawer-url" href={app.url} target="_blank" rel="noreferrer">
                {displayUrl(app.url)} <ExternalIcon />
              </a>
            )}
          </div>
          <button type="button" className="hw-icon-btn hw-drawer-close" onClick={onClose} aria-label="Close (Esc)">
            <CloseIcon />
          </button>
        </header>

        <div className="hw-drawer-body">
          {kind === 'screenshot' && <img className="hw-drawer-shot" src={thumb!} alt={`${app.name}, as it looked when last checked`} width={640} height={400} decoding="async" />}
          <div className="hw-drawer-state">
            <StateMark state={s} label={!checking && s === 'unknown' ? 'not checked' : undefined} />
            <span className="hw-drawer-state-text">
              {!checking
                ? 'Health checks aren’t running in this daemon.'
                : [STATE_META[s].says, h.since ? `for ${duration(Date.now() - Date.parse(h.since))}` : null].filter(Boolean).join(' · ')}
              {h.detail ? <span className="hw-drawer-detail"> · {h.detail}</span> : null}
              {h.checkedAt ? <span className="hw-drawer-detail"> · checked {ago(h.checkedAt)}</span> : null}
            </span>
          </div>

          {app.problems.map((p, i) => (
            <ProblemNote key={i} p={p} lastGood={!!app.config} />
          ))}

          <History app={app} available={state.daemon.providers.history} />
          <Identity app={app} home={home} scanning={isScanning(state)} />
          {app.config && app.config.links.length > 0 && <Links app={app} />}
          <Settings key={app.slug} app={app} onSaved={onSaved} />
          <FileInfo app={app} home={home} onCopy={onCopy} />
        </div>
      </aside>
    </div>
  );
}

function History({ app, available }: { app: AppView; available: boolean }) {
  const [win, setWin] = useState<HistoryWindow>('24h');
  const [data, setData] = useState<AppHistory | 'unavailable' | 'loading' | 'error' | null>(null);
  useEffect(() => {
    if (!available) return setData('unavailable');
    let live = true;
    setData((d) => (d && typeof d === 'object' && d.window === win ? d : 'loading'));
    getHistory(app.slug, win).then(
      (h) => live && setData(h),
      () => live && setData('error'),
    );
    return () => {
      live = false;
    };
    // refetch when the app's state changes, too
  }, [app.slug, win, available, app.health.state]);
  const hist = typeof data === 'object' && data ? data : win === '24h' ? app.history : null;
  return (
    <section className="hw-drawer-section" aria-labelledby="hw-d-uptime">
      <div className="hw-drawer-section-head">
        <h3 id="hw-d-uptime">Uptime</h3>
        <div className="hw-seg-options hw-seg-options--small" role="radiogroup" aria-label="Window">
          {WINDOWS.map((x) => (
            <button key={x.w} type="button" role="radio" aria-checked={win === x.w} className={win === x.w ? 'is-on' : ''} onClick={() => setWin(x.w)} disabled={!available}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {data === 'unavailable' ? (
        <>
          <UptimeBar history={null} size="large" label="Uptime" />
          <p className="hw-quiet">Uptime history isn’t being recorded by this daemon yet.</p>
        </>
      ) : data === 'error' ? (
        <p className="hw-quiet">Couldn’t load the history.</p>
      ) : (
        <>
          <UptimeBar history={hist} size="large" label={`Uptime, ${WINDOWS.find((x) => x.w === win)!.label}`} />
          <dl className="hw-stats">
            <div>
              <dt>Uptime</dt>
              <dd className="hw-num">{percent(hist?.uptime)}</dd>
            </div>
            <div>
              <dt>p50</dt>
              <dd className="hw-num">{millis(hist?.latency.p50)}</dd>
            </div>
            <div>
              <dt>p95</dt>
              <dd className="hw-num">{millis(hist?.latency.p95)}</dd>
            </div>
            <div>
              <dt>Slowest</dt>
              <dd className="hw-num">{millis(hist?.latency.max)}</dd>
            </div>
          </dl>
          {hist && <LatencyChart buckets={hist.buckets} />}
        </>
      )}
    </section>
  );
}

function Identity({ app, home, scanning }: { app: AppView; home: string | null; scanning: boolean }) {
  const id = app.identity;
  const port = app.config?.port;
  if (!id)
    return (
      <section className="hw-drawer-section" aria-labelledby="hw-d-id">
        <h3 id="hw-d-id">Process</h3>
        <p className="hw-quiet">
          {!scanning ? 'The port scanner is off, so nothing is known about the process.' : port ? `Nothing is listening on port ${port} right now.` : 'No port: the file has never been valid.'}
        </p>
      </section>
    );
  const rows: [string, React.ReactNode][] = [];
  const dir = id.projectDir ?? id.cwd;
  if (dir) rows.push(['Directory', <code>{tildify(dir, home)}</code>]);
  if (id.repo || id.branch) rows.push(['Repository', <code>{[id.repo, id.branch].filter(Boolean).join(' @ ')}{id.worktree ? ' (worktree)' : ''}</code>]);
  if (id.lastCommitAt) rows.push(['Last commit', ago(id.lastCommitAt)]);
  if (id.framework) rows.push(['Framework', id.framework]);
  if (id.pid !== null) rows.push(['PID', <span className="hw-num">{id.pid}</span>]);
  if (id.startedAt) rows.push(['Started', `${ago(id.startedAt)} (${new Date(id.startedAt).toLocaleString()})`]);
  if (id.bindAddress) rows.push(['Bound to', <span>
    <code>{id.bindAddress}</code>
    {id.exposed ? <span className="hw-badge hw-badge--warn">exposed: reachable from the network</span> : null}
    {id.exposed ? <p className="hw-note">{exposedHint(id.bindAddress, port)}</p> : null}
  </span>]);
  if (id.supervisor) rows.push(['Supervised by', <code>{supervisedBy(id.supervisor)}</code>]);
  if (id.ppid !== null) rows.push(['Parent', <span>
    <span className="hw-num">{id.ppid}</span>
    {id.orphaned ? <span className="hw-badge">orphaned: the session that started it is gone</span> : null}
    {id.orphaned && !app.managed ? <p className="hw-note">{ORPHANED_HINT}</p> : null}
  </span>]);
  if (id.command) rows.push(['Command', <code className="hw-wrap">{id.command}</code>]);
  return (
    <section className="hw-drawer-section" aria-labelledby="hw-d-id">
      <h3 id="hw-d-id">Process</h3>
      <dl className="hw-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Links({ app }: { app: AppView }) {
  const base = app.url ?? '';
  return (
    <section className="hw-drawer-section" aria-labelledby="hw-d-links">
      <h3 id="hw-d-links">Links</h3>
      <ul className="hw-deeplinks">
        {app.config!.links.map((l, i) => {
          const href = l.url ?? (base ? new URL(l.path!, base).href : null);
          return (
            <li key={i}>
              {href ? (
                <a className="hw-link" href={href} target="_blank" rel="noreferrer">
                  {l.label} <span className="hw-quiet-inline">{l.path ?? displayUrl(l.url!)}</span>
                </a>
              ) : (
                l.label
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const EXPECTED: { v: Expected; label: string }[] = [
  { v: 'running', label: 'Always' },
  { v: 'adhoc', label: 'Sometimes' },
  { v: 'stopped', label: 'Off' },
];

interface Form {
  name: string;
  description: string;
  port: string;
  expected: Expected;
  healthPath: string;
  tags: string;
}

const fromConfig = (c: NonNullable<AppView['config']>): Form => ({
  name: c.name,
  description: c.description ?? '',
  port: String(c.port),
  expected: c.expected,
  healthPath: c.health?.path ?? '',
  tags: c.tags.join(', '),
});

/** The keys a form changes, as a JSON merge patch (D33). */
function diff(c: NonNullable<AppView['config']>, f: Form): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (f.name.trim() !== c.name) p.name = f.name.trim();
  if ((f.description.trim() || null) !== c.description) p.description = f.description.trim() || null;
  if (Number(f.port) !== c.port) p.port = /^\d+$/.test(f.port.trim()) ? Number(f.port) : f.port;
  if (f.expected !== c.expected) p.expected = f.expected;
  const hp = f.healthPath.trim();
  if (hp !== (c.health?.path ?? '')) p.health = hp ? { path: hp } : null;
  const tags = f.tags.split(/[\s,]+/).filter(Boolean);
  if (tags.join(' ') !== c.tags.join(' ')) p.tags = tags;
  return p;
}

function Settings({ app, onSaved }: { app: AppView; onSaved(v: AppView): void }) {
  const c = app.config;
  const [form, setForm] = useState<Form | null>(() => (c ? fromConfig(c) : null));
  const [base, setBase] = useState({ config: c, etag: app.etag });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'conflict'; text: string; etag?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !!(form && base.config && Object.keys(diff(base.config, form)).length);

  // the file changed under an untouched form: follow it
  useEffect(() => {
    if (!dirty && c) {
      setForm(fromConfig(c));
      setBase({ config: c, etag: app.etag });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.etag]);

  if (app.source !== 'declared') return null;
  if (!c || !form || !base.config)
    return (
      <section className="hw-drawer-section">
        <h3>Settings</h3>
        <p className="hw-quiet">This file has never been valid, so there is nothing to edit here. Fix it by hand; the page updates when you save.</p>
      </section>
    );

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    setMsg(null);
  };
  const save = async (etag: string | null) => {
    setBusy(true);
    const r = await patchApp(app.slug, diff(base.config!, form), etag);
    setBusy(false);
    if (r.ok) {
      setIssues({});
      setMsg({ tone: 'ok', text: `Saved to ${app.file}` });
      setBase({ config: r.value.config, etag: r.value.etag });
      if (r.value.config) setForm(fromConfig(r.value.config));
      onSaved(r.value);
    } else if (r.kind === 'conflict') {
      setMsg({ tone: 'conflict', text: r.error, etag: r.etag });
    } else if (r.kind === 'invalid') {
      setIssues(Object.fromEntries(r.issues.map((i) => [i.key.split('.')[0]!, i.message])));
      setMsg({ tone: 'error', text: r.error });
    } else setMsg({ tone: 'error', text: r.error });
  };
  const reload = () => {
    setForm(fromConfig(c));
    setBase({ config: c, etag: app.etag });
    setMsg(null);
    setIssues({});
  };
  const issue = (k: string) => (issues[k] ? <small className="hw-field-error">{issues[k]}</small> : null);

  return (
    <section className="hw-drawer-section" aria-labelledby="hw-d-settings">
      <h3 id="hw-d-settings">Settings</h3>
      <form
        className="hw-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save(base.etag);
        }}
      >
        <label className="hw-field">
          <span>Name</span>
          <input value={form.name} onChange={set('name')} aria-invalid={!!issues.name} />
          {issue('name')}
        </label>
        <label className="hw-field">
          <span>Port</span>
          <input value={form.port} onChange={set('port')} inputMode="numeric" className="hw-num" aria-invalid={!!issues.port} />
          {issue('port')}
        </label>
        <label className="hw-field hw-field--wide">
          <span>Description</span>
          <input value={form.description} onChange={set('description')} placeholder="One line about it" />
        </label>
        <fieldset className="hw-field hw-field--wide hw-seg">
          <legend>Expected to run</legend>
          <div className="hw-seg-options">
            {EXPECTED.map((x) => (
              <label key={x.v} className={form.expected === x.v ? 'is-on' : ''}>
                <input type="radio" name="expected" value={x.v} checked={form.expected === x.v} onChange={() => (setForm({ ...form, expected: x.v }), setMsg(null))} />
                {x.label}
              </label>
            ))}
          </div>
          <small>{form.expected === 'running' ? 'Not answering is down: the alarm.' : form.expected === 'adhoc' ? 'Up sometimes: not answering is stopped, never down.' : 'Off on purpose.'}</small>
        </fieldset>
        <label className="hw-field hw-field--wide">
          <span>Health check path</span>
          <input value={form.healthPath} onChange={set('healthPath')} placeholder="/ (any status under 500)" className="hw-num" aria-invalid={!!issues.health} />
          {issue('health')}
        </label>
        <label className="hw-field hw-field--wide">
          <span>Tags</span>
          <input value={form.tags} onChange={set('tags')} placeholder="work, demo" aria-invalid={!!issues.tags} />
          {issue('tags')}
        </label>
        <div className="hw-settings-actions">
          <button type="submit" className="hw-btn hw-btn--primary" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button type="button" className="hw-btn hw-btn--quiet" onClick={reload}>
              Discard
            </button>
          )}
          {msg?.tone === 'ok' && (
            <span className="hw-saved" role="status">
              {msg.text}
            </span>
          )}
        </div>
        {msg?.tone === 'error' && (
          <p className="hw-form-error" role="alert">
            {msg.text}
          </p>
        )}
        {msg?.tone === 'conflict' && (
          <div className="hw-conflict" role="alert">
            <p>
              <strong>{app.file} changed on disk</strong> since you started editing (an editor or an agent saved it). Load the new version and redo
              your change, or save yours over it.
            </p>
            <div className="hw-settings-actions">
              <button type="button" className="hw-btn" onClick={reload}>
                Load the new version
              </button>
              <button type="button" className="hw-btn hw-btn--danger" onClick={() => void save(msg.etag ?? app.etag)}>
                Save mine anyway
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function FileInfo({ app, home, onCopy }: { app: AppView; home: string | null; onCopy(t: string, w: string): void }) {
  if (!app.path) return app.source === 'discovered' ? (
    <section className="hw-drawer-section">
      <h3>Source</h3>
      <p className="hw-quiet">Read from another tool ({app.adapter}); change it there.</p>
    </section>
  ) : null;
  const shown = tildify(app.path, home);
  return (
    <section className="hw-drawer-section" aria-labelledby="hw-d-file">
      <h3 id="hw-d-file">File</h3>
      <div className="hw-filepath">
        <code>{shown}</code>
        <button type="button" className="hw-icon-btn" onClick={() => onCopy(app.path!, 'the path')} aria-label="Copy the path">
          <CopyIcon />
        </button>
      </div>
      <p className="hw-file-actions">
        <a className="hw-btn hw-btn--small" href={`vscode://file${app.path.startsWith('/') ? '' : '/'}${app.path}`}>
          Open in VS Code
        </a>
        <span className="hw-quiet-inline">
          or <code>$EDITOR {shown}</code>
        </span>
      </p>
    </section>
  );
}
