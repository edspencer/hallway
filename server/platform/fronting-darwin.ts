// macOS: the OS-specific parts of fronted mode (fronting.ts, D47, D65). Unverified on macOS except where CI's macOS job
// or the author's Mac ran them (docs/11-research-notes.md).
//   443, 80    no redirect: launchd binds loopback 443 and 80 for LaunchAgents (`Sockets`), in every tier, so nothing
//              here is root (server/services/spec.ts, `forwards`). The pf redirect an install from before the tiers
//              has (a pf anchor, com.apple/hallway, loaded at boot by the hallway.pf LaunchDaemon) is only removed.
//   trust      System-wide: the System keychain (`security add-trusted-cert -d`, sudo). No admin: the login keychain,
//              with the user's trust settings, which ask for the user's own password or Touch ID, never an admin's.
//   resolver   /etc/resolver/<base>, `nameserver 127.0.0.1` with a `port` line (resolver(5)).
// POSIX paths whatever OS this runs on, so this platform's logic is tested on Windows too
import { posix as path } from 'node:path';
import { type Fronting, type FrontingEnv, MARK, type Recipe, findTool } from './fronting.js';

export const PF_ANCHOR_NAME = 'com.apple/hallway';
export const PF_ANCHOR = '/etc/pf.anchors/hallway';
export const PF_LABEL = 'hallway.pf';
export const PF_PLIST = `/Library/LaunchDaemons/${PF_LABEL}.plist`;
export const SYSTEM_KEYCHAIN = '/Library/Keychains/System.keychain';
export const loginKeychain = (home: string) => path.join(home, 'Library', 'Keychains', 'login.keychain-db');
/** What Caddy calls the root (`Hallway Local CA - 2026 ECC Root`): how it's named in `security dump-trust-settings`. */
const ROOT_NAME = 'Hallway Local CA';

/** `security dump-trust-settings` (the user's domain) lists a certificate called Hallway's root. */
export function userTrustListsRoot(dump: string): boolean {
  return dump.split('\n').some((l) => /^Cert \d+: /.test(l.trim()) && l.trim().replace(/^Cert \d+: /, '').startsWith(ROOT_NAME));
}
export const resolverFile = (base: string) => `/etc/resolver/${base}`;

export function resolverText(base: string, dnsPort: number): string {
  return `# ${MARK}
# Sends ${base} and every name under it to Hallway's dnsmasq, which runs as you on 127.0.0.1:${dnsPort}.
nameserver 127.0.0.1
port ${dnsPort}
`;
}

const root = { sudo: true } as const;

/** Keep Homebrew's own housekeeping (an auto-update, cleanup, hints) from burying setup's steps. */
export const BREW_ENV = ['HOMEBREW_NO_AUTO_UPDATE=1', 'HOMEBREW_NO_INSTALL_CLEANUP=1', 'HOMEBREW_NO_ENV_HINTS=1'];

const BREW_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin'];

