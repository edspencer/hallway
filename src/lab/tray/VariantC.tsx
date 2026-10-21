// Design exploration only. C — Shelves: one shelf per group, its web pages as small tiles you can open with a click,
// and everything else on the shelf (APIs, sign-ins, ports that don't speak HTTP) as one quiet line of chips that opens
// into a list. Folded shelves show only their heading until opened.
import { useState } from 'react';
import type { ObservedListener } from '../../../shared/api';
import { ChevronIcon, ExternalIcon } from '../../components/icons';
import type { TrayGroup } from '../../lib/tray';
import { answerText } from '../../lib/tray';
import { Answer, Exposed, ExposedNote, GroupIcon, Port, RowIcon, type TrayProps, rowName, context, upFor, useRowActions } from './parts';

export function VariantC(p: TrayProps) {
  return (
    <div className="lt-c">
      <ExposedNote observed={p.observed} machine={p.machine} />
      {p.groups.map((g) => (
        <Shelf key={g.key} g={g} p={p} />
      ))}
    </div>
  );
}

function Shelf({ g, p }: { g: TrayGroup; p: TrayProps }) {
  const [open, setOpen] = useState(!g.folded);
  const [rest, setRest] = useState(false);
  const tiles = g.rows.filter((o) => o.answer.kind === 'page');
  const others = g.rows.filter((o) => o.answer.kind !== 'page');
  return (
    <section className={`lt-c-shelf${open ? '' : ' is-folded'}`} aria-label={g.title}>
      <button type="button" className="lt-c-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="lt-c-head-icon">
          <GroupIcon g={g} />
        </span>
        <span className="lt-c-head-title">{g.title}</span>
        <span className="lt-c-head-blurb">
          {g.blurb} · {g.pages ? `${g.pages} page${g.pages === 1 ? '' : 's'}, ` : ''}
          {g.rows.length} port{g.rows.length === 1 ? '' : 's'}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <>
          {tiles.length > 0 && (
            <div className="lt-c-tiles">
              {tiles.map((o) => (
                <Tile key={o.id} o={o} p={p} />
              ))}
            </div>
          )}
          {others.length > 0 && (
            <div className="lt-c-rest">
              <button type="button" className="lt-c-rest-line" aria-expanded={rest} onClick={() => setRest(!rest)}>
                <ChevronIcon />
                <span className="lt-c-rest-label">{tiles.length ? 'Also listening' : 'Listening'}</span>
                {summarise(others).map(([k, n]) => (
                  <span key={k} className="lt-c-chip">
                    {n} × {k}
                  </span>
                ))}
              </button>
              {rest && (
                <ul className="lt-c-list">
                  {others.map((o) => (
                    <Line key={o.id} o={o} p={p} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function summarise(rows: ObservedListener[]): [string, number][] {
  const m = new Map<string, number>();
  for (const o of rows) {
    const k = o.answer.kind === 'redirect' ? 'Redirect' : o.answer.kind === 'empty' || o.answer.kind === 'error' ? 'Other HTTP' : answerText(o.answer);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m];
}

function Tile({ o, p }: { o: ObservedListener; p: TrayProps }) {
  const a = useRowActions(o, p);
  const ctx = context(o, p.home);
  const branch = o.role === 'project' ? o.identity.branch : null;
  return (
    <div className={`lt-c-tile${a.open ? ' is-open' : ''}`}>
      <a className="lt-c-tile-link" href={o.url} target="_blank" rel="noreferrer">
        <RowIcon o={o} />
        <span className="lt-c-tile-text">
          <strong>{rowName(o)}</strong>
          <span>{branch ? `@ ${branch}` : (ctx ?? upFor(o))}</span>
        </span>
        <Port port={o.port} />
        <ExternalIcon />
      </a>
      <div className="lt-c-tile-foot">
        <Exposed o={o} machine={p.machine} />
        {a.buttons}
      </div>
      {a.form}
    </div>
  );
}

function Line({ o, p }: { o: ObservedListener; p: TrayProps }) {
  const a = useRowActions(o, p);
  const ctx = o.role === 'project' && o.identity.branch ? `@ ${o.identity.branch}` : context(o, p.home);
  return (
    <li className={`lt-c-line${a.open ? ' is-open' : ''}`}>
      <div className="lt-c-line-main">
        <Port port={o.port} />
        <strong>{rowName(o)}</strong>
        {ctx && <span className="lt-c-line-ctx">{ctx}</span>}
        <Answer o={o} />
        <Exposed o={o} machine={p.machine} />
        {a.buttons}
      </div>
      {a.form}
    </li>
  );
}
