// Variant B, "Hero + other options": the recommended way is the whole pitch. A display headline, the address the
// apps will have, what macOS will ask, one Turn on. The other two ways wait behind "Other ways to set it up", as
// compact rows that open when chosen.
import { useState } from 'react';
import { ChevronIcon, ExternalIcon } from '../../components/icons';
import { FRONTED_DOCS } from '../../lib/domains';
import { TIERS, type VariantProps } from './model';
import { AddressBar, Cmd, FingerprintIcon, RunStatus } from './parts';

export function VariantB(p: VariantProps) {
  const [other, setOther] = useState(p.selected !== 'user');
  const done = p.run?.phase === 'done';
  const heroRun = p.run?.trust === 'user' ? p.run : null;
  const otherBusy = !!p.run && p.run.trust !== 'user' && p.run.phase === 'running';
  if (done)
    return (
      <section className={`tl-b tl-b--${p.where}`}>
        <RunStatus run={p.run!} onCopy={p.onCopy} onRetry={() => p.turnOn(p.run!.trust)} onReset={p.reset} />
      </section>
    );
  return (
    <section className={`tl-b tl-b--${p.where}`} aria-labelledby={`tl-b-title-${p.where}`}>
      {p.where === 'panel' && (
        <button type="button" className="hw-icon-btn tl-b-close" onClick={p.onDismiss} aria-label="Not now" title="Not now">
          ×
        </button>
      )}
      <div className="tl-b-hero">
        <div className="tl-b-copy">
          <p className="tl-eyebrow">Local domains</p>
          <h2 id={`tl-b-title-${p.where}`} className="tl-b-title">
            Open your apps by name.
          </h2>
          <p className="tl-b-sub">Every app gets an address of its own, over HTTPS, instead of a port number to remember.</p>
        </div>
        <div className="tl-b-preview" aria-hidden="true">
          <span className="tl-b-window">
            <span className="tl-b-dots">
              <i />
              <i />
              <i />
            </span>
            <AddressBar trust="user" />
          </span>
        </div>
      </div>
      <div className="tl-b-act">
        {heroRun ? (
          <RunStatus run={heroRun} onCopy={p.onCopy} onRetry={() => p.turnOn('user')} onReset={p.reset} look="plain" />
        ) : (
          <>
            <button type="button" className="hw-btn hw-btn--primary tl-b-go" onClick={() => p.turnOn('user')} disabled={otherBusy}>
              Turn on
            </button>
            <p className="tl-b-asks">
              <FingerprintIcon />
              <span>
                macOS will ask for your <strong>Touch ID</strong> once, to trust Hallway’s certificate for your account. Not an administrator prompt.
              </span>
            </p>
          </>
        )}
      </div>
      <div className="tl-b-more">
        <button type="button" className={`tl-disclose${other ? ' is-open' : ''}`} aria-expanded={other} onClick={() => setOther(!other)}>
          <ChevronIcon /> Other ways to set it up
        </button>
        {other && (
          <ul className="tl-b-others">
            {TIERS.filter((t) => t.trust !== 'user').map((t) => {
              const on = p.selected === t.trust;
              const mine = p.run?.trust === t.trust ? p.run : null;
              return (
                <li key={t.trust} className={`tl-b-other${on ? ' is-on' : ''}`}>
                  <button type="button" className="tl-b-other-pick" aria-expanded={on} onClick={() => p.select(on ? 'user' : t.trust)}>
                    <span className="tl-b-other-name">{t.name}</span>
                    <span className="tl-b-other-short">{t.short}</span>
                    <ChevronIcon />
                  </button>
                  {on && (
                    <div className="tl-b-other-detail">
                      <AddressBar trust={t.trust} />
                      <p>{t.asks}</p>
                      <ul className="tl-facts">
                        {t.facts.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                      {mine ? (
                        <RunStatus run={mine} onCopy={p.onCopy} onRetry={() => p.turnOn(t.trust)} onReset={p.reset} look="plain" />
                      ) : t.canTurnOn ? (
                        <button type="button" className="hw-btn hw-btn--small" onClick={() => p.turnOn(t.trust)}>
                          Turn on {t.name}
                        </button>
                      ) : (
                        <Cmd command={t.command} onCopy={p.onCopy} small />
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
      </div>
    </section>
  );
}
