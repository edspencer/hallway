// `hallway setup [--domain BASE] [--print]` and `hallway teardown [--uninstall-packages]` (docs/03-networking.md,
// "Privileged setup"; D47). Setup is three kinds of step, all printed before they run:
//   Hallway   things Hallway does as you: write its files, install and start its own user-level jobs (Caddy, and
//             dnsmasq for a custom domain), edit config.yaml
//   you       a command run as you (installing Caddy with Homebrew)
//   sudo      the privileged recipes from the platform layer (server/platform/fronting*.ts): the 443/80 redirect,
//             trusting the local CA, the custom-domain resolver. Each command is printed, then run through sudo.
// Everything is idempotent: a part that's already in place (checked by asking the real thing where possible) is
// skipped, so re-running setup only fixes what's missing. `--print` gathers the same facts and prints the plan,
// running nothing. Gathering facts is read-only; planning is a pure function of the facts (tested with fixtures).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { HallwayConfig } from '../../shared/api.js';
import { dataPaths, tildify } from '../config.js';
import { type Cmd, type FrontingEnv, FrontingUnsupported, type Platform, type Recipe, type Runner, type StagedFile, dnsmasqConf, mergeListeners } from '../platform/index.js';
import { findTool } from '../platform/fronting.js';
import type { Services } from '../services/index.js';
import type { Store } from '../store/index.js';
import { atomicWrite } from '../store/safefs.js';
import { CaddyUnreachable, runningConfig } from './admin.js';
import { CA_NAME, caddyConfig, caddyPaths, caddyText } from './caddy.js';
import { fallbackHtml } from './fallback.js';
import { ipv6Loopback, proxyApps } from './index.js';
import { httpsUrl } from './names.js';
import { httpProbe, readRoot, tlsProbe } from './probe.js';
import { type TldVerdict, delegatedTlds, tldVerdict } from './tld.js';

/** The oldest Caddy that understands the config (2.6 ignores the admin socket's `|0600` mode: research notes). */
export const MIN_CADDY = [2, 7, 0] as const;

// ---------------------------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------------------------

