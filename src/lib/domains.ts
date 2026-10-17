// Local domains (fronted mode, D47; D63): when the dashboard offers them, and how it sums up doctor's checks once
// they're on. Pure, tested under node.
import type { FrontingCheck, FrontingInfo, FrontingSetupJob, StateResponse, TierOption, Trust } from '../../shared/api.js';

/** The website's page on fronted mode: what it is, what setup does, and how to undo it. */
export const FRONTED_DOCS = 'https://hallway.edspencer.net/networking/fronted-mode/';

/** The tier as the header names it (D65): `Local domains · no admin`. */
export const TIER_LABEL: Record<Trust, string> = { user: 'no admin', system: 'system-wide', none: 'no prompts' };

/** The tiers to offer, recommended first (from the daemon); an older daemon sends none, and the panel falls back to
 *  the two plain commands. */
export function tierChoices(f: FrontingInfo): TierOption[] {
  return f.tiers ?? [];
}

/** What the Turn on dialog says before it runs: what will happen, and what (if anything) will ask. */
export function turnOnWords(t: TierOption, macos: boolean): { will: string; asks: string } {
  const will = `Hallway runs Caddy as you${macos ? ', has launchd hold ports ' + (t.trust === 'none' ? '80' : '443 and 80') + ' for it,' : ''} and switches this dashboard to ${t.url.replace('review.', 'hallway.')}.`;
  if (t.trust === 'none') return { will, asks: 'Nothing will ask for a password. Pages are served over plain HTTP.' };
  return {
    will,
    asks: macos
      ? 'macOS will ask for your Touch ID or password, on this screen, to change your own certificate trust settings. It isn’t an administrator prompt.'
      : 'Nothing will ask for a password: the certificate goes into your own NSS database, which Chrome and Chromium read.',
  };
}

/** A Turn on, as the dashboard follows it. */
export type TurnOnState = { trust: Trust; job: FrontingSetupJob | null; error: string | null };

/** The last lines of setup's output, for the dialog while it runs. */
export function logTail(log: string, lines = 6): string {
  return log.trimEnd().split('\n').slice(-lines).join('\n');
}

/** The commands the panel offers to copy (an older daemon, with no tiers). `print` first: it shows the plan and runs nothing. */
export const SETUP_COMMANDS = [
  { cmd: 'hallway setup --print', what: 'shows the plan and runs nothing' },
  { cmd: 'hallway setup', what: 'runs it, printing each step first; the privileged ones go through sudo' },
] as const;

export interface DomainsView {
  /** The header's control: hidden (no provider, or the platform can't: Windows), `off` (direct mode) or `on`. */
  header: 'hidden' | 'off' | 'on';
  /** The panel on the page: direct mode, where fronted mode can work, and not dismissed. */
  panel: boolean;
  fronting: FrontingInfo | null;
}

/** What to show about local domains, from `/api/state`. */
export function domainsView(state: Pick<StateResponse, 'fronting' | 'config'>): DomainsView {
  const f = state.fronting ?? null;
  // an older daemon, or one without the provider: say nothing rather than guess
  if (!f || f.unsupported) return { header: 'hidden', panel: false, fronting: f };
  if (f.mode === 'fronted') return { header: 'on', panel: false, fronting: f };
  // absent from an older config view: read as "show"
  const show = state.config.config.dashboard.hints?.localDomains !== false;
  return { header: 'off', panel: show, fronting: f };
}

export type DomainsTone = 'checking' | 'ok' | 'warn' | 'fail';

/** How local domains are doing, from doctor's checks: the worst status, and the checks worth showing first. */
export function checksSummary(checks: FrontingCheck[] | null, pushError: string | null = null): { tone: DomainsTone; problems: FrontingCheck[]; text: string } {
  if (!checks) return pushError ? { tone: 'fail', problems: [], text: 'Caddy isn’t taking the configuration' } : { tone: 'checking', problems: [], text: 'Checking…' };
  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const tone: DomainsTone = fails.length || pushError ? 'fail' : warns.length ? 'warn' : 'ok';
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const text = fails.length ? n(fails.length, 'problem') : pushError ? 'Caddy isn’t taking the configuration' : warns.length ? n(warns.length, 'warning') : 'Working';
  return { tone, problems: [...fails, ...warns], text };
}

/** The base domain as the header shows it: `hallway.localhost` → the host without the scheme. */
export function hostOfUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
