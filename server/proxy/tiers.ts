// Fronted mode's three tiers (D65, D69): what each costs on this platform, what config.yaml says for each, and what
// they're called. User certificate is always the one recommended (D69). Pure, except `machineFacts`, which asks the OS
// (read-only, no privilege) whether this user is an administrator, for System-wide certificate's wording.
//
//              User certificate (user)      System-wide certificate         No HTTPS (none)
//   macOS      https://review.localhost     https://review.localhost        http://review.localhost
//              your own Touch ID/password   an administrator; --domain      nothing
//   Linux      https://review.localhost:4443  https://review.localhost      http://review.localhost:4480
//              nothing (~/.pki/nssdb)       sudo; --domain                  nothing
import os from 'node:os';
import type { HallwayConfig, TierOption, Trust } from '../../shared/api.js';
import type { Platform, Runner } from '../platform/index.js';
import { publicUrl } from './names.js';

export const TIERS: readonly Trust[] = ['user', 'system', 'none'];

/** The tier config.yaml says fronted mode is in. A setup from before the tiers (no `proxy.trust`) is System-wide. */
export function currentTier(cfg: Pick<HallwayConfig, 'proxy'>): Trust {
  return cfg.proxy.trust ?? (cfg.proxy.scheme === 'http' ? 'none' : 'system');
}

/** Who the user is, for System-wide certificate's wording (D69: it no longer decides the recommendation). */
export interface MachineFacts {
  /** In the `admin` group (macOS), or `sudo`/`wheel`/`admin` (Linux), or root. */
  admin: boolean;
}

/** Ask the OS, read-only: `id -Gn`. */
export async function machineFacts(platform: Pick<Platform, 'id'>, run: Runner, uid = process.getuid?.()): Promise<MachineFacts> {
  if (platform.id === 'win32') return { admin: false };
  const groups = await run('id', ['-Gn']);
  const names = groups.code === 0 ? groups.stdout.trim().split(/\s+/) : [];
  return { admin: uid === 0 || names.some((g) => (platform.id === 'darwin' ? g === 'admin' : ['sudo', 'wheel', 'admin'].includes(g))) };
}

/** The tier to recommend, on every platform and for every user (D69): User certificate. It never needs an
 *  administrator, and the dashboard can turn it on. System-wide certificate is the choice for custom domains, other
 *  accounts and tools with their own CA list (and, on Linux, for links without a port); it's never the default. */
export const RECOMMENDED_TIER: Trust = 'user';

/** The tier's addresses, for people: the dashboard's and an app's. */
export function tierUrls(platformId: Platform['id'], tier: Trust, cfg: Pick<HallwayConfig, 'proxy' | 'domain'>, base = 'localhost') {
  const proxy = { ...cfg.proxy, ...tierProxy(platformId, tier, cfg.proxy) };
  const dashboard = base === 'localhost' ? 'hallway.localhost' : base;
  return { dashboard: publicUrl(dashboard, proxy), app: publicUrl(`review.${base}`, proxy) };
}

/** What setup writes under `proxy:` for a tier (null: the default, left out of the file). On Linux nothing holds 443
 *  and 80 for the user and none tiers, so links carry Caddy's port; on macOS launchd's sockets give every tier both. */
export function tierProxy(platformId: Platform['id'], tier: Trust, proxy: Pick<HallwayConfig['proxy'], 'httpsPort' | 'httpPort'>): { trust: Trust; scheme: 'https' | 'http'; publicPort: number } {
  const scheme = tier === 'none' ? 'http' : 'https';
  const publicPort = platformId === 'linux' && tier !== 'system' ? (tier === 'none' ? proxy.httpPort : proxy.httpsPort) : scheme === 'http' ? 80 : 443;
  return { trust: tier, scheme, publicPort };
}

/** The tiers' names, as every command, check and page says them (D69). */
export const TIER_NAME: Record<Trust, string> = { user: 'User certificate', system: 'System-wide certificate', none: 'No HTTPS' };

/** Each tier for people: its name, a one-line summary (the dashboard's collapsed row), what it asks for, and a line on
 *  what it gives up. `admin` (null: not known) only changes how System-wide certificate says it needs one. */
