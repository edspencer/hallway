// macOS: the privileged parts of fronted mode (fronting.ts, D43). Unverified on macOS except where CI's macOS job
// runs them (docs/11-research-notes.md).
//   redirect   a pf anchor, com.apple/hallway, loaded at boot by a LaunchDaemon that runs one fixed pfctl command.
//              macOS's /etc/pf.conf already evaluates `rdr-anchor "com.apple/*"`, so pf.conf (which OS updates
//              rewrite) is never edited.
//   trust      the System keychain (`security add-trusted-cert`).
//   resolver   /etc/resolver/<base>, `nameserver 127.0.0.1` with a `port` line (resolver(5)).
import path from 'node:path';
import { type Fronting, type FrontingEnv, MARK, type Recipe } from './fronting.js';

export const PF_ANCHOR_NAME = 'com.apple/hallway';
export const PF_ANCHOR = '/etc/pf.anchors/hallway';
export const PF_LABEL = 'hallway.pf';
export const PF_PLIST = `/Library/LaunchDaemons/${PF_LABEL}.plist`;
export const SYSTEM_KEYCHAIN = '/Library/Keychains/System.keychain';
export const resolverFile = (base: string) => `/etc/resolver/${base}`;

export function pfAnchor({ httpsPort, httpPort }: Pick<FrontingEnv, 'httpsPort' | 'httpPort'>): string {
  return `# ${MARK}
# Loaded into the ${PF_ANCHOR_NAME} anchor by the ${PF_LABEL} LaunchDaemon. Connections to loopback ports 443 and
# 80 go to Hallway's Caddy, which runs as you on ${httpsPort} and ${httpPort}. Only loopback traffic is touched.
rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port ${httpsPort}
rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port ${httpPort}
rdr pass on lo0 inet6 proto tcp from any to ::1 port 443 -> ::1 port ${httpsPort}
rdr pass on lo0 inet6 proto tcp from any to ::1 port 80 -> ::1 port ${httpPort}
`;
}

export function pfPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${MARK} It loads one fixed pf anchor at boot and exits; it reads nothing a user can write. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PF_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/sbin/pfctl</string>
    <string>-E</string>
    <string>-a</string>
    <string>${PF_ANCHOR_NAME}</string>
    <string>-f</string>
    <string>${PF_ANCHOR}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

export function resolverText(base: string, dnsPort: number): string {
  return `# ${MARK}
# Sends ${base} and every name under it to Hallway's dnsmasq, which runs as you on 127.0.0.1:${dnsPort}.
nameserver 127.0.0.1
port ${dnsPort}
`;
}

const root = { sudo: true } as const;

export const darwinFronting: Fronting = {
  userServiceNoun: 'LaunchAgent',

  redirect(env): Recipe {
    const anchor = { src: path.join(env.setupDir, 'pf.anchor'), dest: PF_ANCHOR, text: pfAnchor(env) };
    const plist = { src: path.join(env.setupDir, `${PF_LABEL}.plist`), dest: PF_PLIST, text: pfPlist() };
    return {
      why: `Redirect loopback ports 443 and 80 to Caddy on ${env.httpsPort} and ${env.httpPort} (a pf anchor, loaded at boot by the ${PF_LABEL} LaunchDaemon)`,
      files: [anchor, plist],
      cmds: [
        { ...root, argv: ['install', '-m', '0644', '-o', 'root', '-g', 'wheel', anchor.src, anchor.dest] },
        { ...root, argv: ['install', '-m', '0644', '-o', 'root', '-g', 'wheel', plist.src, plist.dest] },
        // re-running reloads it: bootout (if loaded) then bootstrap, which runs it at once (RunAtLoad)
        { ...root, argv: ['launchctl', 'bootout', `system/${PF_LABEL}`], mayFail: true },
        { ...root, argv: ['launchctl', 'bootstrap', 'system', PF_PLIST] },
      ],
    };
  },

  unredirect(): Recipe {
    return {
      why: `Remove the redirect: the ${PF_LABEL} LaunchDaemon and the ${PF_ANCHOR_NAME} pf anchor`,
      files: [],
      cmds: [
        { ...root, argv: ['launchctl', 'bootout', `system/${PF_LABEL}`], mayFail: true },
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
            { ...root, argv: ['security', 'remove-trusted-cert', '-d', env.rootCert], mayFail: true },
            { ...root, argv: ['security', 'delete-certificate', '-Z', env.rootSha1, SYSTEM_KEYCHAIN] },
          ]
        : [{ ...root, argv: ['security', 'delete-certificate', '-c', 'Hallway Local CA', SYSTEM_KEYCHAIN], mayFail: true }],
    };
  },

  trustedQuery: () => ({ argv: ['security', 'find-certificate', '-a', '-Z', SYSTEM_KEYCHAIN], sudo: false }),

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
