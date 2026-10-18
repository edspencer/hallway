// Managed services (v1): what `hallway run`, `start`, `stop`, `restart`, `service add|rm|regenerate` and
// `service install|uninstall|status|restart` do, on top of the platform's service manager (server/platform/) and the
// store (the only writer of apps/*.yaml). The YAML side of the lifecycle (docs/04, "Lifecycle"; D41):
//
//   start / run      expected: running (or adhoc for a job that neither starts at login nor restarts)
//   stop             expected: stopped
//   restart          (unchanged)
//   service rm       the `service:` block is removed; the app stays declared
//
// Each job generated also leaves a manifest in generated/services/<label>.json: the resolved program, PATH and Node,
// so doctor can tell when a recorded Node has gone and `service regenerate` can fix it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, Expected } from '../../shared/api.js';
import { ROOT, VERSION, dataPaths } from '../config.js';
import { type Platform, type Runner, type ServiceManager, type ServiceSpec, type ServiceStatus, currentPlatform } from '../platform/index.js';
import type { Store } from '../store/index.js';
import type { ResolvedNode } from './resolve.js';
import { transientInstall, transientMessage } from './transient.js';
import { CADDY_LABEL, DAEMON_LABEL, DNSMASQ_LABEL, type Forward, appLabel, appSpec, daemonSpec, forwardSpec, forwards, helperSpec, isForwardLabel, slugOfLabel } from './spec.js';

export { CADDY_LABEL, DAEMON_LABEL, DNSMASQ_LABEL, appLabel, forwards, isForwardLabel, logFiles, slugOfLabel } from './spec.js';

/** What a job's manifest records (generated/services/<label>.json). */
export interface ServiceManifest {
  label: string;
  file: string;
  generatedAt: string;
  hallwayVersion: string;
  program: string[];
  cwd: string;
  path: string;
  node: { path: string; version: string } | null;
}

export class ServiceError extends Error {}

/** An app can be called `daemon`, but it can't be a managed service: its logs would be the daemon's (logs/daemon.*). */
export const RESERVED_SERVICE_SLUG = 'daemon';
export const DAEMON_SLUG_MESSAGE = "an app called 'daemon' can't be a managed service: its logs would be Hallway's own daemon's (logs/daemon.out.log); pick another slug";

export interface ServicesOptions {
  store: Store;
  platform?: Platform;
  /** The command runner (launchctl / systemctl): mocked in tests. */
  run?: Runner;
  /** The environment the job's PATH starts from, and where the service directory is found ($HOME, $XDG_CONFIG_HOME). */
  env?: NodeJS.ProcessEnv;
  userHome?: string;
  node?: ResolvedNode;
  now?: () => Date;
  /** The daemon's compiled entry point. */
  cliScript?: string;
}

/** The compiled CLI a daemon job runs. From a checkout it has to have been built (`npm run build`). */
export const DEFAULT_CLI_SCRIPT = path.join(ROOT, 'dist', 'server', 'cli.js');

export class Services {
  readonly store: Store;
  readonly manager: ServiceManager;
  private env: NodeJS.ProcessEnv;
  private userHome?: string;
  private node?: ResolvedNode;
  private now: () => Date;
  private cliScript: string;
  /** The home `~` means in a service: block's cwd (the user's, unless a test gives another). */
  get homeDir(): string {
    return this.userHome ?? os.homedir();
  }

