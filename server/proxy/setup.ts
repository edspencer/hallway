// `hallway setup [--trust user|system|none] [--domain BASE] [--print] [--yes]` and `hallway teardown
// [--uninstall-packages]` (docs/03-networking.md, "Setup"; D47, D65, D67). Setup is three kinds of step, all printed
// before they run:
//   Hallway   things Hallway does as you: write its files, install and start its own user-level jobs (Caddy; dnsmasq
//             for a custom domain; on macOS the forwarders that launchd hands loopback 443 and 80 to), edit config.yaml
//   you       a command run as you (installing Caddy with Homebrew; trusting the certificate for your account only)
//   sudo      the privileged recipes from the platform layer (server/platform/fronting*.ts): trusting the local CA
//             system-wide, the custom-domain resolver, Linux's 443/80 redirect, and removing what another tier (or an
//             older Hallway: macOS's pf redirect) installed. Each command is printed, then run through sudo.
// The tier (D65) decides which: No admin (`user`) has no sudo step at all, No prompts (`none`) nothing that asks for
// anything, System-wide (`system`) is the old setup without the pf redirect. Switching tier removes what the old one
// added. Everything is idempotent: a part that's already in place (checked by asking the real thing where possible) is
// skipped, so re-running setup only fixes what's missing. `--print` gathers the same facts and prints the plan, running
// nothing. Gathering facts is read-only; planning is a pure function of the facts (tested with fixtures).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { HallwayConfig, Trust } from '../../shared/api.js';
import { UsageError } from '../args.js';
import { dataPaths, tildify } from '../config.js';
import { type Cmd, type FrontingEnv, FrontingUnsupported, type Platform, type Recipe, type Runner, type StagedFile, dnsmasqConf, mergeListeners } from '../platform/index.js';
import { findTool } from '../platform/fronting.js';
import { type Forward, forwards } from '../services/spec.js';
import type { Services } from '../services/index.js';
import type { Store } from '../store/index.js';
import { isListening } from '../services/ports.js';
import { atomicWrite } from '../store/safefs.js';
import { CaddyUnreachable, loadConfig, runningConfig } from './admin.js';
import { CA_NAME, caddyConfig, caddyPaths, caddyText } from './caddy.js';
import { fallbackHtml } from './fallback.js';
import { ipv6Loopback, proxyApps } from './index.js';
import { publicUrl } from './names.js';
import { httpProbe, httpsStatus, readRoot, tlsProbe } from './probe.js';
import { type MachineFacts, currentTier, machineFacts, suggestedTier, tierProxy, tierQuestion, tierText, atTheScreen } from './tiers.js';
import { type TldVerdict, delegatedTlds, tldVerdict } from './tld.js';

/** The oldest Caddy that understands the config (2.6 ignores the admin socket's `|0600` mode: research notes). */
export const MIN_CADDY = [2, 7, 0] as const;

// ---------------------------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------------------------

/** How loopback 443 and 80 reach Caddy in the tier being set up: launchd's sockets and forwarders (macOS, every
 *  tier), the nftables redirect (Linux, System-wide), or not at all (links carry Caddy's own port). */
export type LowPorts = 'sockets' | 'redirect' | 'none';

export interface Facts {
  platform: Platform['id'];
  /** The tier being set up, and the one config.yaml records now (null: direct mode, or never set up). */
  tier: Trust;
  previous: Trust | null;
  base: string;
  /** A custom domain (not `localhost`): dnsmasq and the resolver are part of it. */
  custom: boolean;
  dashboard: string;
  httpsPort: number;
  httpPort: number;
  dnsPort: number;
  /** What links will look like: the scheme and port config.yaml will say. */
  scheme: 'https' | 'http';
  publicPort: number;
  lowPorts: LowPorts;
  /** macOS: the forwarders launchd will hold 443 and 80 for. */
  forwards: Forward[];
  /** The TLD verdict, for a custom domain. */
  tld: TldVerdict | null;
  caddy: { path: string | null; version: string | null; install: { cmd: string[] } | { advice: string } };
  dnsmasq: { path: string | null; install: { cmd: string[] } | { advice: string } } | null;
  /** Who holds a port setup needs, for people; non-empty means stop. */
  conflicts: string[];
  warnings: string[];
  /** Reasons to stop that the facts found (the CLI that forwarders would run is npx's, nobody at the Mac's screen…). */
  stops: string[];
  env: FrontingEnv;
  /** What's installed now, from this tier or another (or an older Hallway). */
  found: {
    /** macOS: the pf redirect from before the tiers. Linux: the nftables redirect. */
    redirect: boolean;
    systemTrust: boolean;
    userTrust: boolean;
    /** The resolver file for `base` (this domain), and for the custom domain config.yaml has now, if another. */
    resolver: boolean;
    oldResolver: string | null;
    dnsmasq: boolean;
    forwarders: string[];
  };
  /** Already in place. */
  done: { trust: boolean; lowPorts: boolean; resolver: boolean; config: boolean };
}

export interface SetupDeps {
  store: Store;
  platform: Platform;
  services: () => Services;
  env: NodeJS.ProcessEnv;
  userHome: string;
  /** Captures output (version, read-only queries). */
  query: Runner;
  out: (s: string) => void;
  /** Runs a command with the terminal attached (sudo may prompt), resolving with its exit code; `quiet` drops stderr. */
  exec?: (argv: string[], opts?: { quiet?: boolean }) => Promise<number>;
  /** Is this process root already? (Then commands run without sudo.) */
  isRoot?: boolean;
  /** Asking before anything changes (D67): `yes` (--yes) skips the question; `ask` is a terminal to ask on. With
   *  neither, setup and teardown refuse. */
  confirm?: { yes?: boolean; ask?: (question: string) => Promise<string> };
  /** For tests: probes, the TLD list, who this user is, and whether they're at the Mac's screen. */
  tlds?: Set<string> | null;
  probe443?: () => Promise<'ours' | 'other' | 'none'>;
  machine?: MachineFacts;
  atScreen?: () => Promise<boolean | null>;
}

const versionOf = (s: string) => /v?(\d+)\.(\d+)\.(\d+)/.exec(s)?.slice(1, 4).map(Number) ?? null;
export function versionAtLeast(v: string | null, min: readonly number[]): boolean {
  const n = v ? versionOf(v) : null;
  if (!n) return false;
  for (let i = 0; i < 3; i++) if (n[i] !== min[i]) return n[i] > min[i];
  return true;
}

