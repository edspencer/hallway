// Variant E, "One line": the least the page can say. One row: the pitch with the address, Turn on, and Options.
// A quiet second line says what macOS will ask. Options drops a small menu of the three ways (a check on the chosen
// one); choosing another rewrites the row for it. Running, done and failed replace the row in place.
import { useState } from 'react';
import { GlobeIcon } from '../../components/icons';
import { TIERS, type VariantProps, failedWords, runningWords, tierOf } from './model';
import { AddressBar, CheckIcon, Cmd, FingerprintIcon } from './parts';

export function VariantE(p: VariantProps) {
  const [menu, setMenu] = useState(false);
  const run = p.run;
  const t = tierOf(run?.trust ?? p.selected);
  let line: React.ReactNode;
  let sub: React.ReactNode;
  let actions: React.ReactNode = null;
  if (run?.phase === 'running') {
    const w = runningWords(t.trust);
    line = (
      <>
        <span className="tl-e-mark tl-e-mark--wait">{t.trust === 'user' ? <FingerprintIcon /> : <span className="tl-spinner" />}</span>
        <strong>{w.title}</strong>
      </>
    );
    sub = w.detail;
  } else if (run?.phase === 'done') {
    line = (
      <>
        <span className="tl-e-mark tl-e-mark--ok">
          <CheckIcon />
        </span>
        <strong>Local domains are on.</strong> <span className="tl-e-quiet">This dashboard is at</span> <AddressBar trust={t.trust} host="hallway" />
      </>
    );
    actions = (
      <a className="hw-btn hw-btn--primary hw-btn--small" href={t.dashboardUrl}>
        Open
      </a>
    );
  } else if (run?.phase === 'failed') {
    const w = failedWords(t.trust);
    line = (
      <>
        <span className="tl-e-mark tl-e-mark--fail">!</span>
        <strong>{w.title}.</strong> <span className="tl-e-quiet">Run it in a terminal instead:</span> <Cmd command={t.command} onCopy={p.onCopy} small />
      </>
    );
    sub = 'The Touch ID prompt was cancelled, or timed out after a minute.';
    actions = (
      <>
        <button type="button" className="hw-btn hw-btn--small" onClick={() => p.turnOn(t.trust)}>
          Try again
        </button>
        <button type="button" className="hw-icon-btn tl-e-x" onClick={p.reset} aria-label="Back" title="Back">
          ×
        </button>
      </>
    );
  } else {
    line =
      t.trust === 'system' ? (
        <>
          <span className="tl-e-icon">
            <GlobeIcon />
          </span>
          <strong>System-wide certificate</strong> <span className="tl-e-quiet">needs an administrator, so it runs in a terminal:</span> <Cmd command={t.command} onCopy={p.onCopy} small />
        </>
      ) : (
        <>
          <span className="tl-e-icon">
            <GlobeIcon />
          </span>
          <strong>Open your apps by name,</strong> <span className="tl-e-quiet">like</span> <AddressBar trust={t.trust} />
        </>
      );
    sub =
      t.trust === 'user' ? (
        <>
          <FingerprintIcon /> macOS will ask for your Touch ID once, to trust Hallway’s certificate for your account.
        </>
      ) : t.trust === 'none' ? (
        'No HTTPS: nothing will ask, but Safari drops Secure cookies over plain HTTP.'
      ) : (
        'It trusts the certificate for every account, and allows custom domains like myname.internal.'
      );
    actions = (
      <>
        {t.canTurnOn && (
          <button type="button" className="hw-btn hw-btn--primary hw-btn--small" onClick={() => p.turnOn(t.trust)}>
            Turn on
          </button>
        )}
        <span className="tl-e-menu-wrap">
          <button type="button" className="hw-btn hw-btn--quiet hw-btn--small tl-e-options" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}>
            Options
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {menu && (
            <div className="tl-e-menu" role="menu">
              {TIERS.map((x) => (
                <button
                  key={x.trust}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p.selected === x.trust}
                  className="tl-e-item"
                  onClick={() => {
                    p.select(x.trust);
                    setMenu(false);
                  }}
                >
                  <span className="tl-e-check">{p.selected === x.trust && <CheckIcon size={14} />}</span>
                  <span className="tl-e-item-words">
                    <span className="tl-e-item-name">
                      {x.name}
                      {x.trust === 'user' && <span className="tl-e-item-rec"> · Recommended</span>}
                    </span>
                    <span className="tl-e-item-short">{x.short}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </span>
        {p.where === 'panel' && (
          <button type="button" className="hw-icon-btn tl-e-x" onClick={p.onDismiss} aria-label="Not now" title="Not now">
            ×
          </button>
        )}
      </>
    );
  }
  return (
    <section className={`tl-e tl-e--${p.where}${run ? ` tl-e--${run.phase}` : ''}`} aria-label="Local domains">
      <div className="tl-e-main">
        <p className="tl-e-line">{line}</p>
        {sub && <p className="tl-e-sub">{sub}</p>}
      </div>
      {actions && <div className="tl-e-actions">{actions}</div>}
    </section>
  );
}
