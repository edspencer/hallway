// The OS-specific half of fronted mode (D47, D65), per platform: what `hallway setup` runs outside Hallway's own files
// and jobs, and `hallway teardown` undoes. The root parts are fixed jobs that take no configuration from anything a
// user-level process can write later:
//   redirect   Linux, System-wide certificate tier only: loopback 443 → proxy.httpsPort and 80 → proxy.httpPort (nftables). macOS
//              needs none in any tier: launchd binds loopback 443 and 80 for a LaunchAgent (`lowPorts: 'sockets'`,
//              D65). Its old pf redirect is only ever removed (`unredirect`), from an install made before the tiers.
//   trust      Hallway's local CA root in the system trust store (System-wide certificate), or for this user only (User certificate: the
//              login keychain on macOS, which asks for the user's own password; the user's NSS database on Linux)
//   resolver   custom domains only: `<base>` and everything under it → Hallway's dnsmasq on 127.0.0.1:<dnsPort>
// Pure: each recipe is the files Hallway writes (into generated/setup/, as the user) and the commands that install
// them, so `hallway setup --print` shows exactly what would run and the tests pin it on every OS.
import fs from 'node:fs';
import path from 'node:path';
import type { Runner } from './services.js';

export interface Cmd {
  argv: string[];
  /** Run through `sudo`. */
  sudo: boolean;
  /** A failure is fine (e.g. unloading something that isn't loaded). */
  mayFail?: boolean;
  /** Its error output is expected noise (a mayFail command's complaint), so it isn't shown. sudo prompts on the
   *  terminal, not on stderr, so a password prompt still is. */
  quiet?: boolean;
}

/** A file Hallway writes, as the user, into generated/setup/, for a command to install as root at `dest`. */
export interface StagedFile {
  /** The copy in generated/setup/. */
  src: string;
  /** Where it's installed. */
  dest: string;
  text: string;
}

export interface Recipe {
  /** One line, for people: what this does and why. */
  why: string;
  files: StagedFile[];
  cmds: Cmd[];
}

/** What a recipe needs to know. Everything is resolved by the caller. */
export interface FrontingEnv {
  /** generated/setup/ in the data home. */
  setupDir: string;
  /** Hallway's root certificate (state/caddy/data/pki/authorities/local/root.crt). */
  rootCert: string;
  /** Its SHA-1, upper-case hex, once Caddy has made it. */
  rootSha1: string | null;
  httpsPort: number;
  httpPort: number;
  dnsPort: number;
  /** The custom base domain (resolver only). */
  base: string;
  /** The user's home directory (Linux: the NSS database Chrome reads). */
  userHome: string;
  /** Tools found on this machine (Linux; macOS's are always there). `nssdb`: ~/.pki/nssdb exists (Chrome has run). */
  tools: { nft: string | null; certutil: string | null; nssdb: boolean; systemctl: string | null; resolved: boolean; caStore: 'debian' | 'fedora' | null };
}

export class FrontingUnsupported extends Error {}

/** A verification of the served certificate the way browsers do it (D72): trusted, not trusted (with why), or not
 *  known (nothing answered: a connection problem, not a trust one). `how` says what checked it, for people. */
export type OsTrust = { trusted: boolean | null; how: string; cause?: string };

/** A browser set by its organisation to ignore certificates added to the OS's trust store. */
export interface BrowserPolicy {
  browser: string;
  /** The managed-preferences file that says so. */
  file: string;
}

/** curl's verdict on a TLS connection, by its exit code (D72): 0 is trusted (whatever the HTTP status); 60 (no
 *  trusted issuer), 51 (wrong name), 35 and 58/59 (handshake, certificate) are not, with curl's own words; anything
 *  else (refused, timed out, can't resolve) says nothing about trust. */
export function curlTrust(code: number, stderr: string, how: string): OsTrust {
  const said = stderr.trim().split('\n').filter(Boolean).pop()?.replace(/^curl: \(\d+\) /, '') ?? '';
  if (code === 0) return { trusted: true, how };
  if ([35, 51, 58, 59, 60].includes(code)) return { trusted: false, how, cause: said || `curl exit ${code}` };
  return { trusted: null, how, cause: said || `curl exit ${code}` };
}

/** The curl arguments for checking `https://host:port/` against the system's trust and nothing else: no CA given, no
 *  config file, loopback whatever the resolver says. */
export const curlTrustArgs = (host: string, port: number) => ['-q', '-sS', '-o', '/dev/null', '--max-time', '5', '--resolve', `${host}:${port}:127.0.0.1`, `https://${host}:${port}/`];

