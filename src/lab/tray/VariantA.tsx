// Design exploration only. A — Grouped list: inset groups as in a settings window. Each group is a card under its
// heading; a repository's checkouts sit together under the repository's name; folded groups (desktop apps' internals,
// a cluster's own components) are one disclosure row until opened.
import { useState } from 'react';
import type { ObservedListener } from '../../../shared/api';
import { ChevronIcon } from '../../components/icons';
import type { TrayGroup, TraySet } from '../../lib/tray';
import { Answer, Exposed, ExposedNote, GroupIcon, Port, RowIcon, type TrayProps, rowName, context, upFor, useRowActions } from './parts';

export function VariantA(p: TrayProps) {
  return (
    <div className="lt-a">
      <ExposedNote observed={p.observed} machine={p.machine} />
      {p.groups.map((g) => (
        <Group key={g.key} g={g} p={p} />
      ))}
    </div>
  );
}

function Group({ g, p }: { g: TrayGroup; p: TrayProps }) {
  const [open, setOpen] = useState(!g.folded);
  return (
    <section className="lt-a-group" aria-label={g.title}>
      <h3 className="lt-a-head">
        <span className="lt-a-head-icon">
          <GroupIcon g={g} />
        </span>
        <span className="lt-a-head-title">{g.title}</span>
        <span className="lt-a-head-blurb">{g.blurb}</span>
        <span className="lt-a-head-count">{g.rows.length}</span>
      </h3>
      {open ? (
        <div className="lt-a-card">
          {g.sets.map((s) => (
            <Set key={s.key} s={s} p={p} />
          ))}
          {g.folded && (
            <button type="button" className="lt-a-fold is-open" onClick={() => setOpen(false)}>
              Hide {g.title.toLowerCase()}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="lt-a-card lt-a-fold" aria-expanded="false" onClick={() => setOpen(true)}>
          <span>
            {g.sets.map((s) => s.title).filter(Boolean).join(', ') || `${g.rows.length} listeners`}
            <span className="lt-a-fold-n"> · {g.rows.length} port{g.rows.length === 1 ? '' : 's'}</span>
          </span>
          <ChevronIcon />
        </button>
      )}
    </section>
  );
}

function Set({ s, p }: { s: TraySet; p: TrayProps }) {
  const [open, setOpen] = useState(!s.folded);
  if (!open)
    return (
      <button type="button" className="lt-a-fold lt-a-fold--set" aria-expanded="false" onClick={() => setOpen(true)}>
        <span>
          <strong>{s.title}</strong> <span className="lt-a-fold-n">{s.detail ? `· ${s.detail}` : ''} · {s.rows.length} ports</span>
        </span>
        <ChevronIcon />
      </button>
    );
  return (
    <div className={`lt-a-set${s.title ? ' has-title' : ''}`}>
      {s.title && (
        <div className="lt-a-set-head">
          <strong>{s.title}</strong>
          {s.rows.length > 1 && <span>{s.rows.length} running</span>}
          {s.folded && (
            <button type="button" className="lt-link" onClick={() => setOpen(false)}>
              Hide
            </button>
          )}
        </div>
      )}
      {s.rows.map((o) => (
        <Row key={o.id} o={o} set={s} p={p} />
      ))}
    </div>
  );
}

function Row({ o, set, p }: { o: ObservedListener; set: TraySet; p: TrayProps }) {
  const a = useRowActions(o, p);
  const branch = o.identity.branch;
  // inside a repository's set the branch is what tells its rows apart
  const inRepo = !!set.title && set.key.startsWith('repo:');
  const title = inRepo && o.name === set.title && branch ? branch : rowName(o);
  const ctx = inRepo ? [o.name !== set.title ? o.name : null, title === branch ? null : branch && `@ ${branch}`].filter(Boolean).join(' ') : context(o, p.home);
  const up = upFor(o);
  return (
    <div className={`lt-a-row${a.open ? ' is-open' : ''}${o.answer.kind === 'not-http' ? ' is-quiet' : ''}`}>
      <div className="lt-a-main">
        <RowIcon o={o} />
        <div className="lt-a-text">
          <div className="lt-a-name">
            <strong className={inRepo && title === branch ? 'lt-mono' : ''}>{title}</strong>
            <Port port={o.port} />
          </div>
          <div className="lt-a-meta">
            <Answer o={o} />
            {ctx && <span className="lt-a-ctx">{ctx}</span>}
            {up && <span>{up}</span>}
            <Exposed o={o} machine={p.machine} />
          </div>
        </div>
        {a.buttons}
      </div>
      {a.form}
    </div>
  );
}
