// Local domains (fronted mode, D47; D63, D65, D70). Off: a panel on the page, styled like a settings pane: the three
// tiers as an inset list with one radio each, User certificate chosen and open (its address, what will ask, Turn on),
// the other two one line each until chosen. Dismissible into config.yaml; the header's control brings it back as a
// dialog. User certificate and No HTTPS have Turn on (the daemon runs setup for them, `POST /api/fronting/setup`);
// System-wide certificate never does: its steps need sudo, so it shows its command for a terminal. A Turn on's progress
// and failure show in its row; when it's done the page switches to fronted mode and the dialog says so.
// On: the header shows the dashboard's host and the tier, and the dialog lists doctor's checks with their fixes.
// `SetupActions` is the one place the panel's actions live.
import { useEffect, useRef, useState } from 'react';
import type { FrontingCheck, FrontingInfo, FrontingResponse, PortConflict, TierOption, Trust } from '../../shared/api';
import { FRONTED_DOCS, RESTART_BROWSER, SETUP_COMMANDS, TIER_LABEL, type TurnOnState, checksSummary, conflictHeadline, conflictProcess, conflictWhere, failedWords, hostOfUrl, initialTier, logTail, runningWords, tierChoices, turnOnPhase, withPort } from '../lib/domains';
import { CheckIcon, CloseIcon, CopyIcon, ExternalIcon, FingerprintIcon, GlobeIcon, LockIcon, TerminalIcon } from './icons';

type Copy = (text: string, what?: string) => void;

/** A Turn on in progress, or how the last one went, for the panel and the dialog. */
export interface TurnOn {
  state: TurnOnState | null;
  /** `port`: the port links carry (D71): Caddy's own when 443 is taken, or 443 to move back. */
  start(trust: 'user' | 'none', port?: number): void;
  reset(): void;
}

/** A command, with a button to copy it. */
function Cmd({ command, onCopy }: { command: string; onCopy: Copy }) {
  return (
    <span className="hw-copycmd">
      <code>{command}</code>
      <button type="button" className="hw-copycmd-copy" onClick={() => onCopy(command, 'command')} aria-label={`Copy ${command}`} title="Copy">
        <CopyIcon />
      </button>
    </span>
  );
}

/** An address as a browser shows it: a lock (open for plain HTTP), the scheme quiet, the host plain. */
function Address({ url }: { url: string }) {
  const m = /^(https?:\/\/)(.*)$/.exec(url);
  const plain = url.startsWith('http:');
  return (
    <span className={`hw-address${plain ? ' hw-address--plain' : ''}`}>
      <LockIcon open={plain} />
      <span>
        <span className="hw-address-scheme">{m?.[1] ?? ''}</span>
        {m?.[2] ?? url}
      </span>
    </span>
  );
}

/** The icon tile and the title the panel and the dialog share. */
function DomainsHead({ id, title, sub, children }: { id: string; title: string; sub: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="hw-domains-head">
      <span className="hw-domains-tile" aria-hidden="true">
        <GlobeIcon />
      </span>
      <span className="hw-domains-titles">
        <h2 id={id}>{title}</h2>
        <span>{sub}</span>
      </span>
      {children}
    </header>
  );
}

/** Something else holds the ports (D71): who, where, that tool's own fix, and Caddy's port as the way to coexist. */
function PortsInUse({ conflicts, altPort, appUrl, onRetry, onAlt, onReset }: { conflicts: PortConflict[]; altPort: number | null; appUrl: string; onRetry?(): void; onAlt?(): void; onReset(): void }) {
  return (
    <div className="hw-run hw-run--failed hw-ports" role="alert">
      <span className="hw-run-mark hw-run-mark--fail" aria-hidden="true">
        !
      </span>
      <span className="hw-run-words">
        {conflicts.map((c, i) => {
          const where = conflictWhere(c);
          const proc = conflictProcess(c);
          return (
            <span className="hw-ports-one" key={i}>
              <strong>{conflictHeadline(c)}</strong>
              {(proc || c.command) && (
                <span className="hw-ports-proc">
                  {proc}
                  {c.command && <code title={c.command}>{c.command}</code>}
                </span>
              )}
              {where && <span className={`hw-ports-where${where.exposed ? ' hw-ports-where--exposed' : ''}`}>{where.text}</span>}
              <span className="hw-ports-fix-head">{c.kind === 'standard' ? `To free ${c.ports.length > 1 ? 'them' : 'it'}:` : 'To fix it:'}</span>
              <ul className="hw-ports-fix">
                {c.fix.map((f, j) => (
                  <li key={j}>
                    <Words text={sentence(f)} />
                  </li>
                ))}
              </ul>
            </span>
          );
        })}
        <span>Hallway won’t fight {conflicts.length > 1 ? 'them' : 'it'} for the ports. Then turn local domains on again.</span>
        {altPort && (
          <span className="hw-ports-alt">
            <span>
              <strong>Or leave it running</strong> and use Caddy’s own port, {altPort}: links become <code>{withPort(appUrl, altPort)}</code>. You can move back to 443 later.
            </span>
          </span>
        )}
        <span className="hw-run-buttons">
          {altPort && onAlt && (
            <button type="button" className="hw-btn hw-btn--primary hw-btn--small" onClick={onAlt}>
              Use port {altPort} instead
            </button>
          )}
          {onRetry && (
            <button type="button" className="hw-btn hw-btn--small" onClick={onRetry}>
              Try again
            </button>
          )}
          <button type="button" className="hw-btn hw-btn--quiet hw-btn--small" onClick={onReset}>
            OK
          </button>
        </span>
      </span>
    </div>
  );
}

