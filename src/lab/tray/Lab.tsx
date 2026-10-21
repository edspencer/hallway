// Design exploration only (tray-clarity branch): `?tray=a…d` swaps the observed tray for one of four treatments of the
// grouped tray (D72), over whatever the daemon really found. `&bare=1` hides the switcher. Nothing here is shipped.
import { useMemo, useState } from 'react';
import type { ObservedListener } from '../../../shared/api';
import { machineWord, trayGroups } from '../../lib/tray';
import { VariantA } from './VariantA';
import { VariantB } from './VariantB';
import { VariantC } from './VariantC';
import { VariantD } from './VariantD';
import './lab.css';

export const TRAY_VARIANTS = [
  { id: 'a', name: 'Grouped list' },
  { id: 'b', name: 'Source list' },
  { id: 'c', name: 'Shelves' },
  { id: 'd', name: 'Digest' },
] as const;
export type TrayVariant = (typeof TRAY_VARIANTS)[number]['id'];

const params = () => new URLSearchParams(window.location.search);

export function trayVariant(): TrayVariant | null {
  const v = params().get('tray');
  return TRAY_VARIANTS.some((x) => x.id === v) ? (v as TrayVariant) : null;
}

export interface TrayLabProps {
  initial: TrayVariant;
  observed: ObservedListener[];
  platform: string | null;
  home: string | null;
  takenSlugs: Set<string>;
  notify(text: string, tone?: 'ok' | 'error'): void;
}

export function TrayLab(p: TrayLabProps) {
  const [v, setV] = useState<TrayVariant>(p.initial);
  const groups = useMemo(() => trayGroups(p.observed, p.platform), [p.observed, p.platform]);
  const machine = machineWord(p.platform);
  const pages = p.observed.filter((o) => o.answer.kind === 'page').length;
  const props = { observed: p.observed, groups, home: p.home, machine, takenSlugs: p.takenSlugs, notify: p.notify };
  const pick = (id: TrayVariant) => {
    setV(id);
    const u = new URL(window.location.href);
    u.searchParams.set('tray', id);
    window.history.replaceState(null, '', u);
  };
  return (
    <section className={`hw-section lt lt--${v}`} aria-labelledby="lt-title">
      <header className="hw-section-head">
        <h2 id="lt-title" className="hw-sign">
          Found running <span className="hw-sign-dash">—</span> not yet named
        </h2>
        <span className="hw-section-count">{p.observed.length}</span>
        <span className="lt-head-pages">
          {pages} web page{pages === 1 ? '' : 's'}
        </span>
      </header>
      {v === 'a' && <VariantA {...props} />}
      {v === 'b' && <VariantB {...props} />}
      {v === 'c' && <VariantC {...props} />}
      {v === 'd' && <VariantD {...props} />}
      {params().get('bare') !== '1' && (
        <div className="lt-switch" role="group" aria-label="Tray treatment (design lab)">
          <span className="lt-switch-label">Tray lab</span>
          {TRAY_VARIANTS.map((x) => (
            <button key={x.id} type="button" className={x.id === v ? 'is-on' : ''} onClick={() => pick(x.id)}>
              {x.id.toUpperCase()} <span>{x.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
