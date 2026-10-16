// The write path (docs/02-architecture.md, "The write path"; D7, D14): the one module that reads and writes the
// human-editable files in the data home (config.yaml, apps/<slug>.yaml, bookmarks/<group>.yaml, ignore.yaml). The
// HTTP API, the CLI and MCP all call it; nothing else writes those files.
//
// - Reads keep every file in memory with its last good version. A file that stops parsing or validating keeps that
//   version and gains an error (file, line, message); nothing crashes, and the file is never overwritten.
// - Writes are serialised per file, validated before they touch the disk, atomic (tmp + rename), and edit the file as a
//   YAML Document so comments, key order and unknown keys survive. They honour If-Match (409 on a stale ETag) and
//   refuse to replace a file that has changed on disk since it was read.
// - Deletes move the file into backups/removed/; a delete or a replacing write takes a snapshot first (backups.ts).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Document } from 'yaml';
import type { AppConfig, BookmarkGroupConfig, FileProblem, HallwayConfig, IgnoreConfig, ServerEvent } from '../../shared/api.js';
import { dataPaths } from '../config.js';
import { bus as defaultBus, type EventBus } from '../events.js';
import { snapshotName, snapshotNow } from './backups.js';
import { initDataHome } from './home.js';
import { atomicWrite, isTempName, moveToRemoved } from './safefs.js';
import {
  APP_SCHEMA,
  BOOKMARKS_SCHEMA,
  CONFIG_SCHEMA,
  SLUG,
  defaultConfig,
  reservedSlugs,
  validateApp,
  validateBookmarks,
  validateConfig,
  validateIgnore,
  type Field,
  type Issue,
} from './schema.js';
import { appendMapping, appendToList, locate, mergePatch, newDocument, parse, patchListItem, removeFromList, replaceWith, stringify, type Parsed } from './yamldoc.js';

export { SLUG } from './schema.js';

// ---------------------------------------------------------------------------------------------------------------
// Errors the API maps to status codes
// ---------------------------------------------------------------------------------------------------------------

/** 404. */
export class NotFoundError extends Error {}
/** 409: a stale If-Match, a file that changed on disk meanwhile, a file that exists (create-only), a broken file. */
export class ConflictError extends Error {
  constructor(
    message: string,
    public etag: string | null = null,
  ) {
    super(message);
  }
}
/** 400: the request, or the file it would produce, isn't valid. */
export class ValidationError extends Error {
  constructor(
    message: string,
    public issues: { key: string; message: string }[] = [],
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Entries: one per file, with its last good value
// ---------------------------------------------------------------------------------------------------------------

export type Kind = 'app' | 'bookmarks' | 'config' | 'ignore';

export interface Entry<T> {
  kind: Kind;
  /** The slug or group (the file name without `.yaml`); `config` / `ignore` for those files. */
  name: string;
  /** Absolute path, and relative to the data home with `/`. */
  path: string;
  file: string;
  /** The bytes last read; null if the file doesn't exist. */
  raw: string | null;
  /** `"<hash>"` of `raw`; null if the file doesn't exist. */
  etag: string | null;
  /** The last good value: kept while the file is broken. */
  value: T | null;
  /** The file's errors (first) and warnings, as of the last read. */
  problems: FileProblem[];
}

export const etagOf = (raw: string) => `"${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)}"`;
/** `"abc"`, `W/"abc"` and `abc` are the same tag. */
const normEtag = (t: string) => t.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
/** Does an If-Match header match `etag` (null: no file)? `*` matches any existing file. */
const matches = (ifMatch: string, etag: string | null) =>
  etag !== null && (ifMatch.trim() === '*' || ifMatch.split(',').some((t) => normEtag(t) === normEtag(etag)));

function readRaw(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return null;
    throw e;
  }
}

const keyString = (k: (string | number)[]) => k.join('.');

/** Names for this machine's loopback: two apps on any of them with one port collide. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0', '::', '*']);
const hostKey = (h: string) => (LOOPBACK.has(h.toLowerCase()) ? 'loopback' : h.toLowerCase());

export interface WriteOptions {
  /** The client's If-Match: the write fails with 409 unless the file's current ETag matches (`*`: it must exist). */
  ifMatch?: string | null;
  /** Fail with 409 if the file exists (`If-None-Match: *`). */
  createOnly?: boolean;
}

