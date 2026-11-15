// Design exploration only (icon-cards-lab branch): `?cards=a|b|c` swaps the door cards for one of three icon-first
// treatments, over whatever the daemon really has. No `cards` parameter: today's doors (the "before"). `&bare=1`
// hides the switcher. Nothing here is shipped.
import { useState } from 'react';
import type { AppView } from '../../../shared/api';
import { CardA, CardB, CardC } from './Variants';
import './lab.css';

export const CARD_VARIANTS = [
  { id: 'a', name: 'Launcher' },
  { id: 'b', name: 'Row' },
  { id: 'c', name: 'Poster' },
] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number]['id'];

const params = () => new URLSearchParams(window.location.search);

export function cardsVariant(): CardVariant | null {
  const v = params().get('cards');
  return CARD_VARIANTS.some((x) => x.id === v) ? (v as CardVariant) : null;
}

export function CardsLab({ initial, apps, checking, onCopy, onDetails }: { initial: CardVariant; apps: AppView[]; checking: boolean; onCopy(url: string, what: string): void; onDetails(slug: string): void }) {
  const [v, setV] = useState<CardVariant>(initial);
  const pick = (id: CardVariant) => {
    setV(id);
    const u = new URL(window.location.href);
    u.searchParams.set('cards', id);
    window.history.replaceState(null, '', u);
  };
  const Card = v === 'a' ? CardA : v === 'b' ? CardB : CardC;
  return (
    <>
      <div className={`lc-grid lc-grid--${v}`} data-lab-cards={v}>
        {apps.map((a) => (
          <Card key={a.slug} app={a} checking={checking} onCopy={onCopy} onDetails={onDetails} />
        ))}
      </div>
      {params().get('bare') !== '1' && (
        <div className="lc-switch" role="group" aria-label="Card treatment (design lab)">
          <span className="lc-switch-label">Cards lab</span>
          {CARD_VARIANTS.map((x) => (
            <button key={x.id} type="button" className={x.id === v ? 'is-on' : ''} onClick={() => pick(x.id)}>
              {x.id.toUpperCase()} <span>{x.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
