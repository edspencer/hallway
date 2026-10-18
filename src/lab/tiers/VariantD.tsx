// Variant D, "Name your doors": the hallway's own metaphor (D23). A door with a brass name plate that reads the
// address it will have; the ways are three plates to choose between, the chosen one in brass. Turn on lights the
// plate while macOS asks; done, the door is lit and named.
import { ExternalIcon } from '../../components/icons';
import { FRONTED_DOCS } from '../../lib/domains';
import { TIERS, type VariantProps, failedWords, runningWords, tierOf } from './model';
import { Cmd, FingerprintIcon, LockIcon } from './parts';

function NamedDoor({ name, lit, waiting, plain }: { name: string; lit: boolean; waiting: boolean; plain: boolean }) {
  return (
    <div className={`tl-d-door${lit ? ' is-lit' : ''}${waiting ? ' is-waiting' : ''}`} aria-hidden="true">
      <span className="tl-d-glow" />
      <span className="tl-d-leaf">
        <span className="tl-d-panel" />
        <span className="tl-d-panel" />
        <span className="tl-d-plate">
          {!plain && <LockIcon size={10} />}
          {name}
        </span>
        <span className="tl-d-knob" />
      </span>
      <span className="tl-d-floor" />
    </div>
  );
}

export function VariantD(p: VariantProps) {
  const run = p.run;
  const t = tierOf(run?.trust ?? p.selected);
  const done = run?.phase === 'done';
  const waiting = run?.phase === 'running';
  return (
    <section className={`tl-d tl-d--${p.where}`} aria-labelledby={`tl-d-title-${p.where}`}>
      <NamedDoor name="review.localhost" lit={done} waiting={waiting} plain={t.trust === 'none'} />
      <div className="tl-d-body">
        <div className="tl-d-head">
          <h2 id={`tl-d-title-${p.where}`} className="tl-d-title">
            {done ? 'Your doors have names' : 'Give your doors names'}
          </h2>
          {p.where === 'panel' && !done && (
            <button type="button" className="hw-btn hw-btn--quiet hw-btn--small" onClick={p.onDismiss}>
              Not now
            </button>
          )}
        </div>
        {done ? (
          <>
            <p className="tl-d-sub">
              Local domains are on. This dashboard is at{' '}
              <a className="hw-link" href={t.dashboardUrl}>
                {t.dashboardUrl.replace(/^https?:\/\//, '')}
              </a>
              , and every app at a name of its own.
            </p>
            <a className="hw-btn hw-btn--primary" href={t.dashboardUrl}>
              Open hallway.localhost
            </a>
          </>
        ) : (
          <>
            <p className="tl-d-sub">
              Every app gets a name plate like <code>review.localhost</code> instead of a port number.
            </p>
            <div className="tl-d-plates" role="radiogroup" aria-label="How">
              {TIERS.map((x) => (
                <button key={x.trust} type="button" role="radio" aria-checked={p.selected === x.trust} className={`tl-d-choice${p.selected === x.trust ? ' is-on' : ''}`} disabled={waiting} onClick={() => p.select(x.trust)}>
                  <span className="tl-d-choice-name">{x.name}</span>
                  {x.trust === 'user' && <span className="tl-d-choice-rec">Recommended</span>}
                </button>
              ))}
            </div>
            <div className="tl-d-detail">
              {waiting ? (
                <p className="tl-d-wait" role="status">
                  {t.trust === 'user' ? <FingerprintIcon size={20} /> : <span className="tl-spinner" />}
                  <span>
                    <strong>{runningWords(t.trust).title}</strong> {runningWords(t.trust).detail}
                  </span>
                </p>
              ) : run?.phase === 'failed' ? (
                <div className="tl-d-fail" role="alert">
                  <p>
                    <strong>{failedWords(t.trust).title}.</strong> {failedWords(t.trust).detail}
                  </p>
                  <div className="tl-d-row">
                    <Cmd command={t.command} onCopy={p.onCopy} />
                    <button type="button" className="hw-btn hw-btn--small" onClick={() => p.turnOn(t.trust)}>
                      Try again
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="tl-d-asks">
                    {t.trust === 'user' && <FingerprintIcon />}
                    <span>{t.asks}</span>
                  </p>
                  <p className="tl-d-facts">{t.facts.join(' · ')}</p>
                  <div className="tl-d-row">
                    {t.canTurnOn ? (
                      <button type="button" className="hw-btn hw-btn--primary" onClick={() => p.turnOn(t.trust)}>
                        Name the doors
                      </button>
                    ) : (
                      <Cmd command={t.command} onCopy={p.onCopy} />
                    )}
                    <a className="hw-link tl-docs" href={FRONTED_DOCS} target="_blank" rel="noreferrer">
                      How it works <ExternalIcon />
                    </a>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
