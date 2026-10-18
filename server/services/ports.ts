// Ports for new apps (docs/04-apps-health-services.md, "Ports and environment"; D17). An app that has a port keeps
// it, always. One that doesn't gets the first port in `ports.assignRange` that no app declares, nothing is listening
// on, and isn't a well-known port, and keeps that one from then on: it's stored in the YAML.
import net from 'node:net';
import { candidates, lookedAt } from '../loopback.js';
import type { Store } from '../store/index.js';

/** Ports in or near the default range (5100–5999) that well-known software uses: never handed out. */
export const WELL_KNOWN_PORTS: ReadonlySet<number> = new Set([
  5173, 5174, // Vite's dev and preview servers
  5222, 5269, // XMPP
  5353, // mDNS
  5432, 5433, // PostgreSQL
  5500, 5501, // VS Code Live Server
  5555, // Prisma Studio
  5601, // Kibana
  5622, // Local Review
  5672, // AMQP (RabbitMQ)
  5900, 5901, // VNC / macOS Screen Sharing
  5984, // CouchDB
]);

/** Is something answering on host:port? (A refused connection, fast on loopback, means no.) */
export function isListening(port: number, host = '127.0.0.1', timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/**
 * The address something answers on for an app's `host:` and port, or null: for a loopback or wildcard host, 127.0.0.1
 * and ::1, the configured family first (a server that binds `localhost` on a Mac is often on ::1 only; D68).
 */
export async function answeringAt(port: number, host = '127.0.0.1', timeoutMs = 300): Promise<string | null> {
  for (const a of candidates(host)) if (await isListening(port, a, timeoutMs)) return a;
  return null;
}

/** Can we bind 127.0.0.1:port? (Catches a listener a connect missed, e.g. one that accepts nothing.) */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '127.0.0.1', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

export async function portFree(port: number): Promise<boolean> {
  if (await answeringAt(port)) return false;
  return canBind(port);
}

export class NoFreePortError extends Error {}

/** The first usable port in config.yaml's `ports.assignRange`. */
export async function assignPort(store: Store, { isFree = portFree, extraTaken = [] as number[] } = {}): Promise<number> {
  const [lo, hi] = store.currentConfig().ports.assignRange;
  const taken = new Set<number>(extraTaken);
  for (const e of store.apps.values()) if (e.value) taken.add(e.value.port);
  for (let p = lo; p <= hi; p++) {
    if (taken.has(p) || WELL_KNOWN_PORTS.has(p)) continue;
    if (await isFree(p)) return p;
  }
  throw new NoFreePortError(`no free port in ports.assignRange [${lo}, ${hi}]; widen it in config.yaml or pass --port`);
}

/**
 * Wait until the app's host:port accepts connections (for a loopback host, on 127.0.0.1 or ::1: `address` says which),
 * or `timeoutMs` passes. `abort` is asked between tries.
 */
export async function waitForPort(
  port: number,
  host: string,
  { timeoutMs = 30_000, intervalMs = 250, abort }: { timeoutMs?: number; intervalMs?: number; abort?: () => Promise<string | null> } = {},
): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastAbortCheck = 0;
  for (;;) {
    const address = await answeringAt(port, host);
    if (address) return { ok: true, address };
    if (Date.now() >= deadline) return { ok: false, reason: `nothing was listening on ${lookedAt(host, port)} after ${Math.round(timeoutMs / 1000)} s` };
    if (abort && Date.now() - lastAbortCheck >= 1000) {
      lastAbortCheck = Date.now();
      const why = await abort();
      if (why) return { ok: false, reason: why };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
