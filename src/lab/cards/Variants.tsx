// Design exploration only (icon-cards-lab): three icon-first app cards. A: launcher tile, no door at all. B: a row
// with the door kept as a 10 px state glyph. C: a poster whose colour field is the icon's, the door surviving only as
// the arch of its top edge. Nothing here is shipped.
import type { AppView } from '../../../shared/api';
import { Badges } from '../../components/Door';
import { StateMark } from '../../components/StateMark';
import { UptimeBar } from '../../components/UptimeBar';
import { CopyIcon, MoreIcon } from '../../components/icons';
import { displayUrl } from '../../lib/format';
import { AppIcon, CardError, CardLink, DoorGlyph, passThrough, useCardModel, type CardModel } from './parts';

export interface CardProps {
  app: AppView;
  checking: boolean;
  onCopy(url: string, what: string): void;
  onDetails(slug: string): void;
}

const cls = (m: CardModel, v: string) =>
  `lc-card lc-${v} lc--${m.look}${m.app.url ? '' : ' lc--nourl'}${m.kind && m.kind !== 'favicon' ? ` lc--pic lc--${m.kind}` : ''}`;

function Address({ m, onCopy, center }: { m: CardModel; onCopy: CardProps['onCopy']; center?: boolean }) {
  const { app } = m;
  return (
    <div className={`lc-addr${center ? ' lc-addr--center' : ''}`}>
      <span className="lc-url">{app.url ? displayUrl(app.url) : 'no address yet'}</span>
      {app.url && (
        <button type="button" className="hw-icon-btn lc-copy" onClick={() => onCopy(app.url!, app.name)} aria-label={`Copy ${displayUrl(app.url)}`} title="Copy the address (c)">
          <CopyIcon />
        </button>
      )}
    </div>
  );
}

function More({ m, onDetails }: { m: CardModel; onDetails: CardProps['onDetails'] }) {
  return (
    <button type="button" className="hw-icon-btn lc-more" onClick={() => onDetails(m.app.slug)} aria-label={`Details for ${m.app.name}`} title="Details (i)">
      <MoreIcon />
    </button>
  );
}

/** The picture kinds (a generated card, a screenshot) fill the variant's picture slot instead of the icon. */
function Picture({ m, className }: { m: CardModel; className: string }) {
  return <img className={className} src={m.thumb!} alt="" decoding="async" />;
}

/* A — Launcher. The icon at 64 px on a faint wash of its own colour, a presence dot on its corner; everything else
   centred underneath. No door anywhere. */
export function CardA({ app, checking, onCopy, onDetails }: CardProps) {
  const m = useCardModel(app, checking);
  const pic = m.kind === 'card' || m.kind === 'screenshot';
  return (
    <article className={cls(m, 'a')} style={m.style} data-slug={app.slug} data-variant="a">
      <CardLink m={m} onDetails={onDetails} className="lc-link" />
      <div className="lc-a-stage" aria-hidden="true">
        {pic ? <Picture m={m} className="lc-a-pic" /> : <AppIcon m={m} className="lc-a-icon" />}
        <span className="lc-dot" />
      </div>
      <h3 className="lc-name" title={app.name}>
        {app.name}
      </h3>
      {m.sub && (
        <div className="lc-sub" title={m.sub}>
          {m.sub}
        </div>
      )}
      <Address m={m} onCopy={onCopy} center />
      <UptimeBar history={app.history} label={`${app.name}, last 24 hours`} onClick={passThrough} />
      <div className="lc-foot">
        <StateMark state={m.state} label={m.look === 'unchecked' ? 'not checked' : undefined} />
        <span className="lc-stats">{m.stats}</span>
      </div>
      <CardError m={m} />
      <Badges app={app} warnings={m.warnings} />
      <More m={m} onDetails={onDetails} />
    </article>
  );
}

/* B — Row. Icon left at 56 px, name and address beside it, the state top right as a word with a 10 px door for its
   shape (the trace of the metaphor); uptime along the bottom. Wider, so more fit per screen. */
export function CardB({ app, checking, onCopy, onDetails }: CardProps) {
  const m = useCardModel(app, checking);
  const pic = m.kind === 'card' || m.kind === 'screenshot';
  return (
    <article className={cls(m, 'b')} style={m.style} data-slug={app.slug} data-variant="b">
      <CardLink m={m} onDetails={onDetails} className="lc-link" />
      <div className="lc-b-top">
        {pic ? <Picture m={m} className="lc-b-pic" /> : <AppIcon m={m} className="lc-b-icon" />}
        <div className="lc-b-text">
          <div className="lc-b-head">
            <h3 className="lc-name" title={app.name}>
              {app.name}
            </h3>
            <span className={`lc-b-state hw-state hw-state--${m.state}`}>
              <DoorGlyph look={m.look} />
              <span className="hw-state-word">{m.word}</span>
            </span>
          </div>
          {m.sub && (
            <div className="lc-sub" title={m.sub}>
              {m.sub}
            </div>
          )}
          <Address m={m} onCopy={onCopy} />
        </div>
      </div>
      <div className="lc-b-bar">
        <UptimeBar history={app.history} label={`${app.name}, last 24 hours`} onClick={passThrough} />
        <span className="lc-stats">{m.stats}</span>
        <More m={m} onDetails={onDetails} />
      </div>
      <CardError m={m} />
      <Badges app={app} warnings={m.warnings} />
    </article>
  );
}

/* C — Poster. The top half is a field of the icon's own colour with the icon large in it (and a blurred copy of the
   favicon behind it as texture); the field's top edge is arched, the only door left. The state is a pill on the
   field. */
export function CardC({ app, checking, onCopy, onDetails }: CardProps) {
  const m = useCardModel(app, checking);
  const pic = m.kind === 'card' || m.kind === 'screenshot';
  return (
    <article className={cls(m, 'c')} style={m.style} data-slug={app.slug} data-variant="c">
      <CardLink m={m} onDetails={onDetails} className="lc-link" />
      <div className="lc-c-field" aria-hidden="true">
        {pic ? (
          <Picture m={m} className="lc-c-pic" />
        ) : (
          <>
            {m.kind === 'favicon' && <img className="lc-c-blur" src={m.thumb!} alt="" decoding="async" />}
            <AppIcon m={m} className="lc-c-icon" />
          </>
        )}
      </div>
      <span className={`lc-c-pill hw-state hw-state--${m.state}`}>
        <span className="hw-state-mark" aria-hidden="true">
          {{ healthy: '●', unhealthy: '▲', down: '■', stopped: '○', unknown: '◌', starting: '◐' }[m.state]}
        </span>
        <span className="hw-state-word">{m.word}</span>
      </span>
      <div className="lc-c-body">
        <h3 className="lc-name" title={app.name}>
          {app.name}
        </h3>
        {m.sub && (
          <div className="lc-sub" title={m.sub}>
            {m.sub}
          </div>
        )}
        <Address m={m} onCopy={onCopy} />
        <UptimeBar history={app.history} label={`${app.name}, last 24 hours`} onClick={passThrough} />
        <div className="lc-foot lc-foot--end">
          <span className="lc-stats">{m.stats}</span>
        </div>
        <CardError m={m} />
        <Badges app={app} warnings={m.warnings} />
      </div>
      <More m={m} onDetails={onDetails} />
    </article>
  );
}
