// Design exploration only (the tiers-design branch): the Local domains flow's copy and state, shared by the five
// variants. A macOS fixture with Ed's renames (User certificate, System-wide certificate, No HTTPS; User certificate
// always recommended), and a simulated Turn on, so every state can be shown and clicked through on any machine.
import type { Trust } from '../../../shared/api';

export type VariantId = 'a' | 'b' | 'c' | 'd' | 'e';
export const VARIANTS: { id: VariantId; name: string }[] = [
  { id: 'a', name: 'Settings list' },
  { id: 'b', name: 'Hero + other options' },
  { id: 'c', name: 'Banner + sheet' },
  { id: 'd', name: 'Name your doors' },
  { id: 'e', name: 'One line' },
];

export interface LabTier {
  trust: Trust;
  name: string;
  /** The compact line for the options that aren't chosen. */
  short: string;
  url: string;
  dashboardUrl: string;
  /** What will ask, in a sentence. */
  asks: string;
  /** What you get and what you give up, as short facts. */
  facts: string[];
  command: string;
  canTurnOn: boolean;
}

export const TIERS: LabTier[] = [
  {
    trust: 'user',
    name: 'User certificate',
    short: 'HTTPS, trusted for your account',
    url: 'https://review.localhost',
    dashboardUrl: 'https://hallway.localhost',
    asks: 'macOS asks for your Touch ID or password once, to trust Hallway’s certificate for your account. It isn’t an administrator prompt.',
    facts: ['Safari, Chrome and curl trust it', 'Node and Python need to be told about it', 'Undo any time with hallway teardown'],
    command: 'hallway setup --trust user',
    canTurnOn: true,
  },
  {
    trust: 'system',
    name: 'System-wide certificate',
    short: 'For custom domains and every account; needs an admin',
    url: 'https://review.localhost',
    dashboardUrl: 'https://hallway.localhost',
    asks: 'Needs an administrator’s password, so it runs in a terminal: it trusts the certificate for every account on this Mac.',
    facts: ['Custom domains, like review.myname.internal', 'Trusted by every account and tool that reads the system keychain'],
    command: 'hallway setup --trust system',
    canTurnOn: false,
  },
  {
    trust: 'none',
    name: 'No HTTPS',
    short: 'Plain HTTP; nothing asks for anything',
    url: 'http://review.localhost',
    dashboardUrl: 'http://hallway.localhost',
    asks: 'Nothing will ask for a password.',
    facts: ['Safari drops Secure cookies over HTTP', 'Apps that insist on https: won’t work'],
    command: 'hallway setup --trust none',
    canTurnOn: true,
  },
];

export const tierOf = (t: Trust) => TIERS.find((x) => x.trust === t)!;
/** The short name in the header once it's on: `Local domains · user certificate`. */
export const LAB_TIER_LABEL: Record<Trust, string> = { user: 'user certificate', system: 'system-wide certificate', none: 'no HTTPS' };

export type RunPhase = 'running' | 'done' | 'failed';
export interface LabRun {
  trust: Trust;
  phase: RunPhase;
}

/** While it runs: the headline and the line under it. */
export function runningWords(t: Trust): { title: string; detail: string } {
  if (t === 'user') return { title: 'Waiting for Touch ID…', detail: 'macOS is asking on your screen to trust Hallway’s certificate for your account.' };
  return { title: 'Turning on…', detail: 'Starting Caddy and having launchd hold port 80 for it.' };
}

/** When it didn't work: what happened, and what to do instead. */
export function failedWords(t: Trust): { title: string; detail: string } {
  if (t === 'user') return { title: 'macOS didn’t get an answer', detail: 'The Touch ID prompt was cancelled, or timed out after a minute. Run it in a terminal instead:' };
  return { title: 'Setup stopped', detail: 'Caddy didn’t start. Run it in a terminal instead to see every step:' };
}

export type LabStateId = 'initial' | 'system' | 'none' | 'running' | 'done' | 'failed';
export const LAB_STATES: { id: LabStateId; name: string }[] = [
  { id: 'initial', name: 'Initial' },
  { id: 'system', name: 'System-wide chosen' },
  { id: 'none', name: 'No HTTPS chosen' },
  { id: 'running', name: 'Waiting for Touch ID' },
  { id: 'done', name: 'Done' },
  { id: 'failed', name: 'Cancelled / timed out' },
];

/** What every variant gets. */
export interface VariantProps {
  where: 'panel' | 'dialog';
  selected: Trust;
  select(t: Trust): void;
  run: LabRun | null;
  turnOn(t: Trust): void;
  reset(): void;
  onCopy(text: string, what?: string): void;
  onDismiss(): void;
  /** Variants whose panel opens a sheet: ask the page to open the dialog. */
  openDialog(): void;
  closeDialog(): void;
}
