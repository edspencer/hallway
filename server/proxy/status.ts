// Local domains as the dashboard and the startup banner see them (D63): whether fronted mode can work on this platform,
// whether it's on, and the addresses it gives. The daemon only reports: turning it on is `hallway setup`, which runs
// the privileged steps (AGENTS.md: never root in the daemon). In fronted mode, `GET /api/fronting` also runs doctor's
// networking checks (server/proxy/doctor.ts): read-only, but they probe Caddy, the redirect and the resolver, so they're
// run on request and cached for a few seconds, never on every `/api/state`.
import os from 'node:os';
import path from 'node:path';
import type { FrontingCheck, FrontingInfo, HallwayConfig } from '../../shared/api.js';
import type { Platform } from '../platform/index.js';
import type { StateProvider } from '../providers.js';
import type { Store } from '../store/index.js';
import { httpsUrl } from './names.js';

/** Every path under the home directory in `text`, as `~/…`. */
export function tildifyText(text: string | null, home = os.homedir()): string | null {
  return text && home && home !== path.parse(home).root ? text.split(home + path.sep).join('~' + path.sep) : text;
}

/** Pure: config.yaml, the platform's fronting (for `unsupported`), and the proxy's last push error. */
export function frontingInfo(cfg: HallwayConfig, platform: Pick<Platform, 'fronting'>, pushError: string | null = null): FrontingInfo {
  const port = cfg.proxy.publicPort;
  return {
    unsupported: platform.fronting.unsupported ?? null,
    mode: cfg.mode,
    dashboardUrl: httpsUrl(cfg.domain.dashboard, port),
    appUrl: httpsUrl(`<app>.${cfg.domain.base}`, port),
    base: cfg.domain.base,
    pushError: cfg.mode === 'fronted' ? pushError : null,
  };
}

export interface FrontingProviderOptions {
  store: Store;
  platform: Pick<Platform, 'fronting'>;
  /** The proxy's status (server/proxy/index.ts), for its last push error. */
  proxyStatus?: () => { pushError: string | null };
  /** Doctor's networking checks; run only in fronted mode. */
  checks: () => Promise<FrontingCheck[]>;
  /** How long a run of the checks is reused (default 15 s). */
  ttlMs?: number;
  now?: () => number;
}

/** The provider behind `fronting` in `/api/state` and `GET /api/fronting`. */
export function frontingProvider({ store, platform, proxyStatus, checks, ttlMs = 15_000, now = Date.now }: FrontingProviderOptions): StateProvider {
  let cached: { at: number; key: string; result: Promise<{ checks: FrontingCheck[]; checkedAt: string }> } | null = null;
  return {
    name: 'fronting',
    // the push error names Caddy's socket in full: shown as people see paths (`~/.hallway/…`), like the checks do
    fronting: () => frontingInfo(store.currentConfig(), platform, tildifyText(proxyStatus?.().pushError ?? null)),
    frontingChecks: (fresh = false) => {
      const cfg = store.currentConfig();
      if (cfg.mode !== 'fronted' || platform.fronting.unsupported) return Promise.resolve(null);
      // a config.yaml edit (another domain, other ports) makes the last run stale at once
      const key = JSON.stringify([cfg.domain, cfg.proxy]);
      if (!fresh && cached && cached.key === key && now() - cached.at < ttlMs) return cached.result;
      const at = now();
      const result = checks().then((c) => ({ checks: c, checkedAt: new Date(at).toISOString() }));
      cached = { at, key, result };
      // a run that fails isn't kept
      result.catch(() => {
        if (cached?.result === result) cached = null;
      });
      return result;
    },
  };
}
