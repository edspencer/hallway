// Automatic snapshots of the human-editable files (config.yaml, ignore.yaml, apps/, bookmarks/) into
// backups/<timestamp>/, a plain copy with the same layout, so restoring is copying files back. Taken when the daemon
// starts, hourly while it runs, and before anything destructive (a delete, or a write that replaces a file), each only
// if something changed since the newest snapshot. Pruning keeps the newest KEEP_RECENT snapshots plus the first of
// each UTC day for KEEP_DAYS days, and only ever removes directories directly inside backups/ whose names are snapshot
// timestamps. Files removed through Hallway go to backups/removed/ (safefs.ts) and are never pruned.
// Ported from Local Review's server/backups.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isTempName } from './safefs.js';

export const KEEP_RECENT = 50;
export const KEEP_DAYS = 30;
export const INTERVAL_MS = 60 * 60 * 1000;

/** What a snapshot holds, relative to the data home. */
export const EDITABLE = ['config.yaml', 'ignore.yaml', 'apps', 'bookmarks'];

/** `2026-10-09T08-45-12Z` (ISO 8601 UTC, ':' → '-' so it's a valid file name everywhere), maybe `-2`, `-3`… */
export const SNAPSHOT_NAME = /^(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}Z(?:-\d{1,3})?$/;

export function snapshotName(d: Date) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

/** Every editable file under `root` (a data home or a snapshot), as sorted relative paths. Symlinks are skipped. */
function editableFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const p = path.join(root, rel);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.isFile()) out.push(rel);
    else if (st.isDirectory())
      for (const name of fs.readdirSync(p).sort()) {
        if (!isTempName(name) && !name.startsWith('.')) walk(path.join(rel, name));
      }
  };
  for (const e of EDITABLE) walk(e);
  return out;
}

/** A hash of every editable file's relative path and contents; null when there are none. */
export function fingerprint(root: string): string | null {
  const files = editableFiles(root);
  if (!files.length) return null;
  const h = crypto.createHash('sha256');
  for (const rel of files) h.update(`${rel.split(path.sep).join('/')}\0`).update(fs.readFileSync(path.join(root, rel))).update('\0');
  return h.digest('hex');
}

/** Snapshot directory names, oldest first (the names sort chronologically). */
export function listSnapshots(backupsDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(backupsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && SNAPSHOT_NAME.test(e.name))
    .map((e) => e.name)
    .sort(compareNames);
}

const splitName = (n: string): [string, number] => {
  const m = /^(.*Z)(?:-(\d+))?$/.exec(n)!;
  return [m[1], m[2] ? Number(m[2]) : 1];
};
function compareNames(a: string, b: string) {
  const [ta, na] = splitName(a);
  const [tb, nb] = splitName(b);
  return ta < tb ? -1 : ta > tb ? 1 : na - nb;
}

/**
 * Copy the editable files to `backups/<timestamp>/` unless there are none or they match the newest snapshot. Built
 * under a dot-name and renamed into place, so a snapshot directory is always complete. Returns its name, or null.
 */
export function takeSnapshot(home: string, now = new Date()): string | null {
  const backupsDir = path.join(home, 'backups');
  const fp = fingerprint(home);
  if (!fp) return null;
  const existing = listSnapshots(backupsDir);
  const newest = existing[existing.length - 1];
  if (newest && fingerprint(path.join(backupsDir, newest)) === fp) return null;
  fs.mkdirSync(backupsDir, { recursive: true });
  const base = snapshotName(now);
  let name = base;
  for (let n = 2; fs.existsSync(path.join(backupsDir, name)); n++) name = `${base}-${n}`;
  const partial = path.join(backupsDir, `.partial-${name}-${process.pid}`);
  for (const rel of editableFiles(home)) {
    fs.mkdirSync(path.dirname(path.join(partial, rel)), { recursive: true });
    fs.copyFileSync(path.join(home, rel), path.join(partial, rel), fs.constants.COPYFILE_EXCL);
  }
  const dest = path.join(backupsDir, name);
  if (fs.existsSync(dest)) throw new Error(`${dest} appeared while snapshotting; leaving the copy at ${partial}`);
  fs.renameSync(partial, dest);
  return name;
}

/** Which snapshots to keep: the newest KEEP_RECENT, plus the first of each UTC day in the last KEEP_DAYS days. */
export function snapshotsToKeep(names: string[], now = new Date()): Set<string> {
  const sorted = [...names].sort(compareNames);
  const keep = new Set(sorted.slice(-KEEP_RECENT));
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const seenDays = new Set<string>();
  for (const n of sorted) {
    const day = SNAPSHOT_NAME.exec(n)![1];
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    if (day >= cutoff) keep.add(n);
  }
  return keep;
}

/** Remove the snapshots `snapshotsToKeep` doesn't keep (never the newest). Returns the removed names. */
export function pruneSnapshots(home: string, now = new Date()): string[] {
  const backupsDir = path.join(home, 'backups');
  const names = listSnapshots(backupsDir);
  const keep = snapshotsToKeep(names, now);
  const newest = names[names.length - 1];
  const removed: string[] = [];
  for (const n of names) {
    if (keep.has(n) || n === newest) continue;
    const target = path.join(backupsDir, n);
    // only a real directory directly inside backups/ with a snapshot's name
    const st = fs.lstatSync(target);
    if (!SNAPSHOT_NAME.test(n) || path.dirname(target) !== backupsDir || !st.isDirectory() || st.isSymbolicLink()) continue;
    fs.rmSync(target, { recursive: true });
    removed.push(n);
  }
  return removed;
}

/** Snapshot (if changed) and prune. Never throws: a failed snapshot must not take the daemon down. */
export function snapshotNow(home: string, now = new Date(), log: (s: string) => void = () => {}) {
  try {
    const name = takeSnapshot(home, now);
    if (name) log(`[backups] snapshot backups/${name}`);
    const removed = pruneSnapshots(home, now);
    if (removed.length) log(`[backups] pruned ${removed.length} old snapshot(s)`);
    return name;
  } catch (e) {
    process.stderr.write(`hallway: [backups] snapshot failed: ${(e as Error).message}\n`);
    return null;
  }
}

/** On start, then hourly. Returns a function that stops the timer. */
export function startSnapshots(home: string, log?: (s: string) => void) {
  snapshotNow(home, new Date(), log);
  const t = setInterval(() => snapshotNow(home, new Date(), log), INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