  constructor(opts: ServicesOptions) {
    this.store = opts.store;
    this.env = opts.env ?? process.env;
    this.userHome = opts.userHome;
    this.node = opts.node;
    this.now = opts.now ?? (() => new Date());
    this.cliScript = opts.cliScript ?? DEFAULT_CLI_SCRIPT;
    this.manager = (opts.platform ?? currentPlatform()).services({ run: opts.run, env: this.env, home: opts.userHome });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Specs and manifests
  // ---------------------------------------------------------------------------------------------------------------

  /** The app's last good config; throws if it's missing or broken. */
  app(slug: string): AppConfig {
    const e = this.store.apps.get(slug);
    if (!e) throw new ServiceError(`no app '${slug}' (apps/${slug}.yaml doesn't exist)`);
    const errors = e.problems.filter((p) => p.severity === 'error');
    if (errors.length) throw new ServiceError(`apps/${slug}.yaml has errors; fix it first: ${errors.map((p) => `${p.line ? `line ${p.line}: ` : ''}${p.message}`).join('; ')}`);
    if (!e.value) throw new ServiceError(`apps/${slug}.yaml can't be read`);
    return e.value;
  }

  /** A managed app's config; throws if it has no `service:` block. */
  managed(slug: string): AppConfig {
    if (slug === RESERVED_SERVICE_SLUG) throw new ServiceError(DAEMON_SLUG_MESSAGE);
    const c = this.app(slug);
    if (!c.service) throw new ServiceError(`${slug} isn't a managed service (apps/${slug}.yaml has no service: block). Make it one with \`hallway service add ${slug} -- <command>\`.`);
    return c;
  }

  appSpec(slug: string): ServiceSpec {
    return appSpec(slug, this.managed(slug), this.store.home, { env: this.env, userHome: this.userHome, node: this.node });
  }

  daemonSpec(): ServiceSpec {
    this.refuseTransient(DAEMON_LABEL);
    if (!fs.existsSync(this.cliScript)) throw new ServiceError(`${this.cliScript} doesn't exist: build Hallway first (npm run build)`);
    return daemonSpec(this.store.home, this.cliScript, { env: this.env, userHome: this.userHome, node: this.node });
  }

  /**
   * A job that runs Hallway's own CLI mustn't point into npx's cache or the like (D61): the daemon's, and on Windows
   * every job (the task runs `hallway supervise`). Throws a ServiceError if this one would; with no label, it's about
   * an app's job (called before anything is written for it).
   */
  refuseTransient(label?: string) {
    if (label !== DAEMON_LABEL && !(label && isForwardLabel(label)) && this.manager.kind !== 'schtasks') return;
    const t = transientInstall(this.cliScript);
    if (t) throw new ServiceError(transientMessage(t, label === DAEMON_LABEL ? 'hallway service install' : undefined));
  }

  /** Write a job's definition: every write goes through here, so none can point Hallway's CLI at a cache. */
  private write(spec: ServiceSpec): Promise<boolean> {
    this.refuseTransient(spec.label);
    return this.manager.write(spec);
  }

  manifestFile(label: string) {
    return path.join(dataPaths(this.store.home).generated, 'services', `${label}.json`);
  }

  readManifest(label: string): ServiceManifest | null {
    try {
      return JSON.parse(fs.readFileSync(this.manifestFile(label), 'utf8'));
    } catch {
      return null;
    }
  }

  private writeManifest(spec: ServiceSpec) {
    const m: ServiceManifest = {
      label: spec.label,
      file: this.manager.file(spec.label),
      generatedAt: this.now().toISOString(),
      hallwayVersion: VERSION,
      program: spec.program,
      cwd: spec.cwd,
      path: spec.env.PATH ?? '',
      node: spec.node,
    };
    const f = this.manifestFile(spec.label);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp-${process.pid}`, JSON.stringify(m, null, 2) + '\n');
    fs.renameSync(`${f}.tmp-${process.pid}`, f);
  }

  private dropManifest(label: string) {
    fs.rmSync(this.manifestFile(label), { force: true });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The lifecycle, for any job
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Write the job's definition and make it run. A running job is restarted if its definition changed (or `restart`
   * asks for it), so it runs what the file now says. Returns whether the definition changed, and whether a running
   * job was restarted.
   */
  async up(spec: ServiceSpec, { restart = false } = {}): Promise<{ changed: boolean; restarted: boolean; file: string }> {
    const changed = await this.write(spec);
    this.writeManifest(spec);
    const st = await this.manager.status(spec.label);
    let restarted = false;
    if (st.running && (changed || restart)) {
      await this.manager.restart(spec, { reload: changed });
      restarted = true;
    } else if (st.loaded && changed) await this.manager.restart(spec, { reload: true });
    else await this.manager.start(spec);
    return { changed, restarted, file: this.manager.file(spec.label) };
  }

  /**
   * The Hallway version a job that runs Hallway's own CLI (the daemon, a forwarder) was last generated or started by,
   * when that isn't this CLI's: after `npm i -g hallway@latest` the file on disk is new, but a process started before
   * keeps running the old code until it's restarted (D69). Null when it's this version, or unknown.
   */
  staleVersion(label: string): string | null {
    if (label !== DAEMON_LABEL && !isForwardLabel(label)) return null;
    const v = this.readManifest(label)?.hallwayVersion;
    return v && v !== VERSION ? v : null;
  }

  status(label: string): Promise<ServiceStatus> {
    return this.manager.status(label);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------------------------------------------------

  /** `expected` while a job runs: `running` for a real service, `adhoc` for a `hallway run` without --persist. */
  static runningExpectation(c: AppConfig): Expected {
    return c.service && (c.service.keepAlive || c.service.runAtLoad) ? 'running' : 'adhoc';
  }

  private async setExpected(slug: string, expected: Expected) {
    if (this.store.apps.get(slug)?.value?.expected !== expected) await this.store.patchApp(slug, { expected });
  }

  /** Generate the app's job and start it (`service add`, `start`, `run`). */
  async startApp(slug: string, opts: { restart?: boolean } = {}) {
    const spec = this.appSpec(slug);
    const r = await this.up(spec, opts);
    await this.setExpected(slug, Services.runningExpectation(this.managed(slug)));
    return { ...r, spec };
  }

  async stopApp(slug: string) {
    this.managed(slug);
    await this.manager.stop(appLabel(slug));
    await this.setExpected(slug, 'stopped');
  }

  async restartApp(slug: string) {
    const spec = this.appSpec(slug);
    const changed = await this.write(spec);
    this.writeManifest(spec);
    await this.manager.restart(spec, { reload: changed });
    await this.setExpected(slug, Services.runningExpectation(this.managed(slug)));
    return { spec, changed };
  }

  /** Stop managing it: remove the job and the `service:` block (`service rm`). The app stays declared. */
  async removeApp(slug: string, { keepBlock = false } = {}) {
    if (this.manager.list().includes(appLabel(slug))) await this.manager.remove(appLabel(slug));
    this.dropManifest(appLabel(slug));
    if (!keepBlock && this.store.apps.get(slug)?.value?.service) await this.store.patchApp(slug, { service: null });
  }

  /** Remove a job whose app file is gone or broken (no YAML to update). */
  async removeLabel(label: string) {
    await this.manager.remove(label);
    this.dropManifest(label);
  }

  /** Slugs with a `service:` block. */
  managedSlugs(): string[] {
    return [...this.store.apps.entries()].filter(([, e]) => e.value?.service).map(([s]) => s).sort();
  }

  /**
   * Rewrite job definitions from the YAML and the current Node and PATH (`service regenerate`), e.g. after a Node
   * upgrade removed the one a job was pointing at. Running jobs are restarted onto the new definition; stopped ones
   * stay stopped. A running job of Hallway's own (the daemon, a forwarder) started by another version of Hallway is
   * restarted even if its definition is unchanged (D69): `daemonVersion` is what the running daemon says it is, which
   * beats its manifest; `upgraded` says from which version.
   */
  async regenerate(slug?: string, { daemonVersion }: { daemonVersion?: string | null } = {}): Promise<{ label: string; changed: boolean; restarted: boolean; upgraded?: string; error?: string }[]> {
    const labels = slug ? [appLabel(slug)] : [...new Set([...this.managedSlugs().map(appLabel), ...this.manager.list()])];
    if (slug) this.managed(slug);
    const out: { label: string; changed: boolean; restarted: boolean; upgraded?: string; error?: string }[] = [];
    for (const label of labels) {
      const s = slugOfLabel(label);
      const stale = label === DAEMON_LABEL && daemonVersion ? (daemonVersion !== VERSION ? daemonVersion : null) : this.staleVersion(label);
      try {
        let spec: ServiceSpec;
        if (label === DAEMON_LABEL) spec = this.daemonSpec();
        else if (isForwardLabel(label) && this.wantedForward(label)) spec = this.forwardSpec(this.wantedForward(label)!);
        else if ((label === CADDY_LABEL || label === DNSMASQ_LABEL) && this.readManifest(label)?.program[0])
          spec = this.helperSpec(label === CADDY_LABEL ? 'caddy' : 'dnsmasq', this.readManifest(label)!.program[0]);
        else if (s && this.store.apps.get(s)?.value?.service) spec = this.appSpec(s);
        else {
          out.push({ label, changed: false, restarted: false, error: s ? `apps/${s}.yaml has no service: block (remove the job with \`hallway service rm ${s}\`)` : 'not a job Hallway generates here' });
          continue;
        }
        const changed = await this.write(spec);
        this.writeManifest(spec);
        const st = await this.manager.status(label);
        let restarted = false;
        if (st.running && (changed || stale)) {
          await this.manager.restart(spec, { reload: changed });
          restarted = true;
        } else if (changed && st.loaded && this.manager.kind === 'launchd') {
          // a loaded launchd job keeps its old definition until it's booted out; leave it unloaded and stopped
          await this.manager.stop(label);
        }
        out.push({ label, changed, restarted, ...(restarted && stale ? { upgraded: stale } : {}) });
      } catch (e) {
        out.push({ label, changed: false, restarted: false, error: (e as Error).message });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Fronted mode's helpers: Caddy and dnsmasq (D47), installed by `hallway setup`, removed by `hallway teardown`
  // ---------------------------------------------------------------------------------------------------------------

  helperSpec(kind: 'caddy' | 'dnsmasq', program: string): ServiceSpec {
    return helperSpec(kind, program, this.store.home, { userHome: this.userHome });
  }

  /** Write and start (or restart onto a changed definition) the helper's job. */
  async helperUp(kind: 'caddy' | 'dnsmasq', program: string) {
    return this.up(this.helperSpec(kind, program));
  }

  /** Is the helper's job installed? */
  helperInstalled(kind: 'caddy' | 'dnsmasq') {
    return this.manager.list().includes(kind === 'caddy' ? CADDY_LABEL : DNSMASQ_LABEL);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Loopback 443 and 80 on macOS: launchd's sockets, handed to Caddy by forwarders (D65). Behind these three methods,
  // so that a native helper giving Caddy the sockets itself could replace the forwarders without setup, teardown or
  // doctor noticing.
  // ---------------------------------------------------------------------------------------------------------------

  /** Why a job running Hallway's CLI (a forwarder's, the daemon's) can't be written from here, or null: the CLI is in
   *  npx's cache or the like (D61), or a checkout that hasn't been built. For refusing before anything is changed. */
  cliProblem(): string | null {
    const t = transientInstall(this.cliScript);
    if (t) return transientMessage(t, 'hallway setup');
    return fs.existsSync(this.cliScript) ? null : `${this.cliScript} doesn't exist: build Hallway first (npm run build)`;
  }

  forwardSpec(f: Forward): ServiceSpec {
    this.refuseTransient(f.label);
    if (!fs.existsSync(this.cliScript)) throw new ServiceError(`${this.cliScript} doesn't exist: build Hallway first (npm run build)`);
    return forwardSpec(f, this.store.home, this.cliScript, { env: this.env, userHome: this.userHome, node: this.node });
  }

  /** The forwarder config.yaml wants under this label, if any (fronted mode's scheme and ports). */
  private wantedForward(label: string): Forward | null {
    const cfg = this.store.currentConfig();
    return forwards(cfg.proxy, cfg.proxy.scheme).find((f) => f.label === label) ?? null;
  }

  /** Load exactly these forwarders: each one's job written and loaded, any other `hallway.forward.*` removed. One
   *  still running another version's code is restarted (D69). */
  async forwardersUp(want: readonly Forward[]): Promise<void> {
    const specs = want.map((f) => this.forwardSpec(f));
    for (const label of this.forwardersInstalled()) if (!want.some((f) => f.label === label)) await this.removeLabel(label);
    for (const spec of specs) await this.up(spec, { restart: !!this.staleVersion(spec.label) });
  }

  /** Restart the running forwarders that another version of Hallway started (D69); returns their labels. Ones that
   *  aren't running (launchd starts them on the next connection, with the CLI now on disk) are left alone. */
  async restartStaleForwarders(): Promise<string[]> {
    const done: string[] = [];
    for (const label of this.forwardersInstalled()) {
      const f = this.wantedForward(label);
      if (!f || !this.staleVersion(label)) continue;
      const r = await this.up(this.forwardSpec(f), { restart: true });
      if (r.restarted) done.push(label);
    }
    return done;
  }

  /** The forwarders' jobs that exist. */
  forwardersInstalled(): string[] {
    return this.manager.list().filter(isForwardLabel);
  }

  async removeForwarders(): Promise<void> {
    for (const label of this.forwardersInstalled()) await this.removeLabel(label);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The daemon
  // ---------------------------------------------------------------------------------------------------------------

  /** Write the daemon's job and run it; `restart` restarts a running one even if the job is unchanged (an upgrade). */
  async installDaemon({ restart = false } = {}) {
    const spec = this.daemonSpec();
    const r = await this.up(spec, { restart });
    return { ...r, spec };
  }

  async uninstallDaemon() {
    const st = await this.manager.status(DAEMON_LABEL);
    await this.manager.remove(DAEMON_LABEL);
    this.dropManifest(DAEMON_LABEL);
    return st;
  }

  async restartDaemon() {
    const st = await this.manager.status(DAEMON_LABEL);
    if (!st.installed) throw new ServiceError("the daemon isn't installed as a service; install it with `hallway service install`");
    const spec = this.daemonSpec();
    const changed = await this.write(spec);
    this.writeManifest(spec);
    await this.manager.restart(spec, { reload: changed });
  }
}
