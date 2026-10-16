// File problems, shown in place (docs/05-ui.md, "Errors"): on the card or group they concern, or as a banner for
// config.yaml, ignore.yaml and files that aren't any entity (a badly named file in apps/). Never a blank page.
import type { FileProblem } from '../../shared/api';
import { WarnIcon } from './icons';

const where = (p: FileProblem) => `${p.file}${p.line ? `:${p.line}${p.col ? `:${p.col}` : ''}` : ''}`;

export function ProblemNote({ p, lastGood }: { p: FileProblem; lastGood?: boolean }) {
  return (
    <p className={`hw-problem hw-problem--${p.severity}`} role="note">
      <WarnIcon />
      <span>
        <code className="hw-problem-where">{where(p)}</code> {p.message}
        {p.severity === 'error' && lastGood ? <span className="hw-problem-note"> Showing the last good version.</span> : null}
      </span>
    </p>
  );
}

/** Problems that belong to no card or group. */
export function ProblemBanner({ problems }: { problems: FileProblem[] }) {
  if (!problems.length) return null;
  const errors = problems.filter((p) => p.severity === 'error').length;
  return (
    <section className={`hw-banner${errors ? ' hw-banner--error' : ''}`} aria-label="Problems with Hallway's files">
      <h2 className="hw-banner-title">
        <WarnIcon />
        {errors ? `${errors} file${errors === 1 ? ' has an error' : 's have errors'}` : `${problems.length} warning${problems.length === 1 ? '' : 's'}`}
        <span className="hw-banner-sub">Everything else keeps working; fix the file and this goes away.</span>
      </h2>
      <ul>
        {problems.map((p, i) => (
          <li key={i} className={`hw-banner-item hw-banner-item--${p.severity}`}>
            <code>{where(p)}</code>
            {p.key ? <code className="hw-banner-key">{p.key}</code> : null}
            <span>{p.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