export interface Facts {
  platform: Platform['id'];
  base: string;
  /** A custom domain (not `localhost`): dnsmasq and the resolver are part of it. */
  custom: boolean;
  dashboard: string;
  httpsPort: number;
  httpPort: number;
  dnsPort: number;
  /** config.yaml's proxy.publicPort is proxy.httpsPort: links carry the high port, so there's no redirect to install. */
  noRedirect: boolean;
  /** The TLD verdict, for a custom domain. */
  tld: TldVerdict | null;
  caddy: { path: string | null; version: string | null; install: { cmd: string[] } | { advice: string } };
  dnsmasq: { path: string | null; install: { cmd: string[] } | { advice: string } } | null;
  /** Who holds a port setup needs, for people; non-empty means stop. */
  conflicts: string[];
  warnings: string[];
  env: FrontingEnv;
  /** Already in place. */
  done: { trust: boolean; redirect: boolean; resolver: boolean; config: boolean };
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
  /** Runs a command with the terminal attached (sudo may prompt), resolving with its exit code. */
  exec?: (argv: string[]) => Promise<number>;
  /** Is this process root already? (Then commands run without sudo.) */
  isRoot?: boolean;
  /** For tests: probes and the TLD list. */
  tlds?: Set<string> | null;
  probe443?: () => Promise<'ours' | 'other' | 'none'>;
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

export async function gatherFacts(deps: SetupDeps, opts: { domain?: string } = {}): Promise<Facts> {
  const { store, platform, env } = deps;
  const cfg = store.currentConfig();
  const base = (opts.domain ?? cfg.domain.base).toLowerCase().replace(/\.$/, '');
  const custom = base !== 'localhost';
  // a new --domain gets that domain's default dashboard (its apex); otherwise whatever config.yaml says
  const dashboard = opts.domain && opts.domain !== cfg.domain.base ? (custom ? base : 'hallway.localhost') : cfg.domain.dashboard;
  const { httpsPort, httpPort } = cfg.proxy;
  const noRedirect = cfg.proxy.publicPort === httpsPort;
  const dnsPort = cfg.domain.dnsPort;
  const paths = caddyPaths(store.home);
  const f = platform.fronting;
  const warnings: string[] = [];

  const tld = custom ? tldVerdict(base, deps.tlds !== undefined ? deps.tlds : await delegatedTlds(dataPaths(store.home).cache)) : null;

  const caddyPath = cfg.proxy.caddy ?? findTool('caddy', env.PATH, f.helperDirs);
  let caddyVersion: string | null = null;
  if (caddyPath) {
    const r = await deps.query(caddyPath, ['version']);
    caddyVersion = r.code === 0 ? (r.stdout.trim().split(/\s+/)[0] ?? null) : null;
  }
  const caddy = { path: caddyPath, version: caddyVersion, install: f.installHelper('caddy', env) };
  const dnsmasq = custom ? { path: findTool('dnsmasq', env.PATH, f.helperDirs), install: f.installHelper('dnsmasq', env) } : null;

  const ours = (file: string) => (cmd: string) => cmd.includes(file);
  const { conflicts, seen } = await portConflicts(platform, [
    ...(noRedirect ? [] : [{ port: 443, what: 'HTTPS' }, { port: 80, what: 'HTTP' }]),
    { port: httpsPort, what: 'proxy.httpsPort, for Caddy', oursIf: ours(paths.config) },
    { port: httpPort, what: 'proxy.httpPort, for Caddy', oursIf: ours(paths.config) },
    ...(custom ? [{ port: dnsPort, what: "domain.dnsPort, for Hallway's dnsmasq", oursIf: ours(path.join(dataPaths(store.home).generated, 'dnsmasq.conf')) }] : []),
  ]);
  // macOS's lsof shows only your own processes: a root listener on 443 is invisible to it, but not to a connection
  if (!noRedirect && !seen.has(443)) {
    const p = await (deps.probe443 ?? (() => probe443(dashboard)))();
    if (p === 'other') conflicts.push("port 443 answers, but not with Hallway's certificate, and its owner isn't visible to you (perhaps root's); `sudo lsof -nP -iTCP:443 -sTCP:LISTEN` names it");
  }
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
  const done = {
    trust: root ? await isTrusted(deps, fenv) : false,
    redirect: noRedirect || (safe(() => installedAsStaged(f.redirect(fenv).files)) && (await probe443Cached(deps, dashboard)) === 'ours'),
    resolver: custom ? safe(() => installedAsStaged(f.resolver(fenv).files)) : true,
    config: cfg.mode === 'fronted' && cfg.domain.base === base && cfg.domain.dashboard === dashboard,
  };
  return { platform: platform.id, base, custom, dashboard, httpsPort, httpPort, dnsPort, noRedirect, tld, caddy, dnsmasq, conflicts, warnings, env: fenv, done };
}

const safe = (f: () => boolean) => {
  try {
    return f();
  } catch {
    return false;
  }
};

/** Does 127.0.0.1:443 answer with a certificate from Hallway's CA (the redirect works), something else, or nothing? */
export async function probe443(dashboard: string): Promise<'ours' | 'other' | 'none'> {
  const t = await tlsProbe(443, dashboard, null, 1500);
  if (!t) return 'none';
  return t.issuer?.startsWith(CA_NAME) ? 'ours' : 'other';
}
const probe443Cached = (deps: SetupDeps, dashboard: string) => (deps.probe443 ?? (() => probe443(dashboard)))();

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
  | { kind: 'run'; why: string; recipe: Pick<Recipe, 'files' | 'cmds'>; done?: boolean; recheck?: () => Promise<boolean> };

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
  setConfig(): Promise<void>;
  verify(): Promise<void>;
  isTrusted(): Promise<boolean>;
}

const noop = async () => {};
export const NO_ACTIONS: PlanActions = { writeCaddy: noop, startCaddy: noop, writeDnsmasq: noop, startDnsmasq: noop, setConfig: noop, verify: noop, isTrusted: async () => false };

