// Keyboard-first (docs/05-ui.md, "Keyboard"): `/` filter, arrows between doors and chips, Enter opens (the links do
// that natively, ⌘/Ctrl-Enter in a new tab), `c` copies the focused item's address, `i` opens its details, Esc backs
// out one level, `?` shows the shortcuts. Arrow keys move spatially, to the nearest item in that direction, so they
// work the same across the door grid, the observed rows and the bookmark chips.
import { useEffect } from 'react';

export interface KeyboardActions {
  focusFilter(): void;
  /** Esc: close the topmost thing; false when there was nothing to close. */
  escape(): boolean;
  toggleHelp(): void;
  copy(url: string): void;
  details(slug: string): void;
  /** Is a modal layer (drawer, help) open? Arrows and letters then belong to it. */
  modal(): boolean;
}

const NAV = '[data-nav]';

function navItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(NAV)].filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

/** The nearest item from `from` in a direction, by distance along it plus a penalty for drifting across it. */
export function nearest(from: DOMRect, cands: { el: HTMLElement; r: DOMRect }[], dir: 'up' | 'down' | 'left' | 'right') {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: { el: HTMLElement; score: number } | null = null;
  for (const { el, r } of cands) {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let along: number;
    let across: number;
    if (dir === 'right') [along, across] = [r.left - from.right, Math.abs(y - cy)];
    else if (dir === 'left') [along, across] = [from.left - r.right, Math.abs(y - cy)];
    else if (dir === 'down') [along, across] = [r.top - from.bottom, Math.abs(x - cx)];
    else [along, across] = [from.top - r.bottom, Math.abs(x - cx)];
    if (along < -2) continue;
    // sideways moves stay in the row; vertical ones may drift to the nearest column
    const rowLimit = dir === 'left' || dir === 'right' ? Math.max(from.height, r.height) / 2 : Infinity;
    if (across > rowLimit) continue;
    const score = along + across * (dir === 'left' || dir === 'right' ? 4 : 1.5);
    if (!best || score < best.score) best = { el, score };
  }
  return best?.el ?? null;
}

const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function useKeyboard(a: KeyboardActions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (e.key === 'Escape') {
        if (a.escape()) e.preventDefault();
        else if (target && target !== document.body) target.blur();
        return;
      }
      if (editable(target)) return;
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === '?') {
        e.preventDefault();
        return a.toggleHelp();
      }
      if (a.modal()) return;
      if (e.key === '/') {
        e.preventDefault();
        return a.focusFilter();
      }
      const item = target?.closest<HTMLElement>(NAV) ?? null;
      if (e.key === 'c' && item?.dataset.url) {
        e.preventDefault();
        return a.copy(item.dataset.url);
      }
      if (e.key === 'i' && item?.dataset.slug) {
        e.preventDefault();
        return a.details(item.dataset.slug);
      }
      const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'];
      if (!dir) return;
      const items = navItems();
      if (!items.length) return;
      e.preventDefault();
      if (!item) return items[0]!.focus();
      const from = item.getBoundingClientRect();
      const next = nearest(
        from,
        items.filter((el) => el !== item).map((el) => ({ el, r: el.getBoundingClientRect() })),
        dir,
      );
      if (next) {
        next.focus();
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [a]);
}

/** Focus the first item in the page (the filter's ArrowDown). */
export function focusFirstItem() {
  navItems()[0]?.focus();
}
