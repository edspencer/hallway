// The observed tray, "Found running — not yet named" (docs/05-ui.md): what the scanner found listening that isn't
// declared or discovered. Each row can be claimed (an inline form writes apps/<slug>.yaml), ignored (by port, process
// or directory: ignore.yaml) or opened. Listeners that don't speak HTTP sit in a collapsed list below.
import { useEffect, useRef, useState } from 'react';
import type { Expected, IgnoreRequest, ObservedListener } from '../../shared/api';
import { claim, ignore } from '../api';
import { SLUG, duration, slugify, tildify } from '../lib/format';
import { ChevronIcon, ExternalIcon } from './icons';

export interface ObservedProps {
  observed: ObservedListener[];
  home: string | null;
  /** No apps yet: the tray leads the page and says what it's for. */
  lead: boolean;
  takenSlugs: Set<string>;
  notify(text: string, tone?: 'ok' | 'error'): void;
}

export const listenerName = (o: ObservedListener) => o.identity.name ?? o.title ?? o.identity.process ?? `Port ${o.port}`;
const openUrl = (o: ObservedListener) => `http://localhost:${o.port}`;

export function ObservedTray({ observed, home, lead, takenSlugs, notify }: ObservedProps) {
  const http = observed.filter((o) => o.http);
  const other = observed.filter((o) => !o.http);
  return (
    <section className="hw-section hw-observed" aria-labelledby="hw-observed-title">
      <header className="hw-section-head">
        <h2 id="hw-observed-title" className="hw-sign">
          Found running <span className="hw-sign-dash">—</span> not yet named
        </h2>
        <span className="hw-section-count">{http.length}</span>
      </header>
      {lead && http.length > 0 && (
        <p className="hw-observed-lead">
          We found {http.length === 1 ? 'a web server' : `${http.length} web servers`} running. Name the ones you care about, and they become doors.
        </p>
      )}
      {http.length > 0 ? (
        <ul className="hw-observed-list">
          {http.map((o) => (
            <ObservedRow key={o.id} o={o} home={home} takenSlugs={takenSlugs} notify={notify} />
          ))}
        </ul>
      ) : (
        <p className="hw-quiet">Nothing else is serving web pages right now.</p>
      )}
      {other.length > 0 && (
        <details className="hw-other">
          <summary>
            <ChevronIcon /> {other.length} other listener{other.length === 1 ? '' : 's'} <span className="hw-quiet-inline">(not HTTP)</span>
          </summary>
          <ul>
            {other.map((o) => (
              <li key={o.id}>
                <span className="hw-num hw-other-port">:{o.port}</span>
                <span className="hw-other-proc">{o.identity.process ?? 'unknown process'}</span>
                <span className="hw-other-dir">{o.identity.projectDir ?? o.identity.cwd ? tildify((o.identity.projectDir ?? o.identity.cwd)!, home) : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ObservedRow({ o, home, takenSlugs, notify }: { o: ObservedListener; home: string | null; takenSlugs: Set<string>; notify: ObservedProps['notify'] }) {
  const [mode, setMode] = useState<'idle' | 'claim' | 'ignore'>('idle');
  const id = o.identity;
  const dir = id.projectDir ?? id.cwd;
  const name = listenerName(o);
  const since = id.startedAt ?? o.firstSeen;
  const age = since ? duration(Date.now() - Date.parse(since)) : null;

  return (
    <li className={`hw-observed-row${mode !== 'idle' ? ' is-open' : ''}`}>
      <div className="hw-observed-main">
        <span className="hw-plate hw-observed-plate">{o.port}</span>
        <div className="hw-observed-text">
          <div className="hw-observed-name">
            <strong>{name}</strong>
            {dir && (
              <span className="hw-observed-dir">
                {tildify(dir, home)}
                {id.branch ? <span className="hw-observed-branch"> @ {id.branch}</span> : null}
              </span>
            )}
          </div>
          <div className="hw-observed-meta">
            {age && <span>up {age}</span>}
            {id.framework && <span>{id.framework}</span>}
            {o.title && o.title !== name && <span className="hw-observed-title">“{o.title}”</span>}
            {id.orphaned && <span className="hw-badge">orphaned</span>}
            {id.exposed && <span className="hw-badge hw-badge--warn">exposed</span>}
          </div>
        </div>
        <div className="hw-observed-actions">
          <button type="button" className="hw-btn hw-btn--primary" aria-expanded={mode === 'claim'} onClick={() => setMode(mode === 'claim' ? 'idle' : 'claim')}>
            Claim
          </button>
          <div className="hw-menu-wrap">
            <button type="button" className="hw-btn" aria-haspopup="menu" aria-expanded={mode === 'ignore'} onClick={() => setMode(mode === 'ignore' ? 'idle' : 'ignore')}>
              Ignore <span aria-hidden="true">▾</span>
            </button>
            {mode === 'ignore' && <IgnoreMenu o={o} home={home} onDone={() => setMode('idle')} notify={notify} />}
          </div>
          <a className="hw-btn hw-btn--quiet" href={openUrl(o)} data-nav="observed" data-url={openUrl(o)} target="_blank" rel="noreferrer" aria-label={`Open ${name} on port ${o.port}`}>
            Open <ExternalIcon />
          </a>
        </div>
      </div>
      {mode === 'claim' && <ClaimForm o={o} takenSlugs={takenSlugs} onDone={() => setMode('idle')} notify={notify} />}
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
      <button type="button" role="menuitem" disabled={!dir} onClick={() => go('dir', tildify(dir!, home))}>
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
  const initialName = o.identity.name ?? o.title ?? '';
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