export interface Fronting {
  /** Set where fronted mode can't work at all (Windows, D58): why, for `hallway setup` to refuse with up front. */
  unsupported?: string;
  /** How loopback 443 and 80 reach Caddy's ports: `sockets`, launchd's, for user-level jobs, in every tier (macOS,
   *  D65); `redirect`, a root redirect, in the System-wide certificate tier only (Linux). */
  lowPorts: 'sockets' | 'redirect';
  /** The redirect from 443/80 to Caddy's ports (`lowPorts: 'redirect'`). Throws FrontingUnsupported with what to
   *  install when it can't. */
  redirect?(env: FrontingEnv): Recipe;
  /** Remove the redirect; on macOS, the pf redirect an install from before the tiers has. */
  unredirect(env: FrontingEnv): Recipe;
  /** Trust Hallway's root system-wide (the System-wide certificate tier), and remove it again. */
  trust(env: FrontingEnv): Recipe;
  untrust(env: FrontingEnv): Recipe;
  /** Trust it for this user only (the User certificate tier), with no admin rights, and remove it again. */
  userTrust?(env: FrontingEnv): Recipe;
  userUntrust?(env: FrontingEnv): Recipe;
  /** Is it trusted for this user (the user-only kind, not the system-wide one)? */
  userTrusted?(env: FrontingEnv, run: Runner): Promise<boolean>;
  /** Does this machine trust the certificate served at `https://host:port` the way browsers check it (D72)? Not
   *  "is Hallway's root in a store" but a real verification with no CA given: Apple's curl on macOS (the keychain's
   *  trust settings, as Safari and Chrome read them), the system's curl for Linux's System-wide certificate, and
   *  Chrome's NSS database for Linux's User certificate. */
  osTrust?(target: { host: string; port: number }, tier: 'user' | 'system', env: FrontingEnv, run: Runner): Promise<OsTrust>;
  /** Browsers an organisation has set to ignore certificates added to the OS's trust store (D72; macOS: Chrome's and
   *  Edge's `CAPlatformIntegrationEnabled = false` in managed preferences), with where it was found. */
  browserPolicies?(user: string, run: Runner): Promise<BrowserPolicy[]>;
  /** Send the custom base domain to Hallway's dnsmasq, and stop. */
  resolver(env: FrontingEnv): Recipe;
  unresolver(env: FrontingEnv): Recipe;
  /** Files whose presence means a part is installed (teardown removes a part only if one exists). */
  installed(env: FrontingEnv): { redirect: string[]; trust: string[]; resolver: string[] };
  /** A read-only command whose output contains `rootSha1` iff the root is in the system store; null: compare files. */
  trustedQuery?(env: FrontingEnv): Cmd;
  /** Where trusting (or untrusting) a certificate raises the OS's own dialog even under sudo (macOS): what it is, for
   *  the warning setup gives before it asks to continue (D67). */
  trustDialog?: string;
  /** The same for trusting it for this user only: the user's own password, never an administrator's (D65). */
  userTrustDialog?: string;
  /** Hallway's own service manager words for people (`LaunchAgent` / `systemd user unit`). */
  userServiceNoun: string;
  /** Find the tools the recipes need. */
  detect(env: NodeJS.ProcessEnv): FrontingEnv['tools'];
  /** Where to look for `caddy` and `dnsmasq` besides PATH (Homebrew's prefixes; sbin, which a user's PATH may lack). */
  helperDirs: string[];
  /** How to get a missing helper: a command Hallway can run for you (as you, no sudo), or advice. */
  installHelper(tool: 'caddy' | 'dnsmasq', env: NodeJS.ProcessEnv): { cmd: string[] } | { advice: string };
}

/** `which` over PATH and some extra directories; the first executable found, or null. */
export function findTool(name: string, pathVar: string | undefined, extraDirs: readonly string[] = []): string | null {
  for (const dir of [...(pathVar ?? '').split(path.delimiter), ...extraDirs]) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).isFile()) {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      }
    } catch {
      /* not here */
    }
  }
  return null;
}

/** The header every file Hallway installs as root starts with, so a person (and teardown) can tell whose it is. */
export const MARK = 'Written by `hallway setup`; removed by `hallway teardown`.';

/** The dnsmasq configuration for a custom base domain (unprivileged: Hallway's dnsmasq runs as the user). */
export function dnsmasqConf(base: string, port: number): string {
  return `# ${MARK} (generated/dnsmasq.conf)
# Answers ${base} and every name under it with loopback, and nothing else. It listens on 127.0.0.1 only, on a port
# above 1024, as you: the system resolver is pointed at it for ${base} alone.
port=${port}
listen-address=127.0.0.1
bind-interfaces
no-resolv
no-hosts
no-poll
address=/${base}/127.0.0.1
address=/${base}/::1
`;
}
