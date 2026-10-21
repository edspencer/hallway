// Local domains (fronted mode, D47; D63): when the dashboard offers them, and how it sums up doctor's checks once
// they're on. Pure, tested under node.
import type { FrontingCheck, FrontingInfo, FrontingSetupJob, PortConflict, SetupStopReason, StateResponse, TierOption, Trust } from '../../shared/api.js';

/** The website's page on fronted mode: what it is, what setup does, and how to undo it. */
export const FRONTED_DOCS = 'https://hallway.edspencer.net/networking/fronted-mode/';

/** The tier as the header names it (D65, D70): `Local domains · user certificate`. */
export const TIER_LABEL: Record<Trust, string> = { user: 'user certificate', system: 'system-wide certificate', none: 'no HTTPS' };

/** The tiers to offer, User certificate first (from the daemon); an older daemon sends none, and the panel falls back
 *  to the two plain commands. */
export function tierChoices(f: FrontingInfo): TierOption[] {
  return f.tiers ?? [];
}

/** The tier the panel opens with: the recommended one (User certificate, D70), else the first. */
export function initialTier(tiers: TierOption[]): Trust | null {
  return (tiers.find((t) => t.recommended) ?? tiers[0])?.trust ?? null;
}

/** A Turn on, as the dashboard follows it. */
export type TurnOnState = { trust: Trust; port?: number | null; job: FrontingSetupJob | null; error: string | null };

/** Where a Turn on is: running (until the daemon says otherwise, including before its first answer), done or failed. */
export function turnOnPhase(run: TurnOnState | null): 'running' | 'done' | 'failed' | null {
  if (!run) return null;
  if (run.error || run.job?.state === 'failed') return 'failed';
  if (run.job?.state === 'done') return 'done';
  return 'running';
}

/** What the panel says while a Turn on runs: on a Mac, User certificate waits on the Touch ID dialog. */
export function runningWords(trust: Trust, macos: boolean): { title: string; detail: string } {
  if (trust === 'user' && macos) return { title: 'Waiting for Touch ID…', detail: 'macOS is asking on your screen to trust Hallway’s certificate for your account.' };
  return { title: 'Turning on…', detail: trust === 'none' ? 'Starting Caddy for plain HTTP.' : 'Starting Caddy and trusting its certificate in your NSS database.' };
}

/** What the panel says when a Turn on stopped, before the command to run instead. The daemon says why (D71): only a
 *  failure of the step that raises the dialog names a cancelled or unanswered Touch ID prompt (as the likely cause,
 *  not asserted: it looks like any other failure from here). An older daemon says nothing, and gets the old words. */
export function failedWords(trust: Trust, macos: boolean, reason: SetupStopReason | null = null): { title: string; detail: string } {
  if (trust === 'user' && macos && (reason === 'dialog' || reason === null)) return { title: 'Setup stopped', detail: 'If the Touch ID prompt was cancelled or went unanswered, run it in a terminal instead:' };
  if (reason === 'sudo') return { title: 'Setup stopped', detail: 'It needs sudo this once, so it runs in a terminal:' };
  if (reason === 'refused') return { title: 'Setup stopped before changing anything', detail: 'Once that’s sorted out, turn it on again, or run it in a terminal:' };
  return { title: 'Setup stopped', detail: 'Run it in a terminal instead to see every step:' };
}

/** Ports, as people say them: `443`, `443 and 80`. */
const portList = (ports: readonly number[]) => (ports.length < 2 ? String(ports[0]) : `${ports.slice(0, -1).join(', ')} and ${ports[ports.length - 1]}`);

/** A conflict's headline (D71): `Ports 443 and 80 are taken by Rancher Desktop`. */
export function conflictHeadline(c: PortConflict): string {
  const ports = c.ports.length > 1 ? `Ports ${portList(c.ports)} are` : `Port ${c.ports[0]} is`;
  const who = c.tool ? c.tool.name : c.pid ? (c.process?.trim() ?? 'another process') : 'a process you can’t see';
  return `${ports} taken by ${who}`;
}

/** Which process, for the line under the headline: `ssh, pid 7090` (and the container, when Docker named it). */
export function conflictProcess(c: PortConflict): string | null {
  if (!c.pid) return null;
  const p = `${c.process?.trim() || 'a process'}, pid ${c.pid}`;
  return c.container ? `${p}, for the container ${c.container}` : p;
}

/** Where it listens, for people: `*` is every address, which other machines can reach. */
export function conflictWhere(c: PortConflict): { text: string; exposed: boolean } | null {
  if (!c.addresses.length) return null;
  const all = c.addresses.some((a) => a === '*' || a === '0.0.0.0' || a === '::');
  const where = all ? `every address (${c.addresses.join(', ')})` : c.addresses.join(', ');
  return { text: c.exposed ? `Listening on ${where}: reachable from your network, not just this machine` : `Listening on ${where}`, exposed: c.exposed };
}

/** The address an app gets on another port: `https://<app>.localhost` → `https://<app>.localhost:4443`. */
export function withPort(url: string, port: number): string {
  const m = /^(https?:\/\/[^/:]+)(:\d+)?(.*)$/.exec(url);
  if (!m) return url;
  const standard = url.startsWith('https:') ? 443 : 80;
  return `${m[1]}${port === standard ? '' : `:${port}`}${m[3]}`;
}

/** The last lines of setup's output, for the dialog while it runs. */
export function logTail(log: string, lines = 6): string {
  return log.trimEnd().split('\n').slice(-lines).join('\n');
}

/** Said once a Turn on has trusted Hallway's certificate (D72): Chrome can keep the error it saw before. The same words
 *  as `hallway setup` (server/proxy/setup.ts, RESTART_BROWSER). */
export const RESTART_BROWSER = 'If a browser showed a certificate warning before, quit and reopen it (Chrome remembers the old result).';

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
