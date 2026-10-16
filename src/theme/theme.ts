// `dashboard.theme` (auto/dark/light) → `data-theme` on <html>, following the system preference when it's `auto`.
// The choice is remembered so index.html can apply it before the next first paint.
import { useEffect } from 'react';

export type ThemePref = 'auto' | 'dark' | 'light';

export function useTheme(pref: ThemePref | undefined) {
  useEffect(() => {
    if (!pref) return;
    try {
      localStorage.setItem('hallway.theme', pref);
    } catch {
      /* private mode: just no memory */
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const light = pref === 'light' || (pref === 'auto' && mq.matches);
      document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}
