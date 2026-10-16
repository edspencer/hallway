// Throwaway directories under the OS temp dir. Tests never touch a real data home (~/.hallway).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function tmpDir(prefix: string) {
  // .native: on Windows it also expands 8.3 short names (C:\Users\RUNNER~1), which git and the OS report in full
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A Store on a fresh throwaway data home, with its own event bus (never the daemon's), initialised. */
export async function tmpStore(prefix = 'hw-test-home-') {
  const { Store } = await import('../server/store/index.ts');
  const { EventBus } = await import('../server/events.ts');
  const home = tmpDir(prefix);
  const bus = new EventBus();
  const store = new Store(home, { bus }).init();
  return { home, bus, store, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

/**
 * For test files that open real sockets, child processes or timers: once the file's tests are done, the process should
 * exit by itself. If something is still holding it open 10 s later, name what it is and fail, rather than leaving
 * `node --test` waiting for ever (on CI, until the job times out). Call once, at the top level of the file.
 */
export function exitWatchdog(ms = 10_000) {
  return import('node:test').then(({ after }) =>
    after(() => {
      setTimeout(() => {
        process.stderr.write(`test file still running ${ms} ms after its tests ended; open: ${process.getActiveResourcesInfo().join(', ')}\n`);
        process.exit(1);
      }, ms).unref();
    }),
  );
}

/**
 * For `{ skip }` on tests of something Windows doesn't have (D58), with the reason node:test prints: false elsewhere.
 * Only for what is genuinely POSIX-only; everything else runs on every OS.
 */
export const onWindows = (reason: string): false | string => (process.platform === 'win32' ? `not on Windows: ${reason}` : false);
