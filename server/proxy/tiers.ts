// Fronted mode's three tiers (D65): what each costs on this platform, which one to recommend, and what config.yaml
// says for each. Pure, except `machineFacts`, which asks the OS (read-only, no privilege) who this user is.
//
//              No admin (user)              System-wide (system)            No prompts (none)
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

/** What the recommendation is made from. */
export interface MachineFacts {
  /** In the `admin` group (macOS), or `sudo`/`wheel`/`admin` (Linux), or root. */
  admin: boolean;
  /** macOS: enrolled in MDM (`profiles status -type enrollment`), where admin is usually lent, not held. */
  managed: boolean;
  /** False where System-wide can't work at all (Linux without systemd or nftables): then it isn't recommended. */
  systemPossible?: boolean;
}

/** Ask the OS, read-only: `id -Gn`, and on macOS `profiles status -type enrollment` (which needs no privilege). */
export async function machineFacts(platform: Pick<Platform, 'id'> & { fronting?: Platform['fronting'] }, run: Runner, uid = process.getuid?.(), env: NodeJS.ProcessEnv = process.env): Promise<MachineFacts> {
  if (platform.id === 'win32') return { admin: false, managed: false };
  const groups = await run('id', ['-Gn']);
  const names = groups.code === 0 ? groups.stdout.trim().split(/\s+/) : [];
  const admin = uid === 0 || names.some((g) => (platform.id === 'darwin' ? g === 'admin' : ['sudo', 'wheel', 'admin'].includes(g)));
  let managed = false;
  if (platform.id === 'darwin') {
    const r = await run('profiles', ['status', '-type', 'enrollment']);
    managed = r.code === 0 && /MDM enrollment:\s*Yes/i.test(r.stdout);
  }
  // System-wide's redirect needs systemd and nftables (Linux)
  const f = platform.fronting;
  const tools = f && f.lowPorts === 'redirect' && f.redirect && !f.unsupported ? f.detect(env) : null;
  return { admin, managed, ...(tools && (!tools.systemctl || !tools.nft) ? { systemPossible: false } : {}) };
}

/** The tier to recommend: No admin on a Mac whose user isn't an admin or that MDM manages, and on Linux without sudo;
 *  otherwise System-wide, which trusts the certificate for everything and (on Linux) keeps the port out of links. */
export function suggestedTier(platformId: Platform['id'], m: MachineFacts): Trust {
  if (platformId === 'darwin') return !m.admin || m.managed ? 'user' : 'system';
  return m.admin && m.systemPossible !== false ? 'system' : 'user';
}

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

/** Each tier for people: its name, what it asks for, and a line on what it gives up. */
export function tierText(platformId: Platform['id'], tier: Trust): { name: string; asks: string; note: string } {
  const mac = platformId === 'darwin';
  switch (tier) {
    case 'user':
      return {
        name: 'No admin',
        asks: mac ? 'macOS asks for your own password or Touch ID once, to trust Hallway\'s certificate for your account.' : 'Nothing: the certificate goes into your own NSS database, which Chrome and Chromium read.',
        note: mac ? 'Tools that bring their own certificate list (Node, Python) need to be told about it.' : 'Only Chrome and Chromium trust it; links carry the port. Custom domains need System-wide.',
      };
    case 'system':
      return {
        name: 'System-wide',
        asks: mac ? 'Needs an administrator: trusts it for every account.' : 'sudo: redirects ports 443 and 80, and trusts it system-wide.',
        note: 'Custom domains (--domain) need this.',
      };
    case 'none':
      return {
        name: 'No prompts',
        asks: 'Nothing at all.',
        note: 'Plain HTTP. Browser APIs that need a secure context still work on .localhost; Safari drops Secure cookies.',
      };
  }
}

/** The tiers as the dashboard offers them (D65): the recommended one first, each with its URL, what it asks for and
 *  its command; the dashboard can turn on only the two that need no administrator. */
export function tierOptions(platformId: Platform['id'], cfg: Pick<HallwayConfig, 'proxy' | 'domain'>, suggested: Trust): TierOption[] {
  const order = [suggested, ...TIERS.filter((t) => t !== suggested)];
  return order.map((t) => ({ trust: t, ...tierText(platformId, t), url: tierUrls(platformId, t, cfg).app, command: `hallway setup --trust ${t}`, recommended: t === suggested, canTurnOn: t !== 'system' }));
}

/** The question `hallway setup` asks on a terminal when no --trust is given (D65). Numbers are fixed (1 user, 2
 *  system, 3 none); the default is the current tier if there is one, else the recommended one. */
export function tierQuestion(platformId: Platform['id'], cfg: Pick<HallwayConfig, 'proxy' | 'domain'>, suggested: Trust, current: Trust | null): { text: string; prompt: string; byAnswer: (a: string) => Trust | null } {
  const def = current ?? suggested;
  const lines = ['Local domains: open your apps by name instead of by port.', ''];
  TIERS.forEach((t, i) => {
    const x = tierText(platformId, t);
    const tags = [t === suggested ? 'recommended' : null, t === current ? 'current' : null].filter(Boolean);
    lines.push(`  ${i + 1}) ${x.name.padEnd(13)}${tierUrls(platformId, t, cfg).app}${tags.length ? `   (${tags.join(', ')})` : ''}`);
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
