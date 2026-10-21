// The observed tray, "Found running — not yet named" (docs/05-ui.md; D73): what the scanner found listening that isn't
// declared or discovered, grouped by what it is. Your projects (a repository's checkouts and worktrees together), apps
// on this machine, what each container tool forwards (its cluster's own ports folded away), desktop apps' internal
// ports (folded) and anything else. Every row says what it answers (a web page, an API, a sign-in…); only what a
// browser can show gets Open. Each row can be claimed (an inline form writes apps/<slug>.yaml) or ignored (by port,
// process or directory: ignore.yaml).
import { useEffect, useRef, useState } from 'react';
import type { Expected, IgnoreRequest, ObservedListener } from '../../shared/api';
import { claim, ignore } from '../api';
import { ORPHANED_HINT, SLUG, duration, exposedHint, slugify, supervisedBy, tildify } from '../lib/format';
import { type RowLabel, type TrayGroup, type TraySet, answerText, exposureWords, foldSummary, machineWord, openable, rowLabels, trayGroups } from '../lib/tray';
import { BoxIcon, BranchIcon, ChevronIcon, CogIcon, ExternalIcon, GlobeIcon, QuestionIcon, TunnelIcon, WheelIcon, WindowIcon } from './icons';
import { TipBadge } from './Tip';

export interface ObservedProps {
  observed: ObservedListener[];
  home: string | null;
  /** The daemon's platform: "Apps on this Mac" or "this computer". */
  platform: string | null;
  /** No apps yet: the tray leads the page and says what it's for. */
  lead: boolean;
  takenSlugs: Set<string>;
  notify(text: string, tone?: 'ok' | 'error'): void;
}

interface Ctx {
  home: string | null;
  machine: string;
  takenSlugs: Set<string>;
  notify: ObservedProps['notify'];
}

/** Which folded groups and sets were opened, remembered in this browser. */
const OPEN_KEY = 'hallway.tray.open';
function useOpen(key: string, folded: boolean): [boolean, (v: boolean) => void] {
  const read = () => {
    try {
      const v = (JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>)[key];
      return typeof v === 'boolean' ? v : !folded;
    } catch {
      return !folded;
    }
  };
  const [open, setOpen] = useState(read);
  const set = (v: boolean) => {
    setOpen(v);
    try {
      const all = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>;
      if (v === !folded) delete all[key];
      else all[key] = v;
      localStorage.setItem(OPEN_KEY, JSON.stringify(all));
    } catch {
      /* private mode: not remembered */
    }
  };
  return [open, set];
}

export function ObservedTray({ observed, home, platform, lead, takenSlugs, notify }: ObservedProps) {
  const groups = trayGroups(observed, platform);
  const machine = machineWord(platform);
  const pages = observed.filter((o) => o.answer.kind === 'page').length;
  const ctx: Ctx = { home, machine, takenSlugs, notify };
  return (
    <section className="hw-section hw-observed" aria-labelledby="hw-observed-title">
      <header className="hw-section-head">
        <h2 id="hw-observed-title" className="hw-sign">
          Found running <span className="hw-sign-dash">—</span> not yet named
        </h2>
        <span className="hw-section-count">{observed.length}</span>
        <span className="hw-tray-pages">{pages ? `${pages} web page${pages === 1 ? '' : 's'}` : 'no web pages'}</span>
      </header>
      {lead && pages > 0 && (
        <p className="hw-observed-lead">
          We found {pages === 1 ? 'a web page' : `${pages} web pages`} being served. Name the ones you care about, and they become doors.
        </p>
      )}
      <ExposedNote observed={observed} machine={machine} />
      {groups.map((g) => (
        <Group key={g.key} g={g} ctx={ctx} />
      ))}
    </section>
  );
}

/** "On your network", said once in words wherever something is (D73). */
function ExposedNote({ observed, machine }: { observed: ObservedListener[]; machine: string }) {
  const n = observed.filter((o) => o.identity.exposed).length;
  if (!n) return null;
  const w = exposureWords(machine);
  return (
    <p className="hw-tray-exposed-note">
      <span className="hw-tray-exposed">
        <GlobeIcon />
        {w.label}
      </span>
      <span>
        {w.detail} {n === 1 ? 'One listener here does.' : `${n} listeners here do.`} Bind a server to <code>127.0.0.1</code> to keep it to yourself.
      </span>
    </p>
  );
}

