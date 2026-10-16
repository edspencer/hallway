// An app card: a door (docs/05-ui.md, "App card" and "Visual direction"). The favicon tile is the door's paint, the
// port its number plate, and the state shows in the door itself (ajar with light, closed, boarded up) as well as in
// the shape-and-word indicator, which is what anyone not noticing the metaphor reads. The whole card opens the app;
// the copy and details buttons sit above that link.
import type { CSSProperties } from 'react';
import type { AppView } from '../../shared/api';
import { thumbUrl } from '../api';
import { paintFor } from '../lib/colour';
import { displayUrl, millis, percent } from '../lib/format';
import { STATE_META, doorState, subtitle } from '../lib/status';
import { StateMark } from './StateMark';
import { Tile, isGlyph, useImageColour } from './Tile';
import { UptimeBar } from './UptimeBar';
import { CopyIcon, MoreIcon } from './icons';

export interface DoorProps {
  app: AppView;
  /** Is anything checking health? Without a prober every door is closed and "not checked", not in shadow. */
  checking: boolean;
  onCopy(url: string, what: string): void;
  onDetails(slug: string): void;
}

/**
 * The uptime bar sits above the card's link so its bars can be hovered; a click on it still opens the app, as a click
 * anywhere else on the door does (with the same modifier keys, so ⌘-click is still a new tab).
 */
function passThrough(e: React.MouseEvent) {
  const link = (e.currentTarget as HTMLElement).closest('.hw-door')?.querySelector<HTMLElement>('.hw-door-link');
  link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, button: e.button }));
}

