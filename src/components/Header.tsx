// The front door / doormat (docs/05-ui.md, "Layout"): the machine's name, the filter, and the overall count.
import { forwardRef } from 'react';
import { Logo } from '../brand/Logo';
import type { Connection } from '../live';
import type { DomainsTone } from '../lib/domains';
import type { Counts } from '../lib/status';
import { GlobeIcon, KeyIcon, SearchIcon } from './icons';

export interface HeaderProps {
  title: string;
  counts: Counts | null;
  checking: boolean;
  connection: Connection;
  filter: string;
  onFilter(v: string): void;
  onFilterKey(e: React.KeyboardEvent<HTMLInputElement>): void;
  matches: number | null;
  onHelp(): void;
  /** Local domains (D63): off (opens how to turn them on) or on (the dashboard's host and how the checks went). */
  domains?: { state: 'off' } | { state: 'on'; host: string; tone: DomainsTone; text: string } | null;
  onDomains?(): void;
}

export const Header = forwardRef<HTMLInputElement, HeaderProps>(function Header({ title, counts, checking, connection, filter, onFilter, onFilterKey, matches, onHelp, domains, onDomains }, ref) {
  return (
    <header className="hw-header">
      <div className="hw-header-inner">
        <a className="hw-brand" href="/" aria-label={`Hallway · ${title}`}>
          <Logo size={30} />
          <span className="hw-wordmark">Hallway</span>
          <span className="hw-brand-sep" aria-hidden="true">
            ·
          </span>
          <span className="hw-brand-title">{title}</span>
        </a>

        <div className="hw-filter">
          <SearchIcon />
          <input
            ref={ref}
            type="search"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            onKeyDown={onFilterKey}
            placeholder="Filter…"
            aria-label="Filter apps and bookmarks"
            aria-describedby={filter ? 'hw-filter-count' : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          {filter ? (
            <span id="hw-filter-count" className="hw-filter-count" aria-live="polite">
              {matches === 1 ? '1 match · Enter opens it' : `${matches} matches`}
            </span>
          ) : (
            <kbd className="hw-filter-key" aria-hidden="true">
              /
            </kbd>
          )}
        </div>

        <div className="hw-header-status">
          {connection !== 'live' && (
            <span
              className="hw-pill hw-pill--warn"
              role="status"
              title={connection === 'reconnecting' ? 'The Hallway daemon isn’t answering. The states shown are from before it stopped; this page reconnects by itself.' : undefined}
            >
              <span className="hw-pulse" aria-hidden="true" />
              {connection === 'reconnecting' ? 'Daemon not answering' : 'Connecting…'}
            </span>
          )}
          {counts && counts.total > 0 && (checking ? <CountLine c={counts} /> : <span className="hw-pill" title="No prober is running in this daemon, so no app has been checked">Health checks off</span>)}
          {domains && onDomains && <DomainsButton d={domains} onClick={onDomains} />}
          <button type="button" className="hw-icon-btn hw-help-btn" onClick={onHelp} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)">
            <KeyIcon />
          </button>
        </div>
      </div>
    </header>
  );
});

function DomainsButton({ d, onClick }: { d: NonNullable<HeaderProps['domains']>; onClick(): void }) {
  if (d.state === 'off')
    return (
      <button type="button" className="hw-domains-btn" onClick={onClick} aria-haspopup="dialog" title="Local domains are off: how to turn on https://<app>.localhost">
        <GlobeIcon />
        <span className="hw-domains-btn-label">Local domains</span>
        <span className="hw-domains-btn-off">off</span>
      </button>
    );
  return (
    <button type="button" className={`hw-domains-btn hw-domains-btn--${d.tone}`} onClick={onClick} aria-haspopup="dialog" aria-label={`Local domains: ${d.host}, ${d.text}`} title={`Local domains: ${d.text}`}>
      <span className={`hw-domains-dot hw-domains-dot--${d.tone}`} aria-hidden="true" />
      <span className="hw-domains-btn-label">{d.host}</span>
    </button>
  );
}

function CountLine({ c }: { c: Counts }) {
  return (
    <p className="hw-counts" aria-label={`${c.up} up, ${c.down} down, ${c.unhealthy} unhealthy, ${c.stopped} stopped`}>
      <span className="hw-count hw-count--healthy">
        <span aria-hidden="true">●</span> <b className="hw-num">{c.up}</b> up
      </span>
      {c.down > 0 && (
        <span className="hw-count hw-count--down">
          <span aria-hidden="true">■</span> <b className="hw-num">{c.down}</b> down
        </span>
      )}
      {c.unhealthy > 0 && (
        <span className="hw-count hw-count--unhealthy">
          <span aria-hidden="true">▲</span> <b className="hw-num">{c.unhealthy}</b> unhealthy
        </span>
      )}
      {c.stopped > 0 && (
        <span className="hw-count hw-count--stopped">
          <span aria-hidden="true">○</span> <b className="hw-num">{c.stopped}</b> stopped
        </span>
      )}
    </p>
  );
}
