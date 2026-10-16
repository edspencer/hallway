// Ports for new apps (docs/04-apps-health-services.md, "Ports and environment"; D17). An app that has a port keeps
// it, always. One that doesn't gets the first port in `ports.assignRange` that no app declares, nothing is listening
// on, and isn't a well-known port, and keeps that one from then on: it's stored in the YAML.
import net from 'node:net';
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

/** Can we bind 127.0.0.1:port? (Catches a listener a connect missed, e.g. one that accepts nothing.) */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '127.0.0.1', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

export async function portFree(port: number): Promise<boolean> {
  if ((await isListening(port, '127.0.0.1')) || (await isListening(port, '::1'))) return false;
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

/** Wait until host:port accepts connections, or `timeoutMs` passes. `abort` is asked between tries. */
export async function waitForPort(
  port: number,
  host: string,
  { timeoutMs = 30_000, intervalMs = 250, abort }: { timeoutMs?: number; intervalMs?: number; abort?: () => Promise<string | null> } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  const target = host === '0.0.0.0' || host === '*' ? '127.0.0.1' : host === '::' ? '::1' : host;
  let lastAbortCheck = 0;
  for (;;) {
    if (await isListening(port, target)) return { ok: true };
    if (Date.now() >= deadline) return { ok: false, reason: `nothing was listening on port ${port} after ${Math.round(timeoutMs / 1000)} s` };
    if (abort && Date.now() - lastAbortCheck >= 1000) {
      lastAbortCheck = Date.now();
      const why = await abort();
      if (why) return { ok: false, reason: why };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
