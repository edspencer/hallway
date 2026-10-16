// Log rotation for managed services and the daemon (docs/04-apps-health-services.md, "Logs"; Q-LOG-ROTATION, D40).
// launchd and systemd append to a log file they hold open, so renaming it would leave them writing to the renamed
// file. Instead: copy, then truncate in place. Every `*.log` in the data home's logs/ above `services.logMaxBytes`
// is copied to `<file>.1` (older generations shift up to `services.logGenerations`, the oldest dropped) and then
// truncated to zero. Only the last `logMaxBytes` of it are copied (from the first line break in that window), so no
// rotated file is ever larger than the limit, however much was written between two checks. Lines written between the
// copy and the truncation are lost: the price of not signalling the process.
import fs from 'node:fs';
import path from 'node:path';
import { dataPaths } from '../config.js';
import type { Store } from '../store/index.js';

export interface RotateOptions {
  maxBytes: number;
  generations: number;
}

/** Copy the last `max` bytes of `from` (starting after a line break, when there is one) to `to`. */
function copyTail(from: string, to: string, size: number, max: number) {
  const start = Math.max(0, size - max);
  const fd = fs.openSync(from, 'r');
  const out = fs.openSync(`${to}.tmp-${process.pid}`, 'w');
  try {
    let pos = start;
    if (start > 0) {
      // skip the partial first line
      const probe = Buffer.alloc(Math.min(4096, size - start));
      const n = fs.readSync(fd, probe, 0, probe.length, start);
      const nl = probe.subarray(0, n).indexOf(10);
      if (nl >= 0) pos = start + nl + 1;
    }
    const buf = Buffer.alloc(1024 * 1024);
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (n <= 0) break;
      fs.writeSync(out, buf, 0, n);
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
    fs.closeSync(out);
  }
  fs.renameSync(`${to}.tmp-${process.pid}`, to);
}

/** Rotate one file if it's over the limit. True if it was rotated. */
export function rotateFile(file: string, { maxBytes, generations }: RotateOptions): boolean {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;
  const gen = Math.max(1, generations);
  fs.rmSync(`${file}.${gen}`, { force: true });
  for (let i = gen - 1; i >= 1; i--) {
    try {
      fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {
      /* that generation doesn't exist yet */
    }
  }
  copyTail(file, `${file}.1`, size, maxBytes);
  // truncate in place: the service manager's descriptor (opened for appending) carries on at the new end
  fs.truncateSync(file, 0);
  return true;
}

/** Rotate every `*.log` in `dir` that's over the limit. Returns the files rotated. */
export function rotateLogs(dir: string, opts: RotateOptions): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const done: string[] = [];
  for (const n of names.filter((f) => f.endsWith('.log')).sort()) {
    const f = path.join(dir, n);
    try {
      if (rotateFile(f, opts)) done.push(f);
    } catch (e) {
      process.stderr.write(`hallway: rotating ${f}: ${(e as Error).message}\n`);
    }
  }
  return done;
}

/** The daemon's rotation timer: now, then every `intervalMs`, with config.yaml's limits at each tick. */
export function startLogRotation(store: Store, { intervalMs = 15_000 } = {}): () => void {
  const tick = () => {
    const { logMaxBytes, logGenerations } = store.currentConfig().services;
    rotateLogs(dataPaths(store.home).logs, { maxBytes: logMaxBytes, generations: logGenerations });
  };
  tick();
  const t = setInterval(tick, intervalMs);
  t.unref();
  return () => clearInterval(t);
}
