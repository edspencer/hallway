// Fronted mode, the daemon's side (D4, D43): whenever it starts, and whenever an app or config.yaml changes, generate
// Caddy's config, write it to generated/caddy.json (the file Caddy starts from after a reboot, so routes come back
// before the daemon does) and push it to Caddy's admin socket; and rewrite generated/fallback.html. In direct mode it
// does nothing. A push that fails (Caddy not running yet) is retried every 30 s; nothing here needs privileges.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import type { ServerEvent } from '../../shared/api.js';
import type { EventBus } from '../events.js';
import type { Store } from '../store/index.js';
import { atomicWrite } from '../store/safefs.js';
import { CaddyUnreachable, loadConfig } from './admin.js';
import { type ProxyAppInput, caddyConfig, caddyPaths, caddyText } from './caddy.js';
import { fallbackHtml } from './fallback.js';

export { caddyConfig, caddyPaths } from './caddy.js';

export interface ProxyStatus {
  mode: 'direct' | 'fronted';
  /** When the config last changed and was written. */
  generatedAt: string | null;
  /** The last push: ok, or why not. */
  pushedAt: string | null;
  pushError: string | null;
  /** Names that couldn't be routed. */
  problems: string[];
}

export interface ProxyOptions {
  store: Store;
  bus: EventBus;
  /** The daemon's bound port: the dashboard host's upstream. */
  daemonPort: number;
  /** How to restart the daemon, for the fallback page. */
  restart?: readonly string[];
  retryMs?: number;
  /** Is [::1] usable? Detected once by default. */
  ipv6?: boolean;
  log?: (s: string) => void;
}

/** The commands that restart the daemon, for people: Hallway's own, then the service manager's. */
export function restartCommands(serviceManager: 'launchd' | 'systemd', uid = os.userInfo().uid): string[] {
  return ['hallway service restart', serviceManager === 'launchd' ? `launchctl kickstart -k gui/${uid}/hallway.daemon` : 'systemctl --user restart hallway-daemon.service'];
}

/** Can this machine listen on IPv6 loopback? (Some containers and hardened hosts have it off; Caddy would then fail.) */
export function ipv6Loopback(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(0, '::1', () => s.close(() => resolve(true)));
  });
}

/** The apps Caddy should route: declared, with a config that parsed and validated. */
export function proxyApps(store: Store): ProxyAppInput[] {
  return [...store.apps.entries()].flatMap(([slug, e]) => (e.value ? [{ slug, config: e.value }] : []));
}

export async function startProxy({ store, bus, daemonPort, restart = ['hallway service restart'], retryMs = 30_000, ipv6, log = (s) => process.stderr.write(s) }: ProxyOptions) {
  const v6 = ipv6 ?? (await ipv6Loopback());
  const paths = caddyPaths(store.home);
  const status: ProxyStatus = { mode: 'direct', generatedAt: null, pushedAt: null, pushError: null, problems: [] };
  let pushed: string | null = null;
  let fallbackKey: string | null = null;
  let loggedProblems = '';
  let retry: NodeJS.Timeout | null = null;
  let chain = Promise.resolve();
  let stopped = false;

  const once = async () => {
    const config = store.currentConfig();
    status.mode = config.mode;
    if (config.mode !== 'fronted') return;
    const apps = proxyApps(store);
    const out = caddyConfig({ home: store.home, config, apps, daemonPort, ipv6: v6 });
    status.problems = out.problems;
    if (out.problems.join('\n') !== loggedProblems) {
      loggedProblems = out.problems.join('\n');
      for (const p of out.problems) log(`hallway: [proxy] ${p}\n`);
    }
    const text = caddyText(out.json);
    fs.mkdirSync(paths.generated, { recursive: true });
    fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    if (readOr(paths.config) !== text) {
      atomicWrite(paths.config, text);
      status.generatedAt = new Date().toISOString();
    }
    const fallbackInput = { config, apps, restart, directUrl: `http://localhost:${daemonPort}` };
    const key = fallbackHtml({ ...fallbackInput, now: new Date(0) });
    if (key !== fallbackKey || !fs.existsSync(paths.fallback)) {
      atomicWrite(paths.fallback, fallbackHtml(fallbackInput));
      fallbackKey = key;
    }
    if (text === pushed) return;
    try {
      await loadConfig(paths.socket, text);
      pushed = text;
      status.pushedAt = new Date().toISOString();
      if (status.pushError) log('hallway: [proxy] Caddy has the current config again\n');
      status.pushError = null;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== status.pushError) log(`hallway: [proxy] ${msg}${e instanceof CaddyUnreachable ? '; retrying every 30 s (`hallway doctor` checks the setup)' : ''}\n`);
      status.pushError = msg;
      if (!retry && !stopped) {
        retry = setTimeout(() => {
          retry = null;
          void refresh();
        }, retryMs);
        retry.unref();
      }
    }
  };

  /** Regenerate and push now (serialised: one at a time, in order). */
  const refresh = () => {
    chain = chain.then(once).catch((e) => log(`hallway: [proxy] ${(e as Error).message}\n`));
    return chain;
  };

  const unsubscribe = bus.subscribe(
    (e: ServerEvent) => {
      if (e.type === 'app' || e.type === 'apps' || e.type === 'config') void refresh();
    },
    { internal: true },
  );
  await refresh();
  return {
    status: () => ({ ...status }),
    refresh,
    stop: async () => {
      stopped = true;
      unsubscribe();
      if (retry) clearTimeout(retry);
      await chain;
    },
  };
}

function readOr(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
