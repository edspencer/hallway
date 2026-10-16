// Bookmarks (docs/05-ui.md, "Bookmarks"): the key hooks by the front door. Favicon-led chips in labelled groups, one
// group per bookmarks/<group>.yaml. Lighter than the doors: nothing behind them is checked. Groups collapse (written
// back to the file, so it's the same everywhere), and links can be added and edited in place, through the API; the
// files stay the truth.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BookmarkGroupView, BookmarkLink } from '../../shared/api';
import { bookmarkIconUrl, createGroup, patchGroup } from '../api';
import { paintVar } from '../lib/colour';
import { SLUG, hostOf, slugify } from '../lib/format';
import { ChevronIcon, PencilIcon, PlusIcon } from './icons';
import { ProblemNote } from './Problems';
import { Tile, isGlyph } from './Tile';

export interface BookmarksProps {
  groups: BookmarkGroupView[];
  /** Which links the filter keeps, by group: undefined keeps everything. */
  visible?: Map<string, Set<number>>;
  filtering: boolean;
  iconVersion: number;
  notify(text: string, tone?: 'ok' | 'error'): void;
}

/** A link as it's written back: only the keys that differ from their defaults, so the file stays tidy. */
function tidy(l: Pick<BookmarkLink, 'title' | 'url'> & Partial<BookmarkLink>) {
  return {
    title: l.title,
    url: l.url,
    ...(l.description ? { description: l.description } : {}),
    ...(l.icon && l.icon !== 'auto' ? { icon: l.icon } : {}),
    ...(l.tags?.length ? { tags: l.tags } : {}),
  };
}

export function Bookmarks({ groups, visible, filtering, iconVersion, notify }: BookmarksProps) {
  const [adding, setAdding] = useState(false);
  const shown = filtering ? groups.filter((g) => (visible?.get(g.group)?.size ?? 0) > 0) : groups;
  return (
    <section className="hw-section hw-bookmarks" aria-labelledby="hw-bookmarks-title">
      <header className="hw-section-head">
        <h2 id="hw-bookmarks-title" className="hw-sign">
          Bookmarks
        </h2>
        {!filtering && (
          <button type="button" className="hw-btn hw-btn--quiet hw-btn--small" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <PlusIcon /> Group
          </button>
        )}
      </header>
      {adding && <NewGroup taken={new Set(groups.map((g) => g.group))} onDone={() => setAdding(false)} notify={notify} />}
      <div className="hw-hooks">
        {shown.map((g) => (
          <Group key={g.group} g={g} visible={visible?.get(g.group)} filtering={filtering} iconVersion={iconVersion} notify={notify} />
        ))}
      </div>
    </section>
  );
}

