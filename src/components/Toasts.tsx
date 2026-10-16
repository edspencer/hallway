import { useCallback, useMemo, useRef, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = next.current++;
    setItems((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 2800);
  }, []);
  return useMemo(() => ({ items, push }), [items, push]);
}

export function Toasts({ items }: { items: Toast[] }) {
  return (
    <div className="hw-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`hw-toast hw-toast--${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
