// The privileged half of fronted mode (D46), per platform: the only things `hallway setup` runs as root, and
// `hallway teardown` undoes. Each is a fixed job that takes no configuration from anything a user-level process can
// write later:
//   redirect   loopback 443 → proxy.httpsPort and 80 → proxy.httpPort (pf on macOS, nftables on Linux)
//   trust      Hallway's local CA root in the system trust store
//   resolver   custom domains only: `<base>` and everything under it → Hallway's dnsmasq on 127.0.0.1:<dnsPort>
// Pure: each recipe is the files Hallway writes (into generated/setup/, as the user) and the commands that install
// them, so `hallway setup --print` shows exactly what would run and the tests pin it on every OS.
import fs from 'node:fs';
import path from 'node:path';

export interface Cmd {
  argv: string[];
  /** Run through `sudo`. */
  sudo: boolean;
  /** A failure is fine (e.g. unloading something that isn't loaded). */
  mayFail?: boolean;
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
  /** Tools found on this machine (Linux; macOS's are always there). */
  tools: { nft: string | null; certutil: string | null; systemctl: string | null; resolved: boolean; caStore: 'debian' | 'fedora' | null };
}

export class FrontingUnsupported extends Error {}

export interface Fronting {
  /** The redirect from 443/80 to Caddy's ports. Throws FrontingUnsupported with what to install when it can't. */
  redirect(env: FrontingEnv): Recipe;
  unredirect(env: FrontingEnv): Recipe;
  /** Trust Hallway's root, and remove it again. */
  trust(env: FrontingEnv): Recipe;
  untrust(env: FrontingEnv): Recipe;
  /** Send the custom base domain to Hallway's dnsmasq, and stop. */
  resolver(env: FrontingEnv): Recipe;
  unresolver(env: FrontingEnv): Recipe;
  /** Files whose presence means a part is installed (teardown removes a part only if one exists). */
  installed(env: FrontingEnv): { redirect: string[]; trust: string[]; resolver: string[] };
  /** A read-only command whose output contains `rootSha1` iff the root is in the system store; null: compare files. */
  trustedQuery?(env: FrontingEnv): Cmd;
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
