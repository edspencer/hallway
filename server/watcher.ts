// Watching the data home's human-editable files (docs/02-architecture.md, "Live updates"). A file changed by an editor
// or an agent goes through exactly the same path as an API write: the store re-reads it (keeping the last good version
// if it's now broken) and the bus tells every open dashboard. Changes are debounced per file (DEBOUNCE_MS), so an
// editor's write-rename-chmod or a `git checkout` becomes one event per file; the store's own writes have already been
// read and announced, so their echo here finds nothing new and sends nothing.
import path from 'node:path';
import { watch } from 'chokidar';
import { DEBOUNCE_MS, type EventBus } from './events.js';
import { MACHINE_DIRS } from './store/home.js';
import { isTempName } from './store/safefs.js';
import type { Store } from './store/index.js';

export interface Watcher {
  /** Resolves once the initial scan is done and changes will be seen. */
  ready: Promise<void>;
  close(): Promise<void>;
}

export function startWatcher(store: Store, bus: EventBus = store.bus, debounceMs = DEBOUNCE_MS): Watcher {
  const home = store.home;
  const machine = new Set<string>(MACHINE_DIRS);
  const ignored = (p: string) => {
    const rel = path.relative(home, p);
    if (rel === '' || rel.startsWith('..')) return false;
    const parts = rel.split(path.sep);
    if (machine.has(parts[0]) || parts[0].startsWith('.')) return true; // backups/, state/, .git/, …
    if (parts.length === 1) return !['config.yaml', 'ignore.yaml', 'apps', 'bookmarks'].includes(parts[0]);
    return isTempName(parts[parts.length - 1]) || parts.length > 2;
  };
  const onPath = (p: string) => {
    if (ignored(p)) return;
    // one key per file, written the same on every OS (the store names files with `/` too)
    bus.emitSoon(`file:${path.relative(home, p).split(path.sep).join('/')}`, () => store.reloadPath(p), debounceMs);
  };
  const w = watch(home, { ignoreInitial: true, depth: 1, ignored })
    .on('add', onPath)
    .on('change', onPath)
    .on('unlink', onPath)
    .on('addDir', onPath)
    .on('unlinkDir', onPath)
    .on('error', (err) => process.stderr.write(`hallway: [watch] ${(err as Error).message}\n`));
  const ready = new Promise<void>((res) => w.once('ready', () => res()));
  return { ready, close: () => w.close() };
}
