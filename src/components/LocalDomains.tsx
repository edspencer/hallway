// Local domains (fronted mode, D47; D63, D65). Off: a panel on the page offers setup's three tiers (D65), the
// recommended one first, each with its address, what it asks for and its command to copy, dismissible into
// config.yaml; the header's control brings it back as a dialog. No admin and No prompts also have a Turn on button: the
// daemon runs setup for them (`POST /api/fronting/setup`), never for System-wide, whose steps need sudo in a terminal.
// On: the header shows the dashboard's host and the tier, and the dialog lists doctor's checks with their fixes.
// `SetupActions` is the one place the panel's actions live.
import { useEffect, useRef, useState } from 'react';
import type { FrontingCheck, FrontingInfo, FrontingResponse, TierOption, Trust } from '../../shared/api';
import { FRONTED_DOCS, SETUP_COMMANDS, TIER_LABEL, type TurnOnState, checksSummary, hostOfUrl, logTail, tierChoices, turnOnWords } from '../lib/domains';
import { CloseIcon, CopyIcon, ExternalIcon, GlobeIcon } from './icons';

type Copy = (text: string, what?: string) => void;

/** What local domains give, in two sentences, with this machine's real addresses. */
function Pitch({ f }: { f: FrontingInfo }) {
  if (tierChoices(f).length)
    return (
      <p className="hw-domains-text">
        Open this dashboard and each app by name, such as <code>{f.dashboardUrl.replace(/^https?:\/\//, '')}</code>, instead of by port. Pick how: each
        way runs Caddy as you, and <code>hallway teardown</code> undoes it.
      </p>
    );
  return (
    <>
      <p className="hw-domains-text">
        Reach this dashboard at <code>{f.dashboardUrl}</code> and each app at <code>{f.appUrl}</code> instead of a port number, over HTTPS with a
        certificate your machine trusts. You can use a domain of your own instead, such as <code>myname.internal</code>.
      </p>
      <p className="hw-domains-text hw-domains-quiet">
        It takes one run of <code>hallway setup</code> in a terminal. Hallway runs Caddy as you; the steps that need your password (redirecting ports
        443 and 80 to it, trusting its certificate authority) go through <code>sudo</code> and are printed before they run. <code>hallway teardown</code>{' '}
        undoes it.
      </p>
    </>
  );
}

/** A Turn on in progress, or how the last one went, for the panel and the dialog. */
export interface TurnOn {
  state: TurnOnState | null;
  start(trust: 'user' | 'none'): void;
  reset(): void;
}

/** The tiers as choices (D65): the recommended one first. Turn on asks once more, then runs and follows the daemon. */
function TierChoices({ tiers, macos, onCopy, turnOn }: { tiers: TierOption[]; macos: boolean; onCopy: Copy; turnOn?: TurnOn }) {
  const [confirm, setConfirm] = useState<Trust | null>(null);
  const run = turnOn?.state;
  const busy = run?.job?.state === 'running' || (!!run && !run.job && !run.error);
  return (
    <ul className="hw-tiers">
      {tiers.map((t) => {
        const mine = run?.trust === t.trust ? run : null;
        const words = turnOnWords(t, macos);
        return (
          <li key={t.trust} className={`hw-tier${t.recommended ? ' hw-tier--recommended' : ''}`}>
            <div className="hw-tier-head">
              <span className="hw-tier-name">{t.name}</span>
              {t.recommended && <span className="hw-tier-badge">Recommended</span>}
              <code className="hw-tier-url">{t.url}</code>
            </div>
            <p className="hw-tier-asks">{t.asks}</p>
            <p className="hw-tier-note">{t.note}</p>
            <div className="hw-tier-actions">
              <code className="hw-domains-cmd">{t.command}</code>
              <button type="button" className="hw-btn hw-btn--quiet hw-domains-copy" onClick={() => onCopy(t.command, 'command')} aria-label={`Copy ${t.command}`}>
                <CopyIcon /> Copy
              </button>
              {t.canTurnOn && turnOn && confirm !== t.trust && !mine && (
                <button type="button" className="hw-btn hw-btn--primary hw-tier-on" disabled={busy} onClick={() => setConfirm(t.trust)}>
                  Turn on
                </button>
              )}
              {!t.canTurnOn && <span className="hw-tier-terminal">In a terminal: it needs an administrator</span>}
            </div>
            {confirm === t.trust && !mine && (
              <div className="hw-tier-confirm" role="group" aria-label={`Turn on ${t.name}`}>
                <p>{words.will}</p>
                <p className="hw-tier-confirm-asks">{words.asks}</p>
                <div className="hw-tier-confirm-buttons">
                  <button
                    type="button"
                    className="hw-btn hw-btn--primary"
                    onClick={() => {
                      setConfirm(null);
                      turnOn!.start(t.trust as 'user' | 'none');
                    }}
                  >
                    Turn on {t.name}
                  </button>
                  <button type="button" className="hw-btn hw-btn--quiet" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {mine && <TurnOnProgress run={mine} command={t.command} onDismiss={turnOn!.reset} />}
          </li>
        );
      })}
    </ul>
  );
}

function TurnOnProgress({ run, command, onDismiss }: { run: TurnOnState; command: string; onDismiss(): void }) {
  const state = run.error ? 'failed' : (run.job?.state ?? 'running');
  const tail = logTail(run.job?.log ?? '');
  return (
    <div className={`hw-tier-run hw-tier-run--${state}`} role="status" aria-live="polite">
      <p className="hw-tier-run-line">
        <span className={`hw-domains-dot hw-domains-dot--${state === 'failed' ? 'fail' : state === 'done' ? 'ok' : 'checking'}`} aria-hidden="true" />
        {state === 'failed' ? 'Setup stopped' : state === 'done' ? 'Done' : 'Setting up…'}
      </p>
      {tail && <pre className="hw-tier-log">{tail}</pre>}
      {state === 'failed' && (
        <>
          <p className="hw-form-error">
            <Words text={run.error ?? run.job?.error ?? 'It failed.'} />
          </p>
          <p className="hw-tier-note">
            Run it in a terminal instead to see every step: <code>{command}</code>.{' '}
            <button type="button" className="hw-link" onClick={onDismiss}>
              Dismiss
            </button>
          </p>
        </>
      )}
    </div>
  );
}

/** The tiers (or, from an older daemon, the commands) to copy, and the docs. */
export function SetupActions({ fronting, macos, onCopy, turnOn }: { fronting?: FrontingInfo; macos?: boolean; onCopy: Copy; turnOn?: TurnOn }) {
  const tiers = fronting ? tierChoices(fronting) : [];
  if (tiers.length)
    return (
      <div className="hw-domains-actions hw-domains-actions--tiers">
        <TierChoices tiers={tiers} macos={!!macos} onCopy={onCopy} turnOn={turnOn} />
        <a className="hw-link hw-domains-docs" href={FRONTED_DOCS} target="_blank" rel="noreferrer">
          How local domains work <ExternalIcon />
        </a>
      </div>
    );
  return (
    <div className="hw-domains-actions">
      <ul className="hw-domains-cmds">
        {SETUP_COMMANDS.map((c) => (
          <li key={c.cmd}>
            <code className="hw-domains-cmd">{c.cmd}</code>
            <button type="button" className="hw-btn hw-btn--quiet hw-domains-copy" onClick={() => onCopy(c.cmd, 'command')} aria-label={`Copy ${c.cmd}`}>
              <CopyIcon /> Copy
            </button>
            <span className="hw-domains-what">{c.what}</span>
          </li>
        ))}
      </ul>
      <a className="hw-link hw-domains-docs" href={FRONTED_DOCS} target="_blank" rel="noreferrer">
        How local domains work <ExternalIcon />
      </a>
    </div>
  );
}

/** The panel on the page, in direct mode until it's dismissed. */
export function LocalDomainsPanel({ fronting, macos, onCopy, onDismiss, turnOn }: { fronting: FrontingInfo; macos: boolean; onCopy: Copy; onDismiss(): Promise<void>; turnOn?: TurnOn }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="hw-domains" aria-labelledby="hw-domains-title">
      <div className="hw-domains-head">
        <h2 id="hw-domains-title" className="hw-domains-title">
          <GlobeIcon />
          <span>Local domains are off</span>
        </h2>
        <button
          type="button"
          className="hw-btn hw-btn--quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onDismiss();
            setBusy(false);
          }}
          title="Hide this. The Local domains button at the top brings it back."
        >
          Dismiss
        </button>
      </div>
      <Pitch f={fronting} />
      <SetupActions fronting={fronting} macos={macos} onCopy={onCopy} turnOn={turnOn} />
    </section>
  );
}

/** Doctor's words, with its `backticked` commands as code. */
function Words({ text }: { text: string }) {
  return <>{text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

const MARK: Record<FrontingCheck['status'], string> = { pass: '✓', warn: '!', fail: '✗', skip: '–', info: 'i' };

/** The header's dialog: setup (direct mode) or doctor's checks (fronted mode). */
export function LocalDomainsDialog({
  fronting,
  macos,
  turnOn,
  dismissed,
  result,
  onRecheck,
  onCopy,
  onShowPanel,
  onClose,
}: {
  fronting: FrontingInfo;
  macos: boolean;
  turnOn?: TurnOn;
  /** Direct mode with the panel dismissed: offer to put it back. */
  dismissed: boolean;
  /** Fronted mode: the last checks (null while they run). */
  result: FrontingResponse | null;
  onRecheck(): void;
  onCopy: Copy;
  onShowPanel(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    // Esc is the page's (src/keyboard.ts), as for the shortcuts dialog
    return () => before?.focus?.();
  }, []);
  const on = fronting.mode === 'fronted';
  const sum = checksSummary(result?.checks ?? null, fronting.pushError);
  const shown = (result?.checks ?? []).filter((c) => c.status !== 'skip');
  return (
    <div className="hw-help-wrap" onClick={onClose}>
      <div className="hw-help hw-domains-dialog" role="dialog" aria-modal="true" aria-labelledby="hw-domains-dialog-title" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="hw-domains-dialog-title">Local domains</h2>
          <button type="button" className="hw-icon-btn" onClick={onClose} aria-label="Close (Esc)">
            <CloseIcon />
          </button>
        </header>
        {on ? (
          <>
            <p className="hw-domains-text">
              Turned on{fronting.trust ? `, ${tierChoices(fronting).find((t) => t.trust === fronting.trust)?.name ?? TIER_LABEL[fronting.trust]}` : ''} (<code>mode: fronted</code>): this dashboard is at{' '}
              <a className="hw-link" href={fronting.dashboardUrl}>
                {hostOfUrl(fronting.dashboardUrl)}
              </a>{' '}
              and each app at <code>{fronting.appUrl}</code>.
            </p>
            <p className={`hw-domains-sum hw-domains-sum--${sum.tone}`} role="status">
              <span className={`hw-domains-dot hw-domains-dot--${sum.tone}`} aria-hidden="true" />
              {sum.tone === 'checking' ? 'Running hallway doctor’s checks…' : sum.text}
              {result?.checkedAt && <span className="hw-domains-when"> · checked {new Date(result.checkedAt).toLocaleTimeString()}</span>}
              <button type="button" className="hw-btn hw-btn--quiet hw-domains-recheck" onClick={onRecheck} disabled={sum.tone === 'checking'}>
                Check again
              </button>
            </p>
            {fronting.pushError && <p className="hw-form-error">The daemon couldn’t give Caddy its configuration: {fronting.pushError}</p>}
            {shown.length > 0 && (
              <ul className="hw-domains-checks">
                {shown.map((c, i) => (
                  <li key={`${c.id}-${i}`} className={`hw-domains-check hw-domains-check--${c.status}`}>
                    <span className="hw-domains-mark" aria-label={c.status}>
                      {MARK[c.status]}
                    </span>
                    <span>
                      <Words text={c.message} />
                      {c.fix && c.status !== 'pass' && (
                        <span className="hw-domains-fix">
                          Fix: <Words text={c.fix} />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="hw-help-foot">
              The same checks as <code>hallway doctor</code>. Anything to fix runs in a terminal: <code>hallway setup</code> only does what’s missing (with{' '}
              <code>--trust user</code>, <code>system</code> or <code>none</code> it switches tier), and <code>hallway teardown</code> turns local domains off.
            </p>
          </>
        ) : (
          <>
            <Pitch f={fronting} />
            <SetupActions fronting={fronting} macos={macos} onCopy={onCopy} turnOn={turnOn} />
            {dismissed && (
              <p className="hw-help-foot">
                <button type="button" className="hw-link" onClick={onShowPanel}>
                  Show this on the page again
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
