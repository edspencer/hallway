// Tier-2 thumbnails (D13, D55): real screenshots, opt-in. Headless Chromium (installed by `hallway thumbs enable`,
// server/thumbs/browser.ts) opens a healthy app at 1280×800 at half scale, so the PNG is 640×400 with no image library
// in the daemon; it waits for the network to go quiet, ten seconds at most, and the picture goes in `cache/thumbs/`.
// One page at a time; the browser closes when there's nothing left to shoot for a couple of minutes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserLike, PlaywrightLike } from './browser.js';

export const SHOT = {
  viewport: { width: 1280, height: 800 },
  /** 1280×800 drawn at half scale: a 640×400 PNG. */
  scale: 0.5,
  /** Load plus network idle, at most. */
  waitMs: 10_000,
  /** Re-shoot after this long even if nothing changed. */
  maxAgeMs: 6 * 3600_000,
  /** After a failed shot, don't try that app again for this long (unless asked). */
  retryMs: 15 * 60_000,
  /** Close the browser when it has been idle this long. */
  idleCloseMs: 2 * 60_000,
};

export interface Shot {
  body: Uint8Array;
  contentType: 'image/png';
  etag: string;
  takenAt: number;
  pid: number | null;
  url: string;
}

interface Meta {
  slug: string;
  url: string;
  pid: number | null;
  takenAt: number;
  etag: string;
}

export interface ShotsOptions {
  /** Loads playwright-core; null when it isn't installed. */
  load: () => Promise<PlaywrightLike | null>;
  now?: () => number;
  /** A slug's screenshot appeared, changed or went. */
  onChange?: (slug: string) => void;
  log?: (s: string) => void;
}

const etagOf = (b: Uint8Array) => `"s${crypto.createHash('sha256').update(b).digest('hex').slice(0, 15)}"`;
const safe = (slug: string) => /^[a-z0-9][a-z0-9-]*$/.test(slug);

/** Is a screenshot due? None yet, the process behind the port changed, or it's older than six hours. */
export function shotDue(prev: { takenAt: number; pid: number | null; url: string } | null, cur: { pid: number | null; url: string }, now: number, failedAt?: number): boolean {
  if (failedAt !== undefined && now - failedAt < SHOT.retryMs) return false;
  if (!prev) return true;
  if (prev.url !== cur.url) return true;
  if (prev.pid !== null && cur.pid !== null && prev.pid !== cur.pid) return true;
  return now - prev.takenAt >= SHOT.maxAgeMs;
}

export class Shots {
  private mem = new Map<string, Shot | null>();
  private failed = new Map<string, number>();
  private queue: { slug: string; url: string; pid: number | null }[] = [];
  /** Queued or being shot now. */
  private pending = new Set<string>();
  private running: Promise<void> | null = null;
  private browser: BrowserLike | null = null;
  private launching: Promise<BrowserLike | null> | null = null;
  private idle: NodeJS.Timeout | null = null;
  private now: () => number;
  private stopped = false;

