// "Lost at last reboot" (docs/04-apps-health-services.md; D18, D54): after the machine reboots, what was running before
// it and isn't listening now. It's only answerable because observations are recorded while processes are alive
// (state/observed.json, server/scanner/observations.ts); once a process is gone its directory can't be recovered.
//
//   boot.json says the boot time moved on ──▶ computeLost(observed.json, health samples, what's listening now)
//                                          ──▶ state/lost.json (kept across daemon restarts until dismissed)
//                                          ──▶ /api/state's `lost`, the dashboard's banner, `hallway lost`
//
// This file is the pure part and the file; server/live.ts wires it to the scanner, server/lost/actions.ts restarts.
import fs from 'node:fs';
import path from 'node:path';
import type { AppState } from '../../shared/api.js';
import type { Observation } from '../scanner/types.js';

/** A declared app, as computeLost needs it. */
export interface LostAppInput {
  slug: string;
  name: string;
  port: number;
  managed: boolean;
  command: string[] | null;
  cwd: string | null;
  projectDir: string | null;
}

/** One lost thing, as kept in state/lost.json. */
export interface LostRecord {
  /** The observation's id, or `app:<slug>` for an app known only from its health samples. */
  id: string;
  port: number;
  /** The declared app on its port when the reboot was noticed. */
  slug: string | null;
  /** What to call it: the app's name, else the observation's label. */
  label: string;
  /** Everything the scanner last recorded about it, or null for an app known only from its health samples. */
  observation: Observation | null;
  /** The command and directory to run it again: the app's `service:` block, else the observation's. */
  command: string[] | null;
  cwd: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

/** state/lost.json. */
export interface LostFile {
  version: 1;
  bootTime: string;
  previousBootTime: string | null;
  detectedAt: string;
  items: LostRecord[];
}

export interface ComputeLostInput {
  /** Every recorded observation (observed.json), live or not. */
  records: Observation[];
  /** This boot, and the one before it (null when boot.json didn't say). Milliseconds since the epoch. */
  bootTime: number;
  previousBootTime: number | null;
  /** Is it listening now? Called with each candidate: by id (the same process came back) or by port. */
  listening: (c: { id: string; port: number; slug: string | null }) => boolean;
  apps: LostAppInput[];
  /** Each app's last health sample before the boot (the prober's), for apps the scanner never recorded. */
  lastSample?: (slug: string) => { state: AppState; ts: number } | null;
  /**
   * How far before the last scan of the previous boot an observation may have been last seen and still count as
   * running at the end: a little over two scan intervals, so one slow scan doesn't drop anything.
   */
  windowMs: number;
}

/** The command an observation ran, as arguments: argv where the platform gives it, else the command line split. */
export function observedCommand(o: Pick<Observation, 'argv' | 'command'>): string[] | null {
  if (o.argv?.length) return [...o.argv];
  const parts = (o.command ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts : null;
}

/**
 * What was alive at the end of the previous boot and isn't listening now. "Alive at the end" is "seen in the last scans
 * before the boot": the newest lastSeen older than the boot time, minus `windowMs`. A server stopped by hand a day
 * before the reboot was last seen earlier than that, so it isn't reported (it wasn't lost to the reboot).
 */
export function computeLost(input: ComputeLostInput): LostRecord[] {
  const { bootTime, previousBootTime } = input;
  const before = input.records.filter((o) => {
    const t = Date.parse(o.lastSeen);
    return Number.isFinite(t) && t < bootTime && (previousBootTime === null || t >= previousBootTime);
  });
  const appOn = new Map(input.apps.map((a) => [a.port, a]));
  const out = new Map<number, LostRecord>();
  if (before.length) {
    const last = Math.max(...before.map((o) => Date.parse(o.lastSeen)));
    // newest first, so the latest observation on a port wins
    const alive = before.filter((o) => Date.parse(o.lastSeen) >= last - input.windowMs).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
    for (const o of alive) {
      if (out.has(o.port)) continue;
      const app = appOn.get(o.port) ?? null;
      if (input.listening({ id: o.id, port: o.port, slug: app?.slug ?? null })) continue;
      out.set(o.port, {
        id: o.id,
        port: o.port,
        slug: app?.slug ?? null,
        label: app?.name ?? o.label ?? `${o.process ?? 'unknown'} :${o.port}`,
        observation: o,
        command: app?.command ?? observedCommand(o),
        cwd: app?.command ? app.cwd : o.cwd,
        firstSeen: o.firstSeen,
        lastSeen: o.lastSeen,
      });
    }
  }
  // apps the scanner didn't record (it was off, or ignored their port), from the prober's last sample before the boot
  for (const a of input.apps) {
    if (out.has(a.port) || !input.lastSample) continue;
    const s = input.lastSample(a.slug);
    if (!s || (s.state !== 'healthy' && s.state !== 'unhealthy')) continue;
    if (previousBootTime !== null && s.ts < previousBootTime) continue;
    const id = `app:${a.slug}`;
    if (input.listening({ id, port: a.port, slug: a.slug })) continue;
    out.set(a.port, { id, port: a.port, slug: a.slug, label: a.name, observation: null, command: a.command, cwd: a.cwd ?? a.projectDir, firstSeen: null, lastSeen: new Date(s.ts).toISOString() });
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label) || a.port - b.port);
}

function writeAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** state/lost.json: the notice, kept until every item in it is dismissed (or the next reboot replaces it). */
export class LostStore {
  private current: LostFile | null = null;

  constructor(readonly file: string) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as LostFile;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.items) && typeof parsed.bootTime === 'string') this.current = parsed;
    } catch {
      /* missing or unreadable: state/ is safe to delete */
    }
  }

  /** The notice, or null when there's nothing in it. */
  get(): LostFile | null {
    return this.current?.items.length ? this.current : null;
  }

  item(id: string): LostRecord | null {
    return this.current?.items.find((i) => i.id === id) ?? null;
  }

  /** A new reboot: its notice replaces the last one. An empty list clears the file. */
  replace(f: LostFile) {
    this.current = f;
    this.save();
  }

  /** Dismiss one item (by id), or all of them. Returns how many went. */
  dismiss(id?: string): number {
    if (!this.current) return 0;
    const before = this.current.items.length;
    this.current.items = id === undefined ? [] : this.current.items.filter((i) => i.id !== id);
    const n = before - this.current.items.length;
    if (n) this.save();
    return n;
  }

  /** Record the app an action registered it as. */
  setSlug(id: string, slug: string) {
    const i = this.item(id);
    if (!i || i.slug === slug) return;
    i.slug = slug;
    this.save();
  }

  private save() {
    if (!this.current?.items.length) {
      this.current = null;
      fs.rmSync(this.file, { force: true });
      return;
    }
    writeAtomic(this.file, JSON.stringify(this.current, null, 2) + '\n');
  }
}
