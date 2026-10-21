// Design exploration only (tray-clarity branch): the pieces every treatment of the grouped tray shares. A row's icon
// (by role, or the page's favicon), what it answers, "on your network", and the Claim / Ignore / Open actions.
import { useState } from 'react';
import type { ObservedListener } from '../../../shared/api';
import { ClaimForm, IgnoreMenu } from '../../components/Observed';
import { ExternalIcon, GlobeIcon } from '../../components/icons';
import { duration, tildify } from '../../lib/format';
import { type TrayGroup, answerText, exposureWords, openable, rowContext } from '../../lib/tray';

export interface TrayProps {
  observed: ObservedListener[];
  groups: TrayGroup[];
  home: string | null;
  machine: string;
  takenSlugs: Set<string>;
  notify(text: string, tone?: 'ok' | 'error'): void;
}

const ico = (d: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {d}
  </svg>
);

/** A branch: a project in a repository. */
export const BranchIcon = () =>
  ico(
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.2 4.3" />
    </>,
  );
/** A window: an app on this machine. */
export const WindowIcon = () =>
  ico(
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M2 6h12M4.3 4.5h.1M6 4.5h.1" />
    </>,
  );
/** A box: a container. */
export const BoxIcon = () =>
  ico(
    <>
      <path d="M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z" />
      <path d="M2.5 4.8L8 7.8l5.5-3M8 7.8v6.4" />
    </>,
  );
/** A ship's wheel: Kubernetes. */
export const WheelIcon = () =>
  ico(
    <>
      <circle cx="8" cy="8" r="4.6" />
      <circle cx="8" cy="8" r="1.4" />
      <path d="M8 1.6v4.9M8 9.5v4.9M1.6 8h4.9M9.5 8h4.9M3.5 3.5l3.5 3.5M9 9l3.5 3.5M12.5 3.5L9 7M7 9l-3.5 3.5" />
    </>,
  );
/** Gears: a desktop app's internals. */
export const CogIcon = () =>
  ico(
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v2M8 12.2v2M14.2 8h-2M3.8 8h-2M12.4 3.6L11 5M5 11l-1.4 1.4M12.4 12.4L11 11M5 5L3.6 3.6" />
    </>,
  );
/** A tunnel: an SSH forward. */
export const TunnelIcon = () =>
  ico(
    <>
      <path d="M2 13V8a6 6 0 0 1 12 0v5" />
      <path d="M5 13V8.5a3 3 0 0 1 6 0V13M1.5 13h13" />
    </>,
  );
export const QuestionIcon = () =>
  ico(
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1" />
    </>,
  );

export function GroupIcon({ g }: { g: TrayGroup }) {
  if (g.kind === 'projects') return <BranchIcon />;
  if (g.kind === 'apps') return <WindowIcon />;
  if (g.kind === 'internal') return <CogIcon />;
  if (g.kind === 'other') return <QuestionIcon />;
  if (g.key === 'forwarded:ssh') return <TunnelIcon />;
  if (g.key === 'forwarded:kubernetes' || g.key === 'forwarded:kubectl') return <WheelIcon />;
  return <BoxIcon />;
}

/** The row's tile: the page's favicon when it has one, else a glyph for what it is. */
export function RowIcon({ o }: { o: ObservedListener }) {
  const [broken, setBroken] = useState(false);
  const icon = o.favicon && !broken ? new URL(o.favicon, o.url).toString() : null;
  const glyph =
    o.role === 'project' ? <BranchIcon /> : o.role === 'app' ? <WindowIcon /> : o.role === 'internal' ? <CogIcon /> : o.role === 'cluster' ? <WheelIcon /> : o.identity.via?.tool.id === 'ssh' ? <TunnelIcon /> : o.role === 'forwarded' ? <BoxIcon /> : <QuestionIcon />;
  return (
    <span className={`lt-tile lt-tile--${o.answer.kind}`} aria-hidden="true">
      {icon ? <img src={icon} alt="" onError={() => setBroken(true)} /> : glyph}
    </span>
  );
}