/** A Turn on that's running or stopped, in its tier's row. */
function RunStatus({ run, tier, macos, onCopy, onReset, onStart, noAlt }: { run: TurnOnState; tier: TierOption; macos: boolean; onCopy: Copy; onReset(): void; onStart?(port?: number): void; noAlt?: boolean }) {
  const phase = turnOnPhase(run);
  const tail = logTail(run.job?.log ?? '');
  const job = run.job;
  if (phase === 'failed' && job?.reason === 'ports' && job.conflicts?.length)
    return <PortsInUse conflicts={job.conflicts} altPort={noAlt ? null : (job.altPort ?? null)} appUrl={tier.url} onReset={onReset} onRetry={onStart && (() => onStart(run.port ?? undefined))} onAlt={onStart && job.altPort ? () => onStart(job.altPort!) : undefined} />;
  if (phase === 'failed') {
    const w = failedWords(tier.trust, macos, job?.reason ?? null);
    return (
      <div className="hw-run hw-run--failed" role="alert">
        <span className="hw-run-mark hw-run-mark--fail" aria-hidden="true">
          !
        </span>
        <span className="hw-run-words">
          <strong>{w.title}</strong>
          <span className="hw-run-error">
            <Words text={sentence(run.error ?? run.job?.error ?? 'It failed.')} />
          </span>
          <span>{w.detail}</span>
          <Cmd command={tier.command} onCopy={onCopy} />
          {tail && (
            <details className="hw-run-details">
              <summary>What setup printed</summary>
              <pre className="hw-run-log">{tail}</pre>
            </details>
          )}
          <span className="hw-run-buttons">
            <button type="button" className="hw-btn hw-btn--small" onClick={onReset}>
              OK
            </button>
          </span>
        </span>
      </div>
    );
  }
  const w = runningWords(tier.trust, macos);
  return (
    <div className="hw-run hw-run--running" role="status" aria-live="polite">
      <span className="hw-run-mark hw-run-mark--wait" aria-hidden="true">
        {tier.trust === 'user' && macos ? <FingerprintIcon /> : <span className="hw-spinner" />}
      </span>
      <span className="hw-run-words">
        <strong>{w.title}</strong>
        <span>{w.detail}</span>
        {tail && !(tier.trust === 'user' && macos) && <pre className="hw-run-log">{tail}</pre>}
      </span>
    </div>
  );
}

/** Turned on from this page: where the dashboard is now, and the way there. When the run trusted Hallway's
 *  certificate, a browser that warned before may need quitting and reopening (D73). */
function TurnedOn({ url, appUrl, trustChanged }: { url: string; appUrl: string; trustChanged?: boolean }) {
  return (
    <div className="hw-run hw-run--done" role="status">
      <span className="hw-run-mark hw-run-mark--ok" aria-hidden="true">
        <CheckIcon />
      </span>
      <span className="hw-run-words">
        <strong>Local domains are on</strong>
        <span>
          This dashboard is now at {hostOfUrl(url)}, and each app at its own name, like <code>{appUrl}</code>.
        </span>
        {trustChanged && <span className="hw-run-hint">{RESTART_BROWSER}</span>}
      </span>
      <a className="hw-btn hw-btn--primary hw-run-go" href={url}>
        Open {hostOfUrl(url)}
      </a>
    </div>
  );
}

/** The tiers as a settings list (D70): one radio each, the chosen one open. Turn on runs at once: what will ask is
 *  already on the row, and on a Mac the Touch ID dialog is itself the confirmation. */
