// Variant C, "Banner + sheet": the page carries one slim line; Set up… opens a sheet, as a Mac app would. The sheet
// is a short flow: a segmented control for the way (User certificate first), "What will happen" as a checklist, and
// Cancel / Turn on at the bottom right. While it runs the sheet becomes the Touch ID wait, then the done state with
// the live address. The header's control opens the same sheet.
import { ExternalIcon, GlobeIcon } from '../../components/icons';
import { FRONTED_DOCS } from '../../lib/domains';
import type { Trust } from '../../../shared/api';
import { TIERS, type VariantProps, failedWords, runningWords, tierOf } from './model';
import { AddressBar, CheckIcon, Cmd, FingerprintIcon, TerminalIcon } from './parts';

export function VariantC(p: VariantProps) {
  const done = p.run?.phase === 'done';
  return (
    <section className={`tl-c${done ? ' tl-c--done' : ''}`} aria-label="Local domains">
      <span className="tl-tile tl-tile--small" aria-hidden="true">
        {done ? <CheckIcon /> : <GlobeIcon />}
      </span>
      {done ? (
        <p className="tl-c-line">
          <strong>Local domains are on.</strong> This dashboard is now at <a className="hw-link" href={tierOf(p.run!.trust).dashboardUrl}>{tierOf(p.run!.trust).dashboardUrl.replace(/^https?:\/\//, '')}</a>.
        </p>
      ) : (
        <p className="tl-c-line">
          <strong>Open your apps by name,</strong> like <AddressBar trust="user" />, instead of by port.
        </p>
      )}
      {!done && (
        <>
          <button type="button" className="hw-btn hw-btn--small" onClick={p.openDialog}>
            Set up…
          </button>
          <button type="button" className="hw-icon-btn tl-c-x" onClick={p.onDismiss} aria-label="Not now" title="Not now">
            ×
          </button>
        </>
      )}
    </section>
  );
}

const SEGMENT: Record<Trust, string> = { user: 'User certificate', system: 'System-wide cert', none: 'No HTTPS' };

function steps(t: Trust): { icon: React.ReactNode; text: React.ReactNode }[] {
  const caddy = { icon: <CheckIcon />, text: 'Hallway runs Caddy as you, and launchd holds ports 443 and 80 for it.' };
  if (t === 'user')
    return [
      caddy,
      { icon: <FingerprintIcon />, text: <>macOS asks for your <strong>Touch ID</strong> or password once, to trust Hallway’s certificate for your account. It isn’t an administrator prompt.</> },
      { icon: <CheckIcon />, text: 'This page moves to hallway.localhost.' },
    ];
  if (t === 'system')
    return [
      caddy,
      { icon: <TerminalIcon />, text: <>An <strong>administrator’s password</strong> trusts the certificate for every account, and lets you use a domain of your own, like <code>myname.internal</code>.</> },
      { icon: <TerminalIcon />, text: 'Because it needs an administrator, it runs in a terminal, where you can see each step before it runs.' },
    ];
  return [
    { icon: <CheckIcon />, text: 'Hallway runs Caddy as you, and launchd holds port 80 for it.' },
    { icon: <CheckIcon />, text: 'Nothing asks for a password.' },
    { icon: <span className="tl-c-warn">!</span>, text: 'Plain HTTP: Safari drops Secure cookies, and apps that insist on https: won’t work.' },
  ];
}

/** The sheet: chosen way → what will happen → Turn on → waiting → done (or what to do instead). */
export function VariantCSheet(p: VariantProps) {
  const t = tierOf(p.selected);
  const run = p.run;
  let body: React.ReactNode;
  let foot: React.ReactNode;
  if (run?.phase === 'running') {
    const w = runningWords(run.trust);
    body = (
      <div className="tl-c-state" role="status" aria-live="polite">
        <span className="tl-c-big tl-c-big--wait">{run.trust === 'user' ? <FingerprintIcon size={34} /> : <span className="tl-spinner tl-spinner--big" />}</span>
        <h3>{w.title}</h3>
        <p>{w.detail}</p>
      </div>
    );
    foot = (
      <button type="button" className="hw-btn" disabled>
        Turning on…
      </button>
    );
  } else if (run?.phase === 'done') {
    const r = tierOf(run.trust);
    body = (
      <div className="tl-c-state" role="status">
        <span className="tl-c-big tl-c-big--ok">
          <CheckIcon size={30} />
        </span>
        <h3>Local domains are on</h3>
        <p>This dashboard and every app now have names of their own.</p>
        <AddressBar trust={run.trust} host="hallway" />
      </div>
    );
    foot = (
      <>
        <button type="button" className="hw-btn" onClick={p.closeDialog}>
          Close
        </button>
        <a className="hw-btn hw-btn--primary" href={r.dashboardUrl}>
          Open hallway.localhost
        </a>
      </>
    );
  } else if (run?.phase === 'failed') {
    const w = failedWords(run.trust);
    body = (
      <div className="tl-c-state" role="alert">
        <span className="tl-c-big tl-c-big--fail">!</span>
        <h3>{w.title}</h3>
        <p>{w.detail}</p>
        <Cmd command={tierOf(run.trust).command} onCopy={p.onCopy} />
      </div>
    );
    foot = (
      <>
        <button type="button" className="hw-btn" onClick={p.reset}>
          Back
        </button>
        <button type="button" className="hw-btn hw-btn--primary" onClick={() => p.turnOn(run.trust)}>
          Try again
        </button>
      </>
    );
  } else {
    body = (
      <>
        <div className="tl-seg" role="radiogroup" aria-label="How">
          {TIERS.map((x) => (
            <button key={x.trust} type="button" role="radio" aria-checked={p.selected === x.trust} className={`tl-seg-item${p.selected === x.trust ? ' is-on' : ''}`} onClick={() => p.select(x.trust)}>
              {SEGMENT[x.trust]}
            </button>
          ))}
        </div>
        <p className="tl-c-rec">{t.trust === 'user' ? 'Recommended. ' : ''}{t.short}.</p>
        <div className="tl-c-addr">
          <span>Your apps will be at</span>
          <AddressBar trust={t.trust} />
        </div>
        <h3 className="tl-c-h">What will happen</h3>
        <ul className="tl-c-steps">
          {steps(t.trust).map((s, i) => (
            <li key={i}>
              <span className="tl-c-step-icon">{s.icon}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
        {!t.canTurnOn && <Cmd command={t.command} onCopy={p.onCopy} />}
      </>
    );
    foot = (
      <>
        <a className="hw-link tl-docs tl-c-docs" href={FRONTED_DOCS} target="_blank" rel="noreferrer">
          How it works <ExternalIcon />
        </a>
        <button type="button" className="hw-btn" onClick={p.closeDialog}>
          Cancel
        </button>
        {t.canTurnOn ? (
          <button type="button" className="hw-btn hw-btn--primary" onClick={() => p.turnOn(t.trust)}>
            Turn on
          </button>
        ) : (
          <button type="button" className="hw-btn hw-btn--primary" onClick={() => p.onCopy(t.command, 'command')}>
            Copy command
          </button>
        )}
      </>
    );
  }
  return (
    <div className="tl-sheet" role="dialog" aria-modal="true" aria-labelledby="tl-c-sheet-title" onClick={(e) => e.stopPropagation()}>
      <header className="tl-sheet-head">
        <span className="tl-tile" aria-hidden="true">
          <GlobeIcon />
        </span>
        <h2 id="tl-c-sheet-title">Turn on local domains</h2>
      </header>
      <div className="tl-sheet-body">{body}</div>
      <footer className="tl-sheet-foot">{foot}</footer>
    </div>
  );
}