/** The files a recipe installs are in place with exactly the text it would install. */
export function installedAsStaged(files: readonly StagedFile[]): boolean {
  return files.length > 0 && files.every((f) => readOr(f.dest) === f.text);
}

/** What's listening on 443/80 (or Caddy's and dnsmasq's ports) that isn't Hallway's, for people. */
export async function portConflicts(
  platform: Platform,
  want: { port: number; what: string; oursIf?: (command: string) => boolean }[],
): Promise<{ conflicts: string[]; seen: Set<number> }> {
  const listeners = mergeListeners(await platform.listListeners());
  const pids = [...new Set(listeners.map((l) => l.pid).filter((p): p is number => p !== null))];
  const info = pids.length ? await platform.processInfo(pids) : new Map();
  const conflicts: string[] = [];
  const seen = new Set<number>();
  for (const w of want)
    for (const l of listeners.filter((x) => x.port === w.port)) {
      seen.add(w.port);
      const cmd = l.pid ? info.get(l.pid)?.command ?? '' : '';
      if (w.oursIf && cmd && w.oursIf(cmd)) continue;
      const who = l.pid ? `${l.process ?? 'a process'} (pid ${l.pid}${cmd ? `: ${cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd}` : ''})` : "a process you can't see (another user's, perhaps root's)";
      conflicts.push(`port ${w.port} (${w.what}) is held by ${who}, listening on ${l.addresses.join(', ')}`);
    }
  return { conflicts, seen };
}

/** A command line that's one of Hallway's forwarders (`node …/cli.js forward 4443`), as launchd runs them. */
export const isOurForwarder = (command: string) => /[/\\]cli\.js forward \d+(\s|$)/.test(command);

/** How loopback 443/80 reach Caddy for a tier on this platform. A hand-set `publicPort: httpsPort` from before the
 *  tiers (fronted mode with nothing on 443, D47) is kept for System-wide, the only tier that had it. */
export function lowPortsFor(platform: Pick<Platform, 'fronting'>, tier: Trust, cfg: Pick<HallwayConfig, 'proxy'>): LowPorts {
  if (tier === 'system' && cfg.proxy.trust === null && cfg.proxy.publicPort === cfg.proxy.httpsPort) return 'none';
  if (platform.fronting.lowPorts === 'sockets') return 'sockets';
  return tier === 'system' ? 'redirect' : 'none';
}

export interface SetupOptions {
  domain?: string;
  print?: boolean;
  /** The tier; without one, setup asks on a terminal, or else keeps the current tier, or else the recommended one. */
  trust?: Trust;
}

