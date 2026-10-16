import { useEffect, useRef } from 'react';
import { CloseIcon } from './icons';

const KEYS: [string[], string][] = [
  [['/'], 'Filter by name, port, directory, branch or bookmark'],
  [['↑', '↓', '←', '→'], 'Move between doors and bookmarks'],
  [['Enter'], 'Open (with one filter match: open that)'],
  [['⌘', 'Enter'], 'Open in a new tab (Ctrl-Enter elsewhere)'],
  [['c'], 'Copy the address'],
  [['i'], 'Details'],
  [['Esc'], 'Close, or clear the filter'],
  [['?'], 'This list'],
];

export function Help({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => before?.focus?.();
  }, []);
  return (
    <div className="hw-help-wrap" onClick={onClose}>
      <div className="hw-help" role="dialog" aria-modal="true" aria-labelledby="hw-help-title" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="hw-help-title">Keyboard</h2>
          <button type="button" className="hw-icon-btn" onClick={onClose} aria-label="Close (Esc)">
            <CloseIcon />
          </button>
        </header>
        <dl>
          {KEYS.map(([keys, what]) => (
            <div key={what}>
              <dt>
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="hw-help-foot">
          Theme: <code>dashboard.theme</code> in <code>config.yaml</code> (auto, dark or light).
        </p>
      </div>
    </div>
  );
}
