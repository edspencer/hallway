// A badge with an explanation that shows on hover and on keyboard focus: the badge is focusable and described by the
// tooltip (aria-describedby), so screen readers read the explanation too. Escape hides it until the pointer or focus
// leaves (WCAG 1.4.13).
import { useId, useState } from 'react';

export function TipBadge({ text, tip, tone }: { text: string; tip: string; tone?: 'warn' | 'alarm' }) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  return (
    <span className={`hw-tip${hidden ? ' is-dismissed' : ''}`} onMouseLeave={() => setHidden(false)} onBlur={() => setHidden(false)}>
      <span
        className={`hw-badge${tone ? ` hw-badge--${tone}` : ''}`}
        tabIndex={0}
        aria-describedby={id}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !hidden) {
            e.stopPropagation();
            setHidden(true);
          }
        }}
      >
        {text}
      </span>
      <span role="tooltip" id={id} className="hw-tip-body">
        {tip}
      </span>
    </span>
  );
}