export function tierText(platformId: Platform['id'], tier: Trust, admin: boolean | null = null): { name: string; summary: string; asks: string; note: string } {
  const mac = platformId === 'darwin';
  const name = TIER_NAME[tier];
  switch (tier) {
    case 'user':
      return {
        name,
        summary: mac ? 'HTTPS, trusted for your account' : 'HTTPS for Chrome and Chromium, no password',
        asks: mac ? "macOS asks for your Touch ID or password once, to trust Hallway's certificate for your account. It isn't an administrator prompt." : 'Nothing: the certificate goes into your own NSS database, which Chrome and Chromium read.',
        note: mac ? 'Safari, Chrome and Apple’s curl trust it; tools that bring their own certificate list (Node, Python) need to be told about it.' : 'Only Chrome and Chromium trust it, and links carry the port.',
      };
    case 'system': {
      const who = admin === false ? (mac ? 'an administrator (this account isn’t one)' : 'sudo, which this account doesn’t have') : mac ? 'an administrator’s password' : 'sudo';
      return {
        name,
        summary: 'For custom domains and every account; needs an administrator',
        asks: mac ? `Needs ${who}, so it runs in a terminal: it trusts the certificate for every account on this Mac.` : `Needs ${who}, so it runs in a terminal: it redirects ports 443 and 80 and trusts the certificate system-wide.`,
        note: 'Custom domains (--domain) need it, and so do other accounts and tools that read only the system’s certificates.',
      };
    }
    case 'none':
      return {
        name,
        summary: 'Plain HTTP; nothing asks for anything',
        asks: 'Nothing will ask for a password.',
        note: 'Plain HTTP: browser APIs that need a secure context still work on .localhost, but Safari drops Secure cookies.',
      };
  }
}

/** The tiers as the dashboard offers them (D65, D69): User certificate first and recommended, each with its URL, what it
 *  asks for and its command; the dashboard can turn on only the two that need no administrator. */
export function tierOptions(platformId: Platform['id'], cfg: Pick<HallwayConfig, 'proxy' | 'domain'>, admin: boolean | null = null): TierOption[] {
  return TIERS.map((t) => ({ trust: t, ...tierText(platformId, t, admin), url: tierUrls(platformId, t, cfg).app, command: `hallway setup --trust ${t}`, recommended: t === RECOMMENDED_TIER, canTurnOn: t !== 'system' }));
}

/** The question `hallway setup` asks on a terminal when no --trust is given (D65, D69). Numbers are fixed (1 user, 2
 *  system, 3 none); the default is the current tier if there is one, else User certificate. */
export function tierQuestion(platformId: Platform['id'], cfg: Pick<HallwayConfig, 'proxy' | 'domain'>, current: Trust | null, admin: boolean | null = null): { text: string; prompt: string; byAnswer: (a: string) => Trust | null } {
  const def = current ?? RECOMMENDED_TIER;
  const lines = ['Local domains: open your apps by name instead of by port.', ''];
  TIERS.forEach((t, i) => {
    const x = tierText(platformId, t, admin);
    const tags = [t === RECOMMENDED_TIER ? 'recommended' : null, t === current ? 'current' : null].filter(Boolean);
    lines.push(`  ${i + 1}) ${x.name.padEnd(25)}${tierUrls(platformId, t, cfg).app}${tags.length ? `   (${tags.join(', ')})` : ''}`);
    lines.push(`     ${x.asks}`);
    lines.push(`     ${x.note}`);
  });
  lines.push('');
  return {
    text: lines.join('\n') + '\n',
    prompt: `Which? [${TIERS.indexOf(def) + 1}] `,
    byAnswer: (a) => {
      const s = a.trim().toLowerCase();
      if (s === '') return def;
      const n = Number(s);
      if (Number.isInteger(n) && n >= 1 && n <= TIERS.length) return TIERS[n - 1];
      return (TIERS as readonly string[]).includes(s) ? (s as Trust) : null;
    },
  };
}

/** The console user on macOS is this user (a GUI session that can show the trust dialog), from `stat -f %Su
 *  /dev/console`; null when that couldn't be asked. */
export async function atTheScreen(run: Runner): Promise<boolean | null> {
  const r = await run('stat', ['-f', '%Su', '/dev/console']);
  if (r.code !== 0) return null;
  return r.stdout.trim() === os.userInfo().username;
}
