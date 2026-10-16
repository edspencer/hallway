// state/daemon.json: where the running daemon actually listens. The CLI looks for the daemon on config.yaml's port
// first (D44); this is its second place to look, for when that isn't where the daemon is: config.yaml is broken (the
// daemon keeps its last good port, the CLI would fall back to the default), it was edited after the daemon started,
// or the daemon was started with --port or $PORT (D46).
import fs from 'node:fs';
import path from 'node:path';
import { dataPaths } from './config.js';
import { atomicWrite } from './store/safefs.js';

export interface DaemonRecord {
  pid: number;
  port: number;
  startedAt: string;
}

const file = (home: string) => path.join(dataPaths(home).state, 'daemon.json');

export function writeDaemonRecord(home: string, port: number, pid = process.pid): void {
  try {
    atomicWrite(file(home), JSON.stringify({ pid, port, startedAt: new Date().toISOString() } satisfies DaemonRecord) + '\n');
  } catch {
    /* best effort: the CLI still finds a daemon on config.yaml's port */
  }
}

/** The record, or null if there's none, it's unreadable, or its process is gone. */
export function readDaemonRecord(home: string): DaemonRecord | null {
  let r: Partial<DaemonRecord>;
  try {
    r = JSON.parse(fs.readFileSync(file(home), 'utf8')) as Partial<DaemonRecord>;
  } catch {
    return null;
  }
  if (!Number.isInteger(r.pid) || !Number.isInteger(r.port) || typeof r.startedAt !== 'string') return null;
  try {
    process.kill(r.pid!, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') return null;
  }
  return r as DaemonRecord;
}

/** Remove the record if it's this process's (a newer daemon may have replaced it). */
export function removeDaemonRecord(home: string, pid = process.pid): void {
  try {
    const r = JSON.parse(fs.readFileSync(file(home), 'utf8')) as Partial<DaemonRecord>;
    if (r.pid === pid) fs.rmSync(file(home), { force: true });
  } catch {
    /* none, or unreadable */
  }
}