function GroupIcon({ g }: { g: TrayGroup }) {
  if (g.kind === 'projects') return <BranchIcon />;
  if (g.kind === 'apps') return <WindowIcon />;
  if (g.kind === 'internal') return <CogIcon />;
  if (g.kind === 'other') return <QuestionIcon />;
  if (g.key === 'forwarded:ssh') return <TunnelIcon />;
  if (g.key === 'forwarded:kubernetes' || g.key === 'forwarded:kubectl') return <WheelIcon />;
  return <BoxIcon />;
}

function Group({ g, ctx }: { g: TrayGroup; ctx: Ctx }) {
  const [open, setOpen] = useOpen(g.key, g.folded);
  const id = `hw-tray-${g.key.replace(/[^a-z0-9]+/gi, '-')}`;
  const summary = foldSummary(g);
  return (
    <section className="hw-tray-group" aria-labelledby={id}>
      <h3 className="hw-tray-head" id={id}>
        <span className="hw-tray-head-icon">
          <GroupIcon g={g} />
        </span>
        <span className="hw-tray-head-title">{g.title}</span>
        <span className="hw-tray-head-blurb">{g.blurb}</span>
        <span className="hw-tray-head-count">{g.rows.length}</span>
      </h3>
      {open ? (
        <div className="hw-tray-card">
          {g.sets.map((s) => (
            <Set key={s.key} s={s} ctx={ctx} />
          ))}
          {g.folded && (
            <button type="button" className="hw-tray-fold hw-tray-fold--hide" aria-expanded="true" onClick={() => setOpen(false)}>
              Hide {g.title.toLowerCase()}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="hw-tray-card hw-tray-fold" aria-expanded="false" onClick={() => setOpen(true)}>
          <span className="hw-tray-fold-text">
            {summary || g.blurb}
            <span className="hw-tray-fold-n">
              {' '}
              · {g.rows.length} port{g.rows.length === 1 ? '' : 's'}
            </span>
          </span>
          <ChevronIcon />
        </button>
      )}
    </section>
  );
}

function Set({ s, ctx }: { s: TraySet; ctx: Ctx }) {
  const [open, setOpen] = useOpen(s.key, s.folded);
  const labels = rowLabels(s, (p) => tildify(p, ctx.home));
  if (!open)
    return (
      <button type="button" className="hw-tray-fold hw-tray-fold--set" aria-expanded="false" onClick={() => setOpen(true)}>
        <span className="hw-tray-fold-text">
          <strong>{s.title}</strong>
          <span className="hw-tray-fold-n">
            {s.detail ? ` · ${s.detail}` : ''} · {s.rows.length} port{s.rows.length === 1 ? '' : 's'}
          </span>
        </span>
        <ChevronIcon />
      </button>
    );
  return (
    <div className={`hw-tray-set${s.title ? ' has-title' : ''}`}>
      {s.title && (
        <div className="hw-tray-set-head">
          <strong>{s.title}</strong>
          {s.detail && <span className={s.detail.startsWith('@ ') ? 'hw-tray-set-detail hw-tray-mono' : 'hw-tray-set-detail'}>{s.detail}</span>}
          {s.rows.length > 1 && <span>{s.rows.length} running</span>}
          {s.folded && (
            <button type="button" className="hw-tray-set-hide" aria-expanded="true" onClick={() => setOpen(false)}>
              Hide
            </button>
          )}
        </div>
      )}
      <ul className="hw-tray-rows">
        {s.rows.map((o) => (
          <ObservedRow key={o.id} o={o} label={labels.get(o.id)!} ctx={ctx} />
        ))}
      </ul>
    </div>
  );
}

/** The row's tile: the page's favicon when it has one, else a glyph for what it is. */
function RowIcon({ o }: { o: ObservedListener }) {
  const [broken, setBroken] = useState(false);
  let icon: string | null = null;
  try {
    icon = o.favicon && !broken ? new URL(o.favicon, o.url).toString() : null;
  } catch {
    icon = null;
  }
  const via = o.identity.via;
  const glyph =
    o.role === 'project' ? <BranchIcon /> : o.role === 'app' ? <WindowIcon /> : o.role === 'internal' ? <CogIcon /> : o.role === 'cluster' ? <WheelIcon /> : via?.tool.id === 'ssh' ? <TunnelIcon /> : o.role === 'forwarded' ? <BoxIcon /> : <QuestionIcon />;
  return (
    <span className={`hw-tray-tile hw-tray-tile--${o.answer.kind}`} aria-hidden="true">
      {icon ? <img src={icon} alt="" onError={() => setBroken(true)} /> : glyph}
    </span>
  );
}

/** What it answers: a mark (● page, ◆ API, ■ sign-in, — redirect, ○ nothing or not HTTP), the words, HTTPS. */
function Answer({ o }: { o: ObservedListener }) {
  const a = o.answer;
  return (
    <span className={`hw-tray-answer hw-tray-answer--${a.kind}`} title={a.status ? `GET / answered HTTP ${a.status}${a.tls ? ' over HTTPS' : ''}` : 'It took the connection but didn’t answer HTTP'}>
      <span className="hw-tray-answer-mark" aria-hidden="true" />
      {answerText(a)}
      {a.tls && a.kind !== 'not-http' ? <span className="hw-tray-answer-tls">HTTPS</span> : null}
    </span>
  );
}

function ObservedRow({ o, label, ctx }: { o: ObservedListener; label: RowLabel; ctx: Ctx }) {
  const [mode, setMode] = useState<'idle' | 'claim' | 'ignore'>('idle');
  const id = o.identity;
  const since = id.startedAt ?? o.firstSeen;
  const age = since ? duration(Date.now() - Date.parse(since)) : null;
  // the supervisor is worth saying for what you run, not for a tool's or a desktop app's own ports
  const supervisor = id.supervisor && (o.role === 'app' || o.role === 'project' || o.role === 'other') ? id.supervisor : null;
  return (
    <li className={`hw-tray-row${mode !== 'idle' ? ' is-open' : ''}${o.answer.kind === 'not-http' ? ' is-quiet' : ''}`}>
      <div className="hw-tray-main">
        <RowIcon o={o} />
        <div className="hw-tray-text">
          <div className="hw-tray-name">
            <strong className={label.mono ? 'hw-tray-mono' : undefined} title={label.title}>
              {label.title}
            </strong>
            <span className="hw-tray-port">:{o.port}</span>
          </div>
          <div className="hw-tray-meta">
            <Answer o={o} />
            {label.detail && (
              <span className="hw-tray-detail" title={label.detail}>
                {label.detail}
              </span>
            )}
            {age && <span>up {age}</span>}
            {supervisor && (
              <span className="hw-supervisor" title="The service manager that keeps it running">
                {supervisedBy(supervisor)}
              </span>
            )}
            {id.orphaned && <TipBadge text="orphaned" tip={ORPHANED_HINT} />}
            {id.exposed && <TipBadge text={exposureWords(ctx.machine).label} tone="warn" tip={exposedHint(id.bindAddress, o.port)} />}
          </div>
        </div>
        <div className="hw-tray-actions">
          {openable(o) && (
            <a className="hw-btn hw-tray-open" href={o.url} data-nav="observed" data-url={o.url} target="_blank" rel="noreferrer" aria-label={`Open ${label.title} on port ${o.port}`}>
              Open <ExternalIcon />
            </a>
          )}
          <button type="button" className="hw-btn hw-btn--quiet hw-tray-more" aria-expanded={mode === 'claim'} onClick={() => setMode(mode === 'claim' ? 'idle' : 'claim')}>
            Claim
          </button>
          <div className="hw-menu-wrap">
            <button type="button" className="hw-btn hw-btn--quiet hw-tray-more" aria-haspopup="menu" aria-expanded={mode === 'ignore'} onClick={() => setMode(mode === 'ignore' ? 'idle' : 'ignore')}>
              Ignore <span aria-hidden="true">▾</span>
            </button>
            {mode === 'ignore' && <IgnoreMenu o={o} home={ctx.home} onDone={() => setMode('idle')} notify={ctx.notify} />}
          </div>
        </div>
      </div>
      {mode === 'claim' && <ClaimForm o={o} takenSlugs={ctx.takenSlugs} onDone={() => setMode('idle')} notify={ctx.notify} />}
    </li>
  );
}

function IgnoreMenu({ o, home, onDone, notify }: { o: ObservedListener; home: string | null; onDone(): void; notify: ObservedProps['notify'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const dir = o.identity.projectDir ?? o.identity.cwd;
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onDone();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDone();
      }
    };
    document.addEventListener('mousedown', away);
    ref.current?.addEventListener('keydown', esc);
    return () => document.removeEventListener('mousedown', away);
  }, [onDone]);
  const go = async (by: IgnoreRequest['by'], what: string) => {
    const r = await ignore(o.id, by);
    onDone();
    notify(r.ok ? `Ignoring ${what}. Undo it in ignore.yaml.` : r.error, r.ok ? 'ok' : 'error');
  };
  return (
    <div className="hw-menu" role="menu" ref={ref}>
      <button type="button" role="menuitem" onClick={() => go('port', `port ${o.port}`)}>
        This port <span className="hw-num">:{o.port}</span>
      </button>
      <button type="button" role="menuitem" disabled={!o.identity.process} onClick={() => go('process', `every ${o.identity.process} process`)}>
        This process <span className="hw-num">{o.identity.process ?? 'unknown'}</span>
      </button>
      <button type="button" role="menuitem" disabled={!dir || dir === '/'} onClick={() => go('dir', tildify(dir!, home))}>
        This directory <span className="hw-num">{dir ? tildify(dir, home) : 'unknown'}</span>
      </button>
    </div>
  );
}

