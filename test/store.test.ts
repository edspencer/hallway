// server/store/: the data home's layout, reading with last-good fallback and located errors, and every rule of the
// write path: validation, atomic writes, comment-preserving edits, unknown keys, ETag/If-Match, deletes into
// backups/, snapshots, never overwriting a broken file, port conflicts, reserved slugs.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ServerEvent } from '../shared/api.ts';
import { ConflictError, NotFoundError, Store, ValidationError, etagOf } from '../server/store/index.ts';
import { GITIGNORE, configTemplate, initDataHome } from '../server/store/home.ts';
import { listSnapshots, pruneSnapshots, snapshotName, snapshotsToKeep, takeSnapshot, KEEP_RECENT } from '../server/store/backups.ts';
import { atomicWrite, ExistsError, moveToRemoved } from '../server/store/safefs.ts';
import { validateConfig } from '../server/store/schema.ts';
import YAML from 'yaml';
import { tmpDir, tmpStore } from './fixture.ts';

const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((c) => c()));
async function fresh() {
  const s = await tmpStore();
  cleanups.push(s.cleanup);
  const events: ServerEvent[] = [];
  s.bus.subscribe((e) => events.push(e));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(s.home, rel)), { recursive: true });
    fs.writeFileSync(path.join(s.home, rel), text);
  };
  const read = (rel: string) => fs.readFileSync(path.join(s.home, rel), 'utf8');
  const ls = (rel: string) => fs.readdirSync(path.join(s.home, rel));
  return { ...s, events, write, read, ls };
}

