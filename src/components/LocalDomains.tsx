// Local domains (fronted mode, D47; D63). Off: a panel on the page says what they give and how to turn them on (one
// `hallway setup` in a terminal), dismissible into config.yaml; the header's control brings it back as a dialog. On: the
// header shows the dashboard's host and how doctor's networking checks went, and the dialog lists them with their fixes.
// The dashboard never runs setup itself: the privileged steps belong to `hallway setup` (AGENTS.md). `SetupActions` is
// the one place the panel's actions live, so another (a native prompt that runs setup, say) slots in beside them.
import { useEffect, useRef, useState } from 'react';
import type { FrontingCheck, FrontingInfo, FrontingResponse } from '../../shared/api';
import { FRONTED_DOCS, SETUP_COMMANDS, checksSummary, hostOfUrl } from '../lib/domains';
import { CloseIcon, CopyIcon, ExternalIcon, GlobeIcon } from './icons';

type Copy = (text: string, what?: string) => void;

/** What local domains give, in two sentences, with this machine's real addresses. */
function Pitch({ f }: { f: FrontingInfo }) {
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

/** The commands to copy, and the docs. */
export function SetupActions({ onCopy }: { onCopy: Copy }) {
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
export function LocalDomainsPanel({ fronting, onCopy, onDismiss }: { fronting: FrontingInfo; onCopy: Copy; onDismiss(): Promise<void> }) {
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
      <SetupActions onCopy={onCopy} />
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
  dismissed,
  result,
  onRecheck,
  onCopy,
  onShowPanel,
  onClose,
}: {
  fronting: FrontingInfo;
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
              Turned on (<code>mode: fronted</code>): this dashboard is at{' '}
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
              The same checks as <code>hallway doctor</code>. Anything to fix runs in a terminal: <code>hallway setup</code> only does what’s missing, and{' '}
              <code>hallway teardown</code> turns local domains off.
            </p>
          </>
        ) : (
          <>
            <Pitch f={fronting} />
            <SetupActions onCopy={onCopy} />
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