function TierList({ tiers, macos, onCopy, turnOn }: { tiers: TierOption[]; macos: boolean; onCopy: Copy; turnOn?: TurnOn }) {
  const run = turnOn?.state ?? null;
  const [chosen, setChosen] = useState<Trust | null>(() => run?.trust ?? initialTier(tiers));
  const busy = turnOnPhase(run) === 'running';
  const selected = run?.trust ?? chosen;
  return (
    <ul className="hw-tiers" role="radiogroup" aria-label="How to turn them on">
      {tiers.map((t) => {
        const on = selected === t.trust;
        const mine = run?.trust === t.trust && turnOnPhase(run) !== 'done' ? run : null;
        return (
          <li key={t.trust} className={`hw-tier${on ? ' is-on' : ''}`}>
            <button type="button" role="radio" aria-checked={on} className="hw-tier-pick" disabled={busy || (!!run && !on)} onClick={() => setChosen(t.trust)}>
              <span className="hw-radio" aria-hidden="true" />
              <span className="hw-tier-name">
                {t.name}
                {t.recommended && <span className="hw-tier-badge">Recommended</span>}
              </span>
              {!on && t.summary && <span className="hw-tier-summary">{t.summary}</span>}
            </button>
            {on && (
              <div className="hw-tier-detail">
                <Address url={t.url} />
                <p className="hw-tier-asks">
                  {t.trust === 'user' && macos ? <FingerprintIcon /> : t.trust === 'system' ? <TerminalIcon /> : null}
                  <span>{t.asks}</span>
                </p>
                <p className="hw-tier-note">{t.note}</p>
                {t.warning && (
                  <p className="hw-tier-warning" role="note">
                    {t.warning}
                  </p>
                )}
                {mine ? (
                  <RunStatus run={mine} tier={t} macos={macos} onCopy={onCopy} onReset={turnOn!.reset} onStart={t.canTurnOn ? (port) => turnOn!.start(t.trust as 'user' | 'none', port) : undefined} />
                ) : t.canTurnOn && turnOn ? (
                  <div className="hw-tier-actions">
                    <span className="hw-tier-or">
                      or in a terminal: <code>{t.command}</code>
                    </span>
                    <button type="button" className="hw-btn hw-btn--primary" onClick={() => turnOn.start(t.trust as 'user' | 'none')}>
                      Turn on
                    </button>
                  </div>
                ) : (
                  <div className="hw-tier-actions hw-tier-actions--terminal">
                    <span className="hw-tier-or">In a terminal:</span>
                    <Cmd command={t.command} onCopy={onCopy} />
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The tiers (or, from an older daemon, the commands) to copy, and the docs. */
export function SetupActions({ fronting, macos, onCopy, turnOn }: { fronting?: FrontingInfo; macos?: boolean; onCopy: Copy; turnOn?: TurnOn }) {
  const tiers = fronting ? tierChoices(fronting) : [];
  // done, and the page hasn't heard yet that the mode changed: say so rather than offer Turn on again
  const run = turnOn?.state ?? null;
  const done = turnOnPhase(run) === 'done' ? tiers.find((t) => t.trust === run!.trust) : undefined;
  if (done && fronting) return <TurnedOn url={run!.job?.dashboardUrl ?? done.dashboardUrl ?? fronting.dashboardUrl} appUrl={run!.job?.appUrl ?? done.url} trustChanged={!!run!.job?.trustChanged} />;
  if (tiers.length)
    return (
      <div className="hw-domains-actions hw-domains-actions--tiers">
        <TierList tiers={tiers} macos={!!macos} onCopy={onCopy} turnOn={turnOn} />
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

/** One line under the title: what local domains give. An older daemon (no tiers) gets the fuller story. */
function pitch(f: FrontingInfo): React.ReactNode {
  if (tierChoices(f).length) return 'Open this dashboard and your apps by name, instead of by port.';
  return (
    <>
      Reach this dashboard at <code>{f.dashboardUrl}</code> and each app at <code>{f.appUrl}</code> instead of a port number. It takes one run of{' '}
      <code>hallway setup</code> in a terminal; <code>hallway teardown</code> undoes it.
    </>
  );
}

/** The panel on the page, in direct mode until it's dismissed. */
export function LocalDomainsPanel({ fronting, macos, onCopy, onDismiss, turnOn }: { fronting: FrontingInfo; macos: boolean; onCopy: Copy; onDismiss(): Promise<void>; turnOn?: TurnOn }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="hw-domains" aria-labelledby="hw-domains-title">
      <DomainsHead id="hw-domains-title" title="Local domains" sub={pitch(fronting)}>
        <button
          type="button"
          className="hw-btn hw-btn--quiet hw-btn--small"
          disabled={busy || turnOnPhase(turnOn?.state ?? null) === 'running'}
          onClick={async () => {
            setBusy(true);
            await onDismiss();
            setBusy(false);
          }}
          title="Hide this. The Local domains button at the top brings it back."
        >
          Not now
        </button>
      </DomainsHead>
      <SetupActions fronting={fronting} macos={macos} onCopy={onCopy} turnOn={turnOn} />
    </section>
  );
}

/** Fronted mode on Caddy's own port (D71): which port, and the way back to 443 once nothing else holds it, one click
 *  for the two tiers the daemon can run setup for, a command for System-wide certificate. */
function PortBack({ fronting, port, macos, turnOn, onCopy }: { fronting: FrontingInfo; port: number; macos: boolean; turnOn?: TurnOn; onCopy: Copy }) {
  const trust = fronting.trust!;
  const tier = tierChoices(fronting).find((t) => t.trust === trust);
  const run = turnOn?.state ?? null;
  const command = `hallway setup --trust ${trust} --port ${port}`;
  const mine = run && run.trust === trust && run.port === port && turnOnPhase(run) !== 'done' ? run : null;
  if (mine && tier) return <RunStatus run={mine} tier={{ ...tier, command }} macos={macos} onCopy={onCopy} onReset={turnOn!.reset} onStart={(p) => turnOn!.start(trust as 'user' | 'none', p)} noAlt />;
  const current = /:(\d+)$/.exec(hostOfUrl(fronting.dashboardUrl))?.[1];
  return (
    <div className="hw-ports-back">
      <span>
        Links carry Caddy’s own port{current ? `, :${current}` : ''}, as chosen with <code>--port</code>, and nothing is on {port}. Once nothing else holds {port}, links can move back to it.
      </span>
      {trust !== 'system' && turnOn ? (
        <button type="button" className="hw-btn hw-btn--small" onClick={() => turnOn.start(trust as 'user' | 'none', port)}>
          Move to port {port}
        </button>
      ) : (
        <Cmd command={command} onCopy={onCopy} />
      )}
    </div>
  );
}

/** Setup's errors start lower case (they follow `hallway: ` in a terminal); on the page they're sentences. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  // on Caddy's own port by choice (D71): the way back (doctor's line below says whether the port is free yet)
  const back = on && fronting.standardPort ? fronting.standardPort : null;
  const shown = (result?.checks ?? []).filter((c) => c.status !== 'skip');
  const tierName = fronting.trust ? (tierChoices(fronting).find((t) => t.trust === fronting.trust)?.name ?? TIER_LABEL[fronting.trust]) : null;
  // turned on from this page a moment ago: say so, with the way to the new address
  const justOn = on && turnOnPhase(turnOn?.state ?? null) === 'done';
  return (
    <div className="hw-help-wrap" onClick={onClose}>
      <div className="hw-help hw-domains-dialog" role="dialog" aria-modal="true" aria-labelledby="hw-domains-dialog-title" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <DomainsHead id="hw-domains-dialog-title" title="Local domains" sub={on ? `On${tierName ? `, ${tierName}` : ''}` : pitch(fronting)}>
          <button type="button" className="hw-icon-btn" onClick={onClose} aria-label="Close (Esc)">
            <CloseIcon />
          </button>
        </DomainsHead>
        {on ? (
          <>
            {justOn ? (
              <TurnedOn url={fronting.dashboardUrl} appUrl={fronting.appUrl} trustChanged={!!turnOn?.state?.job?.trustChanged} />
            ) : (
              <p className="hw-domains-text">
                This dashboard is at{' '}
                <a className="hw-link" href={fronting.dashboardUrl}>
                  {hostOfUrl(fronting.dashboardUrl)}
                </a>{' '}
                and each app at <code>{fronting.appUrl}</code> (<code>mode: fronted</code>).
              </p>
            )}
            <p className={`hw-domains-sum hw-domains-sum--${sum.tone}`} role="status">
              <span className={`hw-domains-dot hw-domains-dot--${sum.tone}`} aria-hidden="true" />
              {sum.tone === 'checking' ? 'Running hallway doctor’s checks…' : sum.text}
              {result?.checkedAt && <span className="hw-domains-when"> · checked {new Date(result.checkedAt).toLocaleTimeString()}</span>}
              <button type="button" className="hw-btn hw-btn--quiet hw-domains-recheck" onClick={onRecheck} disabled={sum.tone === 'checking'}>
                Check again
              </button>
            </p>
            {back && fronting.trust && <PortBack fronting={fronting} port={back} macos={macos} turnOn={turnOn} onCopy={onCopy} />}
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