describe('the data home', () => {
  test('init creates the layout, the .gitignore and starter files, and is idempotent', async () => {
    const { home, read, ls } = await fresh();
    for (const d of ['apps', 'bookmarks', 'state', 'cache', 'generated', 'logs', 'backups']) assert.ok(fs.statSync(path.join(home, d)).isDirectory(), d);
    assert.equal(read('.gitignore'), GITIGNORE);
    for (const d of ['state', 'cache', 'generated', 'logs', 'backups']) assert.match(GITIGNORE, new RegExp(`^/${d}/$`, 'm'));
    assert.equal(read('config.yaml'), configTemplate());
    assert.match(read('ignore.yaml'), /^ports: \[\]/m);
    // a user's files are never replaced
    fs.writeFileSync(path.join(home, 'config.yaml'), 'version: 1\nport: 5050\n');
    fs.writeFileSync(path.join(home, '.gitignore'), 'mine\n');
    assert.deepEqual(initDataHome(home), []);
    assert.equal(read('config.yaml'), 'version: 1\nport: 5050\n');
    assert.equal(read('.gitignore'), 'mine\n');
    assert.deepEqual(ls('apps'), []);
  });

  test('the config template is valid and is exactly the defaults', () => {
    const r = validateConfig(YAML.parse(configTemplate()));
    assert.deepEqual(r.issues, []);
    // every commented line, uncommented, still validates to the defaults
    const uncommented = configTemplate()
      .split('\n')
      .filter((l) => /^# {1,3}\w+:/.test(l) || /^version/.test(l))
      .map((l) => l.replace(/^# /, '').replace(/\s+#.*$/, ''))
      .join('\n');
    const all = validateConfig(YAML.parse(uncommented));
    assert.deepEqual(all.issues, [], uncommented);
    assert.deepEqual(all.value, r.value);
  });
});

describe('reading', () => {
  test('valid files load with defaults; ETags are content hashes', async () => {
    const { store, write } = await fresh();
    write('apps/foo.yaml', 'name: Foo\nport: 5173\n');
    write('bookmarks/prod.yaml', 'title: Production\nlinks:\n  - url: https://admin.example.com\n');
    store.loadAll();
    const foo = store.apps.get('foo')!;
    assert.equal(foo.value!.name, 'Foo');
    assert.equal(foo.value!.expected, 'running');
    assert.equal(foo.etag, etagOf('name: Foo\nport: 5173\n'));
    assert.deepEqual(foo.problems, []);
    assert.equal(store.groups.get('prod')!.value!.links[0].title, 'admin.example.com');
  });

  test('a broken file keeps its last good version and gets an error with file, line and message', async () => {
    const { store, write, home } = await fresh();
    write('apps/foo.yaml', 'name: Foo\nport: 5173\n');
    store.loadAll();
    const broken = 'name: Foo\nport: 5173\nlinks: [\n';
    write('apps/foo.yaml', broken);
    assert.deepEqual(store.reloadPath(path.join(home, 'apps/foo.yaml')), [{ type: 'app', slug: 'foo', reason: 'error' }]);
    const e = store.apps.get('foo')!;
    assert.equal(e.value!.port, 5173, 'last good version kept');
    assert.equal(e.problems.length, 1);
    const p = e.problems[0];
    assert.equal(p.severity, 'error');
    assert.equal(p.file, 'apps/foo.yaml');
    assert.equal(p.path, path.join(home, 'apps/foo.yaml'));
    assert.equal(typeof p.line, 'number');
    assert.match(p.message, /^YAML syntax error: /);
  });

  test('validation errors point at the line of the bad value', async () => {
    const { store, write } = await fresh();
    write('apps/foo.yaml', '# my app\nname: Foo\nport: 70000\nexpcted: adhoc\n');
    store.loadAll();
    const [err, warn] = store.apps.get('foo')!.problems;
    assert.deepEqual({ ...err, path: undefined }, { severity: 'error', file: 'apps/foo.yaml', path: undefined, line: 3, col: 7, key: 'port', message: 'port: must be between 1 and 65535' });
    assert.equal(warn.severity, 'warning');
    assert.equal(warn.line, 4);
    assert.equal(warn.col, 1);
    assert.equal(store.apps.get('foo')!.value, null, 'never valid: no value');
  });

  test('a file that was never valid is still listed, with its error', async () => {
    const { store, write } = await fresh();
    write('apps/foo.yaml', ': : :\n');
    store.loadAll();
    assert.ok(store.apps.has('foo'));
    assert.equal(store.apps.get('foo')!.value, null);
    assert.equal(store.allProblems()[0].file, 'apps/foo.yaml');
  });

  test('bad file names and .yml are reported, not loaded; dotfiles and temp files are skipped', async () => {
    const { store, write } = await fresh();
    write('apps/My App.yaml', 'port: 1\n');
    write('apps/foo.yml', 'port: 1\n');
    write('apps/.foo.yaml.tmp-1-abcdef12', 'port: 1\n');
    write('apps/notes.txt', 'hi');
    store.loadAll();
    assert.deepEqual([...store.apps.keys()], []);
    assert.deepEqual(
      store.stray.map((p) => [p.file, p.severity]),
      [
        ['apps/My App.yaml', 'warning'],
        ['apps/foo.yml', 'warning'],
      ],
    );
    assert.match(store.stray[1].message, /rename it to foo\.yaml/);
  });

  test('reserved slugs are errors, and follow the configured dashboard host', async () => {
    const { store, write, home } = await fresh();
    write('apps/hallway.yaml', 'port: 1\n');
    write('apps/hall.yaml', 'port: 2\n');
    store.loadAll();
    assert.match(store.apps.get('hallway')!.problems[0].message, /reserved/);
    assert.deepEqual(store.apps.get('hall')!.problems, []);
    write('config.yaml', 'version: 1\ndomain:\n  dashboard: hall.localhost\n');
    const ev = store.reloadPath(path.join(home, 'config.yaml'));
    assert.deepEqual(ev, [{ type: 'config' }, { type: 'apps', reason: 'config' }]);
    assert.deepEqual(store.apps.get('hallway')!.problems, []);
    assert.match(store.apps.get('hall')!.problems[0].message, /reserved/);
  });

  test('two apps on one port warn on both (an error-free warning)', async () => {
    const { store, write } = await fresh();
    write('apps/a.yaml', 'port: 4666\n');
    write('apps/b.yaml', 'port: 4666\nhost: localhost\nexpected: stopped\n');
    write('apps/c.yaml', 'port: 4670\n');
    store.loadAll();
    const a = store.appProblems('a');
    assert.equal(a.length, 1);
    assert.equal(a[0].severity, 'warning');
    assert.equal(a[0].key, 'port');
    assert.equal(a[0].line, 1);
    assert.match(a[0].message, /port 4666 is also declared by apps\/b\.yaml/);
    assert.match(store.appProblems('b')[0].message, /apps\/a\.yaml/);
    assert.deepEqual(store.appProblems('c'), []);
    assert.ok(store.apps.get('a')!.value, 'still usable');
  });

  test('reloadPath: the events for add, change, unchanged, remove', async () => {
    const { store, write, home } = await fresh();
    const p = path.join(home, 'apps/foo.yaml');
    write('apps/foo.yaml', 'port: 1\n');
    assert.deepEqual(store.reloadPath(p), [
      { type: 'app', slug: 'foo', reason: 'config' },
      { type: 'apps', reason: 'added' },
    ]);
    assert.deepEqual(store.reloadPath(p), [], 'same bytes: nothing');
    write('apps/foo.yaml', 'port: 2\n');
    assert.deepEqual(store.reloadPath(p), [{ type: 'app', slug: 'foo', reason: 'config' }]);
    fs.unlinkSync(p);
    assert.deepEqual(store.reloadPath(p), [
      { type: 'app', slug: 'foo', reason: 'removed' },
      { type: 'apps', reason: 'removed' },
    ]);
    assert.ok(!store.apps.has('foo'));
    write('bookmarks/g.yaml', 'links: []\n');
    assert.deepEqual(store.reloadPath(path.join(home, 'bookmarks/g.yaml')), [{ type: 'bookmarks', group: 'g' }]);
    write('ignore.yaml', 'ports: [631]\n');
    assert.deepEqual(store.reloadPath(path.join(home, 'ignore.yaml')), [{ type: 'observed', reason: 'ignored' }]);
    assert.deepEqual(store.currentIgnore().ports, [631]);
    assert.deepEqual(store.reloadPath(path.join(home, 'state/x.json')), []);
    assert.deepEqual(store.reloadPath(path.join(home, 'apps/.foo.yaml.tmp-1-abcdef12')), []);
  });
});

describe('writing', () => {
  test('PUT creates a file atomically (no temp files left) and announces it', async () => {
    const { store, read, ls, events } = await fresh();
    const e = await store.putApp('foo', { name: 'Foo', port: 5173, tags: ['a', 'b'] });
    assert.equal(read('apps/foo.yaml'), 'name: Foo\nport: 5173\ntags: [ a, b ]\n');
    assert.deepEqual(ls('apps'), ['foo.yaml']);
    assert.equal(e.etag, etagOf(read('apps/foo.yaml')));
    assert.deepEqual(events, [
      { type: 'app', slug: 'foo', reason: 'config' },
      { type: 'apps', reason: 'added' },
    ]);
  });

  test('PATCH keeps comments, key order, quoting and unknown keys', async () => {
    const { store, write, read } = await fresh();
    const original = [
      '# My app, started by hand',
      'name: "Foo"   # the display name',
      'port: 5173',
      'mystery: keep me',
      '',
      '# how to check it',
      'health:',
      '  path: /health',
      'tags: [a, b]',
      '',
    ].join('\n');
    write('apps/foo.yaml', original);
    store.loadAll();
    assert.match(store.apps.get('foo')!.problems[0].message, /unknown key "mystery"/);
    await store.patchApp('foo', { description: 'The thing', health: { expectStatus: 204 }, expected: 'adhoc' });
    assert.equal(
      read('apps/foo.yaml'),
      [
        '# My app, started by hand',
        'name: "Foo" # the display name',
        'port: 5173',
        'mystery: keep me',
        '',
        '# how to check it',
        'health:',
        '  path: /health',
        '  expectStatus: 204',
        'tags: [ a, b ]',
        'description: The thing',
        'expected: adhoc',
        '',
      ].join('\n'),
    );
    // null removes a key; a changed scalar keeps its comment
    await store.patchApp('foo', { description: null, name: 'Bar' });
    assert.match(read('apps/foo.yaml'), /^name: "Bar" # the display name$/m);
    assert.doesNotMatch(read('apps/foo.yaml'), /description/);
  });

  test('PUT replaces known keys but keeps unknown ones and comments on what survives', async () => {
    const { store, write, read } = await fresh();
    write('apps/foo.yaml', '# top\nname: Foo # nice\nport: 5173\nexpected: adhoc\nmystery: 1\n');
    store.loadAll();
    await store.putApp('foo', { name: 'Foo', port: 5174 });
    assert.equal(read('apps/foo.yaml'), '# top\nname: Foo # nice\nport: 5174\nmystery: 1\n');
  });

  test('invalid writes are refused with the issues, and nothing is written', async () => {
    const { store, ls } = await fresh();
    await assert.rejects(store.putApp('foo', { port: 70000 }), (e) => e instanceof ValidationError && e.issues[0].key === 'port');
    await assert.rejects(store.putApp('foo', { name: 'x' }), (e) => e instanceof ValidationError && /port: is required/.test(e.message));
    await assert.rejects(store.putApp('foo', { port: 1, expected: 'maybe' }), ValidationError);
    await assert.rejects(store.putApp('foo', { port: 1, colour: 'red' }), (e) => e instanceof ValidationError && /unknown key "colour"/.test(e.message));
    await assert.rejects(store.putApp('foo', { port: 1, health: { pth: '/x' } }), (e) => e instanceof ValidationError && /unknown key "health.pth"/.test(e.message));
    await assert.rejects(store.putApp('Foo', { port: 1 }), (e) => e instanceof ValidationError && /not a valid slug/.test(e.message));
    await assert.rejects(store.putApp('www', { port: 1 }), (e) => e instanceof ValidationError && /reserved/.test(e.message));
    await assert.rejects(store.putApp('foo', [1]), ValidationError);
    assert.deepEqual(ls('apps'), []);
  });

  test('If-Match: a stale ETag is a conflict; the current one (quoted, bare or weak) succeeds', async () => {
    const { store } = await fresh();
    const e1 = await store.putApp('foo', { port: 1 });
    const old = e1.etag!;
    await store.patchApp('foo', { port: 2 }, { ifMatch: old });
    await assert.rejects(store.patchApp('foo', { port: 3 }, { ifMatch: old }), (e) => e instanceof ConflictError && e.etag === store.apps.get('foo')!.etag);
    const cur = store.apps.get('foo')!.etag!;
    await store.patchApp('foo', { port: 3 }, { ifMatch: cur.replace(/"/g, '') });
    await store.patchApp('foo', { port: 4 }, { ifMatch: `W/${store.apps.get('foo')!.etag}` });
    await store.patchApp('foo', { port: 5 }, { ifMatch: '*' });
    await assert.rejects(store.putApp('bar', { port: 1 }, { ifMatch: '*' }), ConflictError);
    await assert.rejects(store.putApp('foo', { port: 1 }, { createOnly: true }), ConflictError);
    await assert.rejects(store.deleteApp('foo', { ifMatch: old }), ConflictError);
  });

  test('PATCH and DELETE of a missing app are 404s', async () => {
    const { store } = await fresh();
    await assert.rejects(store.patchApp('nope', { port: 1 }), NotFoundError);
    await assert.rejects(store.deleteApp('nope'), NotFoundError);
  });

  test('a file the user broke is never overwritten, and stays byte-for-byte untouched', async () => {
    const { store, write, read } = await fresh();
    write('apps/foo.yaml', 'name: Foo\nport: 5173\n');
    store.loadAll();
    const broken = 'name: Foo\nport: 5173\n  oops: [\n';
    write('apps/foo.yaml', broken);
    store.loadAll();
    for (const attempt of [() => store.patchApp('foo', { port: 1 }), () => store.putApp('foo', { port: 1 })])
      await assert.rejects(attempt(), (e) => e instanceof ConflictError && /refusing to overwrite apps\/foo\.yaml: it is not valid YAML/.test(e.message));
    assert.equal(read('apps/foo.yaml'), broken);
  });

  test('a write can fix a file that only fails validation', async () => {
    const { store, write, read } = await fresh();
    write('apps/foo.yaml', '# keep\nport: 70000\n');
    store.loadAll();
    await store.patchApp('foo', { port: 7000 });
    assert.equal(read('apps/foo.yaml'), '# keep\nport: 7000\n');
    assert.deepEqual(store.apps.get('foo')!.problems, []);
  });

  test('a write with an ETag read before a hand edit is refused, and the edit survives', async () => {
    const { store, write, read } = await fresh();
    await store.putApp('foo', { port: 1 });
    const etag = store.apps.get('foo')!.etag!;
    write('apps/foo.yaml', 'port: 2\n');
    await assert.rejects(store.patchApp('foo', { port: 3 }, { ifMatch: etag }), ConflictError);
    assert.equal(read('apps/foo.yaml'), 'port: 2\n');
  });

  test('writes to one file are serialised', async () => {
    const { store, read } = await fresh();
    await store.putApp('foo', { port: 1, tags: [] });
    await Promise.all(['a', 'b', 'c', 'd'].map((t) => store.patchApp('foo', { description: t })));
    assert.match(read('apps/foo.yaml'), /description: d/);
  });

  test('DELETE moves the file into backups/removed/ after a snapshot', async () => {
    const { store, home, ls, events } = await fresh();
    await store.putApp('foo', { port: 1 });
    events.length = 0;
    const dest = await store.deleteApp('foo');
    assert.deepEqual(ls('apps'), []);
    assert.match(path.relative(home, dest), /^backups\/removed\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\/apps\/foo\.yaml$/);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'port: 1\n');
    const snaps = listSnapshots(path.join(home, 'backups'));
    assert.equal(snaps.length, 1);
    assert.ok(fs.existsSync(path.join(home, 'backups', snaps[0], 'apps', 'foo.yaml')), 'snapshot taken before the delete');
    assert.deepEqual(events, [
      { type: 'app', slug: 'foo', reason: 'removed' },
      { type: 'apps', reason: 'removed' },
    ]);
    // deleting it again: 404, and a second app of the same name deleted later gets its own place
    await assert.rejects(store.deleteApp('foo'), NotFoundError);
    await store.putApp('foo', { port: 2 });
    const dest2 = await store.deleteApp('foo');
    assert.notEqual(dest2, dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'port: 1\n');
  });

  test('a replacing PUT takes a snapshot first; a create does not need one', async () => {
    const { store, home } = await fresh();
    await store.putApp('foo', { port: 1 });
    const before = listSnapshots(path.join(home, 'backups')).length;
    await store.putApp('foo', { port: 2 });
    const snaps = listSnapshots(path.join(home, 'backups'));
    assert.equal(snaps.length, before + 1);
    assert.equal(fs.readFileSync(path.join(home, 'backups', snaps[snaps.length - 1], 'apps/foo.yaml'), 'utf8'), 'port: 1\n');
  });

  test('createApp writes comment blocks and refuses to replace', async () => {
    const { store, read } = await fresh();
    await store.createApp('foo', { name: 'Foo', port: 4567, expected: 'adhoc' }, { header: ' claimed', footer: ' service:\n   command: ["python3"]' });
    assert.equal(read('apps/foo.yaml'), '# claimed\n\nname: Foo\nport: 4567\nexpected: adhoc\n\n# service:\n#   command: ["python3"]\n');
    assert.equal(store.apps.get('foo')!.value!.service, null, 'the service block stays commented out');
    await assert.rejects(store.createApp('foo', { port: 1 }), ConflictError);
  });

  test('bookmark groups: put, patch, delete', async () => {
    const { store, read, ls, events } = await fresh();
    await store.putGroup('prod', { title: 'Production', links: [{ title: 'Admin', url: 'https://admin.example.com' }] });
    assert.equal(read('bookmarks/prod.yaml'), 'title: Production\nlinks:\n  - title: Admin\n    url: https://admin.example.com\n');
    await store.patchGroup('prod', { collapsed: true });
    assert.equal(store.groups.get('prod')!.value!.collapsed, true);
    await assert.rejects(store.putGroup('prod', { links: [{ url: 'not a url' }] }), ValidationError);
    await store.deleteGroup('prod');
    assert.deepEqual(ls('bookmarks'), []);
    assert.deepEqual(events.filter((e) => e.type === 'bookmarks').length, 3);
  });

  test('addIgnore appends without duplicates and keeps comments', async () => {
    const { store, read } = await fresh();
    await store.addIgnore('port', 4567);
    await store.addIgnore('port', 4567);
    await store.addIgnore('process', 'rapportd');
    await store.addIgnore('dir', '~/Code/scratch');
    const text = read('ignore.yaml');
    assert.match(text, /^# Listeners the port scanner should never show/);
    assert.match(text, /^ports: \[ 4567 \] +# e\.g\. \[631, 8080\]$/m);
    assert.deepEqual(store.currentIgnore(), { ports: [4567], processes: ['rapportd'], dirs: ['~/Code/scratch'] });
  });

  test('patchConfig keeps the template comments', async () => {
    const { store, read } = await fresh();
    await store.patchConfig({ dashboard: { theme: 'dark' } });
    assert.equal(store.currentConfig().dashboard.theme, 'dark');
    assert.match(read('config.yaml'), /^# Hallway settings\./);
    assert.match(read('config.yaml'), /^# probe:/m);
    await assert.rejects(store.patchConfig({ mode: 'sideways' }), ValidationError);
  });
});

describe('safefs', () => {
  test('atomicWrite createOnly never replaces; moveToRemoved never clobbers', () => {
    const dir = tmpDir('hw-test-safefs-');
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const f = path.join(dir, 'a.yaml');
    atomicWrite(f, 'one');
    assert.throws(() => atomicWrite(f, 'two', { createOnly: true }), ExistsError);
    assert.equal(fs.readFileSync(f, 'utf8'), 'one');
    atomicWrite(f, 'three');
    assert.deepEqual(fs.readdirSync(dir), ['a.yaml']);
    const d1 = moveToRemoved(dir, f, 'T');
    fs.writeFileSync(f, 'four');
    const d2 = moveToRemoved(dir, f, 'T');
    assert.notEqual(d1, d2);
    assert.equal(fs.readFileSync(d1, 'utf8'), 'three');
    assert.equal(fs.readFileSync(d2, 'utf8'), 'four');
    assert.throws(() => moveToRemoved(path.join(dir, 'backups'), f, 'T'), /not in the data home/);
  });
});

describe('backups', () => {
  test('snapshots copy only the editable files, only when something changed', async () => {
    const { home, write } = await fresh();
    write('apps/foo.yaml', 'port: 1\n');
    write('state/observed.json', '{}');
    const t = new Date('2026-10-16T10:00:00Z');
    const n1 = takeSnapshot(home, t)!;
    assert.equal(n1, '2026-10-16T10-00-00Z');
    assert.deepEqual(fs.readdirSync(path.join(home, 'backups', n1)).sort(), ['apps', 'config.yaml', 'ignore.yaml']);
    assert.equal(takeSnapshot(home, t), null, 'unchanged');
    write('apps/foo.yaml', 'port: 2\n');
    assert.equal(takeSnapshot(home, t), '2026-10-16T10-00-00Z-2');
  });

  test('pruning keeps the newest and one a day, and nothing else in backups/', async () => {
    const { home } = await fresh();
    const b = path.join(home, 'backups');
    const now = new Date('2026-10-16T12:00:00Z');
    const names: string[] = [];
    for (let i = 0; i < KEEP_RECENT + 10; i++) names.push(snapshotName(new Date(now.getTime() - i * 60_000)));
    names.push(snapshotName(new Date('2026-08-01T00:00:00Z')));
    for (const n of names) fs.mkdirSync(path.join(b, n), { recursive: true });
    fs.mkdirSync(path.join(b, 'removed', 'x'), { recursive: true });
    const keep = snapshotsToKeep(names, now);
    assert.equal(keep.size, KEEP_RECENT + 1); // the newest 50, plus the first of today
    const removed = pruneSnapshots(home, now);
    assert.equal(removed.length, names.length - keep.size);
    assert.ok(removed.includes(snapshotName(new Date('2026-08-01T00:00:00Z'))), 'older than KEEP_DAYS');
    assert.ok(fs.existsSync(path.join(b, 'removed', 'x')), 'removed/ is never pruned');
  });
});
