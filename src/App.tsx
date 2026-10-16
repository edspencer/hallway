// The dashboard shell. Pre-release: this is a placeholder front page that proves the daemon serves the built UI and
// answers /api/health. The real dashboard (apps as doors, the observed tray, bookmarks by the front door) is v0
// (docs/05-ui.md, docs/08-roadmap.md).
import { useEffect, useState } from 'react';
import type { AppState } from '../shared/api';
import { getHealth } from './api';
import { Logo } from './brand/Logo';

type Daemon = { status: 'checking' } | { status: 'up'; version: string } | { status: 'unreachable' };

function useDaemon(): Daemon {
  const [daemon, setDaemon] = useState<Daemon>({ status: 'checking' });
  useEffect(() => {
    const ctl = new AbortController();
    getHealth(ctl.signal).then(
      (h) => setDaemon({ status: 'up', version: h.version }),
      () => !ctl.signal.aborted && setDaemon({ status: 'unreachable' }),
    );
    return () => ctl.abort();
  }, []);
  return daemon;
}

/** Every state with its shape and word: colour is never the only signal (docs/05-ui.md, "App card"). */
const STATES: { state: AppState; mark: string; label: string; note: string }[] = [
  { state: 'healthy', mark: '●', label: 'healthy', note: 'door ajar, light on' },
  { state: 'unhealthy', mark: '▲', label: 'unhealthy', note: 'light flickering' },
  { state: 'down', mark: '■', label: 'down', note: 'dark: should be running' },
  { state: 'stopped', mark: '○', label: 'stopped', note: 'closed on purpose' },
  { state: 'unknown', mark: '◌', label: 'unknown', note: 'not checked yet' },
];

export function App() {
  const daemon = useDaemon();
  return (
    <div className="hw-page">
      <header className="hw-header">
        <a className="hw-brand" href="/">
          <Logo />
          <span className="hw-wordmark">Hallway</span>
        </a>
        <span className={`hw-daemon hw-daemon--${daemon.status}`} role="status">
          {daemon.status === 'checking' && 'Checking the daemon…'}
          {daemon.status === 'up' && (
            <>
              <span aria-hidden="true">●</span> daemon up · <span className="hw-num">v{daemon.version}</span>
            </>
          )}
          {daemon.status === 'unreachable' && (
            <>
              <span aria-hidden="true">■</span> daemon unreachable
            </>
          )}
        </span>
      </header>

      <main className="hw-main">
        <section className="hw-empty" aria-labelledby="hw-empty-title">
          <Corridor />
          <h1 id="hw-empty-title">The hallway is still being built.</h1>
          <p>
            Hallway will be the front door for every web server on this machine: the ones you registered, and the ones
            it finds listening on a random port. This is a pre-release build; the dashboard arrives with v0.
          </p>
          <p className="hw-hint">
            Served from <code>{window.location.host}</code>. Configuration will live in plain YAML in{' '}
            <code>~/.hallway</code> (or <code>$HALLWAY_HOME</code>).
          </p>
        </section>

        <section className="hw-legend" aria-labelledby="hw-legend-title">
          <h2 id="hw-legend-title">How doors will show health</h2>
          <ul>
            {STATES.map((s) => (
              <li key={s.state} className={`hw-state hw-state--${s.state}`}>
                <span className="hw-state-mark" aria-hidden="true">
                  {s.mark}
                </span>
                <span className="hw-state-label">{s.label}</span>
                <span className="hw-state-note">{s.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

/** The empty-state illustration: a short, well-lit hallway with one door ajar (docs/05-ui.md, "Ideas to explore"). */
function Corridor() {
  return (
    <svg className="hw-corridor" viewBox="0 0 360 180" role="img" aria-label="A short hallway with one door ajar">
      <defs>
        <linearGradient id="hw-spill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--hw-lamplight)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--hw-lamplight)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* walls and floor, in one-point perspective */}
      <polygon points="0,0 360,0 250,50 110,50" fill="var(--hw-bg-raised)" />
      <polygon points="0,180 360,180 250,130 110,130" fill="var(--hw-floor)" />
      <polygon points="0,0 110,50 110,130 0,180" fill="var(--hw-bg-sunken)" />
      <polygon points="360,0 250,50 250,130 360,180" fill="var(--hw-bg-sunken)" />
      <rect x="110" y="50" width="140" height="80" fill="var(--hw-bg)" />
      {/* doors down the left wall: closed */}
      <polygon points="22,40 52,54 52,150 22,166" fill="var(--hw-door)" stroke="var(--hw-door-edge)" />
      <polygon points="72,63 90,71 90,138 72,145" fill="var(--hw-door)" stroke="var(--hw-door-edge)" />
      {/* doors down the right wall: one ajar with light, one closed */}
      <polygon points="308,40 338,26 338,172 308,158" fill="var(--hw-lamplight)" opacity="0.85" />
      <polygon points="308,40 322,40 322,160 308,158" fill="var(--hw-door)" stroke="var(--hw-door-edge)" />
      <polygon points="308,158 338,172 250,180 220,180" fill="url(#hw-spill)" />
      <polygon points="270,71 288,63 288,145 270,138" fill="var(--hw-door)" stroke="var(--hw-door-edge)" />
      {/* the far door, with its number plate */}
      <rect x="166" y="70" width="28" height="60" fill="var(--hw-door)" stroke="var(--hw-door-edge)" />
      <rect x="173" y="78" width="14" height="6" rx="1" fill="var(--hw-accent)" />
    </svg>
  );
}
