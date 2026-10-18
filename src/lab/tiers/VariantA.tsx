// Variant A, "Settings list": one card like a macOS System Settings pane. An icon tile and a title, then an inset
// grouped list of the three ways, one radio each; the chosen one opens in place with its address, what will ask and
// its action. User certificate starts chosen.
import { ExternalIcon, GlobeIcon } from '../../components/icons';
import { FRONTED_DOCS } from '../../lib/domains';
import { TIERS, type VariantProps } from './model';
import { AddressBar, Cmd, FingerprintIcon, RunStatus, TerminalIcon } from './parts';

export function VariantA(p: VariantProps) {
  const done = p.run?.phase === 'done';
  return (
    <section className={`tl-a tl-a--${p.where}`} aria-labelledby={`tl-a-title-${p.where}`}>
      <header className="tl-a-head">
        <span className="tl-tile" aria-hidden="true">
          <GlobeIcon />
        </span>
        <span className="tl-a-titles">
          <h2 id={`tl-a-title-${p.where}`}>Local domains</h2>
          <span>Open this dashboard and your apps by name, instead of by port.</span>
        </span>
        {p.where === 'panel' && !done && (
          <button type="button" className="hw-btn hw-btn--quiet hw-btn--small" onClick={p.onDismiss}>
            Not now
          </button>
        )}
      </header>
      {done ? (
        <RunStatus run={p.run!} onCopy={p.onCopy} onRetry={() => p.turnOn(p.run!.trust)} onReset={p.reset} />
      ) : (
        <ul className="tl-a-list" role="radiogroup" aria-label="How">
          {TIERS.map((t) => {
            const on = p.selected === t.trust;
            const mine = p.run?.trust === t.trust ? p.run : null;
            return (
              <li key={t.trust} className={`tl-a-row${on ? ' is-on' : ''}`}>
                <button type="button" role="radio" aria-checked={on} className="tl-a-pick" onClick={() => p.select(t.trust)} disabled={!!p.run && p.run.phase === 'running'}>
                  <span className="tl-radio" aria-hidden="true" />
                  <span className="tl-a-name">
                    {t.name}
                    {t.trust === 'user' && <span className="tl-a-rec">Recommended</span>}
                  </span>
                  {!on && <span className="tl-a-short">{t.short}</span>}
                </button>
                {on && (
                  <div className="tl-a-detail">
                    <AddressBar trust={t.trust} />
                    <p className="tl-a-asks">
                      {t.trust === 'user' ? <FingerprintIcon /> : t.trust === 'system' ? <TerminalIcon /> : null}
                      <span>{t.asks}</span>
                    </p>
                    <ul className="tl-facts">
                      {t.facts.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    {mine ? (
                      <RunStatus run={mine} onCopy={p.onCopy} onRetry={() => p.turnOn(t.trust)} onReset={p.reset} look="plain" />
                    ) : t.canTurnOn ? (
                      <div className="tl-a-actions">
                        <span className="tl-a-or">
                          or in a terminal: <code>{t.command}</code>
                        </span>
                        <button type="button" className="hw-btn hw-btn--primary" onClick={() => p.turnOn(t.trust)}>
                          Turn on
                        </button>
                      </div>
                    ) : (
                      <div className="tl-a-actions tl-a-actions--terminal">
                        <span className="tl-a-or">Run this in a terminal:</span>
                        <Cmd command={t.command} onCopy={p.onCopy} />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <a className="hw-link tl-docs" href={FRONTED_DOCS} target="_blank" rel="noreferrer">
        How local domains work <ExternalIcon />
      </a>
    </section>
  );
}
