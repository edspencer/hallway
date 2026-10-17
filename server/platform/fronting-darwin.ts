// macOS: the privileged parts of fronted mode (fronting.ts, D47). Unverified on macOS except where CI's macOS job
// runs them (docs/11-research-notes.md).
//   redirect   a pf anchor, com.apple/hallway, loaded at boot by a LaunchDaemon that runs one fixed pfctl command.
//              macOS's /etc/pf.conf already evaluates `rdr-anchor "com.apple/*"`, so pf.conf (which OS updates
//              rewrite) is never edited.
//   trust      the System keychain (`security add-trusted-cert`).
//   resolver   /etc/resolver/<base>, `nameserver 127.0.0.1` with a `port` line (resolver(5)).
//   the skip   pf ignores lo0 entirely, and so the redirect, when something has loaded a ruleset with `set skip on lo0`
//              (D64): found with read-only pfctl queries, cleared by loading /etc/pf.conf again.
// POSIX paths whatever OS this runs on, so this platform's logic is tested on Windows too
import fs from 'node:fs';
import { posix as path } from 'node:path';
import { type Fronting, type FrontingEnv, type LoopbackSkip, MARK, type Recipe, findTool } from './fronting.js';
import type { Runner } from './services.js';

export const PF_CONF = '/etc/pf.conf';
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

// ---------------------------------------------------------------------------------------------------------------
// pf skipping loopback (D64). The parsers are pure, tested against test/fixtures/platform/pfctl-*.txt.
// ---------------------------------------------------------------------------------------------------------------

const LOOPBACK = new Set(['lo0', 'lo']); // the interface, and its interface group

/** The interfaces (and groups) pf skips, from `pfctl -s Interfaces -v`, where each one is `lo0 (skip)`. */
export function parsePfSkipped(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^\s*(\S+)\s+\(skip\)/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

export interface PfReference {
  pid: number;
  name: string;
}

/** Who holds pf enabled, from `pfctl -s References`: a `PID  Process Name  TOKEN  TIMESTAMP` table (macOS only). */
export function parsePfReferences(text: string): PfReference[] {
  const out: PfReference[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s+(\d{4,})\s+\S.*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), name: m[2].trim() });
  }
  return out;
}

/** /etc/pf.conf itself says `set skip on` loopback? Comments and `\` continuations are understood; files it
 *  `include`s, and macros, are not followed. */