const EXPECTED: { v: Expected; label: string; hint: string }[] = [
  { v: 'adhoc', label: 'Sometimes', hint: 'Off is fine: shown as stopped, never down' },
  { v: 'running', label: 'Always', hint: 'Off means down' },
  { v: 'stopped', label: 'Off for now', hint: 'Kept, but expected to be off' },
];

function ClaimForm({ o, takenSlugs, onDone, notify }: { o: ObservedListener; takenSlugs: Set<string>; onDone(): void; notify: ObservedProps['notify'] }) {
  const initialName = o.name;
  const [slug, setSlug] = useState(o.suggestedSlug ?? (slugify(initialName) || `port-${o.port}`));
  const [name, setName] = useState(initialName);
  const [expected, setExpected] = useState<Expected>('adhoc');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slugRef = useRef<HTMLInputElement>(null);
  useEffect(() => slugRef.current?.select(), []);
  const slugProblem = !slug ? 'Give it a slug' : !SLUG.test(slug) ? 'Lower-case letters, digits and hyphens' : takenSlugs.has(slug) ? 'Another app already has this slug' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (slugProblem) return setError(slugProblem);
    setBusy(true);
    const r = await claim(o.id, { slug, name: name.trim() || undefined, expected });
    setBusy(false);
    if (r.ok) {
      notify(`Claimed: apps/${slug}.yaml`, 'ok');
      onDone();
    } else setError(r.kind === 'conflict' ? `apps/${slug}.yaml already exists: pick another slug` : r.error);
  };

  return (
    <form
      className="hw-claim"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <label className="hw-field">
        <span>Slug</span>
        <input ref={slugRef} value={slug} onChange={(e) => (setSlug(e.target.value.toLowerCase()), setError(null))} spellCheck={false} aria-invalid={!!slugProblem} className="hw-num" />
        <small>apps/{slug || '…'}.yaml</small>
      </label>
      <label className="hw-field hw-field--grow">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={slug} />
      </label>
      <fieldset className="hw-field hw-seg">
        <legend>Expected to run</legend>
        <div className="hw-seg-options">
          {EXPECTED.map((x) => (
            <label key={x.v} title={x.hint} className={expected === x.v ? 'is-on' : ''}>
              <input type="radio" name={`expected-${o.id}`} value={x.v} checked={expected === x.v} onChange={() => setExpected(x.v)} />
              {x.label}
            </label>
          ))}
        </div>
        <small>{EXPECTED.find((x) => x.v === expected)!.hint}</small>
      </fieldset>
      {o.identity.supervisor && (
        <p className="hw-note hw-claim-note">
          {o.identity.supervisor.manager} already keeps this running (<code>{o.identity.supervisor.label}</code>). Claiming it names it and
          watches its health; leave the starting and stopping to {o.identity.supervisor.manager} rather than making it a Hallway service too.
        </p>
      )}
      <div className="hw-claim-actions">
        <button type="submit" className="hw-btn hw-btn--primary" disabled={busy}>
          {busy ? 'Claiming…' : `Claim port ${o.port}`}
        </button>
        <button type="button" className="hw-btn hw-btn--quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="hw-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
