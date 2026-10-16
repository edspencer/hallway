// Observations (docs/04-apps-health-services.md, "Observed listeners", steps 5–6; D18): stable ids, worktree-sibling
// labels, and the machine-written records in state/: observed.json (last-known identity of everything seen, kept so
// that what was lost at a reboot can be reported later) and boot.json (the boot time, to notice the reboot).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ObservedListener } from '../../shared/api.js';

/**
 * The command, normalised so a restart produces the same id: the executable reduced to its name (`/usr/bin/node` and
 * `node` are the same server), whitespace collapsed.
 */
export function normaliseCommand(argv: string[] | null, command: string | null): string {
  const parts = argv?.length ? [...argv] : (command ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length) parts[0] = path.basename(parts[0]);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** A stable observation id: PIDs change on every restart, but the project, port and command don't. */
export function observationId(root: string | null, port: number, normalisedCommand: string): string {
  return crypto.createHash('sha256').update(`${root ?? ''}\0${port}\0${normalisedCommand}`).digest('hex').slice(0, 16);
}

/**
 * What to call each listener. Worktree siblings (listeners from different checkouts of one repository) become
 * `repo @ branch`, so three copies of one dashboard on three ports can be told apart; a lone linked worktree is
 * labelled the same way. Everything else is its project name, else its process name and port.
 */
export function labelListeners(list: ObservedListener[]): void {
  const checkouts = new Map<string, Set<string>>();
  for (const l of list) {
    if (!l.git) continue;
    const s = checkouts.get(l.git.commonDir) ?? new Set();
    s.add(l.git.toplevel);
    checkouts.set(l.git.commonDir, s);
  }
  for (const l of list) {
    const g = l.git;
    if (g && g.branch && (g.worktree || (checkouts.get(g.commonDir)?.size ?? 0) > 1)) l.label = `${g.repo} @ ${g.branch}`;
    else l.label = l.project?.name ?? `${l.process ?? 'unknown'} :${l.port}`;
  }
}

/** state/observed.json. */
interface ObservedFile {
  version: 1;
  updatedAt: string;
  observations: Record<string, ObservedListener>;
}

/** Records not seen for this long are dropped from observed.json. */
export const OBSERVED_RETENTION_MS = 90 * 24 * 3600_000;

function writeAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** The observed-listener records: every listener ever seen, by id, with first-seen, last-seen and last identity. */
export class ObservedStore {
  private records = new Map<string, ObservedListener>();

  constructor(private file: string) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ObservedFile;
      for (const [id, r] of Object.entries(parsed.observations ?? {})) if (r && typeof r === 'object') this.records.set(id, r);
    } catch {
      /* missing or unreadable: state/ is safe to delete, so start empty */
    }
  }

  get(id: string) {
    return this.records.get(id);
  }

  all() {
    return [...this.records.values()];
  }

  /** Merge one scan's listeners in: keeps each record's firstSeen, sets lastSeen, replaces the identity. */
  record(listeners: ObservedListener[], now: number) {
    const at = new Date(now).toISOString();
    for (const l of listeners) {
      const prev = this.records.get(l.id);
      l.firstSeen = prev?.firstSeen ?? at;
      l.lastSeen = at;
      this.records.set(l.id, { ...l });
    }
    for (const [id, r] of this.records) if (now - Date.parse(r.lastSeen) > OBSERVED_RETENTION_MS) this.records.delete(id);
    const out: ObservedFile = { version: 1, updatedAt: at, observations: Object.fromEntries(this.records) };
    writeAtomic(this.file, JSON.stringify(out, null, 2) + '\n');
  }
}

/** state/boot.json. */
export interface BootRecord {
  /** ISO time the machine booted. */
  bootTime: string;
  checkedAt: string;
}

/**
 * Read the previous boot time from state/boot.json and record the current one. `rebooted` is true when the boot time
 * moved on since the daemon last looked, which is when "Lost at last reboot" (v1) applies. A small tolerance absorbs
 * clock adjustments: boot time is derived from the wall clock on both platforms.
 */
export function recordBoot(file: string, bootTime: number | null, now = Date.now()) {
  let previous: BootRecord | null = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first run */
  }
  if (bootTime === null) return { bootTime: null, previous, rebooted: false };
  const rec: BootRecord = { bootTime: new Date(bootTime).toISOString(), checkedAt: new Date(now).toISOString() };
  writeAtomic(file, JSON.stringify(rec, null, 2) + '\n');
  const rebooted = previous !== null && Math.abs(Date.parse(previous.bootTime) - bootTime) > 60_000;
  return { bootTime: rec.bootTime, previous, rebooted };
}