export function Door({ app, checking, onCopy, onDetails }: DoorProps) {
  const state = doorState(app);
  const thumb = app.thumb ? thumbUrl(app.slug, app.thumb) : null;
  // a favicon is drawn small on the door; a screenshot is its glass; a generated card is the whole door (D55)
  const kind = thumb ? (app.thumbKind ?? 'favicon') : null;
  const colour = useImageColour(kind === 'card' ? null : thumb);
  const error = app.problems.find((p) => p.severity === 'error');
  const warnings = app.problems.filter((p) => p.severity === 'warning').length;
  const port = app.config?.port ?? null;
  const sub = subtitle(app);
  const unchecked = !checking && state === 'unknown';
  const h = app.health;
  const stats = [h.uptime24h !== null ? percent(h.uptime24h) : null, h.latencyP50 !== null ? millis(h.latencyP50) : h.latencyMs !== null ? millis(h.latencyMs) : null].filter(Boolean).join(' · ');
  const expected = app.config?.expected;
  const id = app.identity;
  const glyph = isGlyph(app.config?.icon) ? app.config!.icon : null;
  const style = { '--paint': paintFor(app.slug, colour) } as CSSProperties;
  const label = `${app.name}${sub ? `, ${sub}` : ''}: ${unchecked ? 'not checked' : STATE_META[state].label}${app.url ? `, ${displayUrl(app.url)}` : ''}`;

  return (
    <article className={`hw-door hw-door--${unchecked ? 'unchecked' : state}${app.url ? '' : ' hw-door--nourl'}${kind && kind !== 'favicon' ? ` hw-door--${kind}` : ''}`} style={style} data-slug={app.slug}>
      {app.url ? (
        <a className="hw-door-link" href={app.url} data-nav="door" data-url={app.url} data-slug={app.slug} aria-label={label} title={STATE_META[state].says} />
      ) : (
        <button type="button" className="hw-door-link" data-nav="door" data-slug={app.slug} aria-label={`${label}. Its file has an error: show details`} onClick={() => onDetails(app.slug)} />
      )}
      <div className="hw-door-panel" aria-hidden="true">
        <span className="hw-door-panes" />
        <span className="hw-door-light" />
        <span className="hw-door-boards" />
        {kind === 'screenshot' || kind === 'card' ? (
          <img className={kind === 'card' ? 'hw-door-card' : 'hw-door-glass'} src={thumb!} alt="" decoding="async" />
        ) : (
          <Tile name={app.name} src={thumb} glyph={glyph} className="hw-door-tile" />
        )}
        <span className="hw-plate hw-door-plate">{port ?? '—'}</span>
        <span className="hw-door-knob" />
      </div>
      <div className="hw-door-body">
        <h3 className="hw-door-name" title={app.name}>
          {app.name}
        </h3>
        {sub && (
          <div className={`hw-door-sub${id?.label ? ' hw-door-sub--label' : ''}`} title={sub}>
            {sub}
          </div>
        )}
        <div className="hw-door-addr">
          <span className="hw-door-url">{app.url ? displayUrl(app.url) : 'no address yet'}</span>
          {app.url && (
            <button type="button" className="hw-icon-btn hw-door-copy" onClick={() => onCopy(app.url!, app.name)} aria-label={`Copy ${displayUrl(app.url)}`} title="Copy the address (c)">
              <CopyIcon />
            </button>
          )}
          {/* fronted mode: the hostname is the address; the port is the way round the proxy */}
          {app.url && app.directUrl && app.directUrl !== app.url && (
            <a className="hw-door-direct" href={app.directUrl} aria-label={`${app.name} on ${displayUrl(app.directUrl)}, not through the proxy`} title={`Straight to the app, not through the proxy: ${displayUrl(app.directUrl)}`}>
              :{port}
            </a>
          )}
        </div>
        <UptimeBar history={app.history} label={`${app.name}, last 24 hours`} onClick={passThrough} />
        <div className="hw-door-foot">
          <StateMark state={state} label={unchecked ? 'not checked' : undefined} />
          <span className="hw-door-stats">{stats || (expected && expected !== 'running' && expected !== state ? expected : '')}</span>
        </div>
        {error && (
          <p className="hw-door-error" role="note">
            <span className="hw-door-error-where">
              {error.file}
              {error.line ? `:${error.line}` : ''}
            </span>{' '}
            {error.message}
            {app.config ? <span className="hw-door-error-note"> Showing the last good version.</span> : null}
          </p>
        )}
        <Badges app={app} warnings={warnings} />
      </div>
      <button type="button" className="hw-icon-btn hw-door-more" onClick={() => onDetails(app.slug)} aria-label={`Details for ${app.name}`} title="Details (i)">
        <MoreIcon />
      </button>
    </article>
  );
}

function Badges({ app, warnings }: { app: AppView; warnings: number }) {
  const id = app.identity;
  const out: { key: string; text: string; tone?: 'warn' | 'alarm'; title: string }[] = [];
  // an error is shown in full on the card; warnings get a badge
  if (warnings && !app.problems.some((p) => p.severity === 'error')) out.push({ key: 'warn', text: `${warnings} warning${warnings === 1 ? '' : 's'}`, tone: 'warn', title: app.problems.map((p) => p.message).join('\n') });
  if (id?.orphaned && !app.managed) out.push({ key: 'orphaned', text: 'orphaned', title: 'The session that started it has gone (its parent is PID 1)' });
  if (id?.exposed) out.push({ key: 'exposed', text: 'exposed', tone: 'warn', title: `Listening on every interface (${id.bindAddress ?? '0.0.0.0'}), not just this machine` });
  if (app.managed) out.push({ key: 'managed', text: 'managed', title: 'Kept running by Hallway as a service' });
  if (app.source === 'discovered') out.push({ key: 'source', text: `discovered: ${app.adapter ?? 'adapter'}`, title: 'Read from another tool; edit it there' });
  if (!out.length) return null;
  return (
    <ul className="hw-badges" aria-label="Notes">
      {out.map((b) => (
        <li key={b.key} className={`hw-badge${b.tone ? ` hw-badge--${b.tone}` : ''}`} title={b.title}>
          {b.text}
        </li>
      ))}
    </ul>
  );
}