export const darwinFronting: Fronting = {
  userServiceNoun: 'LaunchAgent',
  lowPorts: 'sockets',
  trustDialog: 'a separate macOS dialog (Touch ID or your password) to change certificate trust settings, which macOS asks for itself, even under sudo (Big Sur and later)',
  userTrustDialog: 'macOS, for your Touch ID or password, to change *your* certificate trust settings. This is not an administrator prompt',
  // everything the macOS recipes run ships with macOS
  detect: () => ({ nft: null, certutil: null, nssdb: false, systemctl: null, resolved: false, caStore: null }),
  helperDirs: BREW_DIRS,
  installHelper(tool, env) {
    const brew = findTool('brew', env.PATH, BREW_DIRS);
    return brew ? { cmd: ['/usr/bin/env', ...BREW_ENV, brew, 'install', tool] } : { advice: `install ${tool} (with Homebrew: \`brew install ${tool}\`, see https://brew.sh), then run \`hallway setup\` again` };
  },

  unredirect(): Recipe {
    return {
      why: `Remove the pf redirect an older Hallway installed (the ${PF_LABEL} LaunchDaemon and the ${PF_ANCHOR_NAME} pf anchor): launchd's sockets do its job now, with no root`,
      files: [],
      cmds: [
        { ...root, argv: ['launchctl', 'bootout', `system/${PF_LABEL}`], mayFail: true, quiet: true },
        { ...root, argv: ['pfctl', '-a', PF_ANCHOR_NAME, '-F', 'all'], mayFail: true },
        { ...root, argv: ['rm', '-f', PF_PLIST, PF_ANCHOR] },
      ],
    };
  },

  trust(env): Recipe {
    return {
      why: "Trust Hallway's local certificate authority in the System keychain, so browsers accept its certificates",
      files: [],
      cmds: [{ ...root, argv: ['security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', SYSTEM_KEYCHAIN, env.rootCert] }],
    };
  },

  untrust(env): Recipe {
    return {
      why: "Remove Hallway's local certificate authority from the System keychain",
      files: [],
      cmds: env.rootSha1
        ? [
            // deleting the certificate takes its trust setting with it; `security remove-trusted-cert -d` would edit the
            // admin trust settings directly, which can wait for a GUI authorisation prompt even as root
            { ...root, argv: ['security', 'delete-certificate', '-Z', env.rootSha1, SYSTEM_KEYCHAIN] },
          ]
        : [{ ...root, argv: ['security', 'delete-certificate', '-c', 'Hallway Local CA', SYSTEM_KEYCHAIN], mayFail: true }],
    };
  },

  trustedQuery: () => ({ argv: ['security', 'find-certificate', '-a', '-Z', SYSTEM_KEYCHAIN], sudo: false }),

  userTrust(env): Recipe {
    return {
      why: "Trust Hallway's local certificate authority for your account only (your login keychain): no administrator needed, macOS asks for your own Touch ID or password",
      files: [],
      // no -d (the admin domain) and no sudo: the user's own trust settings (com.apple.trust-settings.user)
      cmds: [{ sudo: false, argv: ['security', 'add-trusted-cert', '-r', 'trustRoot', '-k', loginKeychain(env.userHome), env.rootCert] }],
    };
  },

  userUntrust(env): Recipe {
    return {
      why: "Stop trusting Hallway's local certificate authority for your account (your login keychain; macOS may ask for your Touch ID or password)",
      files: [],
      cmds: [
        // the user's trust setting, then the certificate itself
        { sudo: false, argv: ['security', 'remove-trusted-cert', env.rootCert], mayFail: true },
        { sudo: false, argv: ['security', 'delete-certificate', ...(env.rootSha1 ? ['-Z', env.rootSha1] : ['-c', ROOT_NAME]), loginKeychain(env.userHome)], mayFail: true },
      ],
    };
  },

  async userTrusted(env, run) {
    if (!env.rootSha1) return false;
    const inKeychain = await run('security', ['find-certificate', '-a', '-Z', loginKeychain(env.userHome)]);
    if (inKeychain.code !== 0 || !inKeychain.stdout.toUpperCase().includes(env.rootSha1.toUpperCase())) return false;
    const dump = await run('security', ['dump-trust-settings']);
    return dump.code === 0 && userTrustListsRoot(dump.stdout);
  },

  resolver(env): Recipe {
    const f = { src: path.join(env.setupDir, 'resolver'), dest: resolverFile(env.base), text: resolverText(env.base, env.dnsPort) };
    return {
      why: `Send ${env.base} and every name under it to Hallway's dnsmasq on 127.0.0.1:${env.dnsPort} (${f.dest})`,
      files: [f],
      cmds: [
        { ...root, argv: ['install', '-d', '-m', '0755', '/etc/resolver'] },
        { ...root, argv: ['install', '-m', '0644', '-o', 'root', '-g', 'wheel', f.src, f.dest] },
        { ...root, argv: ['killall', '-HUP', 'mDNSResponder'], mayFail: true },
      ],
    };
  },

  unresolver(env): Recipe {
    return {
      why: `Stop sending ${env.base} to Hallway's dnsmasq (remove ${resolverFile(env.base)})`,
      files: [],
      cmds: [
        { ...root, argv: ['rm', '-f', resolverFile(env.base)] },
        { ...root, argv: ['killall', '-HUP', 'mDNSResponder'], mayFail: true },
      ],
    };
  },

  installed: (env) => ({ redirect: [PF_PLIST, PF_ANCHOR], trust: [], resolver: [resolverFile(env.base)] }),
};
