// Managed services' logs (docs/04-apps-health-services.md, "Logs"): `logs/<slug>.out.log` and `.err.log`, written
// by launchd / systemd, read here for `hallway logs`, `hallway run`'s failure report and GET /api/apps/:slug/logs;
// rotated by the daemon (rotate.ts).
import fs from 'node:fs';
import { logFiles } from './spec.js';

/** The last `n` lines of a file ('' if it doesn't exist), reading back from the end rather than the whole file. */
export function tailFile(file: string, n: number): string {
  if (n <= 0) return '';
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return '';
  }
  try {
    const size = fs.fstatSync(fd).size;
    const chunk = 64 * 1024;
    let pos = size;
    let text = '';
    while (pos > 0) {
      const len = Math.min(chunk, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      text = buf.toString('utf8') + text;
      // n lines need n newlines before them (plus the file's last one)
      if ((text.match(/\n/g)?.length ?? 0) > n) break;
    }
    if (!text) return '';
    return text.replace(/\n$/, '').split('\n').slice(-n).join('\n') + '\n';
  } finally {
    fs.closeSync(fd);
  }
}

export interface AppLogs {
  out: { file: string; text: string };
  err: { file: string; text: string };
}

export function appLogs(home: string, name: string, lines: number): AppLogs {
  const f = logFiles(home, name);
  return { out: { file: f.out, text: tailFile(f.out, lines) }, err: { file: f.err, text: tailFile(f.err, lines) } };
}

/** Both logs, `tail`-style: a `==> file <==` header before each that has anything in it. */
export function formatLogs(l: AppLogs): string {
  const parts = [l.out, l.err].filter((p) => p.text).map((p) => `==> ${p.file} <==\n${p.text}`);
  return parts.join('\n');
}

/**
 * Follow files as they grow (`hallway logs --follow`), calling `write` with new text, prefixed by a header whenever
 * the output switches file. A file that shrinks has been rotated (copied and truncated): read it from the start.
 * Returns a function that stops.
 */
export function followFiles(files: string[], write: (s: string) => void, { intervalMs = 250 } = {}): () => void {
  const offsets = new Map(files.map((f) => [f, size(f)]));
  let last: string | null = null;
  const tick = () => {
    for (const f of files) {
      const s = size(f);
      let from = offsets.get(f) ?? 0;
      if (s < from) from = 0;
      if (s > from) {
        const fd = fs.openSync(f, 'r');
        const buf = Buffer.alloc(s - from);
        fs.readSync(fd, buf, 0, buf.length, from);
        fs.closeSync(fd);
        if (last !== f && files.length > 1) write(`\n==> ${f} <==\n`);
        last = f;
        write(buf.toString('utf8'));
      }
      offsets.set(f, s);
    }
  };
  const t = setInterval(tick, intervalMs);
  return () => clearInterval(t);
}

function size(f: string) {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
}