export async function gatherFacts(deps: SetupDeps, opts: SetupOptions & { trust: Trust }): Promise<Facts> {
  const { store, platform, env } = deps;
  const cfg = store.currentConfig();
  const tier = opts.trust;
  const previous = cfg.mode === 'fronted' ? currentTier(cfg) : null;
  const f = platform.fronting;
  const warnings: string[] = [];
  const stops: string[] = [];
  // custom domains need the resolver, which is root: System-wide only. Another tier goes back to *.localhost
  const wanted = (opts.domain ?? cfg.domain.base).toLowerCase().replace(/\.$/, '');
  const base = tier === 'system' ? wanted : 'localhost';
  if (wanted !== base) warnings.push(`${wanted} is a custom domain, and those need System-wide (--trust system): the system resolver has to be pointed at it, which needs an administrator. ${tierText(platform.id, tier).name} uses *.localhost${cfg.domain.base !== 'localhost' && cfg.mode === 'fronted' ? `, and ${wanted}'s resolver and dnsmasq are removed` : ''}.`);
  const custom = base !== 'localhost';
  // a new domain gets that domain's default dashboard (its apex); otherwise whatever config.yaml says
  const dashboard = base !== cfg.domain.base ? (custom ? base : 'hallway.localhost') : cfg.domain.dashboard;
  const { httpsPort, httpPort } = cfg.proxy;
  const dnsPort = cfg.domain.dnsPort;
  const paths = caddyPaths(store.home);
  const lowPorts = lowPortsFor(platform, tier, cfg);
  const scheme = tierProxy(platform.id, tier, cfg.proxy).scheme;
  // what links will carry: Caddy's own port when nothing holds 443/80 for it
  const publicPort = lowPorts === 'none' ? (scheme === 'https' ? httpsPort : httpPort) : scheme === 'https' ? 443 : 80;
  const want = lowPorts === 'sockets' ? forwards(cfg.proxy, scheme) : [];

  const tld = custom ? tldVerdict(base, deps.tlds !== undefined ? deps.tlds : await delegatedTlds(dataPaths(store.home).cache)) : null;

  const caddyPath = cfg.proxy.caddy ?? findTool('caddy', env.PATH, f.helperDirs);
  let caddyVersion: string | null = null;
  if (caddyPath) {
    const r = await deps.query(caddyPath, ['version']);
    caddyVersion = r.code === 0 ? (r.stdout.trim().split(/\s+/)[0] ?? null) : null;
  }
  const caddy = { path: caddyPath, version: caddyVersion, install: f.installHelper('caddy', env) };
  const dnsmasq = custom ? { path: findTool('dnsmasq', env.PATH, f.helperDirs), install: f.installHelper('dnsmasq', env) } : null;

  // the low ports this tier needs, by scheme: plain HTTP needs only 80
  // a forwarder of ours that launchd has started (macOS) shows up as a node on 443/80: it isn't in the way
  const lows = (lowPorts === 'none' ? [] : scheme === 'https' ? [{ port: 443, what: 'HTTPS' }, { port: 80, what: 'HTTP' }] : [{ port: 80, what: 'HTTP' }]).map((l) => ({ ...l, oursIf: isOurForwarder }));
  const ours = (file: string) => (cmd: string) => cmd.includes(file);
  const { conflicts, seen } = await portConflicts(platform, [
    ...lows,
    { port: httpsPort, what: 'proxy.httpsPort, for Caddy', oursIf: ours(paths.config) },
    { port: httpPort, what: 'proxy.httpPort, for Caddy', oursIf: ours(paths.config) },
    ...(custom ? [{ port: dnsPort, what: "domain.dnsPort, for Hallway's dnsmasq", oursIf: ours(path.join(dataPaths(store.home).generated, 'dnsmasq.conf')) }] : []),
  ]);
  // lsof shows only your own processes: a root listener on 443 (or launchd holding it for someone else's agent) is
  // invisible to it, but not to a connection
  const p443 = lows.some((l) => l.port === 443) && !seen.has(443) ? await probe443Cached(deps, dashboard, cfg.domain.dashboard) : null;
  if (p443 === 'other') conflicts.push("port 443 answers, but not with Hallway's certificate, and its owner isn't visible to you (perhaps root's); `sudo lsof -nP -iTCP:443 -sTCP:LISTEN` names it");
  const { conflicts: admin } = await portConflicts(platform, [{ port: 2019, what: "a Caddy admin API's default port" }]);
  if (admin.length) warnings.push(`${admin[0]}: another Caddy is probably running. Hallway's Caddy doesn't use port 2019 and leaves that one alone, but it mustn't hold 80 or 443.`);
  if (caddyPath && caddyVersion && !versionAtLeast(caddyVersion, MIN_CADDY)) warnings.push(`Caddy ${caddyVersion} (${caddyPath}) is older than ${MIN_CADDY.join('.')}, which Hallway needs (it can't put the admin API on a private socket)`);

  const root = readRoot(paths.rootCert);
  const fenv: FrontingEnv = {
    setupDir: path.join(dataPaths(store.home).generated, 'setup'),
    rootCert: paths.rootCert,
    rootSha1: root?.sha1 ?? null,
    httpsPort,
    httpPort,
    dnsPort,
    base,
    userHome: deps.userHome,
    tools: f.detect(env),
  };
  const services = safeServices(deps);
  const forwarders = services?.forwardersInstalled() ?? [];
  const oldBase = cfg.domain.base !== 'localhost' && cfg.domain.base !== base ? cfg.domain.base : null;
  const found = {
    redirect: f.installed(fenv).redirect.some((p) => fs.existsSync(p)),
    systemTrust: root ? await isTrusted(deps, fenv) : false,
    userTrust: root && f.userTrusted ? await f.userTrusted(fenv, deps.query) : false,
    resolver: custom ? safe(() => installedAsStaged(f.resolver(fenv).files)) : false,
    oldResolver: oldBase && f.installed({ ...fenv, base: oldBase }).resolver.some((p) => fs.existsSync(p)) ? oldBase : null,
    dnsmasq: services?.helperInstalled('dnsmasq') ?? false,
    forwarders,
  };
  if (lowPorts === 'sockets') {
    // the forwarders run Hallway's own CLI: never npx's cache (D61), and a checkout must have been built
    const problem = services ? services.cliProblem() : null;
    if (problem) stops.push(problem);
  }
  if (platform.id === 'darwin' && tier === 'user' && !found.userTrust && root !== null) {
    // the trust dialog needs someone at the screen: run headless, `security add-trusted-cert` waits forever (verified)
    const here = await (deps.atScreen ?? (() => atTheScreen(deps.query)))();
    if (here === false) stops.push("trusting the certificate for your account shows a macOS dialog, and you aren't the one at this Mac's screen (logged in over SSH?): run `hallway setup --trust user` at the Mac itself, or use --trust none");
  }
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const done = {
    trust: tier === 'none' ? true : tier === 'user' ? found.userTrust : found.systemTrust,
    lowPorts:
      lowPorts === 'none'
        ? true
        : lowPorts === 'redirect'
          ? safe(() => installedAsStaged(f.redirect!(fenv).files)) && (await probe443Cached(deps, dashboard, cfg.domain.dashboard)) === 'ours'
          : sameSet(forwarders, want.map((w) => w.label)) && (scheme === 'http' || p443 === 'ours'),
    resolver: custom ? found.resolver : true,
    config:
      cfg.mode === 'fronted' &&
      cfg.domain.base === base &&
      cfg.domain.dashboard === dashboard &&
      cfg.proxy.trust === tier &&
      cfg.proxy.scheme === scheme &&
      publicUrl('x', cfg.proxy) === publicUrl('x', { scheme, publicPort }),
  };
  return { platform: platform.id, tier, previous, base, custom, dashboard, httpsPort, httpPort, dnsPort, scheme, publicPort, lowPorts, forwards: want, tld, caddy, dnsmasq, conflicts, warnings, stops, env: fenv, found, done };
}

const safe = (f: () => boolean) => {
  try {
    return f();
  } catch {
    return false;
  }
};

function safeServices(deps: Pick<SetupDeps, 'services'>): Services | null {
  try {
    return deps.services();
  } catch {
    return null;
  }
}

/** Does 127.0.0.1:443 answer with a certificate from Hallway's CA, something else, or nothing? */
export async function probe443(...names: string[]): Promise<'ours' | 'other' | 'none'> {
  // something that accepts the connection but doesn't speak TLS (a plain HTTP server) is still in the way
  if (!(await isListening(443, '127.0.0.1', 1000))) return 'none';
  // Caddy only completes a handshake for a name it serves: when the domain is changing, that's the old dashboard
  for (const name of [...new Set(names)]) {
    const t = await tlsProbe(443, name, null, 1500);
    if (t?.issuer?.startsWith(CA_NAME)) return 'ours';
  }
  return 'other';
}
const probe443Cached = (deps: SetupDeps, ...names: string[]) => (deps.probe443 ?? (() => probe443(...names)))();

/** Is Hallway's root in the system trust store? */
export async function isTrusted(deps: Pick<SetupDeps, 'platform' | 'query'>, env: FrontingEnv): Promise<boolean> {
  const f = deps.platform.fronting;
  if (f.trustedQuery) {
    if (!env.rootSha1) return false;
    const q = f.trustedQuery(env);
    const r = await deps.query(q.argv[0], q.argv.slice(1));
    return r.code === 0 && r.stdout.toUpperCase().includes(env.rootSha1.toUpperCase());
  }
  const dests = f.installed(env).trust;
  const pem = readOr(env.rootCert);
  return !!pem && dests.some((d) => readOr(d) === pem);
}

// ---------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------

export type Step =
  | { kind: 'hallway'; why: string; detail?: string[]; done?: boolean; action: () => Promise<void> }
  // recheck, just before it runs: true is done already; a string is why it isn't needed (or won't be done)
  // dialog: its commands may raise the OS's own authorisation dialog (macOS trust settings), besides sudo's prompt:
  // the platform's words for it
  | { kind: 'run'; why: string; recipe: Pick<Recipe, 'files' | 'cmds'>; done?: boolean; recheck?: () => Promise<boolean | string>; dialog?: string };

export interface Plan {
  /** Reasons not to go ahead at all. */
  refusals: string[];
  warnings: string[];
  steps: Step[];
}

export interface PlanActions {
  writeCaddy(): Promise<void>;
  startCaddy(): Promise<void>;
  writeDnsmasq(): Promise<void>;
  startDnsmasq(): Promise<void>;
  /** Load exactly the forwarders the tier wants (macOS), removing any others. */
  forwardersUp(): Promise<void>;
  removeDnsmasq(): Promise<void>;
  setConfig(): Promise<void>;
  verify(): Promise<void>;
  isTrusted(): Promise<boolean>;
}

const noop = async () => {};
export const NO_ACTIONS: PlanActions = { writeCaddy: noop, startCaddy: noop, writeDnsmasq: noop, startDnsmasq: noop, forwardersUp: noop, removeDnsmasq: noop, setConfig: noop, verify: noop, isTrusted: async () => false };

/** Setup's steps, from the facts. Pure (the actions are only called when it runs). */
export function planSetup(facts: Facts, platform: Platform, home: string, a: PlanActions = NO_ACTIONS): Plan {
  const refusals: string[] = [...facts.stops.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))];
  const warnings = [...facts.warnings];
  const f = platform.fronting;
  const steps: Step[] = [];
  const show = (p: string) => tildify(p);
  const paths = caddyPaths(home);
  const gen = dataPaths(home).generated;
  const link = (host: string) => publicUrl(host, { scheme: facts.scheme, publicPort: facts.publicPort });
  const name = tierText(facts.platform, facts.tier).name;

  if (facts.tld?.verdict === 'refuse') refusals.push(`${facts.base}: ${facts.tld.reason}.`);
  else if (facts.tld?.verdict === 'warn') warnings.push(`${facts.base}: ${facts.tld.reason}.`);
  for (const c of facts.conflicts)
    refusals.push(`${c}. Hallway won't fight it: stop it${/:443|:80|\b(443|80)\b/.test(c) ? " (a container tool such as Docker Desktop, Rancher Desktop, Colima or Lima forwarding 80/443 is the usual culprit: turn that port forward off)" : ', or pick other ports in config.yaml (proxy.httpsPort, proxy.httpPort, domain.dnsPort)'}, then run \`hallway setup\` again.`);

  // the helpers
  const helper = (tool: 'caddy' | 'dnsmasq', found: string | null, install: { cmd: string[] } | { advice: string }) => {
    if (found) return;
    if ('cmd' in install) steps.push({ kind: 'run', why: `Install ${tool} (as you, with Homebrew)`, recipe: { files: [], cmds: [{ argv: install.cmd, sudo: false }] } });
    else refusals.push(`${tool} isn't installed: ${install.advice}.`);
  };
  helper('caddy', facts.caddy.path, facts.caddy.install);
  if (facts.dnsmasq) helper('dnsmasq', facts.dnsmasq.path, facts.dnsmasq.install);

  const recipe = (make: () => Recipe): Recipe | null => {
    try {
      return make();
    } catch (e) {
      if (!(e instanceof FrontingUnsupported)) throw e;
      refusals.push(`${e.message}.`);
      return null;
    }
  };
  // each part on its own, so one this machine can't do doesn't hide the others from --print
  const trust =
    facts.tier === 'system' ? recipe(() => f.trust(facts.env)) : facts.tier === 'user' && f.userTrust ? recipe(() => f.userTrust!(facts.env)) : null;
  const redirect = facts.lowPorts === 'redirect' && f.redirect ? recipe(() => f.redirect!(facts.env)) : null;
  const resolver = facts.custom ? recipe(() => f.resolver(facts.env)) : null;
  if (facts.lowPorts === 'none' && facts.tier === 'system') warnings.push(`proxy.publicPort is proxy.httpsPort (${facts.httpsPort}), so nothing is put on 443 and links carry :${facts.httpsPort}. Remove proxy.publicPort from config.yaml for plain https:// links.`);

  const routes = `${facts.custom ? `*.${facts.base}` : '*.localhost'} to your apps and ${link(facts.dashboard)} to the dashboard`;
  steps.push({
    kind: 'hallway',
    why: `Write Caddy's configuration, routing ${routes}${facts.scheme === 'http' ? ' (plain HTTP: no certificates)' : ''}, and check it with \`caddy validate\``,
    detail: [show(paths.config), show(paths.fallback)],
    action: a.writeCaddy,
  });
  steps.push({
    kind: 'hallway',
    why: `Run Caddy as you, on 127.0.0.1:${facts.scheme === 'https' ? `${facts.httpsPort} and :${facts.httpPort}` : facts.httpPort}, as a ${f.userServiceNoun} (hallway.caddy), with its admin API on a private socket`,
    detail: [show(paths.socket)],
    action: a.startCaddy,
  });
  if (facts.custom) {
    steps.push({ kind: 'hallway', why: `Write dnsmasq's configuration: ${facts.base} and every name under it → loopback`, detail: [show(path.join(gen, 'dnsmasq.conf'))], action: a.writeDnsmasq });
    steps.push({ kind: 'hallway', why: `Run dnsmasq as you, on 127.0.0.1:${facts.dnsPort}, as a ${f.userServiceNoun} (hallway.dnsmasq)`, action: a.startDnsmasq });
  }
  if (facts.lowPorts === 'sockets') {
    const ports = facts.scheme === 'https' ? `ports 443 and 80 (to Caddy's ${facts.httpsPort} and ${facts.httpPort})` : `port 80 (to Caddy's ${facts.httpPort})`;
    steps.push({
      kind: 'hallway',
      why: `Have launchd hold loopback ${ports} for you, on 127.0.0.1 and ::1: a ${f.userServiceNoun} for each, which launchd starts on the first connection to pass it on. No sudo: launchd binds them`,
      detail: facts.forwards.map((x) => `${x.label}  ${x.address === '::1' ? '[::1]' : x.address}:${x.port} → 127.0.0.1:${x.to}`),
      done: facts.done.lowPorts,
      action: a.forwardersUp,
    });
  }
  if (redirect) steps.push({ kind: 'run', why: redirect.why, recipe: redirect, done: facts.done.lowPorts });
  const userDialog = f.userTrustDialog;
  if (trust)
    steps.push({
      kind: 'run',
      why: trust.why,
      recipe: trust,
      done: facts.done.trust,
      recheck: a.isTrusted,
      dialog: facts.tier === 'system' ? f.trustDialog : userDialog,
    });
  if (resolver) steps.push({ kind: 'run', why: resolver.why, recipe: resolver, done: facts.done.resolver });

  // what another tier (or an older Hallway) installed that this one doesn't use
  const removals: Step[] = [];
  if (facts.found.redirect && facts.lowPorts !== 'redirect') {
    const r = f.unredirect(facts.env);
    removals.push({ kind: 'run', why: f.lowPorts === 'sockets' ? r.why : `${r.why} (${name} doesn't use it)`, recipe: r });
  }
  if (facts.found.systemTrust && facts.tier !== 'system') {
    const r = f.untrust(facts.env);
    removals.push({ kind: 'run', why: `${r.why} (${name} doesn't trust it system-wide)`, recipe: r });
  }
  // on Linux System-wide's trust includes the user's NSS database, so it's left there
  if (facts.found.userTrust && (facts.tier === 'none' || (facts.tier === 'system' && facts.platform === 'darwin')) && f.userUntrust) {
    const r = f.userUntrust(facts.env);
    removals.push({ kind: 'run', why: `${r.why} (${name} doesn't use it)`, recipe: r, dialog: userDialog });
  }
  if (facts.found.oldResolver) {
    const r = f.unresolver({ ...facts.env, base: facts.found.oldResolver });
    removals.push({ kind: 'run', why: r.why, recipe: r });
  }
  if (!facts.custom && facts.found.dnsmasq) removals.push({ kind: 'hallway', why: `Stop and remove Hallway's dnsmasq (${f.userServiceNoun} hallway.dnsmasq): *.localhost needs no DNS`, action: a.removeDnsmasq });
  if (removals.length && facts.previous && facts.previous !== facts.tier)
    warnings.push(`Moving from ${tierText(facts.platform, facts.previous).name} to ${name}: what the old tier added is removed${removals.some((s) => s.kind === 'run' && s.recipe.cmds.some((c) => c.sudo)) ? ' (that needs sudo, this once)' : ''}.`);
  else if (removals.some((s) => s.kind === 'run' && s.recipe.cmds.some((c) => c.sudo)) && f.lowPorts === 'sockets' && facts.found.redirect)
    warnings.push("An older Hallway's pf redirect is still installed: it's removed (that needs sudo, this once). launchd's sockets do its job now, with no root.");
  steps.push(...removals);

  steps.push({
    kind: 'hallway',
    why: `Switch config.yaml to fronted mode, ${name}${facts.custom ? ` on ${facts.base}` : ''}: links become ${link(`<app>.${facts.base}`)}`,
    done: facts.done.config,
    action: a.setConfig,
  });
  const through = facts.lowPorts === 'sockets' ? " through launchd's socket" : facts.lowPorts === 'redirect' ? ' through the redirect' : '';
  steps.push({ kind: 'hallway', why: `Check ${link(facts.dashboard)} answers${through}${facts.scheme === 'https' ? ", with Hallway's certificate" : ''}`, action: a.verify });
  return { refusals, warnings, steps };
}

