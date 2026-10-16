// The only places the daemon writes, renames or removes files under the data home (Local Review's safefs.ts):
//  - every write is atomic: a fresh temp file in the same directory, renamed over the target. Temp names contain
//    `.tmp`, which the watcher ignores, so a half-written file is never read;
//  - nothing is deleted: a removed entity's file is moved into backups/removed/, and a rename never replaces an
//    existing file (renameNoClobber);
//  - the only unlink is our own temp file after a failed write, or the old name of a file that has just been
//    hard-linked to its new name (so the data is still there).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Our temp files: `.<name>.tmp-<pid>-<random>`. */
const TEMP_NAME = /^\..+\.tmp-\d+-[0-9a-f]{8}$/;
/** Anything the watcher and backups should skip: our temp files, and other tools' (`*.tmp`, `foo.yaml.tmp.123`). */
export const isTempName = (name: string) => name.includes('.tmp');

export class ExistsError extends Error {
  code = 'EEXIST';
}

/**
 * Write `text` to `file` atomically: a temp file in the same directory, then rename. With `createOnly`, never replace
 * an existing `file` (throws ExistsError), even one that appears while writing.
 */
export function atomicWrite(file: string, text: string, { createOnly = false } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
    if (createOnly) renameNoClobber(tmp, file);
    else fs.renameSync(tmp, file);
  } catch (e) {
    removeOwnTemp(tmp);
    throw e;
  }
}

function removeOwnTemp(tmp: string) {
  if (!TEMP_NAME.test(path.basename(tmp))) return;
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* already gone */
  }
}

/** Rename `from` to `to`, failing with ExistsError if `to` exists (fs.rename would silently replace it). */
export function renameNoClobber(from: string, to: string) {
  try {
    fs.linkSync(from, to); // atomic, and fails if `to` exists
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new ExistsError(`${to} already exists; not replacing it`);
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw e;
    // a file system without hard links: check, then rename
    if (fs.existsSync(to)) throw new ExistsError(`${to} already exists; not replacing it`);
    fs.renameSync(from, to);
    return;
  }
  const a = fs.statSync(from);
  const b = fs.statSync(to);
  if (a.ino !== b.ino || a.dev !== b.dev) return; // should not happen; keep both names rather than risk anything
  fs.unlinkSync(from); // drop the old name of a file that is now also linked at `to`
}

/**
 * Move `file` (somewhere under `home`) into `backups/removed/<stamp>/<the same relative path>`, never replacing
 * anything. Returns the new path. This is what "delete" means for every human-editable file.
 */
export function moveToRemoved(home: string, file: string, stamp: string): string {
  const rel = path.relative(home, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${file} is not in the data home`);
  for (let n = 1; n < 1000; n++) {
    const dest = path.join(home, 'backups', 'removed', n === 1 ? stamp : `${stamp}-${n}`, rel);
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      renameNoClobber(file, dest);
      return dest;
    } catch (e) {
      if (!(e instanceof ExistsError)) throw e;
    }
  }
  throw new Error(`no free name in backups/removed for ${rel}`);
}
