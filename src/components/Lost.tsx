// "Lost at last reboot" (docs/05-ui.md; D54): doors that closed while you were away. A banner at the top of the page
// after a reboot, saying when the machine booted and how many apps didn't come back; Review opens one row per item
// (what it was, where it ran from, its command) with Restart once, Make it a service and Dismiss. Each state is
// shape + word + colour: ▯ not running (amber), ● back (calm).
import { useState } from 'react';
import type { LostItem, LostNotice } from '../../shared/api';
import { dismissLost, reviveLost } from '../api';
import { bootLabel, lostCommand, lostCount, lostWhere } from '../lib/lost';
import { ExternalIcon } from './icons';

export interface LostProps {
  lost: LostNotice;
  home: string | null;
  notify(text: string, tone?: 'ok' | 'error'): void;
}

/** A closed door: the banner's mark. */
const ClosedDoor = () => (
  <svg className="hw-lost-door" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 14.5V2.5h9v12" />
    <path d="M1.5 14.5h13" />
    <circle cx="10" cy="8.8" r=".6" fill="currentColor" stroke="none" />
  </svg>
);

export function LostBanner({ lost, home, notify }: LostProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = lostCount(lost);
  const dismissAll = async () => {
    setBusy(true);
    const r = await dismissLost();
    setBusy(false);
    if (!r.ok) notify(r.error, 'error');
  };
  return (
    <section className={`hw-lost${count.lost ? '' : ' hw-lost--back'}`} aria-labelledby="hw-lost-title">
      <div className="hw-lost-head">
        <h2 id="hw-lost-title" className="hw-lost-title">
          {count.lost ? <span className="hw-lost-warn" aria-hidden="true">⚠</span> : null}
          <ClosedDoor />
          <span>
            Lost at last reboot <span className="hw-lost-when">({bootLabel(lost.bootTime)})</span>: {count.text}
          </span>
        </h2>
        <span className="hw-lost-sub">{count.lost ? 'Doors that closed while you were away.' : 'Everything that closed at the reboot is open again.'}</span>
        <div className="hw-lost-actions">
          <button type="button" className="hw-btn" aria-expanded={open} aria-controls="hw-lost-list" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Review'}
          </button>
          <button type="button" className="hw-btn hw-btn--quiet" disabled={busy} onClick={dismissAll}>
            Dismiss
          </button>
        </div>
      </div>
      {open && (
        <ul className="hw-lost-list" id="hw-lost-list">
          {lost.items.map((i) => (
            <LostRow key={i.id} item={i} home={home} notify={notify} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LostRow({ item: i, home, notify }: { item: LostItem; home: string | null; notify: LostProps['notify'] }) {
  const [busy, setBusy] = useState<null | 'restart' | 'service' | 'dismiss'>(null);
  const [failure, setFailure] = useState<{ reason: string; tail?: string } | null>(null);
  const where = lostWhere(i, home);
  const command = lostCommand(i, home);
  const slug = i.slug ?? i.suggestedSlug;
  const canRun = !!slug && (i.managed || !!i.command);

  const revive = async (how: 'restart' | 'service') => {
    setBusy(how);
    setFailure(null);
    const r = await reviveLost(i.id, how);
    setBusy(null);
    if (!r.ok) return setFailure({ reason: r.error });
    if (!r.value.ok) return setFailure({ reason: `It didn’t come up: ${r.value.reason ?? 'no reason given'}.`, tail: r.value.tail });
    notify(how === 'service' ? `${r.value.slug} is a service now: it starts at login and restarts if it exits` : `${r.value.slug} is back on :${r.value.port}`, 'ok');
  };
  const dismiss = async () => {
    setBusy('dismiss');
    const r = await dismissLost(i.id);
    setBusy(null);
    if (!r.ok) notify(r.error, 'error');
  };

  return (
    <li className={`hw-lost-row${i.back ? ' is-back' : ''}`}>
      <span className="hw-plate hw-lost-plate">{i.port}</span>
      <div className="hw-lost-text">
        <div className="hw-lost-name">
          <strong>{i.label}</strong>
          {i.back ? (
            <span className="hw-state hw-state--healthy">
              <span className="hw-state-mark" aria-hidden="true">●</span>
              <span className="hw-state-word">back</span>
            </span>
          ) : (
            <span className="hw-state hw-lost-state">
              <span className="hw-state-mark" aria-hidden="true">▯</span>
              <span className="hw-state-word">not running</span>
            </span>
          )}
          {i.managed && <span className="hw-badge">managed</span>}
        </div>
        <div className="hw-lost-meta">
          {where ? <span className="hw-lost-where">{where}</span> : <span className="hw-quiet-inline">directory not recorded</span>}
          {command ? <code className="hw-lost-cmd">{command}</code> : <span className="hw-quiet-inline">no command was recorded</span>}
        </div>
        {!i.back && !i.slug && slug && canRun && (
          <div className="hw-lost-note">
            Starting it registers it as <code>apps/{slug}.yaml</code>, on port {i.port}.
          </div>
        )}
        {failure && (
          <div className="hw-form-error" role="alert">
            {failure.reason}
            {failure.tail && (
              <details>
                <summary>The last lines of its logs</summary>
                <pre className="hw-lost-tail">{failure.tail}</pre>
              </details>
            )}
          </div>
        )}
      </div>
      <div className="hw-lost-row-actions">
        {i.back ? (
          <a className="hw-btn hw-btn--quiet" href={`http://localhost:${i.port}`} target="_blank" rel="noreferrer" aria-label={`Open ${i.label} on port ${i.port}`}>
            Open <ExternalIcon />
          </a>
        ) : (
          <>
            <button type="button" className="hw-btn hw-btn--primary" disabled={!canRun || !!busy} title={canRun ? 'Start it now; it won’t come back after another reboot' : 'Nothing was recorded to start it with'} onClick={() => revive('restart')}>
              {busy === 'restart' ? 'Starting…' : 'Restart once'}
            </button>
            <button type="button" className="hw-btn" disabled={!canRun || !!busy} title={canRun ? 'Start it now, at every login, and again if it exits' : 'Nothing was recorded to start it with'} onClick={() => revive('service')}>
              {busy === 'service' ? 'Starting…' : 'Make it a service'}
            </button>
          </>
        )}
        <button type="button" className="hw-btn hw-btn--quiet" disabled={!!busy} onClick={dismiss} aria-label={`Dismiss ${i.label}`}>
          Dismiss
        </button>
      </div>
    </li>
  );
}