/** The plan, for people (`--print`, and before running). */
export function formatPlan(plan: Plan, opts: { isRoot?: boolean; printOnly?: boolean } = {}): string {
  const out: string[] = [];
  for (const w of plan.warnings) out.push(`! ${w}`);
  for (const r of plan.refusals) out.push(`✗ ${r}`);
  if (plan.warnings.length || plan.refusals.length) out.push('');
  let n = 0;
  for (const s of plan.steps) {
    n++;
    const tag = s.kind === 'hallway' ? 'Hallway' : s.recipe.cmds.some((c) => c.sudo) ? 'sudo' : 'you';
    out.push(`${n}. [${tag}] ${s.why}${s.done ? ' (already done)' : ''}`);
    if (s.kind === 'hallway') for (const d of s.detail ?? []) out.push(`     ${d}`);
    else {
      for (const file of s.recipe.files) {
        out.push(`     writes ${tildify(file.src)}, installed as ${file.dest}:`);
        for (const l of file.text.trimEnd().split('\n')) out.push(`       | ${l}`);
      }
      for (const c of s.recipe.cmds) out.push(`     $ ${cmdLine(c, opts.isRoot)}${c.mayFail ? '   (may fail harmlessly)' : ''}`);
      if (s.dialog && !s.done) out.push(`     (asks: ${s.dialog})`);
    }
  }
  const sudo = plan.steps.some((s) => s.kind === 'run' && s.recipe.cmds.some((c) => c.sudo));
  if (opts.printOnly) out.push('', plan.refusals.length ? 'Nothing was run (and setup would stop: see ✗ above).' : `Nothing was run. \`hallway setup\` runs these${sudo ? ', asking for your password through sudo where it says sudo' : ''}.`);
  return out.join('\n') + '\n';
}

