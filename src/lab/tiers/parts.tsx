// Design exploration only: pieces the variants share (a command to copy, the lock-and-URL, the status of a run).
import type { Trust } from '../../../shared/api';
import { CopyIcon } from '../../components/icons';
import { type LabRun, failedWords, runningWords, tierOf } from './model';

const svg = (d: React.ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {d}
  </svg>
);

export const LockIcon = ({ open = false, size = 16 }: { open?: boolean; size?: number }) =>
  svg(
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d={open ? 'M5.5 7V5a2.5 2.5 0 0 1 4.9-.7' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'} />
    </>,
    size,
  );
export const CheckIcon = ({ size = 16 }: { size?: number }) => svg(<path d="M3.5 8.4l3 3 6-6.6" />, size);
export const TerminalIcon = () =>
  svg(
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.8" />
      <path d="M5 6.5l2 1.5-2 1.5M8.5 10H11" />
    </>,
  );
/** Touch ID's fingerprint, drawn in the same line style as the rest. */
export const FingerprintIcon = ({ size = 16 }: { size?: number }) =>
  svg(
    <>
      <path d="M4.2 3.6A5.3 5.3 0 0 1 13.3 7.5v1" />
      <path d="M2.7 6.2a5.3 5.3 0 0 0-.1 1.3v1.6" />
      <path d="M5 13.2c.6-1 .9-2.3.9-3.7V7.6a2.1 2.1 0 0 1 4.2 0v1.9" />
      <path d="M8 7.8v1.7c0 1.8-.5 3.4-1.3 4.6" />
      <path d="M10.1 11.6c-.2.9-.5 1.7-.9 2.4" />
      <path d="M13.2 10.6c-.1.9-.3 1.8-.6 2.6" />
    </>,
    size,
  );

/** A command, and a button to copy it. */
export function Cmd({ command, onCopy, small = false }: { command: string; onCopy(text: string, what?: string): void; small?: boolean }) {
  return (
    <span className={`tl-cmd${small ? ' tl-cmd--small' : ''}`}>
      <code>{command}</code>
      <button type="button" className="tl-cmd-copy" onClick={() => onCopy(command, 'command')} aria-label={`Copy ${command}`} title="Copy">
        <CopyIcon />
      </button>
    </span>
  );
}

/** The address an app will have: a lock (or an open one, for plain HTTP) and the URL, like a browser's address bar. */
export function AddressBar({ trust, host = 'review' }: { trust: Trust; host?: string }) {
  const https = trust !== 'none';
  return (
    <span className={`tl-address${https ? '' : ' tl-address--plain'}`}>
      <LockIcon open={!https} size={13} />
      <span>
        <span className="tl-address-scheme">{https ? 'https://' : 'http://'}</span>
        <span className="tl-address-host">{host}.localhost</span>
      </span>
    </span>
  );
}

/** A run's status, in the look a variant asks for: running, done or failed. */
export function RunStatus({ run, onCopy, onRetry, onReset, look = 'card' }: { run: LabRun; onCopy(text: string, what?: string): void; onRetry(): void; onReset(): void; look?: 'card' | 'plain' }) {
  const t = tierOf(run.trust);
  if (run.phase === 'running') {
    const w = runningWords(run.trust);
    return (
      <div className={`tl-run tl-run--running tl-run--${look}`} role="status" aria-live="polite">
        <span className="tl-run-mark tl-run-mark--wait">{run.trust === 'user' ? <FingerprintIcon size={22} /> : <span className="tl-spinner" />}</span>
        <span className="tl-run-words">
          <strong>{w.title}</strong>
          <span>{w.detail}</span>
        </span>
      </div>
    );
  }
  if (run.phase === 'done')
    return (
      <div className={`tl-run tl-run--done tl-run--${look}`} role="status" aria-live="polite">
        <span className="tl-run-mark tl-run-mark--ok">
          <CheckIcon size={18} />
        </span>
        <span className="tl-run-words">
          <strong>Local domains are on</strong>
          <span>
            This dashboard is now at <a className="hw-link" href={t.dashboardUrl}>{t.dashboardUrl.replace(/^https?:\/\//, '')}</a>, and each app at its own name, like{' '}
            <code>{t.url.replace(/^https?:\/\//, '')}</code>.
          </span>
        </span>
        <a className="hw-btn hw-btn--primary tl-run-go" href={t.dashboardUrl}>
          Open {t.dashboardUrl.replace(/^https?:\/\//, '')}
        </a>
      </div>
    );
  const w = failedWords(run.trust);
  return (
    <div className={`tl-run tl-run--failed tl-run--${look}`} role="alert">
      <span className="tl-run-mark tl-run-mark--fail">!</span>
      <span className="tl-run-words">
        <strong>{w.title}</strong>
        <span>{w.detail}</span>
        <Cmd command={t.command} onCopy={onCopy} />
        <span className="tl-run-buttons">
          <button type="button" className="hw-btn hw-btn--small" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="hw-btn hw-btn--quiet hw-btn--small" onClick={onReset}>
            Choose another way
          </button>
        </span>
      </span>
    </div>
  );
}