/** Setup's steps, from the facts. Pure (the actions are only called when it runs). */
export function planSetup(facts: Facts, platform: Platform, home: string, a: PlanActions = NO_ACTIONS): Plan {
  const refusals: string[] = [];
  const warnings = [...facts.warnings];
  const f = platform.fronting;
  const steps: Step[] = [];
  const show = (p: string) => tildify(p);
  const paths = caddyPaths(home);
  const gen = dataPaths(home).generated;

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
  const recipes = {
    trust: recipe(() => f.trust(facts.env)),
    redirect: facts.noRedirect ? null : recipe(() => f.redirect(facts.env)),
    resolver: facts.custom ? recipe(() => f.resolver(facts.env)) : null,
  };
  if (facts.noRedirect) warnings.push(`proxy.publicPort is proxy.httpsPort (${facts.httpsPort}), so no redirect from 443 is installed and links carry :${facts.httpsPort}. Remove proxy.publicPort from config.yaml for plain https:// links.`);

  steps.push({
    kind: 'hallway',
    why: `Write Caddy's configuration, routing ${facts.custom ? `*.${facts.base}` : '*.localhost'} to your apps and https://${facts.dashboard} to the dashboard, and check it with \`caddy validate\``,
    detail: [show(paths.config), show(paths.fallback)],
    action: a.writeCaddy,
  });
  steps.push({
    kind: 'hallway',
    why: `Run Caddy as you, on 127.0.0.1:${facts.httpsPort} and :${facts.httpPort}, as a ${f.userServiceNoun} (hallway.caddy), with its admin API on a private socket`,
    detail: [show(paths.socket)],
    action: a.startCaddy,
  });
  if (facts.custom) {
    steps.push({ kind: 'hallway', why: `Write dnsmasq's configuration: ${facts.base} and every name under it → loopback`, detail: [show(path.join(gen, 'dnsmasq.conf'))], action: a.writeDnsmasq });
    steps.push({ kind: 'hallway', why: `Run dnsmasq as you, on 127.0.0.1:${facts.dnsPort}, as a ${f.userServiceNoun} (hallway.dnsmasq)`, action: a.startDnsmasq });
  }
  if (recipes.trust) steps.push({ kind: 'run', why: recipes.trust.why, recipe: recipes.trust, done: facts.done.trust, recheck: a.isTrusted });
  if (recipes.redirect) steps.push({ kind: 'run', why: recipes.redirect.why, recipe: recipes.redirect, done: facts.done.redirect });
  if (recipes.resolver) steps.push({ kind: 'run', why: recipes.resolver.why, recipe: recipes.resolver, done: facts.done.resolver });
  steps.push({
    kind: 'hallway',
    why: `Switch config.yaml to fronted mode${facts.custom ? ` on ${facts.base}` : ''}: links become https://<app>.${facts.base}`,
    done: facts.done.config,
    action: a.setConfig,
  });
  steps.push({ kind: 'hallway', why: `Check ${httpsUrl(facts.dashboard, facts.noRedirect ? facts.httpsPort : 443)} answers${facts.noRedirect ? '' : ' through the redirect'}, with Hallway's certificate`, action: a.verify });
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
    }
  }
  if (opts.printOnly) out.push('', plan.refusals.length ? 'Nothing was run (and setup would stop: see ✗ above).' : 'Nothing was run. `hallway setup` runs these, asking for your password through sudo where it says sudo.');
  return out.join('\n') + '\n';
}

const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const cmdLine = (c: Cmd, isRoot = false) => [...(c.sudo && !isRoot ? ['sudo'] : []), ...c.argv].map(quote).join(' ');

// ---------------------------------------------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------------------------------------------

export class SetupError extends Error {}

const defaultExec = (argv: string[]) =>
  new Promise<number>((resolve) => {
    const p = spawn(argv[0], argv.slice(1), { stdio: 'inherit' });
    p.on('error', () => resolve(127));
    p.on('exit', (code) => resolve(code ?? 1));
  });