/** What it answers, as a small chip with a mark: ● page, ◆ API, a lock for a sign-in, → redirect, ○ not HTTP. */
export function Answer({ o, quiet = false }: { o: ObservedListener; quiet?: boolean }) {
  const a = o.answer;
  return (
    <span className={`lt-answer lt-answer--${a.kind}${quiet ? ' is-quiet' : ''}`} title={a.status ? `GET / answered HTTP ${a.status}${a.tls ? ' over HTTPS' : ''}` : 'It accepted a connection but didn’t answer HTTP'}>
      <span className="lt-answer-mark" aria-hidden="true" />
      {answerText(a)}
      {a.tls && a.kind !== 'not-http' ? <span className="lt-answer-tls">HTTPS</span> : null}
    </span>
  );
}

/** "On your network", with its explanation in a tooltip (the tray also says it in words once). */
export function Exposed({ o, machine }: { o: ObservedListener; machine: string }) {
  if (!o.identity.exposed) return null;
  const w = exposureWords(machine);
  return (
    <span className="lt-exposed" title={`${w.detail} (${o.identity.bindAddress ?? '*'}:${o.port})`}>
      <GlobeIcon />
      {w.label}
    </span>
  );
}

/** The one-line explanation of "on your network", shown wherever something is. */
export function ExposedNote({ observed, machine }: { observed: ObservedListener[]; machine: string }) {
  const n = observed.filter((o) => o.identity.exposed).length;
  if (!n) return null;
  const w = exposureWords(machine);
  return (
    <p className="lt-exposed-note">
      <span className="lt-exposed">
        <GlobeIcon />
        {w.label}
      </span>
      <span>
        {w.detail} {n === 1 ? 'One thing here does.' : `${n} things here do.`} Bind a server to <code>127.0.0.1</code> to keep it to yourself.
      </span>
    </p>
  );
}

export const context = (o: ObservedListener, home: string | null) => rowContext(o, (p) => tildify(p, home));

export const upFor = (o: ObservedListener) => {
  const since = o.identity.startedAt ?? o.firstSeen;
  return since ? `up ${duration(Date.now() - Date.parse(since))}` : null;
};

/** Branch, for a repository's rows. */
export const branchOf = (o: ObservedListener) => o.identity.branch;

/** Claim, Ignore and Open, and the Claim form under the row when it's open. `compact` puts Open first as a link. */
export function useRowActions(o: ObservedListener, p: Pick<TrayProps, 'home' | 'takenSlugs' | 'notify'>) {
  const [mode, setMode] = useState<'idle' | 'claim' | 'ignore'>('idle');
  const open = openable(o);
  const buttons = (
    <div className="lt-actions">
      {open && (
        <a className="hw-btn lt-open" href={o.url} target="_blank" rel="noreferrer" aria-label={`Open ${o.name} on port ${o.port}`}>
          Open <ExternalIcon />
        </a>
      )}
      <button type="button" className="hw-btn hw-btn--quiet" aria-expanded={mode === 'claim'} onClick={() => setMode(mode === 'claim' ? 'idle' : 'claim')}>
        Claim
      </button>
      <div className="hw-menu-wrap">
        <button type="button" className="hw-btn hw-btn--quiet" aria-haspopup="menu" aria-expanded={mode === 'ignore'} onClick={() => setMode(mode === 'ignore' ? 'idle' : 'ignore')}>
          Ignore
        </button>
        {mode === 'ignore' && <IgnoreMenu o={o} home={p.home} onDone={() => setMode('idle')} notify={p.notify} />}
      </div>
    </div>
  );
  const form = mode === 'claim' ? <ClaimForm o={o} takenSlugs={p.takenSlugs} onDone={() => setMode('idle')} notify={p.notify} /> : null;
  return { buttons, form, open: mode !== 'idle' };
}

/** What a row is called: a forward nothing could name says so, rather than repeating its tool and port. */
export const rowName = (o: ObservedListener) => {
  const v = o.identity.via;
  return v && !v.container && !v.kubernetes && o.name === `${v.tool.name} :${o.port}` ? 'Unidentified forward' : o.name;
};

/** Port as a small mono figure. */
export const Port = ({ port }: { port: number }) => <span className="lt-port">:{port}</span>;
