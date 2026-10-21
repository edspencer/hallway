// Design exploration only. D — Digest: one sentence that says what's out there, then the web pages you can open as a
// short list, then everything else by where it comes from, each group a closed disclosure with its count. The page
// answers "is it a web server?" before anything else.
import { useState } from 'react';
import type { ObservedListener } from '../../../shared/api';
import { ChevronIcon } from '../../components/icons';
import type { TrayGroup } from '../../lib/tray';
import { byAnswer } from '../../lib/tray';
import { Answer, Exposed, ExposedNote, GroupIcon, Port, RowIcon, type TrayProps, rowName, context, upFor, useRowActions } from './parts';

export function VariantD(p: TrayProps) {
  const pages = p.observed.filter((o) => o.answer.kind === 'page').sort((a, b) => order(p.groups, a) - order(p.groups, b) || byAnswer(a, b));
  const groupOf = (o: ObservedListener) => p.groups.find((g) => g.rows.includes(o));
  return (
    <div className="lt-d">
      <p className="lt-d-digest">
        {p.observed.length} things are listening on {p.machine}. <strong>{pages.length} serve web pages</strong>
        {digestTail(p.groups)}
      </p>
      <h3 className="lt-d-sub">Web pages</h3>
      <ul className="lt-d-pages">
        {pages.map((o) => (
          <PageRow key={o.id} o={o} p={p} g={groupOf(o)} />
        ))}
      </ul>
      <h3 className="lt-d-sub">Everything else, by where it comes from</h3>
      <div className="lt-d-groups">
        {p.groups.map((g) => {
          const rest = g.rows.filter((o) => o.answer.kind !== 'page');
          return rest.length ? <Fold key={g.key} g={g} rows={rest} p={p} /> : null;
        })}
      </div>
      <ExposedNote observed={p.observed} machine={p.machine} />
    </div>
  );
}

const order = (groups: TrayGroup[], o: ObservedListener) => groups.findIndex((g) => g.rows.includes(o));

function digestTail(groups: TrayGroup[]) {
  const parts: string[] = [];
  for (const g of groups) {
    if (g.kind === 'projects') parts.push(`${g.sets.length} of your projects`);
    else if (g.kind === 'forwarded') parts.push(`${g.title} forwards ${g.rows.length}`);
    else if (g.kind === 'internal') parts.push(`${g.sets.length} desktop app${g.sets.length === 1 ? '' : 's'} keep${g.sets.length === 1 ? 's' : ''} ${g.rows.length} for themselves`);
  }
  return parts.length ? `; ${parts.join(', ')}.` : '.';
}

function PageRow({ o, p, g }: { o: ObservedListener; p: TrayProps; g: TrayGroup | undefined }) {
  const a = useRowActions(o, p);
  const branch = o.role === 'project' ? o.identity.branch : null;
  const ctx = branch ? `${o.identity.repo ?? ''} @ ${branch}` : context(o, p.home);
  return (
    <li className={`lt-d-page${a.open ? ' is-open' : ''}`}>
      <div className="lt-d-page-main">
        <RowIcon o={o} />
        <div className="lt-d-page-text">
          <strong>{rowName(o)}</strong>
          <span>{[g?.title, ctx].filter(Boolean).join(' · ')}</span>
        </div>
        <Exposed o={o} machine={p.machine} />
        <Port port={o.port} />
        {a.buttons}
      </div>
      {a.form}
    </li>
  );
}

function Fold({ g, rows, p }: { g: TrayGroup; rows: ObservedListener[]; p: TrayProps }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lt-d-fold${open ? ' is-open' : ''}`}>
      <button type="button" className="lt-d-fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon />
        <span className="lt-d-fold-icon">
          <GroupIcon g={g} />
        </span>
        <strong>{g.title}</strong>
        <span className="lt-d-fold-blurb">{g.blurb}</span>
        <span className="lt-d-fold-n">{rows.length}</span>
      </button>
      {open && (
        <ul className="lt-d-list">
          {rows.map((o) => (
            <Line key={o.id} o={o} p={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Line({ o, p }: { o: ObservedListener; p: TrayProps }) {
  const a = useRowActions(o, p);
  const ctx = o.role === 'project' && o.identity.branch ? `@ ${o.identity.branch}` : context(o, p.home);
  const up = upFor(o);
  return (
    <li className={`lt-d-line${a.open ? ' is-open' : ''}`}>
      <div className="lt-d-line-main">
        <Port port={o.port} />
        <span className="lt-d-line-text">
          <strong>{rowName(o)}</strong>
          <span>{[ctx, up].filter(Boolean).join(' · ')}</span>
        </span>
        <Answer o={o} />
        <Exposed o={o} machine={p.machine} />
        {a.buttons}
      </div>
      {a.form}
    </li>
  );
}
