// Linux: the OS-specific parts of fronted mode (fronting.ts, D47, D65).
//   redirect   System-wide certificate tier only (an unprivileged process can't have loopback 443 on Linux, and nothing binds it on
//              the user's behalf): an nftables table, `inet hallway`, with a nat output chain, applied at boot by a oneshot system unit.
//              Its own table: nothing else's rules are touched, and teardown deletes the table whole.
//   trust      the system CA store (Debian/Ubuntu: /usr/local/share/ca-certificates; Fedora/RHEL/Arch:
//              /etc/pki/ca-trust/source/anchors), plus the user's NSS database, which Chrome and Chromium read on
//              Linux (no sudo; only when `certutil` and ~/.pki/nssdb exist). User certificate: that NSS database alone,
//              created if Chrome hasn't yet, with no prompt at all.
//   resolver   a systemd-resolved drop-in routing `~<base>` to Hallway's dnsmasq.
// POSIX paths whatever OS this runs on, so this platform's logic is tested on Windows too
import { posix as path } from 'node:path';
import fs from 'node:fs';
import { type Cmd, type Fronting, type FrontingEnv, FrontingUnsupported, MARK, type Recipe, curlTrust, curlTrustArgs, findTool } from './fronting.js';
import type { Runner } from './services.js';

export const NFT_FILE = '/etc/hallway/redirect.nft';
export const REDIRECT_UNIT = 'hallway-redirect.service';
export const REDIRECT_UNIT_FILE = `/etc/systemd/system/${REDIRECT_UNIT}`;
export const RESOLVED_DROPIN = '/etc/systemd/resolved.conf.d/hallway.conf';
export const NSS_NICKNAME = 'Hallway Local CA';
export const CA_FILES = {
  debian: { file: '/usr/local/share/ca-certificates/hallway-local-ca.crt', update: ['update-ca-certificates'] },
  fedora: { file: '/etc/pki/ca-trust/source/anchors/hallway-local-ca.crt', update: ['update-ca-trust', 'extract'] },
} as const;

export function nftRules({ httpsPort, httpPort }: Pick<FrontingEnv, 'httpsPort' | 'httpPort'>): string {
  return `# ${MARK}
# Applied at boot by ${REDIRECT_UNIT}. Connections from this machine to loopback ports 443 and 80 go to Hallway's
# Caddy, which runs as you on ${httpsPort} and ${httpPort}. Hallway's own table: nothing else's rules are touched.
# (Declaring then deleting the table first makes re-applying the file replace it rather than add to it.)
table inet hallway
delete table inet hallway
table inet hallway {
  chain output {
    type nat hook output priority -100; policy accept;
    ip daddr 127.0.0.1 tcp dport 443 redirect to :${httpsPort}
    ip daddr 127.0.0.1 tcp dport 80 redirect to :${httpPort}
    ip6 daddr ::1 tcp dport 443 redirect to :${httpsPort}
    ip6 daddr ::1 tcp dport 80 redirect to :${httpPort}
  }
}
`;
}

export function redirectUnit(nft: string): string {
  return `# ${MARK}
# Applies one fixed nftables file at boot; it reads nothing a user can write.
[Unit]
Description=Hallway: redirect loopback ports 443 and 80 to Hallway's Caddy
After=nftables.service
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${nft} -f ${NFT_FILE}
ExecStop=${nft} delete table inet hallway

[Install]
WantedBy=multi-user.target
`;
}

export function resolvedDropin(base: string, dnsPort: number): string {
  return `# ${MARK}
# Routes ${base} and every name under it to Hallway's dnsmasq, which runs as you on 127.0.0.1:${dnsPort}.
[Resolve]
DNS=127.0.0.1:${dnsPort}
Domains=~${base}
`;
}

const root = { sudo: true } as const;
const nssDir = (home: string) => path.join(home, '.pki', 'nssdb');
const nssDb = (home: string) => `sql:${nssDir(home)}`;
/** Where to get `certutil`, for a refusal. */
export const CERTUTIL_ADVICE = "install `certutil` (Debian and Ubuntu: `sudo apt install libnss3-tools`; Fedora: `sudo dnf install nss-tools`; Arch: `sudo pacman -S nss`), then run `hallway setup` again";

/** A PEM's base64 body, for comparing two copies of a certificate. */
const pemBody = (pem: string) => pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

const SBIN = ['/usr/local/sbin', '/usr/sbin', '/sbin', '/usr/local/bin', '/usr/bin'];
const exists = (p: string) => fs.existsSync(p);