export interface StoreOptions {
  bus?: EventBus;
  /** Snapshot before deletes and replacing writes (default true). */
  backups?: boolean;
  now?: () => Date;
}

export class Store {
  readonly paths: ReturnType<typeof dataPaths>;
  readonly bus: EventBus;
  private backups: boolean;
  private now: () => Date;

  readonly apps = new Map<string, Entry<AppConfig>>();
  readonly groups = new Map<string, Entry<BookmarkGroupConfig>>();
  readonly config: Entry<HallwayConfig>;
  readonly ignore: Entry<IgnoreConfig>;
  /** Files in apps/ or bookmarks/ that aren't entities (a bad name, `.yml`): reported, never read. */
  stray: FileProblem[] = [];

  private locks = new Map<string, Promise<unknown>>();

  constructor(
    readonly home: string,
    opts: StoreOptions = {},
  ) {
    this.paths = dataPaths(home);
    this.bus = opts.bus ?? defaultBus;
    this.backups = opts.backups ?? true;
    this.now = opts.now ?? (() => new Date());
    this.config = this.emptyEntry('config', 'config', this.paths.config);
    this.ignore = this.emptyEntry('ignore', 'ignore', this.paths.ignore);
  }

  /** Create the data home's layout where missing, then read everything. */
  init() {
    initDataHome(this.home);
    this.loadAll();
    return this;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------------------------------------------

  private emptyEntry<T>(kind: Kind, name: string, abs: string): Entry<T> {
    return { kind, name, path: abs, file: path.relative(this.home, abs).split(path.sep).join('/'), raw: null, etag: null, value: null, problems: [] };
  }

  private problem(e: Entry<unknown>, severity: FileProblem['severity'], message: string, at?: { line: number; col: number }, key?: string): FileProblem {
    return { severity, file: e.file, path: e.path, ...(at ? { line: at.line, col: at.col } : {}), ...(key ? { key } : {}), message };
  }

  /** Parse and validate `raw` for an entry. Errors first; `value` is null if there are any. */
  private check(e: Entry<unknown>, raw: string): { value: unknown; problems: FileProblem[]; parsed: Parsed } {
    const parsed = parse(raw);
    if (parsed.error) {
      const at = parsed.error.line ? { line: parsed.error.line, col: parsed.error.col ?? 1 } : undefined;
      return { value: null, parsed, problems: [this.problem(e, 'error', `YAML syntax error: ${parsed.error.message}`, at)] };
    }
    let js: unknown;
    try {
      js = parsed.doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      return { value: null, parsed, problems: [this.problem(e, 'error', `YAML error: ${(err as Error).message}`)] };
    }
    let r: { value: unknown; issues: Issue[] };
    if (e.kind === 'app') r = validateApp(e.name, js);
    else if (e.kind === 'bookmarks') r = validateBookmarks(e.name, js);
    else if (e.kind === 'config') r = validateConfig(js);
    else r = validateIgnore(js);
    const issues = [...r.issues];
    if (e.kind === 'app' && reservedSlugs(this.currentConfig()).includes(e.name))
      issues.unshift({ severity: 'error', key: [], message: `"${e.name}" is a reserved name (it would collide with Hallway's own host names); rename the file` });
    const problems = issues
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
      .map((i) =>
        this.problem(e, i.severity, i.key.length ? `${keyString(i.key)}: ${i.message}` : i.message, locate(parsed, i.key, i.atKey), i.key.length ? keyString(i.key) : undefined),
      );
    return { value: problems.some((p) => p.severity === 'error') ? null : r.value, problems, parsed };
  }

  /**
   * Re-read one entry's file. Returns what changed: null (nothing: the same bytes), `removed`, `error` (the file is
   * now broken; its last good value is kept), or `config`.
   */
  private reload<T>(e: Entry<T>): 'config' | 'removed' | 'error' | null {
    const raw = readRaw(e.path);
    if (raw === e.raw) return null;
    e.raw = raw;
    if (raw === null) {
      e.etag = null;
      e.value = null;
      e.problems = [];
      return 'removed';
    }
    e.etag = etagOf(raw);
    const r = this.check(e, raw);
    e.problems = r.problems;
    if (r.value === null) return 'error';
    e.value = r.value as T;
    return 'config';
  }

  /** Read every file. */
  loadAll() {
    this.reload(this.config);
    this.reload(this.ignore);
    this.loadDir('app');
    this.loadDir('bookmarks');
  }

  private dirOf(kind: 'app' | 'bookmarks') {
    return kind === 'app' ? this.paths.apps : this.paths.bookmarks;
  }

  /** The entity name for a file in apps/ or bookmarks/, or null (with a warning in `stray`) if it isn't one. */
  private nameOf(kind: 'app' | 'bookmarks', file: string): string | null {
    if (file.startsWith('.') || isTempName(file)) return null;
    const rel = `${kind === 'app' ? 'apps' : 'bookmarks'}/${file}`;
    const abs = path.join(this.dirOf(kind), file);
    const stray = (message: string) => {
      this.stray.push({ severity: 'warning', file: rel, path: abs, message });
      return null;
    };
    if (file.endsWith('.yml')) return stray(`Hallway reads .yaml files only: rename it to ${file.slice(0, -4)}.yaml`);
    if (!file.endsWith('.yaml')) return null;
    const name = file.slice(0, -5);
    if (!SLUG.test(name))
      return stray(
        `"${name}" is not a valid ${kind === 'app' ? 'app slug' : 'group name'} (lower-case letters, digits and hyphens; starts and ends with a letter or digit), so the file is ignored: rename it`,
      );
    return name;
  }

  private loadDir(kind: 'app' | 'bookmarks') {
    const map = (kind === 'app' ? this.apps : this.groups) as Map<string, Entry<unknown>>;
    const dirRel = kind === 'app' ? 'apps/' : 'bookmarks/';
    this.stray = this.stray.filter((p) => !p.file.startsWith(dirRel));
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dirOf(kind)).sort();
    } catch {
      /* no directory: no entities */
    }
    const seen = new Set<string>();
    for (const f of files) {
      const name = this.nameOf(kind, f);
      if (!name) continue;
      const e = map.get(name) ?? this.emptyEntry(kind, name, path.join(this.dirOf(kind), f));
      this.reload(e);
      if (e.raw === null) continue; // a directory called foo.yaml, or gone meanwhile
      map.set(name, e);
      seen.add(name);
    }
    for (const name of [...map.keys()]) if (!seen.has(name)) map.delete(name);
  }

  /** The config in force: the last good config.yaml, else the defaults. */
  currentConfig(): HallwayConfig {
    return this.config.value ?? defaultConfig();
  }

  currentIgnore(): IgnoreConfig {
    return this.ignore.value ?? { ports: [], processes: [], dirs: [] };
  }

  /** Port-conflict warnings for an app: other apps with a good config on the same port and host. */
  portConflicts(slug: string): FileProblem[] {
    const e = this.apps.get(slug);
    const mine = e?.value;
    if (!e || !mine) return [];
    const others = [...this.apps.values()].filter((o) => o.name !== slug && o.value && o.value.port === mine.port && hostKey(o.value.host) === hostKey(mine.host));
    if (!others.length) return [];
    return [
      this.problem(
        e,
        'warning',
        `port ${mine.port} is also declared by ${others.map((o) => o.file).join(', ')}; only one of them can be listening at a time`,
        e.raw ? locate(parse(e.raw), ['port']) : undefined,
        'port',
      ),
    ];
  }

  /** An app's problems, including port conflicts with other apps. Errors first. */
  appProblems(slug: string): FileProblem[] {
    const e = this.apps.get(slug);
    if (!e) return [];
    return [...e.problems, ...this.portConflicts(slug)];
  }

  /** Every problem in the data home, errors first. */
  allProblems(): FileProblem[] {
    const all = [
      ...this.config.problems,
      ...this.ignore.problems,
      ...[...this.apps.keys()].flatMap((s) => this.appProblems(s)),
      ...[...this.groups.values()].flatMap((g) => g.problems),
      ...this.stray,
    ];
    return [...all.filter((p) => p.severity === 'error'), ...all.filter((p) => p.severity !== 'error')];
  }

  /**
   * A path under the data home changed (the watcher). Re-read it and return the events to send: none if nothing the
   * dashboard shows changed (e.g. the store's own write, already read and announced).
   */
  reloadPath(abs: string): ServerEvent[] {
    const rel = path.relative(this.home, abs).split(path.sep);
    if (rel[0] === '' || rel[0] === '..' || isTempName(rel[rel.length - 1])) return [];
    if (rel.length === 1) {
      if (rel[0] === 'config.yaml') return this.afterConfigReload(this.reload(this.config));
      if (rel[0] === 'ignore.yaml') return this.reload(this.ignore) ? [{ type: 'observed', reason: 'ignored' }] : [];
      if (rel[0] === 'apps') return this.reloadDir('app');
      if (rel[0] === 'bookmarks') return this.reloadDir('bookmarks');
      return [];
    }
    if (rel.length !== 2 || (rel[0] !== 'apps' && rel[0] !== 'bookmarks')) return [];
    const kind = rel[0] === 'apps' ? 'app' : 'bookmarks';
    const file = rel[1];
    const before = this.stray.length;
    this.stray = this.stray.filter((p) => p.file !== `${rel[0]}/${file}`);
    const exists = fs.existsSync(abs);
    let name: string | null;
    if (exists) name = this.nameOf(kind, file);
    else name = file.endsWith('.yaml') && SLUG.test(file.slice(0, -5)) ? file.slice(0, -5) : null;
    if (!name) return this.stray.length !== before || (exists && this.stray.some((p) => p.file === `${rel[0]}/${file}`)) ? [kind === 'app' ? { type: 'apps', reason: 'stray' } : { type: 'bookmarks' }] : [];
    const map = (kind === 'app' ? this.apps : this.groups) as Map<string, Entry<unknown>>;
    const known = map.get(name);
    const e = known ?? this.emptyEntry(kind, name, abs);
    const what = this.reload(e);
    if (e.raw === null) map.delete(name);
    else map.set(name, e);
    if (!what || (what === 'removed' && !known)) return [];
    if (kind === 'bookmarks') return [{ type: 'bookmarks', group: name }];
    const out: ServerEvent[] = [{ type: 'app', slug: name, reason: what }];
    if (!known || what === 'removed') out.push({ type: 'apps', reason: what === 'removed' ? 'removed' : 'added' });
    return out;
  }

  private reloadDir(kind: 'app' | 'bookmarks'): ServerEvent[] {
    this.loadDir(kind);
    return [kind === 'app' ? { type: 'apps', reason: 'dir' } : { type: 'bookmarks' }];
  }

  /** The reserved slugs depend on config.yaml, so a config change re-checks the apps. */
  private afterConfigReload(what: 'config' | 'removed' | 'error' | null): ServerEvent[] {
    if (!what) return [];
    for (const e of this.apps.values()) {
      e.raw = null; // force a re-check
      this.reload(e);
    }
    return [{ type: 'config' }, { type: 'apps', reason: 'config' }];
  }

  // -------------------------------------------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------------------------------------------

  /** Serialise writes per file. */
  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  private stale(e: Entry<unknown>, etag: string | null) {
    return new ConflictError(etag ? `${e.file} has changed since you read it (its ETag is now ${etag}); read it again` : `${e.file} doesn't exist`, etag);
  }

  /**
   * The one write path. Reads the file fresh, checks the preconditions, applies `edit` to its Document, validates the
   * result, and writes it atomically. Updates the entry in place.
   */
  private async write<T>(
    e: Entry<T>,
    edit: (doc: Document, exists: boolean) => void,
    opts: WriteOptions & { mustExist?: boolean; destructive?: boolean; comments?: { header?: string; footer?: string } } = {},
  ): Promise<Entry<T>> {
    return this.withLock(e.path, async () => {
      const raw = readRaw(e.path);
      const exists = raw !== null;
      const etag = exists ? etagOf(raw) : null;
      if (opts.mustExist && !exists) throw new NotFoundError(`${e.file} doesn't exist`);
      if (opts.createOnly && exists) throw new ConflictError(`${e.file} already exists`, etag);
      if (opts.ifMatch && !matches(opts.ifMatch, etag)) throw this.stale(e, etag);
      let doc: Document;
      if (exists) {
        const parsed = parse(raw);
        // never overwrite a file the user broke: they'd lose whatever they were in the middle of
        if (parsed.error)
          throw new ConflictError(
            `refusing to overwrite ${e.file}: it is not valid YAML (${parsed.error.message}${parsed.error.line ? `, line ${parsed.error.line}` : ''}). Fix the file by hand.`,
            etag,
          );
        doc = parsed.doc;
      } else doc = newDocument(opts.comments);
      try {
        edit(doc, exists);
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof ConflictError || err instanceof ValidationError) throw err;
        throw new ConflictError(`can't edit ${e.file}: ${(err as Error).message}. Fix the file by hand.`, etag);
      }
      const text = stringify(doc);
      const errors = this.check(e, text).problems.filter((p) => p.severity === 'error');
      if (errors.length)
        throw new ValidationError(
          `${e.file} would not be valid: ${errors.map((p) => p.message).join('; ')}`,
          errors.map((p) => ({ key: p.key ?? '', message: p.message })),
        );
      if (text === raw) {
        this.reload(e);
        return e; // nothing to change
      }
      if (exists && opts.destructive && this.backups) snapshotNow(this.home, this.now());
      // a hand edit may have landed while we worked: never write over it
      if (readRaw(e.path) !== raw) throw new ConflictError(`${e.file} changed on disk while saving; read it again`, etag);
      atomicWrite(e.path, text, { createOnly: !exists });
      this.reload(e);
      return e;
    });
  }

  private requireName(name: string, what: 'app' | 'group') {
    if (!SLUG.test(name))
      throw new ValidationError(
        `"${name}" is not a valid ${what === 'app' ? 'slug' : 'group name'}: lower-case letters, digits and hyphens, starting and ending with a letter or digit, at most 63 characters`,
        [{ key: what === 'app' ? 'slug' : 'group', message: 'invalid name' }],
      );
  }

  /** Reject keys a schema doesn't know in an API body (a file may have them; a request has no excuse). */
  private rejectUnknown(schema: Field, body: unknown, key: string[] = []) {
    if (schema.t === 'list' && Array.isArray(body)) body.forEach((v, i) => this.rejectUnknown(schema.of, v, [...key, String(i)]));
    if (schema.t !== 'object' || typeof body !== 'object' || body === null || Array.isArray(body)) return;
    for (const [k, v] of Object.entries(body)) {
      const f = schema.fields[k];
      const at = [...key, k].join('.');
      if (!f) throw new ValidationError(`unknown key "${at}"`, [{ key: at, message: 'unknown key' }]);
      this.rejectUnknown(f, v, [...key, k]);
    }
  }

  private body(schema: Field, body: unknown): Record<string, unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('the body must be a JSON object');
    this.rejectUnknown(schema, body);
    return body as Record<string, unknown>;
  }

  private appEntry(slug: string): Entry<AppConfig> {
    return this.apps.get(slug) ?? this.emptyEntry('app', slug, path.join(this.paths.apps, `${slug}.yaml`));
  }

  private groupEntry(group: string): Entry<BookmarkGroupConfig> {
    return this.groups.get(group) ?? this.emptyEntry('bookmarks', group, path.join(this.paths.bookmarks, `${group}.yaml`));
  }

  private track<T>(map: Map<string, Entry<T>>, e: Entry<T>) {
    if (e.raw !== null) map.set(e.name, e);
    else map.delete(e.name);
  }

  private emitApp(slug: string, existed: boolean) {
    this.bus.emit({ type: 'app', slug, reason: 'config' });
    if (!existed) this.bus.emit({ type: 'apps', reason: 'added' });
  }

  /** PUT: create or replace an app. Known keys become exactly `body`'s; unknown keys and comments stay. */
  async putApp(slug: string, body: unknown, opts: WriteOptions = {}): Promise<Entry<AppConfig>> {
    this.requireName(slug, 'app');
    const value = this.body(APP_SCHEMA, body);
    const e = this.appEntry(slug);
    const existed = this.apps.has(slug);
    await this.write(e, (doc) => replaceWith(doc, value, APP_SCHEMA), { ...opts, destructive: true });
    this.track(this.apps, e);
    this.emitApp(slug, existed);
    return e;
  }

  /** PATCH: a JSON merge patch (RFC 7396) onto an existing app: mappings merge, null removes a key. */
  async patchApp(slug: string, patch: unknown, opts: WriteOptions = {}): Promise<Entry<AppConfig>> {
    this.requireName(slug, 'app');
    const value = this.body(APP_SCHEMA, patch);
    const e = this.appEntry(slug);
    await this.write(e, (doc) => mergePatch(doc, value, APP_SCHEMA), { ...opts, mustExist: true });
    this.track(this.apps, e);
    this.emitApp(slug, true);
    return e;
  }

  /**
   * Create a new app file (claim), with optional comment blocks before and after its keys (e.g. a commented-out
   * `service:` block the user can enable). Fails with 409 if the file exists.
   */
  async createApp(slug: string, value: Record<string, unknown>, comments: { header?: string; footer?: string } = {}): Promise<Entry<AppConfig>> {
    this.requireName(slug, 'app');
    const e = this.appEntry(slug);
    await this.write(e, (doc) => replaceWith(doc, value, APP_SCHEMA), { createOnly: true, comments });
    this.track(this.apps, e);
    this.emitApp(slug, false);
    return e;
  }

  /** DELETE: move the file to backups/removed/ (after a snapshot). Returns where it went. */
  async deleteApp(slug: string, opts: WriteOptions = {}): Promise<string> {
    this.requireName(slug, 'app');
    const dest = await this.remove(this.appEntry(slug), opts);
    this.apps.delete(slug);
    this.bus.emit({ type: 'app', slug, reason: 'removed' });
    this.bus.emit({ type: 'apps', reason: 'removed' });
    return dest;
  }

  private async remove(e: Entry<unknown>, opts: WriteOptions): Promise<string> {
    return this.withLock(e.path, async () => {
      const raw = readRaw(e.path);
      if (raw === null) throw new NotFoundError(`${e.file} doesn't exist`);
      const etag = etagOf(raw);
      if (opts.ifMatch && !matches(opts.ifMatch, etag)) throw this.stale(e, etag);
      if (this.backups) snapshotNow(this.home, this.now());
      const dest = moveToRemoved(this.home, e.path, snapshotName(this.now()));
      Object.assign(e, { raw: null, etag: null, value: null, problems: [] });
      return dest;
    });
  }

  /** PUT a bookmark group: create or replace. */
  async putGroup(group: string, body: unknown, opts: WriteOptions = {}): Promise<Entry<BookmarkGroupConfig>> {
    this.requireName(group, 'group');
    const value = this.body(BOOKMARKS_SCHEMA, body);
    const e = this.groupEntry(group);
    await this.write(e, (doc) => replaceWith(doc, value, BOOKMARKS_SCHEMA), { ...opts, destructive: true });
    this.track(this.groups, e);
    this.bus.emit({ type: 'bookmarks', group });
    return e;
  }

  /** PATCH a bookmark group (merge patch; `links`, being a list, is replaced whole). */
  async patchGroup(group: string, patch: unknown, opts: WriteOptions = {}): Promise<Entry<BookmarkGroupConfig>> {
    this.requireName(group, 'group');
    const value = this.body(BOOKMARKS_SCHEMA, patch);
    const e = this.groupEntry(group);
    await this.write(e, (doc) => mergePatch(doc, value, BOOKMARKS_SCHEMA), { ...opts, mustExist: true });
    this.track(this.groups, e);
    this.bus.emit({ type: 'bookmarks', group });
    return e;
  }

  /** Append a link to a group (`hallway bookmark add`), creating the group's file if it's missing. Comments stay. */
  async addBookmark(group: string, link: { url: string; title?: string; description?: string; icon?: string; tags?: string[] }, opts: WriteOptions = {}): Promise<Entry<BookmarkGroupConfig>> {
    this.requireName(group, 'group');
    this.rejectUnknown((BOOKMARKS_SCHEMA as Extract<Field, { t: 'object' }>).fields.links, [link]);
    const e = this.groupEntry(group);
    await this.write(e, (doc) => appendMapping(doc, 'links', Object.fromEntries(Object.entries(link).filter(([, v]) => v !== undefined))), opts);
    this.track(this.groups, e);
    this.bus.emit({ type: 'bookmarks', group });
    return e;
  }

  /** Remove a link from a group by its URL or its 0-based index (`hallway bookmark rm`). Returns the removed link. */
  async removeBookmark(group: string, which: string | number, opts: WriteOptions = {}): Promise<{ title?: string; url: string }> {
    this.requireName(group, 'group');
    const e = this.groupEntry(group);
    let removed: { title?: string; url: string } | null = null;
    await this.write(
      e,
      (doc) => {
        const links = ((doc.toJS() as { links?: unknown } | null)?.links ?? []) as { title?: string; url: string }[];
        const i = typeof which === 'number' ? which : Array.isArray(links) ? links.findIndex((l) => l && l.url === which) : -1;
        if (!Array.isArray(links) || i < 0 || i >= links.length || !removeFromList(doc, 'links', i))
          throw new NotFoundError(typeof which === 'number' ? `${e.file} has no link number ${which}` : `${e.file} has no link to ${which}`);
        removed = links[i];
      },
      { ...opts, mustExist: true, destructive: true },
    );
    this.track(this.groups, e);
    this.bus.emit({ type: 'bookmarks', group });
    return removed!;
  }

  /**
   * Merge-patch one link in a group, found by its URL or its 0-based index (MCP's `update_bookmark`). The link keeps
   * its place and comments; `null` removes a key. Returns the link as written.
   */
  async updateBookmark(group: string, which: string | number, patch: unknown, opts: WriteOptions = {}): Promise<Record<string, unknown>> {
    this.requireName(group, 'group');
    const linkSchema = (BOOKMARKS_SCHEMA as Extract<Field, { t: 'object' }>).fields.links;
    const ofLink = linkSchema.t === 'list' ? linkSchema.of : undefined;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('the patch must be an object');
    this.rejectUnknown(linkSchema, [patch]);
    const e = this.groupEntry(group);
    let index = -1;
    await this.write(
      e,
      (doc) => {
        const links = ((doc.toJS() as { links?: unknown } | null)?.links ?? []) as { url: string }[];
        index = typeof which === 'number' ? which : Array.isArray(links) ? links.findIndex((l) => l && l.url === which) : -1;
        if (!Array.isArray(links) || !patchListItem(doc, 'links', index, patch as Record<string, unknown>, ofLink))
          throw new NotFoundError(typeof which === 'number' ? `${e.file} has no link number ${which}` : `${e.file} has no link to ${which}`);
      },
      { ...opts, mustExist: true },
    );
    this.track(this.groups, e);
    this.bus.emit({ type: 'bookmarks', group });
    return (e.value?.links[index] ?? {}) as unknown as Record<string, unknown>;
  }

  async deleteGroup(group: string, opts: WriteOptions = {}): Promise<string> {
    this.requireName(group, 'group');
    const dest = await this.remove(this.groupEntry(group), opts);
    this.groups.delete(group);
    this.bus.emit({ type: 'bookmarks', group });
    return dest;
  }

  /** PATCH config.yaml (merge patch). Creates it if missing. */
  async patchConfig(patch: unknown, opts: WriteOptions = {}): Promise<Entry<HallwayConfig>> {
    const value = this.body(CONFIG_SCHEMA, patch);
    await this.write(this.config, (doc, exists) => mergePatch(doc, exists ? value : { version: 1, ...value }, CONFIG_SCHEMA), opts);
    this.afterConfigReload('config');
    this.bus.emit({ type: 'config' });
    return this.config;
  }

  /** Add a port, process name or directory to ignore.yaml (no duplicates; comments kept). Creates the file if missing. */
  async addIgnore(by: 'port' | 'process' | 'dir', value: number | string): Promise<Entry<IgnoreConfig>> {
    const key = by === 'port' ? 'ports' : by === 'process' ? 'processes' : 'dirs';
    await this.write(this.ignore, (doc) => {
      appendToList(doc, key, value);
    });
    this.bus.emit({ type: 'observed', reason: 'ignored' });
    return this.ignore;
  }
}