/** Run a plan's steps in order, printing each first; a failed command stops it. */
export async function runPlan(plan: Plan, deps: Pick<SetupDeps, 'out' | 'exec' | 'isRoot'>): Promise<void> {
  const exec = deps.exec ?? defaultExec;
  let n = 0;
  for (const s of plan.steps) {
    n++;
    if (s.kind === 'run' && s.recheck && !s.done) s.done = await s.recheck();
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
      const code = await exec(c.sudo && !deps.isRoot ? ['sudo', ...c.argv] : c.argv);
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

/** The config.yaml the plan is for: fronted, on `facts.base`. */
function targetConfig(cfg: HallwayConfig, facts: Facts): HallwayConfig {
  return { ...cfg, mode: 'fronted', domain: { ...cfg.domain, base: facts.base, dashboard: facts.dashboard }, proxy: { ...cfg.proxy, publicPort: facts.noRedirect ? cfg.proxy.httpsPort : 443 } };
}

/** The actions behind setup's Hallway steps. */
export function setupActions(deps: SetupDeps, facts: Facts): PlanActions {
  const { store } = deps;
  const paths = caddyPaths(store.home);
  const gen = dataPaths(store.home).generated;
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
          return fs.existsSync(paths.rootCert);
        } catch (e) {
          if (e instanceof CaddyUnreachable) return false;
          throw e;
        }
      }, 20_000);
      if (!ok) throw new SetupError(`Caddy didn't come up within 20 s; its log is ${tildify(path.join(dataPaths(store.home).logs, 'caddy.err.log'))}`);
      // the trust step needs the root's fingerprint, which exists only now
      facts.env.rootSha1 = readRoot(paths.rootCert)?.sha1 ?? null;
      deps.out(`   Caddy is running; its certificate authority is ${tildify(paths.rootCert)}\n`);
    },
    async writeDnsmasq() {
      atomicWrite(path.join(gen, 'dnsmasq.conf'), dnsmasqConf(facts.base, facts.dnsPort));
    },
    async startDnsmasq() {
      const dnsmasq = facts.dnsmasq?.path ?? findTool('dnsmasq', deps.env.PATH, deps.platform.fronting.helperDirs);
      if (!dnsmasq) throw new SetupError("dnsmasq still isn't installed");
      await deps.services().helperUp('dnsmasq', dnsmasq);
    },
    async setConfig() {
      await store.patchConfig({
        mode: 'fronted',
        // only what differs from the default is written (D36): a default left commented out can still change later
        domain: { base: facts.base === 'localhost' ? null : facts.base, dashboard: facts.dashboard === (facts.base === 'localhost' ? 'hallway.localhost' : facts.base) ? null : facts.dashboard },
      });
    },
    async verify() {
      const [https, http] = facts.noRedirect ? [facts.httpsPort, facts.httpPort] : [443, 80];
      const t = await tlsProbe(https, facts.dashboard, readRoot(paths.rootCert)?.pem ?? null, 3000);
      const h = await httpProbe(http, facts.dashboard);
      const plain = `http://${facts.dashboard}${http === 80 ? '' : `:${http}`}`;
      const lines: string[] = [];
      if (t?.ours) lines.push(`   ✓ ${httpsUrl(facts.dashboard, https)} answers with Hallway's certificate`);
      else lines.push(`   ✗ ${httpsUrl(facts.dashboard, https)}: ${t ? `a certificate from ${t.issuer ?? 'someone else'} (${t.error})` : 'nothing answered'}`);
      if (h?.status === 308 && h.location?.startsWith(`https://${facts.dashboard}`)) lines.push(`   ✓ ${plain} redirects to HTTPS`);
      else lines.push(`   ✗ ${plain}: ${h ? `HTTP ${h.status}` : 'nothing answered'}`);
      deps.out(lines.join('\n') + '\n');
      if (!t?.ours) throw new SetupError(`fronted mode is set up but not answering on ${https}; \`hallway doctor\` says why`);
    },
    isTrusted: () => isTrusted(deps, facts.env),
  };
}

export interface SetupResult {
  plan: Plan;
  ran: boolean;
}

export async function setup(deps: SetupDeps, opts: { domain?: string; print?: boolean }): Promise<number> {
  const facts = await gatherFacts(deps, opts);
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
  for (const w of plan.warnings) deps.out(`! ${w}\n`);
  deps.out(`Setting up fronted mode: https://<app>.${facts.base}, the dashboard at ${httpsUrl(facts.dashboard)}. Each step is printed before it runs; the sudo ones may ask for your password.\n\n`);
  await runPlan(plan, deps);
  deps.out(`\nDone. The dashboard is at ${httpsUrl(facts.dashboard)}${facts.custom ? '' : ''}; \`hallway doctor\` checks everything.${deps.platform.id === 'darwin' ? ' Firefox: set security.enterprise_roots.enabled to true in about:config to trust the same certificates.' : ''}\n`);
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
  if (any(installed.redirect)) {
    const r = f.unredirect(env);
    steps.push({ kind: 'run', why: r.why, recipe: r });
  }
  if (await isTrusted(deps, env)) {
    const r = f.untrust(env);
    steps.push({ kind: 'run', why: r.why, recipe: r });
  }
  if (services.helperInstalled('caddy')) steps.push({ kind: 'hallway', why: `Stop and remove Hallway's Caddy (${f.userServiceNoun} hallway.caddy)`, detail: [`its certificate authority stays in ${show(paths.data)}, unused`], action: () => services.removeLabel('hallway.caddy') });
  if (cfg.mode !== 'direct') steps.push({ kind: 'hallway', why: 'Switch config.yaml back to direct mode: links go to http://localhost:<port> again', action: async () => void (await store.patchConfig({ mode: 'direct' })) });
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
  for (const w of plan.warnings) deps.out(`! ${w}\n`);
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