  constructor(
    private dir: string,
    private opts: ShotsOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  private file(slug: string, ext: 'png' | 'json') {
    return path.join(this.dir, `${slug}.${ext}`);
  }

  /** The screenshot for `slug`, if there is one (from memory, else the cache directory). */
  get(slug: string): Shot | null {
    if (!safe(slug)) return null;
    if (this.mem.has(slug)) return this.mem.get(slug)!;
    let shot: Shot | null = null;
    try {
      const meta = JSON.parse(fs.readFileSync(this.file(slug, 'json'), 'utf8')) as Meta;
      shot = { body: new Uint8Array(fs.readFileSync(this.file(slug, 'png'))), contentType: 'image/png', etag: meta.etag, takenAt: meta.takenAt, pid: meta.pid, url: meta.url };
    } catch {
      shot = null;
    }
    this.mem.set(slug, shot);
    return shot;
  }

  /** Queue a shot if one is due (`force`: regardless). Returns whether it was queued. */
  want(slug: string, url: string, pid: number | null, force = false): boolean {
    if (this.stopped || !safe(slug)) return false;
    if (!force && !shotDue(this.get(slug), { pid, url }, this.now(), this.failed.get(slug))) return false;
    if (this.pending.has(slug)) return false;
    this.pending.add(slug);
    this.queue.push({ slug, url, pid });
    this.pump();
    return true;
  }

  private pump() {
    if (this.running) return;
    this.running = (async () => {
      while (this.queue.length && !this.stopped) {
        const job = this.queue.shift()!;
        try {
          await this.take(job.slug, job.url, job.pid);
        } finally {
          this.pending.delete(job.slug);
        }
      }
    })().finally(() => {
      this.running = null;
      this.armIdle();
    });
  }

  private async getBrowser(): Promise<BrowserLike | null> {
    if (this.browser?.isConnected()) return this.browser;
    this.launching ??= (async () => {
      const pw = await this.opts.load();
      if (!pw) return null;
      // Chromium refuses to run sandboxed as root (containers, CI); a normal user keeps the sandbox
      const args = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
      try {
        this.browser = await pw.chromium.launch({ headless: true, args });
        return this.browser;
      } catch (e) {
        this.opts.log?.(`hallway: [thumbs] can't start the browser: ${(e as Error).message.split('\n')[0]}\n`);
        return null;
      }
    })().finally(() => (this.launching = null));
    return this.launching;
  }

  /** Shoot one app now. Resolves true if a picture was stored. */
  private async take(slug: string, url: string, pid: number | null): Promise<boolean> {
    if (this.idle) clearTimeout(this.idle);
    const browser = await this.getBrowser();
    if (!browser) {
      this.failed.set(slug, this.now());
      return false;
    }
    let body: Uint8Array | null = null;
    const started = this.now();
    try {
      const page = await browser.newPage({ viewport: SHOT.viewport, deviceScaleFactor: SHOT.scale });
      try {
        try {
          await page.goto(url, { waitUntil: 'load', timeout: SHOT.waitMs });
        } catch (e) {
          // slow to load is fine: shoot what's there; not answering at all is not
          if ((e as Error).name !== 'TimeoutError') throw e;
        }
        const left = SHOT.waitMs - (this.now() - started);
        if (left > 0) await page.waitForLoadState('networkidle', { timeout: left }).catch(() => {});
        body = new Uint8Array(await page.screenshot({ type: 'png' }));
      } finally {
        await page.close().catch(() => {});
      }
    } catch (e) {
      this.opts.log?.(`hallway: [thumbs] no screenshot of ${slug}: ${(e as Error).message.split('\n')[0]}\n`);
    }
    if (!body?.byteLength) {
      this.failed.set(slug, this.now());
      return false;
    }
    this.failed.delete(slug);
    const shot: Shot = { body, contentType: 'image/png', etag: etagOf(body), takenAt: this.now(), pid, url };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = (f: string) => path.join(this.dir, `.${path.basename(f)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
      const png = this.file(slug, 'png');
      const t1 = tmp(png);
      fs.writeFileSync(t1, body);
      fs.renameSync(t1, png);
      const json = this.file(slug, 'json');
      const t2 = tmp(json);
      const meta: Meta = { slug, url, pid, takenAt: shot.takenAt, etag: shot.etag };
      fs.writeFileSync(t2, JSON.stringify(meta) + '\n');
      fs.renameSync(t2, json);
    } catch (e) {
      this.opts.log?.(`hallway: [thumbs] can't save a screenshot: ${(e as Error).message}\n`);
    }
    const prev = this.mem.get(slug)?.etag ?? null;
    this.mem.set(slug, shot);
    if (prev !== shot.etag) this.opts.onChange?.(slug);
    return true;
  }

  private armIdle() {
    if (this.idle) clearTimeout(this.idle);
    if (!this.browser) return;
    this.idle = setTimeout(() => void this.closeBrowser(), SHOT.idleCloseMs);
    this.idle.unref?.();
  }

  private async closeBrowser() {
    const b = this.browser;
    this.browser = null;
    await b?.close().catch(() => {});
  }

  /** Screenshots turned off: drop the queue, close the browser and forget every picture. */
  async reset() {
    this.queue.length = 0;
    this.pending.clear();
    await this.running;
    if (this.idle) clearTimeout(this.idle);
    await this.closeBrowser();
    this.clear();
  }

  /** Forget every screenshot, on disk and in memory. */
  clear() {
    const had = [...this.mem.entries()].filter(([, s]) => s).map(([slug]) => slug);
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.mem.clear();
    this.failed.clear();
    for (const slug of had) this.opts.onChange?.(slug);
  }

  /** Wait for the queue to drain (tests, `hallway thumbs refresh`). */
  async settle() {
    while (this.running) await this.running;
  }

  /** Stop shooting and close the browser. */
  async stop() {
    this.stopped = true;
    this.queue.length = 0;
    this.pending.clear();
    if (this.idle) clearTimeout(this.idle);
    await this.running;
    await this.closeBrowser();
  }
}