/** What will ask for what, said before the question (D65, D67): sudo's password in the terminal, the OS's own dialog,
 *  or nothing at all. */
export function promptsAhead(plan: Plan, platform: Platform, isRoot = false): string {
  void platform;
  const pending = plan.steps.filter((s) => !s.done && s.kind === 'run') as Extract<Step, { kind: 'run' }>[];
  const sudo = !isRoot && pending.some((s) => s.recipe.cmds.some((c) => c.sudo));
  const dialog = pending.find((s) => s.dialog)?.dialog ?? null;
  if (sudo && dialog) return `You'll be asked twice: for your password by sudo, here in the terminal, and then by ${dialog}.`;
  if (sudo) return 'sudo will ask for your password, here in the terminal (it remembers it for a few minutes).';
  if (dialog) return `You'll be asked by ${dialog}.`;
  return 'Nothing here will ask for a password.';
}

/** Print the plan and ask before running it (D67). False: the answer was no. Throws UsageError with no terminal and no
 *  --yes. With --yes the plan isn't printed up front: each step is still printed as it runs. */
export async function confirmPlan(plan: Plan, deps: Pick<SetupDeps, 'out' | 'confirm' | 'isRoot' | 'platform'>, what: 'setup' | 'teardown'): Promise<boolean> {
  const c = deps.confirm;
  if (!c?.yes && !c?.ask) throw new UsageError(`\`hallway ${what}\` asks before it changes anything, and there's no terminal to ask on: run it in one, or pass --yes (\`hallway ${what} --print\` shows what it would do)`);
  const ahead = promptsAhead(plan, deps.platform, deps.isRoot);
  if (c.yes) {
    deps.out(`${ahead}\n\n`);
    return true;
  }
  deps.out(formatPlan(plan, { isRoot: deps.isRoot }));
  deps.out(`\n${ahead}\n`);
  const answer = (await c.ask!('Continue? [y/N] ')).trim();
  if (/^y(es)?$/i.test(answer)) {
    deps.out('\n');
    return true;
  }
  deps.out(`Nothing was run.${what === 'setup' ? ' `hallway setup --print` shows the plan again.' : ''}\n`);
  return false;
}