function Group({ g, visible, filtering, iconVersion, notify }: { g: BookmarkGroupView; visible?: Set<number>; filtering: boolean; iconVersion: number; notify: BookmarksProps['notify'] }) {
  const c = g.config;
  const [collapsedLocal, setCollapsedLocal] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<number | 'new' | null>(null);
  useEffect(() => setCollapsedLocal(null), [c?.collapsed]);
  const collapsed = !filtering && (collapsedLocal ?? c?.collapsed ?? false);
  const error = g.problems.find((p) => p.severity === 'error');
  const title = c?.title ?? g.group;
  const bodyId = `hw-group-${g.group}`;

  const toggle = async () => {
    const next = !collapsed;
    setCollapsedLocal(next);
    const r = await patchGroup(g.group, { collapsed: next }, g.etag);
    if (!r.ok) {
      setCollapsedLocal(null);
      notify(r.kind === 'conflict' ? `${g.file} changed on disk; try again` : r.error, 'error');
    }
  };

  const save = async (links: BookmarkLink[], done: string) => {
    const r = await patchGroup(g.group, { links: links.map(tidy) }, g.etag);
    if (r.ok) {
      setForm(null);
      notify(done, 'ok');
      return null;
    }
    if (r.kind === 'invalid') return r.issues.map((i) => i.message).join('; ') || r.error;
    if (r.kind === 'conflict') return `${g.file} changed on disk since the page loaded. It has been reloaded: check it and save again.`;
    return r.error;
  };

  return (
    <div className={`hw-group${collapsed ? ' is-collapsed' : ''}${editing ? ' is-editing' : ''}`}>
      <div className="hw-group-head">
        <button type="button" className="hw-group-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls={bodyId} disabled={!c || filtering} title={collapsed ? 'Show' : 'Hide (remembered in the file)'}>
          <ChevronIcon />
          <span className="hw-group-title">{title}</span>
          {c && <span className="hw-group-count hw-num">{c.links.length}</span>}
        </button>
        {c && !collapsed && !filtering && (
          <button type="button" className={`hw-btn hw-btn--quiet hw-btn--small hw-group-edit${editing ? ' is-on' : ''}`} onClick={() => (setEditing((e) => !e), setForm(null))} aria-pressed={editing}>
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {error && <ProblemNote p={error} lastGood={!!c} />}
      {!collapsed && c && (
        <div id={bodyId} className="hw-chips">
          {c.links.map((l, i) =>
            visible && !visible.has(i) ? null : editing ? (
              <button type="button" key={`${i}-${l.url}`} className={`hw-chip hw-chip--edit${form === i ? ' is-on' : ''}`} onClick={() => setForm(form === i ? null : i)} title="Edit this link" style={{ '--paint': paintVar(hostOf(l.url)) } as CSSProperties}>
                <ChipFace g={g.group} l={l} v={iconVersion} />
                <PencilIcon />
              </button>
            ) : (
              <a key={`${i}-${l.url}`} className="hw-chip" href={l.url} data-nav="chip" data-url={l.url} title={l.description ?? l.url} style={{ '--paint': paintVar(hostOf(l.url)) } as CSSProperties}>
                <ChipFace g={g.group} l={l} v={iconVersion} />
              </a>
            ),
          )}
          {editing && (
            <button type="button" className={`hw-chip hw-chip--add${form === 'new' ? ' is-on' : ''}`} onClick={() => setForm(form === 'new' ? null : 'new')}>
              <PlusIcon /> Add link
            </button>
          )}
          {!c.links.length && !editing && <span className="hw-quiet">No links yet. Use Edit to add one.</span>}
        </div>
      )}
      {editing && form !== null && c && (
        <LinkForm
          key={String(form)}
          initial={form === 'new' ? null : c.links[form]!}
          onCancel={() => setForm(null)}
          onSave={(l) => (form === 'new' ? save([...c.links, l], `Added ${l.title} to ${title}`) : save(c.links.map((x, i) => (i === form ? { ...x, ...l } : x)), `Saved ${l.title}`))}
          onRemove={form === 'new' ? undefined : () => save(c.links.filter((_, i) => i !== form), `Removed ${c.links[form]!.title}`)}
        />
      )}
    </div>
  );
}

function ChipFace({ g, l, v }: { g: string; l: BookmarkLink; v: number }) {
  const glyph = isGlyph(l.icon) ? l.icon : null;
  return (
    <>
      <Tile name={l.title} src={glyph ? null : bookmarkIconUrl(g, l.url, v)} glyph={glyph} className="hw-chip-tile" />
      <span className="hw-chip-title">{l.title}</span>
    </>
  );
}

function normaliseUrl(s: string) {
  const v = s.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : v ? `https://${v}` : '';
}

function LinkForm({ initial, onSave, onCancel, onRemove }: { initial: BookmarkLink | null; onSave(l: BookmarkLink): Promise<string | null>; onCancel(): void; onRemove?: () => Promise<string | null> }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const run = async (p: Promise<string | null>) => {
    setBusy(true);
    const err = await p;
    setBusy(false);
    setError(err);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = normaliseUrl(url);
    try {
      new URL(u);
    } catch {
      return setError('That isn’t a URL (e.g. https://example.com/)');
    }
    void run(onSave({ title: title.trim() || hostOf(u), url: u, description: description.trim() || null, icon: initial?.icon ?? 'auto', tags: initial?.tags ?? [] }));
  };
  return (
    <form
      className="hw-linkform"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <label className="hw-field">
        <span>Title</span>
        <input ref={first} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Admin console" />
      </label>
      <label className="hw-field hw-field--grow">
        <span>URL</span>
        <input value={url} onChange={(e) => (setUrl(e.target.value), setError(null))} placeholder="https://admin.example.com/" spellCheck={false} className="hw-num" inputMode="url" />
      </label>
      <label className="hw-field hw-field--grow">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown as a tooltip (optional)" />
      </label>
      <div className="hw-claim-actions">
        <button type="submit" className="hw-btn hw-btn--primary" disabled={busy}>
          {initial ? 'Save' : 'Add'}
        </button>
        <button type="button" className="hw-btn hw-btn--quiet" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="hw-btn hw-btn--danger" disabled={busy} onClick={() => void run(onRemove())}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="hw-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** A new bookmarks/<group>.yaml with its first link. */
export function NewGroup({ taken, onDone, notify }: { taken: Set<string>; onDone(): void; notify: BookmarksProps['notify'] }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const slug = slugify(title);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!SLUG.test(slug)) return setError('Give the group a name');
    if (taken.has(slug)) return setError(`bookmarks/${slug}.yaml already exists`);
    const u = normaliseUrl(url);
    const links = u ? [{ title: hostOf(u), url: u }] : [];
    const r = await createGroup(slug, { title: title.trim(), links });
    if (r.ok) {
      notify(`Created bookmarks/${slug}.yaml`, 'ok');
      onDone();
    } else setError(r.kind === 'invalid' ? r.issues.map((i) => i.message).join('; ') || r.error : r.error);
  };
  return (
    <form
      className="hw-linkform hw-newgroup"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <label className="hw-field">
        <span>Group</span>
        <input ref={first} value={title} onChange={(e) => (setTitle(e.target.value), setError(null))} placeholder="Production" />
        <small>bookmarks/{slug || '…'}.yaml</small>
      </label>
      <label className="hw-field hw-field--grow">
        <span>First link</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://status.example.com/ (optional)" spellCheck={false} className="hw-num" />
      </label>
      <div className="hw-claim-actions">
        <button type="submit" className="hw-btn hw-btn--primary">
          Create group
        </button>
        <button type="button" className="hw-btn hw-btn--quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="hw-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
