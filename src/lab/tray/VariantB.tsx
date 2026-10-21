// Design exploration only. B — Source list: the groups down the left as in a mail or files window, with counts; the
// chosen group's listeners on the right. "Web pages" comes first and gathers every page from every group, so the
// question "what can I open?" is one click. Narrow screens get the groups as a row of pills.
import { useState } from 'react';
import type { ObservedListener } from '../../../shared/api';
import { ChevronIcon } from '../../components/icons';
import type { TrayGroup } from '../../lib/tray';
import { byAnswer } from '../../lib/tray';
import { Answer, Exposed, ExposedNote, GroupIcon, Port, RowIcon, type TrayProps, rowName, context, upFor, useRowActions } from './parts';

const PAGES = 'pages';

export function VariantB(p: TrayProps) {
  const pages = p.observed.filter((o) => o.answer.kind === 'page').sort(byAnswer);
  const [sel, setSel] = useState<string>(pages.length ? PAGES : (p.groups[0]?.key ?? PAGES));
  const g = p.groups.find((x) => x.key === sel);
  const groupOf = (o: ObservedListener) => p.groups.find((x) => x.rows.includes(o));
  return (
    <div className="lt-b">
      <nav className="lt-b-nav" aria-label="Groups">
        <button type="button" className={`lt-b-item${sel === PAGES ? ' is-on' : ''}`} onClick={() => setSel(PAGES)}>
          <span className="lt-b-item-icon lt-b-item-icon--pages" aria-hidden="true">
            <span className="lt-answer-mark" />
          </span>
          <span className="lt-b-item-title">Web pages</span>
          <span className="lt-b-item-n">{pages.length}</span>
        </button>
        <div className="lt-b-rule" />
        {p.groups.map((x) => (
          <button key={x.key} type="button" className={`lt-b-item${sel === x.key ? ' is-on' : ''}${x.folded ? ' is-dim' : ''}`} onClick={() => setSel(x.key)}>
            <span className="lt-b-item-icon">
              <GroupIcon g={x} />
            </span>
            <span className="lt-b-item-title">{x.title}</span>
            <span className="lt-b-item-n">{x.rows.length}</span>
          </button>
        ))}
      </nav>
      <div className="lt-b-pane">
        {sel === PAGES ? (
          <>
            <header className="lt-b-pane-head">
              <h3>Web pages</h3>
              <p>Everything that answered with a page you can open, from every group.</p>
            </header>
            <ul className="lt-b-list">
              {pages.map((o) => (
                <Row key={o.id} o={o} p={p} tag={groupOf(o)?.title ?? null} />
              ))}
            </ul>
          </>
        ) : g ? (
          <GroupPane g={g} p={p} />
        ) : null}
        <ExposedNote observed={sel === PAGES ? pages : (g?.rows ?? [])} machine={p.machine} />
      </div>
    </div>
  );
}

function GroupPane({ g, p }: { g: TrayGroup; p: TrayProps }) {
  return (
    <>
      <header className="lt-b-pane-head">
        <h3>{g.title}</h3>
        <p>{g.blurb}</p>
      </header>
      {g.sets.map((s) => (
        <SetBlock key={s.key} title={s.title} detail={s.detail} folded={s.folded} n={s.rows.length}>
          <ul className="lt-b-list">
            {s.rows.map((o) => (
              <Row key={o.id} o={o} p={p} tag={null} branchFirst={s.key.startsWith('repo:')} />
            ))}
          </ul>
        </SetBlock>
      ))}
    </>
  );
}

function SetBlock({ title, detail, folded, n, children }: { title: string | null; detail: string | null; folded: boolean; n: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(!folded);
  if (!title) return <>{children}</>;
  return (
    <div className="lt-b-set">
      <button type="button" className="lt-b-set-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon />
        <strong>{title}</strong>
        <span>
          {detail ? `${detail} · ` : ''}
          {n}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function Row({ o, p, tag, branchFirst = false }: { o: ObservedListener; p: TrayProps; tag: string | null; branchFirst?: boolean }) {
  const a = useRowActions(o, p);
  const branch = o.identity.branch;
  const ctx = branchFirst ? (branch ? `@ ${branch}` : null) : context(o, p.home);
  const up = upFor(o);
  return (
    <li className={`lt-b-row${a.open ? ' is-open' : ''}${o.answer.kind === 'not-http' ? ' is-quiet' : ''}`}>
      <div className="lt-b-main">
        <RowIcon o={o} />
        <div className="lt-b-text">
          <div className="lt-b-name">
            <strong>{rowName(o)}</strong>
            {ctx && <span className="lt-b-ctx">{ctx}</span>}
          </div>
          <div className="lt-b-meta">
            {tag && <span className="lt-b-tag">{tag}</span>}
            {up && <span>{up}</span>}
            <Exposed o={o} machine={p.machine} />
          </div>
        </div>
        <Answer o={o} />
        <Port port={o.port} />
        {a.buttons}
      </div>
      {a.form}
    </li>
  );
}