const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const cmdLine = (c: Cmd, isRoot = false) => [...(c.sudo && !isRoot ? ['sudo'] : []), ...c.argv].map(quote).join(' ');

// ---------------------------------------------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------------------------------------------

export class SetupError extends Error {}

/** How long one command may take. sudo's password prompt counts, so it's generous; a hung GUI prompt still ends. */
export const COMMAND_TIMEOUT_MS = 5 * 60_000;

const defaultExec = (argv: string[], opts: { quiet?: boolean } = {}) =>
  new Promise<number>((resolve) => {
    const p = spawn(argv[0], argv.slice(1), { stdio: opts.quiet ? ['inherit', 'inherit', 'ignore'] : 'inherit' });
    const timer = setTimeout(() => {
      process.stderr.write(`hallway: \`${argv.join(' ')}\` took longer than ${COMMAND_TIMEOUT_MS / 60_000} minutes (is it waiting for a prompt?); stopping it\n`);
      p.kill('SIGTERM');
    }, COMMAND_TIMEOUT_MS);
    p.on('error', () => {
      clearTimeout(timer);
      resolve(127);
    });
    p.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

/** Run a plan's steps in order, printing each first; a failed command stops it. */
export async function runPlan(plan: Plan, deps: Pick<SetupDeps, 'out' | 'exec' | 'isRoot'>): Promise<void> {
  const exec = deps.exec ?? defaultExec;
  let n = 0;
  for (const s of plan.steps) {
    n++;
    if (s.kind === 'run' && s.recheck && !s.done) {
      const r = await s.recheck();
      if (typeof r === 'string') {
        deps.out(`${n}. ${s.why}\n   ${r}\n`);
        continue;
      }
      s.done = r;
    }
    if (s.done) {
      deps.out(`${n}. ${s.why}: already done\n`);
      continue;
    }
    deps.out(`${n}. ${s.why}\n`);
    if (s.kind === 'hallway') {
      await s.action();
      continue;
    }
    for (const file of s.recipe.files) {
      fs.mkdirSync(path.dirname(file.src), { recursive: true });
      atomicWrite(file.src, file.text);
      deps.out(`   wrote ${tildify(file.src)} (for ${file.dest})\n`);
    }
    for (const c of s.recipe.cmds) {
      deps.out(`   $ ${cmdLine(c, deps.isRoot)}\n`);
      const code = await exec(c.sudo && !deps.isRoot ? ['sudo', ...c.argv] : c.argv, { quiet: c.quiet });
      if (code !== 0 && !c.mayFail) throw new SetupError(`that failed (exit ${code}); nothing after it ran. Fix it and run the command again: it skips what's already done`);
    }
  }
}

/** Wait for `test` to be true, polling. */
async function until(test: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** What config.yaml will say once the plan has run: fronted, on `facts.base`, in `facts.tier`. */
function targetConfig(cfg: HallwayConfig, facts: Facts): HallwayConfig {
  return {
    ...cfg,
    mode: 'fronted',
    domain: { ...cfg.domain, base: facts.base, dashboard: facts.dashboard },
    proxy: { ...cfg.proxy, trust: facts.tier, scheme: facts.scheme, publicPort: facts.publicPort },
  };
}

/** The actions behind setup's Hallway steps. */
export function setupActions(deps: SetupDeps, facts: Facts): PlanActions {
  const { store } = deps;
  const paths = caddyPaths(store.home);
  const gen = dataPaths(store.home).generated;
  const https = facts.scheme === 'https';
  return {
    async writeCaddy() {
      const config = targetConfig(store.currentConfig(), facts);
      const apps = proxyApps(store);
      const out = caddyConfig({ home: store.home, config, apps, daemonPort: config.port, ipv6: await ipv6Loopback() });
      fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      atomicWrite(paths.config, caddyText(out.json));
      atomicWrite(paths.fallback, fallbackHtml({ config, apps, restart: ['hallway service restart'], directUrl: `http://localhost:${config.port}` }));
      const r = await deps.query(facts.caddy.path ?? 'caddy', ['validate', '--config', paths.config]);
      if (r.code !== 0) throw new SetupError(`\`caddy validate\` refused the generated configuration: ${(r.stderr || r.stdout).trim().split('\n').pop()}${versionAtLeast(facts.caddy.version, MIN_CADDY) ? '' : ` (Caddy ${facts.caddy.version} is too old; Hallway needs ${MIN_CADDY.join('.')} or later)`}`);
    },
    async startCaddy() {
      const caddy = facts.caddy.path ?? findTool('caddy', deps.env.PATH, deps.platform.fronting.helperDirs);
      if (!caddy) throw new SetupError("Caddy still isn't installed");
      await deps.services().helperUp('caddy', caddy);
      const ok = await until(async () => {
        try {
          await runningConfig(paths.socket);
          // plain HTTP makes no certificate authority
          return !https || fs.existsSync(paths.rootCert);
        } catch (e) {
          if (e instanceof CaddyUnreachable) return false;
          throw e;
        }
      }, 20_000);
      if (!ok) throw new SetupError(`Caddy didn't come up within 20 s; its log is ${tildify(path.join(dataPaths(store.home).logs, 'caddy.err.log'))}`);
      // a Caddy that was already running keeps its old routes until told (its job didn't change, so it wasn't
      // restarted): give it the config just written, as the daemon would
      await loadConfig(paths.socket, fs.readFileSync(paths.config, 'utf8'));
      // the trust step needs the root's fingerprint, which exists only now
      facts.env.rootSha1 = readRoot(paths.rootCert)?.sha1 ?? null;
      deps.out(`   Caddy is running${https ? `; its certificate authority is ${tildify(paths.rootCert)}` : ''}\n`);
    },
    async writeDnsmasq() {
      atomicWrite(path.join(gen, 'dnsmasq.conf'), dnsmasqConf(facts.base, facts.dnsPort));
    },
    async startDnsmasq() {
      const dnsmasq = facts.dnsmasq?.path ?? findTool('dnsmasq', deps.env.PATH, deps.platform.fronting.helperDirs);
      if (!dnsmasq) throw new SetupError("dnsmasq still isn't installed");
      await deps.services().helperUp('dnsmasq', dnsmasq);
    },
    async forwardersUp() {
      await deps.services().forwardersUp(facts.forwards);
    },
    async removeDnsmasq() {
      await deps.services().removeLabel('hallway.dnsmasq');
    },
    async setConfig() {
      const isDefault = facts.publicPort === 443;
      await store.patchConfig({
        mode: 'fronted',
        // only what differs from the default is written (D36): a default left commented out can still change later
        domain: { base: facts.base === 'localhost' ? null : facts.base, dashboard: facts.dashboard === (facts.base === 'localhost' ? 'hallway.localhost' : facts.base) ? null : facts.dashboard },
        proxy: { trust: facts.tier, scheme: facts.scheme === 'https' ? null : 'http', publicPort: isDefault || (facts.scheme === 'http' && facts.publicPort === 80) ? null : facts.publicPort },
      });
    },
    async verify() {
      const pub = facts.publicPort;
      const http = facts.lowPorts === 'none' ? facts.httpPort : 80;
      const url = publicUrl(facts.dashboard, { scheme: facts.scheme, publicPort: pub });
      const lines: string[] = [];
      let ok = false;
      if (https) {
        // launchctl bootstrap (and a systemd restart) can return before the port is held: give it a moment
        const pem = readRoot(paths.rootCert)?.pem ?? null;
        let t = null as Awaited<ReturnType<typeof tlsProbe>>;
        await until(async () => !!(t = await tlsProbe(pub, facts.dashboard, pem, 3000))?.ours, 15_000);
        let h = null as Awaited<ReturnType<typeof httpProbe>>;
        await until(async () => (h = await httpProbe(http, facts.dashboard))?.status === 308, 5_000);
        const plain = `http://${facts.dashboard}${http === 80 ? '' : `:${http}`}`;
        ok = !!t?.ours;
        if (ok) lines.push(`   ✓ ${url} answers with Hallway's certificate`);
        else lines.push(`   ✗ ${url}: ${t ? `a certificate from ${t.issuer ?? 'someone else'} (${t.error})` : 'nothing answered'}`);
        if (h?.status === 308 && h.location?.startsWith(`https://${facts.dashboard}`)) lines.push(`   ✓ ${plain} redirects to HTTPS`);
        else lines.push(`   ✗ ${plain}: ${h ? `HTTP ${h.status}` : 'nothing answered'}`);
        // the daemon reads config.yaml through its file watcher, a moment after it changed: give it that moment
        const root = readRoot(paths.rootCert);
        if (ok && root && (await isListening(store.currentConfig().port))) {
          const up = await until(async () => (await httpsStatus(pub, facts.dashboard, '/api/health', root.pem)) === 200, 10_000);
          lines.push(up ? `   ✓ the dashboard answers at ${url}` : `   ✗ the daemon doesn't answer at ${url} yet (is it running an older Hallway? \`hallway service restart\`)`);
        }
      } else {
        // plain HTTP: the dashboard itself, through Caddy (no redirect, no certificate)
        let h = null as Awaited<ReturnType<typeof httpProbe>>;
        const daemon = await isListening(store.currentConfig().port);
        await until(async () => {
          h = await httpProbe(pub, facts.dashboard, 2000, '127.0.0.1', '/api/health');
          return h !== null && (daemon ? h.status === 200 : h.status > 0);
        }, 15_000);
        ok = !!h;
        lines.push(h ? `   ✓ ${url} answers (plain HTTP${h.status === 200 ? ', the dashboard' : `, HTTP ${h.status}: the daemon isn't up yet, so Caddy's fallback page`})` : `   ✗ ${url}: nothing answered`);
      }
      deps.out(lines.join('\n') + '\n');
      if (!ok) throw new SetupError(`fronted mode is set up but not answering on ${pub}; \`hallway doctor\` says why`);
    },
    isTrusted: () => (facts.tier === 'user' && deps.platform.fronting.userTrusted ? deps.platform.fronting.userTrusted(facts.env, deps.query) : isTrusted(deps, facts.env)),
  };
}

/** Which tier: `--trust`, else the answer to the question on a terminal (D65), else the current one, else the
 *  recommended one. `--domain` means System-wide. */
export async function chooseTier(deps: SetupDeps, opts: SetupOptions): Promise<Trust> {
  if (opts.trust) return opts.trust;
  const cfg = deps.store.currentConfig();
  const current = cfg.mode === 'fronted' ? currentTier(cfg) : null;
  if (opts.domain && opts.domain !== 'localhost') {
    deps.out('A custom domain needs System-wide (--trust system): the system resolver is pointed at it, which needs an administrator.\n\n');
    return 'system';
  }
  const machine = deps.machine ?? (await machineFacts(deps.platform, deps.query));
  let suggested = suggestedTier(deps.platform.id, machine);
  // System-wide's redirect needs systemd and nftables (Linux): without them, don't recommend what would be refused
  const f = deps.platform.fronting;
  if (suggested === 'system' && f.lowPorts === 'redirect' && f.redirect) {
    const tools = f.detect(deps.env);
    if (!tools.systemctl || !tools.nft) suggested = 'user';
  }
  const ask = deps.confirm?.ask;
  if (ask && !deps.confirm?.yes && !opts.print) {
    const q = tierQuestion(deps.platform.id, cfg, suggested, current);
    deps.out(q.text);
    for (;;) {
      const t = q.byAnswer(await ask(q.prompt));
      if (t) {
        deps.out('\n');
        return t;
      }
      deps.out('Answer 1, 2 or 3 (or Enter for the default).\n');
    }
  }
  const t = current ?? suggested;
  deps.out(`Tier: ${tierText(deps.platform.id, t).name} (--trust ${t}), ${current ? 'as set up now' : 'recommended here'}. Choose another with --trust user, --trust system or --trust none.\n\n`);
  return t;
}

export async function setup(deps: SetupDeps, opts: SetupOptions): Promise<number> {
  // before anything is looked for or written (Windows, D58)
  if (deps.platform.fronting.unsupported) throw new SetupError(deps.platform.fronting.unsupported);
  const trust = await chooseTier(deps, opts);
  const facts = await gatherFacts(deps, { ...opts, trust });
  const plan = planSetup(facts, deps.platform, deps.store.home, setupActions(deps, facts));
  if (opts.print) {
    deps.out(formatPlan(plan, { isRoot: deps.isRoot, printOnly: true }));
    return plan.refusals.length ? 1 : 0;
  }
  if (plan.refusals.length) {
    deps.out(formatPlan({ ...plan, steps: [] }));
    deps.out('Setup stopped before doing anything.\n');
    return 1;
  }
  if (!(await confirmPlan(plan, deps, 'setup'))) return 1;
  // the plan printed the warnings already, unless --yes skipped it
  if (deps.confirm?.yes && plan.warnings.length) deps.out(plan.warnings.map((w) => `! ${w}\n`).join('') + '\n');
  const link = (host: string) => publicUrl(host, { scheme: facts.scheme, publicPort: facts.publicPort });
  deps.out(`Setting up fronted mode, ${tierText(facts.platform, facts.tier).name}: ${link(`<app>.${facts.base}`)}, the dashboard at ${link(facts.dashboard)}. Each step is printed before it runs.\n\n`);
  await runPlan(plan, deps);
  const firefox = facts.scheme === 'https' && deps.platform.id === 'darwin' ? ' Firefox: set security.enterprise_roots.enabled to true in about:config to trust the same certificates.' : '';
  deps.out(`\nDone. The dashboard is at ${link(facts.dashboard)}; \`hallway doctor\` checks everything.${firefox}\n`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------------------------------------------

export async function planTeardown(deps: SetupDeps, opts: { uninstallPackages?: boolean } = {}): Promise<Plan> {
  const { store, platform } = deps;
  const f = platform.fronting;
  const cfg = store.currentConfig();
  const paths = caddyPaths(store.home);
  const root = readRoot(paths.rootCert);
  const env: FrontingEnv = {
    setupDir: path.join(dataPaths(store.home).generated, 'setup'),
    rootCert: paths.rootCert,
    rootSha1: root?.sha1 ?? null,
    httpsPort: cfg.proxy.httpsPort,
    httpPort: cfg.proxy.httpPort,
    dnsPort: cfg.domain.dnsPort,
    base: cfg.domain.base,
    userHome: deps.userHome,
    tools: f.detect(deps.env),
  };
  const installed = f.installed(env);
  const any = (files: string[]) => files.some((p) => fs.existsSync(p));
  const steps: Step[] = [];
  const services = deps.services();
  const show = (p: string) => tildify(p);
  if (cfg.domain.base !== 'localhost' && any(installed.resolver)) {
    const r = f.unresolver(env);
    steps.push({ kind: 'run', why: r.why, recipe: r });
  }
  if (services.helperInstalled('dnsmasq')) steps.push({ kind: 'hallway', why: `Stop and remove Hallway's dnsmasq (${f.userServiceNoun} hallway.dnsmasq)`, action: () => services.removeLabel('hallway.dnsmasq') });
  const fwd = services.forwardersInstalled();
  if (fwd.length) steps.push({ kind: 'hallway', why: `Stop and remove the ${f.userServiceNoun}s launchd holds loopback 443 and 80 for (${fwd.join(', ')})`, action: () => services.removeForwarders() });
  if (any(installed.redirect)) {
    const r = f.unredirect(env);
    steps.push({ kind: 'run', why: r.why, recipe: r });
  }
  if (await isTrusted(deps, env)) {
    const r = f.untrust(env);
    steps.push({ kind: 'run', why: r.why, recipe: r });
  }
  if (root && f.userTrusted && f.userUntrust && (await f.userTrusted(env, deps.query))) {
    const r = f.userUntrust(env);
    steps.push({ kind: 'run', why: r.why, recipe: r, dialog: f.userTrustDialog });
  }
  if (services.helperInstalled('caddy')) steps.push({ kind: 'hallway', why: `Stop and remove Hallway's Caddy (${f.userServiceNoun} hallway.caddy)`, detail: [`its certificate authority stays in ${show(paths.data)}, unused`], action: () => services.removeLabel('hallway.caddy') });
  if (cfg.mode !== 'direct' || cfg.proxy.trust !== null)
    steps.push({
      kind: 'hallway',
      why: 'Switch config.yaml back to direct mode: links go to http://localhost:<port> again',
      // the tier's settings go with it; a publicPort set by hand before the tiers is left alone
      action: async () => void (await store.patchConfig({ mode: 'direct', proxy: { trust: null, scheme: null, ...(cfg.proxy.trust !== null ? { publicPort: null } : {}) } })),
    });
  if (opts.uninstallPackages) {
    const brew = findTool('brew', deps.env.PATH, f.helperDirs);
    const pkgs = ['caddy', 'dnsmasq'].filter((t) => findTool(t, deps.env.PATH, f.helperDirs)?.match(/homebrew|\/usr\/local\/(s?bin|Cellar)/));
    if (brew && pkgs.length) steps.push({ kind: 'run', why: `Uninstall ${pkgs.join(' and ')} (as you, with Homebrew)`, recipe: { files: [], cmds: [{ argv: [brew, 'uninstall', ...pkgs], sudo: false }] } });
  }
  const warnings: string[] = [];
  if (opts.uninstallPackages && platform.id === 'linux') warnings.push("Hallway doesn't remove packages on Linux: remove caddy or dnsmasq with your package manager if you installed them only for Hallway.");
  return { refusals: [], warnings, steps };
}

export async function teardown(deps: SetupDeps, opts: { uninstallPackages?: boolean; print?: boolean } = {}): Promise<number> {
  if (deps.platform.fronting.unsupported) {
    deps.out(`Nothing to undo: ${deps.platform.fronting.unsupported}.\n`);
    return 0;
  }
  const plan = await planTeardown(deps, opts);
  if (!plan.steps.length) {
    for (const w of plan.warnings) deps.out(`! ${w}\n`);
    deps.out('Nothing to undo: fronted mode isn\'t set up here.\n');
    return 0;
  }
  if (opts.print) {
    deps.out(formatPlan(plan, { isRoot: deps.isRoot, printOnly: true }));
    return 0;
  }
  if (!(await confirmPlan(plan, deps, 'teardown'))) return 1;
  if (deps.confirm?.yes) for (const w of plan.warnings) deps.out(`! ${w}\n`);
  await runPlan(plan, deps);
  deps.out(`\nDone. Fronted mode is gone; the dashboard is at http://localhost:${deps.store.currentConfig().port}.\n`);
  return 0;
}

function readOr(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