export const linuxFronting: Fronting = {
  userServiceNoun: 'systemd user unit',
  lowPorts: 'redirect',
  detect: (env) => ({
    nft: findTool('nft', env.PATH, SBIN),
    certutil: findTool('certutil', env.PATH, SBIN),
    nssdb: exists(`${env.HOME ?? ''}/.pki/nssdb`),
    systemctl: exists('/run/systemd/system') ? findTool('systemctl', env.PATH, SBIN) : null,
    // resolved is in charge when it's running and /etc/resolv.conf points at its stub (or at its own file)
    resolved: exists('/run/systemd/resolve/stub-resolv.conf') && /127\.0\.0\.53|systemd-resolved|stub-resolv/.test(safeRead('/etc/resolv.conf') + safeLink('/etc/resolv.conf')),
    caStore: findTool('update-ca-certificates', env.PATH, SBIN) && exists('/usr/local/share/ca-certificates') ? 'debian' : findTool('update-ca-trust', env.PATH, SBIN) ? 'fedora' : null,
  }),
  helperDirs: SBIN,
  installHelper: (tool) => ({
    advice:
      tool === 'caddy'
        ? 'install Caddy 2.7 or later: a release binary from https://caddyserver.com/download (or https://github.com/caddyserver/caddy/releases) on your PATH, or set proxy.caddy in config.yaml to where it is. Distribution packages may be older, and start a system Caddy on port 80 that you would need to disable'
        : 'install dnsmasq (on Debian and Ubuntu the `dnsmasq-base` package, which starts no system service: `sudo apt install dnsmasq-base`), then run `hallway setup` again',
  }),

  redirect(env): Recipe {
    if (!env.tools.systemctl) throw new FrontingUnsupported("the redirect from ports 443 and 80 is applied at boot by a systemd unit, and this machine doesn't run systemd. Use fronted mode without it: set proxy.publicPort to proxy.httpsPort in config.yaml (links then carry the port)");
    if (!env.tools.nft) throw new FrontingUnsupported("the redirect from ports 443 and 80 needs nftables (the `nft` command): install it (e.g. `sudo apt install nftables`), then run `hallway setup` again");
    const rules = { src: path.join(env.setupDir, 'redirect.nft'), dest: NFT_FILE, text: nftRules(env) };
    const unit = { src: path.join(env.setupDir, REDIRECT_UNIT), dest: REDIRECT_UNIT_FILE, text: redirectUnit(env.tools.nft) };
    return {
      why: `Redirect loopback ports 443 and 80 to Caddy on ${env.httpsPort} and ${env.httpPort} (an nftables table, applied at boot by ${REDIRECT_UNIT})`,
      files: [rules, unit],
      cmds: [
        { ...root, argv: ['install', '-D', '-m', '0644', rules.src, rules.dest] },
        { ...root, argv: ['install', '-m', '0644', unit.src, unit.dest] },
        { ...root, argv: ['systemctl', 'daemon-reload'] },
        { ...root, argv: ['systemctl', 'enable', REDIRECT_UNIT] },
        { ...root, argv: ['systemctl', 'restart', REDIRECT_UNIT] },
      ],
    };
  },

  unredirect(): Recipe {
    return {
      why: `Remove the redirect: ${REDIRECT_UNIT} and its nftables table`,
      files: [],
      cmds: [
        { ...root, argv: ['systemctl', 'disable', '--now', REDIRECT_UNIT], mayFail: true },
        { ...root, argv: ['nft', 'delete', 'table', 'inet', 'hallway'], mayFail: true },
        { ...root, argv: ['rm', '-f', REDIRECT_UNIT_FILE, NFT_FILE] },
        { ...root, argv: ['rmdir', path.dirname(NFT_FILE)], mayFail: true },
        { ...root, argv: ['systemctl', 'daemon-reload'] },
      ],
    };
  },

  trust(env): Recipe {
    const store = env.tools.caStore;
    if (!store) throw new FrontingUnsupported("can't find this system's CA store (neither /usr/local/share/ca-certificates with update-ca-certificates nor /etc/pki/ca-trust with update-ca-trust)");
    const { file, update } = CA_FILES[store];
    const nss: Cmd[] = env.tools.certutil && env.tools.nssdb
      ? [
          // Chrome and Chromium on Linux read the user's NSS database, not the system store; as the user, no sudo
          { sudo: false, argv: [env.tools.certutil, '-d', nssDb(env.userHome), '-D', '-n', NSS_NICKNAME], mayFail: true },
          { sudo: false, argv: [env.tools.certutil, '-d', nssDb(env.userHome), '-A', '-t', 'C,,', '-n', NSS_NICKNAME, '-i', env.rootCert] },
        ]
      : [];
    return {
      why: `Trust Hallway's local certificate authority system-wide${nss.length ? ", and in your NSS database (Chrome's on Linux)" : ''}`,
      files: [],
      cmds: [{ ...root, argv: ['install', '-D', '-m', '0644', env.rootCert, file] }, { ...root, argv: [...update] }, ...nss],
    };
  },

  untrust(env): Recipe {
    const store = env.tools.caStore ? CA_FILES[env.tools.caStore] : null;
    const cmds: Cmd[] = store ? [{ ...root, argv: ['rm', '-f', store.file] }, { ...root, argv: [...store.update] }] : [];
    return { why: "Remove Hallway's local certificate authority from the system's trust store", files: [], cmds };
  },

  userTrust(env): Recipe {
    if (!env.tools.certutil) throw new FrontingUnsupported(`trusting Hallway's certificate for your account means adding it to your NSS database (~/.pki/nssdb, which Chrome and Chromium read), and that needs certutil: ${CERTUTIL_ADVICE}`);
    const certutil = env.tools.certutil;
    return {
      why: `Trust Hallway's local certificate authority in your own NSS database (${nssDir(env.userHome).replace(env.userHome, '~')}), which Chrome and Chromium read: as you, no sudo`,
      files: [],
      cmds: [
        // Chrome makes the database on its first run; if it hasn't run yet, make an empty one (no password) as it would
        ...(env.tools.nssdb ? [] : [{ sudo: false, argv: ['mkdir', '-p', '-m', '0700', nssDir(env.userHome)] }, { sudo: false, argv: [certutil, '-N', '-d', nssDb(env.userHome), '--empty-password'] }]),
        { sudo: false, argv: [certutil, '-d', nssDb(env.userHome), '-D', '-n', NSS_NICKNAME], mayFail: true, quiet: true },
        { sudo: false, argv: [certutil, '-d', nssDb(env.userHome), '-A', '-t', 'C,,', '-n', NSS_NICKNAME, '-i', env.rootCert] },
      ],
    };
  },

  userUntrust(env): Recipe {
    return {
      why: "Remove Hallway's local certificate authority from your NSS database, as you, no sudo",
      files: [],
      cmds: env.tools.certutil ? [{ sudo: false, argv: [env.tools.certutil, '-d', nssDb(env.userHome), '-D', '-n', NSS_NICKNAME], mayFail: true }] : [],
    };
  },

  async userTrusted(env, run: Runner) {
    if (!env.tools.certutil || !env.tools.nssdb) return false;
    const r = await run(env.tools.certutil, ['-L', '-d', nssDb(env.userHome), '-n', NSS_NICKNAME, '-a']);
    const pem = safeRead(env.rootCert);
    return r.code === 0 && !!pem && pemBody(r.stdout) === pemBody(pem);
  },

  // User certificate is Chrome's NSS database (what Chrome and Chromium read); System-wide certificate, the system's
  // store, as the system's curl reads it
  async osTrust(target, tier, env, run) {
    if (tier === 'user') {
      // the database may have been made since the facts were gathered (setup makes it before the trust step): look again
      const ok = await linuxFronting.userTrusted!({ ...env, tools: { ...env.tools, nssdb: env.tools.nssdb || fs.existsSync(nssDir(env.userHome)) } }, run);
      return ok ? { trusted: true, how: "Chrome's NSS database (~/.pki/nssdb)" } : { trusted: false, how: "Chrome's NSS database (~/.pki/nssdb)", cause: "Hallway's root isn't in it" };
    }
    const r = await run('curl', curlTrustArgs(target.host, target.port));
    if (r.code === 127) return { trusted: null, how: "the system's certificate store", cause: 'curl is not installed' };
    return curlTrust(r.code, r.stderr, "the system's certificate store (curl, with no CA given)");
  },

  resolver(env): Recipe {
    if (!env.tools.resolved)
      throw new FrontingUnsupported(
        `custom domains on Linux need systemd-resolved, which isn't running here. Point your resolver at 127.0.0.1:${env.dnsPort} for ${env.base} yourself, or use the default *.localhost names, which need no DNS`,
      );
    const f = { src: path.join(env.setupDir, 'resolved.conf'), dest: RESOLVED_DROPIN, text: resolvedDropin(env.base, env.dnsPort) };
    return {
      why: `Send ${env.base} and every name under it to Hallway's dnsmasq on 127.0.0.1:${env.dnsPort} (a systemd-resolved drop-in)`,
      files: [f],
      cmds: [
        { ...root, argv: ['install', '-D', '-m', '0644', f.src, f.dest] },
        { ...root, argv: ['systemctl', 'restart', 'systemd-resolved.service'] },
      ],
    };
  },

  unresolver(): Recipe {
    return {
      why: `Stop sending the custom domain to Hallway's dnsmasq (remove ${RESOLVED_DROPIN})`,
      files: [],
      cmds: [
        { ...root, argv: ['rm', '-f', RESOLVED_DROPIN] },
        { ...root, argv: ['systemctl', 'restart', 'systemd-resolved.service'], mayFail: true },
      ],
    };
  },

  installed: (env) => ({
    redirect: [REDIRECT_UNIT_FILE, NFT_FILE],
    trust: env.tools.caStore ? [CA_FILES[env.tools.caStore].file] : [CA_FILES.debian.file, CA_FILES.fedora.file],
    resolver: [RESOLVED_DROPIN],
  }),
};

function safeRead(f: string) {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}
function safeLink(f: string) {
  try {
    return fs.readlinkSync(f);
  } catch {
    return '';
  }
}
