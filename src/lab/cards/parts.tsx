// Design exploration only (icon-cards-lab branch): what every variant of the icon-first app card shares. The same
// facts Door.tsx works out (state, the picture and its kind, the brand match, the paint, the address, the stats), and
// one AppIcon that draws the app's identity as the protagonist: a favicon at full size, a brand mark or a monogram as a
// proper app icon in the app's own colour, a generated card or screenshot as a picture. Nothing here is shipped.
import { useEffect, useState, type CSSProperties } from 'react';
import type { AppView } from '../../../shared/api';
import { thumbUrl } from '../../api';
import { matchBrand, type BrandEntry } from '../../lib/brands';
import { monogram, paintFor } from '../../lib/colour';
import { displayUrl, millis, percent } from '../../lib/format';
import { STATE_META, doorState, subtitle, type DoorState } from '../../lib/status';
import { isGlyph, useImageColour } from '../../components/Tile';

export type CardState = DoorState | 'unchecked';

export interface CardModel {
  app: AppView;
  state: DoorState;
  /** what the card shows: the state, or `unchecked` when nothing is checking health */
  look: CardState;
  word: string;
  thumb: string | null;
  kind: 'favicon' | 'screenshot' | 'card' | null;
  brand: BrandEntry | null;
  glyph: string | null;
  colour: string | null;
  style: CSSProperties;
  sub: string | null;
  stats: string;
  port: number | null;
  error: AppView['problems'][number] | undefined;
  warnings: number;
  label: string;
}

export function useCardModel(app: AppView, checking: boolean): CardModel {
  const state = doorState(app);
  const thumb = app.thumb ? thumbUrl(app.slug, app.thumb) : null;
  const kind = thumb ? (app.thumbKind ?? 'favicon') : null;
  const id = app.identity;
  const brand = thumb
    ? null
    : matchBrand({ icon: app.config?.icon ?? null, process: id?.process ?? null, command: id?.command ?? null, supervisorLabel: id?.supervisor?.label ?? null, name: app.name, slug: app.slug, port: app.config?.port ?? null });
  const colour = useImageColour(kind === 'favicon' ? thumb : null) ?? brand?.hex ?? null;
  const unchecked = !checking && state === 'unknown';
  const h = app.health;
  const expected = app.config?.expected;
  const stats =
    [h.uptime24h !== null ? percent(h.uptime24h) : null, h.latencyP50 !== null ? millis(h.latencyP50) : h.latencyMs !== null ? millis(h.latencyMs) : null].filter(Boolean).join(' · ') ||
    (expected && expected !== 'running' && expected !== state ? expected : '');
  const sub = subtitle(app);
  const word = unchecked ? 'not checked' : STATE_META[state].label;
  return {
    app,
    state,
    look: unchecked ? 'unchecked' : state,
    word,
    thumb,
    kind,
    brand,
    glyph: isGlyph(app.config?.icon) ? app.config!.icon! : null,
    colour,
    // --paint: the muted door paint (as today); --hue: the icon's own colour, unmuted, for plates and fields
    style: { '--paint': paintFor(app.slug, colour), '--hue': colour ?? paintFor(app.slug, null) } as CSSProperties,
    sub,
    stats,
    port: app.config?.port ?? null,
    error: app.problems.find((p) => p.severity === 'error'),
    warnings: app.problems.filter((p) => p.severity === 'warning').length,
    label: `${app.name}${sub ? `, ${sub}` : ''}: ${word}${app.url ? `, ${displayUrl(app.url)}` : ''}`,
  };
}

/**
 * The app's identity, drawn large. A favicon is shown as itself (it usually carries its own shape and background); a
 * brand mark, glyph or monogram gets a filled app-icon plate in the app's colour, so an app with no favicon still
 * looks like an app rather than a placeholder. Card and screenshot kinds are pictures and are drawn by the variant.
 */
export function AppIcon({ m, className = '' }: { m: CardModel; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [m.thumb]);
  const src = m.kind === 'favicon' && !broken ? m.thumb : null;
  const what = src ? 'img' : m.brand ? 'brand' : m.glyph ? 'glyph' : 'mono';
  return (
    <span className={`lc-icon lc-icon--${what} ${className}`} aria-hidden="true">
      {src ? (
        <img src={src} alt="" decoding="async" onError={() => setBroken(true)} />
      ) : m.brand ? (
        <svg viewBox="0 0 24 24">
          <path d={m.brand.path} />
        </svg>
      ) : m.glyph ? (
        <span className="lc-icon-glyph">{m.glyph}</span>
      ) : (
        <span className="lc-icon-mono">{monogram(m.app.name)}</span>
      )}
    </span>
  );
}

/** The click-through that makes the whole card the app's link (or, with no address, the details). */
export function CardLink({ m, onDetails, className }: { m: CardModel; onDetails(slug: string): void; className: string }) {
  const { app } = m;
  return app.url ? (
    <a className={className} href={app.url} data-nav="door" data-url={app.url} data-slug={app.slug} aria-label={m.label} title={STATE_META[m.state].says} />
  ) : (
    <button type="button" className={className} data-nav="door" data-slug={app.slug} aria-label={`${m.label}. Its file has an error: show details`} onClick={() => onDetails(app.slug)} />
  );
}

/** A click on the uptime bar opens the app, as a click anywhere else on the card does. */
export function passThrough(e: React.MouseEvent) {
  const link = (e.currentTarget as HTMLElement).closest('.lc-card')?.querySelector<HTMLElement>('.lc-link');
  link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, button: e.button }));
}

export function CardError({ m }: { m: CardModel }) {
  const e = m.error;
  if (!e) return null;
  return (
    <p className="hw-door-error lc-error" role="note">
      <span className="hw-door-error-where">
        {e.file}
        {e.line ? `:${e.line}` : ''}
      </span>{' '}
      {e.message}
      {m.app.config ? <span className="hw-door-error-note"> Showing the last good version.</span> : null}
    </p>
  );
}

/** Variant B's state glyph: a door 10 px wide, ajar with light, closed, boarded or drawn as an outline. */
export function DoorGlyph({ look }: { look: CardState }) {
  return (
    <span className={`lc-dg lc-dg--${look}`} aria-hidden="true">
      <span className="lc-dg-leaf" />
      <span className="lc-dg-light" />
    </span>
  );
}