export function pfConfSkipsLoopback(text: string): boolean {
  const joined = text.replace(/\\\r?\n/g, ' ');
  for (const raw of joined.split('\n')) {
    const m = /^\s*set\s+skip\s+on\s+(.*)$/.exec(raw.replace(/#.*/, ''));
    if (m && m[1].split(/[\s,{}]+/).some((t) => LOOPBACK.has(t))) return true;
  }
  return false;
}

/** The main ruleset loaded now is macOS's stock one: nothing in it but the hooks for the com.apple anchors (`pfctl -s
 *  nat`, `pfctl -s rules`), including the rdr hook the redirect hangs off. Then loading /etc/pf.conf again can't take
 *  anyone's rules with it. */
export function stockMainRuleset(nat: string, rules: string): boolean {
  const lines = `${nat}\n${rules}`.split('\n').map((l) => l.trim()).filter(Boolean);
  const hook = /^(?:(?:scrub|nat|rdr|binat|dummynet)-)?anchor "com\.apple\/\*"(?:\s|$)/;
  return lines.every((l) => hook.test(l)) && lines.some((l) => l.startsWith('rdr-anchor "com.apple/*"'));
}

export interface PfFacts {
  /** Each command's stdout, or null when it couldn't run (no root). */
  interfaces: string | null;
  references: string | null;
  nat: string | null;
  rules: string | null;
  /** /etc/pf.conf's text, or null when it can't be read. */
  pfConf: string | null;
}

const RELOAD = `sudo pfctl -f ${PF_CONF} && sudo launchctl kickstart -k system/${PF_LABEL}`;

/** What the facts mean, for doctor and setup. Pure. */
export function diagnoseLoopbackSkip(f: PfFacts): LoopbackSkip {
  if (f.interfaces === null)
    return {
      skipped: null,
      message: "couldn't check whether pf is set to skip loopback (lo0), which makes it ignore the redirect: that needs root, and sudo would have had to ask for your password",
      fix: '`sudo -v`, then `hallway doctor` again, lets it look (or `sudo pfctl -s Interfaces -v`: a line `lo0 (skip)` is the problem)',
      repairable: false,
    };
  const skipped = [...parsePfSkipped(f.interfaces)].some((i) => LOOPBACK.has(i));
  if (!skipped) return { skipped: false, message: "pf doesn't skip loopback (lo0)", fix: '', repairable: false };
  // Hallway's own LaunchDaemon enables pf with `pfctl -E`, so its reference is a pfctl's
  const others = f.references === null ? [] : parsePfReferences(f.references).filter((r) => r.name !== 'pfctl');
  const by = others.length ? ` (pf was turned on by ${[...new Set(others.map((r) => `${r.name} (pid ${r.pid})`))].join(', ')}, which may be what set it)` : '';
  const message = `pf is set to skip loopback (lo0), so the redirect is ignored; something other than Hallway set this${by}`;
  const again = 'If the tool that set it does so again (at the next boot, say), the skip comes back.';
  if (f.pfConf !== null && pfConfSkipsLoopback(f.pfConf))
    return {
      skipped,
      message,
      fix: `${PF_CONF} itself says \`set skip on lo0\`, so loading it again won't help: take lo0 out of that line if nothing you use needs it, then \`${RELOAD}\``,
      repairable: false,
    };
  if (f.nat === null || f.rules === null || !stockMainRuleset(f.nat, f.rules))
    return {
      skipped,
      message,
      fix: `pf's main ruleset has rules beyond macOS's stock anchors (\`sudo pfctl -s rules\`, \`sudo pfctl -s nat\`), so loading ${PF_CONF} again would drop them: turn off the \`set skip on lo0\` in whatever loaded them, or, if you don't need them, \`${RELOAD}\`. ${again}`,
      repairable: false,
    };
  return {
    skipped,
    message,
    fix: `\`${RELOAD}\` (loading ${PF_CONF} again clears the skip; pf's main ruleset is macOS's stock one, so nothing else changes), or \`hallway setup\`, which does the same. ${again}`,
    repairable: true,
  };
}

/** Ask pf, read-only, through `sudo -n` (which never prompts: without a cached password it just fails). */
export async function loopbackSkip(run: Runner, readConf: () => string | null = () => readOr(PF_CONF)): Promise<LoopbackSkip> {
  const pfctl = async (...args: string[]) => {
    const r = await run('sudo', ['-n', 'pfctl', ...args]);
    return r.code === 0 ? r.stdout : null;
  };
  const interfaces = await pfctl('-s', 'Interfaces', '-v');
  const skipping = interfaces !== null && [...parsePfSkipped(interfaces)].some((i) => LOOPBACK.has(i));
  const more = skipping ? { references: await pfctl('-s', 'References'), nat: await pfctl('-s', 'nat'), rules: await pfctl('-s', 'rules') } : { references: null, nat: null, rules: null };
  return diagnoseLoopbackSkip({ interfaces, ...more, pfConf: skipping ? readConf() : null });
}

function readOr(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const root = { sudo: true } as const;

/** Keep Homebrew's own housekeeping (an auto-update, cleanup, hints) from burying setup's steps. */
export const BREW_ENV = ['HOMEBREW_NO_AUTO_UPDATE=1', 'HOMEBREW_NO_INSTALL_CLEANUP=1', 'HOMEBREW_NO_ENV_HINTS=1'];

const BREW_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin'];

export const darwinFronting: Fronting = {
  userServiceNoun: 'LaunchAgent',
  trustDialog: 'a separate macOS dialog (Touch ID or your password) to change certificate trust settings, which macOS asks for itself, even under sudo (Big Sur and later)',
  // everything the macOS recipes run ships with macOS
  detect: () => ({ nft: null, certutil: null, systemctl: null, resolved: false, caStore: null }),
  helperDirs: BREW_DIRS,
  installHelper(tool, env) {
    const brew = findTool('brew', env.PATH, BREW_DIRS);
    return brew ? { cmd: ['/usr/bin/env', ...BREW_ENV, brew, 'install', tool] } : { advice: `install ${tool} (with Homebrew: \`brew install ${tool}\`, see https://brew.sh), then run \`hallway setup\` again` };
  },

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
        // the first time, it isn't loaded, and launchctl says "Boot-out failed: 3: No such process": not shown
        { ...root, argv: ['launchctl', 'bootout', `system/${PF_LABEL}`], mayFail: true, quiet: true },
        { ...root, argv: ['launchctl', 'bootstrap', 'system', PF_PLIST] },
      ],
    };
  },

  unredirect(): Recipe {
    return {
      why: `Remove the redirect: the ${PF_LABEL} LaunchDaemon and the ${PF_ANCHOR_NAME} pf anchor`,
      files: [],
      cmds: [
        { ...root, argv: ['launchctl', 'bootout', `system/${PF_LABEL}`], mayFail: true, quiet: true },
        { ...root, argv: ['pfctl', '-a', PF_ANCHOR_NAME, '-F', 'all'], mayFail: true },
        { ...root, argv: ['rm', '-f', PF_PLIST, PF_ANCHOR] },
      ],
    };
  },

  loopbackSkip: (run) => loopbackSkip(run),

  unskip() {
    return {
      why: `Make pf stop skipping loopback (lo0), which something other than Hallway told it to: load macOS's own ${PF_CONF} again (that clears the skip), then the redirect`,
      when: `If pf has been told to skip loopback (lo0), which makes it ignore the redirect: load macOS's own ${PF_CONF} again (that clears the skip), then the redirect`,
      files: [],
      cmds: [
        { ...root, argv: ['pfctl', '-f', PF_CONF] },
        { ...root, argv: ['launchctl', 'kickstart', '-k', `system/${PF_LABEL}`] },
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
