// Local domains as the dashboard and the startup banner see them (D63): whether fronted mode can work on this platform,
// whether it's on, and the addresses it gives, with the three tiers to choose from (D65). The daemon runs setup itself
// only for the dashboard's Turn on, and only in the two tiers that need no administrator (User certificate, No HTTPS): a
// plan with any sudo step is refused, and System-wide certificate is `hallway setup` in a terminal (AGENTS.md: never root in the
// daemon). In fronted mode, `GET /api/fronting` also runs doctor's
// networking checks (server/proxy/doctor.ts): read-only, but they probe Caddy, the redirect and the resolver, so they're
// run on request and cached for a few seconds, never on every `/api/state`.
import os from 'node:os';
import path from 'node:path';
import type { FrontingCheck, FrontingInfo, FrontingSetupJob, HallwayConfig, PortConflict, SetupStopReason, Trust } from '../../shared/api.js';
import type { Platform } from '../platform/index.js';
import type { StateProvider } from '../providers.js';
import type { Store } from '../store/index.js';
import { publicUrl } from './names.js';
import { chosenCaddyPorts } from './setup.js';
import { type MachineFacts, RECOMMENDED_TIER, currentTier, tierOptions } from './tiers.js';

/** Every path under the home directory in `text`, as `~/…` (either separator: on Windows a message may use both). */
export function tildifyText(text: string | null, home = os.homedir()): string | null {
  if (!text || !home || home === path.parse(home).root) return text;
  for (const sep of ['/', '\\']) text = text.split(home + sep).join('~' + sep);
  return text;
}

/** Pure: config.yaml, the platform's fronting (for `unsupported`), the proxy's last push error, and who the user is
 *  (for System-wide certificate's wording; null until the OS has been asked). User certificate is always the one
 *  recommended (D70), so the tiers don't wait for the OS. */
export function frontingInfo(cfg: HallwayConfig, platform: Pick<Platform, 'fronting'> & { id?: Platform['id'] }, pushError: string | null = null, machine: MachineFacts | null = null): FrontingInfo {
  const offered = !!platform.id && !platform.fronting.unsupported;
  const admin = machine ? machine.admin : null;
  return {
    suggested: offered ? RECOMMENDED_TIER : null,
    admin,
    tiers: offered ? tierOptions(platform.id!, cfg, admin, machine?.policies) : [],
    caddyPort: cfg.proxy.httpsPort,
    // on Caddy's own port by choice (D71): the dashboard offers the way back
    standardPort: cfg.mode === 'fronted' && chosenCaddyPorts(platform, cfg) ? (cfg.proxy.scheme === 'http' ? 80 : 443) : null,
    unsupported: platform.fronting.unsupported ?? null,
    mode: cfg.mode,
    trust: cfg.mode === 'fronted' ? currentTier(cfg) : null,
    dashboardUrl: publicUrl(cfg.domain.dashboard, cfg.proxy),
    appUrl: publicUrl(`<app>.${cfg.domain.base}`, cfg.proxy),
    base: cfg.domain.base,
    pushError: cfg.mode === 'fronted' ? pushError : null,
  };
}

export interface FrontingProviderOptions {
  store: Store;
  platform: Pick<Platform, 'fronting'> & { id?: Platform['id'] };
  /** Who the user is, for System-wide certificate's wording (asked of the OS once, at start). */
  machine?: () => Promise<MachineFacts>;
  /** Run setup, unattended, in a tier that needs no administrator (server/proxy/setup.ts `setupUnattended`), writing
   *  what it prints to `out`. Absent: the dashboard can't turn local domains on (an older or a test daemon). */
  runSetup?: (trust: Trust, out: (s: string) => void, port?: number) => Promise<{ dashboardUrl: string; appUrl: string; trustChanged?: boolean } | void>;
  /** The proxy's status (server/proxy/index.ts), for its last push error. */
  proxyStatus?: () => { pushError: string | null };
  /** Doctor's networking checks; run only in fronted mode. */
  checks: () => Promise<FrontingCheck[]>;
  /** How long a run of the checks is reused (default 15 s). */
  ttlMs?: number;
  now?: () => number;
}

/** The provider behind `fronting` in `/api/state` and `GET /api/fronting`. */
export function frontingProvider({ store, platform, machine, runSetup, proxyStatus, checks, ttlMs = 15_000, now = Date.now }: FrontingProviderOptions): StateProvider {
  let cached: { at: number; key: string; result: Promise<{ checks: FrontingCheck[]; checkedAt: string }> } | null = null;
  let who: MachineFacts | null = null;
  machine?.().then(
    (m) => (who = m),
    () => {},
  );
  let job: FrontingSetupJob = { state: 'idle', trust: null, port: null, log: '', error: null, reason: null };
  return {
    name: 'fronting',
    // the push error names Caddy's socket in full: shown as people see paths (`~/.hallway/…`), like the checks do
    fronting: () => frontingInfo(store.currentConfig(), platform, tildifyText(proxyStatus?.().pushError ?? null), who),
    frontingSetup: () => ({ ...job, log: tildifyText(job.log) ?? '' }),
    turnOnFronting: (trust, port) => {
      if (platform.fronting.unsupported) return { refused: platform.fronting.unsupported, status: 400 };
      if (trust === 'system') return { refused: 'System-wide certificate needs an administrator, so it runs in a terminal: `hallway setup --trust system`', status: 400 };
      if (!runSetup) return { refused: "this daemon can't run setup; run `hallway setup` in a terminal", status: 503 };
      if (job.state === 'running') return { refused: `setup is already running (${job.trust})`, status: 409 };
      job = { state: 'running', trust, port: port ?? null, log: '', error: null, reason: null };
      const mine = job;
      runSetup(trust, (s) => (mine.log += s), port).then(
        (urls) => {
          mine.state = 'done';
          if (urls) Object.assign(mine, urls);
        },
        (e) => {
          mine.state = 'failed';
          mine.error = tildifyText((e as Error).message);
          // setup's SetupError says why (D71); anything else is a plain failure
          const x = e as { reason?: SetupStopReason; conflicts?: PortConflict[]; altPort?: number | null };
          mine.reason = x.reason ?? 'failed';
          if (x.conflicts?.length) mine.conflicts = x.conflicts;
          if (x.altPort) mine.altPort = x.altPort;
        },
      );
      return { ...job };
    },
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

