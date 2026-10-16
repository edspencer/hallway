// Empty and first-run states (docs/05-ui.md): nothing declared and nothing found gets a short explainer with the two
// ways in; the daemon being unreachable gets its own page. The illustration is the one place the hallway is drawn
// literally: a short, well-lit corridor with one door ajar.
import type { StateResponse } from '../../shared/api';

export function Corridor({ className = '' }: { className?: string }) {
  return (
    <svg className={`hw-corridor ${className}`} viewBox="0 0 360 180" role="img" aria-label="A short hallway with one door ajar">
      <defs>
        <linearGradient id="hw-spill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--hw-lamplight)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--hw-lamplight)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="hw-lamp" cx="0.5" cy="0" r="0.8">
          <stop offset="0" stopColor="var(--hw-lamplight)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--hw-lamplight)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <polygon points="0,0 360,0 250,50 110,50" fill="var(--hw-bg-raised)" />
      <polygon points="0,180 360,180 250,130 110,130" fill="var(--hw-floor)" />
      <polygon points="0,0 110,50 110,130 0,180" fill="var(--hw-bg-sunken)" />
      <polygon points="360,0 250,50 250,130 360,180" fill="var(--hw-bg-sunken)" />
      <rect x="110" y="50" width="140" height="80" fill="var(--hw-bg)" />
      <rect x="0" y="0" width="360" height="180" fill="url(#hw-lamp)" />
      {/* skirting boards */}
      <polygon points="0,172 110,126 110,130 0,180" fill="var(--hw-door-edge)" />
      <polygon points="360,172 250,126 250,130 360,180" fill="var(--hw-door-edge)" />
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

/** Nothing declared, nothing found: what to do first. */
export function FirstRun({ state }: { state: StateResponse }) {
  const home = state.daemon.dataHomeDisplay;
  const scanning = state.daemon.providers.scanner;
  return (
    <section className="hw-firstrun" aria-labelledby="hw-firstrun-title">
      <Corridor />
      <div className="hw-firstrun-text">
        <h1 id="hw-firstrun-title">An empty hallway, for now.</h1>
        <p>
          Every web server you run on this machine gets a door here: a name, a number and a light that shows whether it’s up.{' '}
          {scanning ? 'Nothing is listening right now. Start something and it appears here, ready to name, or write its file yourself.' : 'Add your first one by writing its file.'}
        </p>
        <ol className={`hw-steps${scanning ? '' : ' hw-steps--one'}`}>
          {scanning && (
            <li>
              <span className="hw-step-label">Start a server and let Hallway find it</span>
              <code className="hw-cmd">npx vite --port 5173</code>
              <span className="hw-step-note">It shows up under “Found running — not yet named”. Claim it to give it a door.</span>
            </li>
          )}
          <li>
            <span className="hw-step-label">{scanning ? 'Or write one by hand' : 'Write one by hand'}</span>
            <pre className="hw-cmd">
              <span className="hw-cmd-comment"># {home}/apps/my-app.yaml</span>
              {'\n'}name: My app{'\n'}port: 5173
            </pre>
            <span className="hw-step-note">The page updates as soon as you save.</span>
          </li>
        </ol>
        <p className="hw-firstrun-links">
          Coding agents: read{' '}
          <a href="/agent-guide.md" className="hw-link">
            the agent guide
          </a>{' '}
          (or <a href="/llms.txt" className="hw-link">/llms.txt</a>).
        </p>
      </div>
    </section>
  );
}

/** The first load failed. */
export function Unreachable({ onRetry }: { onRetry(): void }) {
  return (
    <main className="hw-unreachable">
      <Corridor className="hw-corridor--dark" />
      <h1>The hallway’s lights are off.</h1>
      <p>
        The Hallway daemon isn’t answering. Start it with <code className="hw-cmd hw-cmd--inline">hallway</code> in a terminal, then try again. This
        page reconnects by itself once it’s back.
      </p>
      <button type="button" className="hw-btn hw-btn--primary" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}
