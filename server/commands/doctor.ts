// `hallway doctor [--json]`: read-only diagnostics, each a pass / warn / fail line with a suggested fix
// (docs/03-networking.md, "`hallway doctor`"). v0 checks the daemon, the data home and its files; with v1's services
// it also checks every generated job for the PATH trap (docs/04) and a recorded Node that has gone. The networking
// checks (Caddy, ports 80/443, the CA, DNS) arrive with fronted mode; in direct mode an info line says local domains are
// off and how to turn them on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StateResponse } from '../../shared/api.js';
import { check } from '../args.js';
import { ROOT, VERSION, packageRoot } from '../config.js';
import { describeInstall, detectInstall, updateCommand } from '../contract/install-method.js';
import { npmConfigGet, npmGlobalRoot } from '../contract/package-manager.js';
import { RegistryError, resolveRegistry, resolveTarget } from '../contract/registry.js';
import { compareVersions, isPrerelease, satisfiesEngines } from '../contract/semver.js';
import { type UpdateCheck, updateNotice, writeUpdateCheck } from '../contract/update-check.js';
import { PACKAGE_NAME, changelogUrl } from './update.js';
import { type Runner, defaultRunner } from '../platform/index.js';
import { DAEMON_LABEL, isForwardLabel, slugOfLabel } from '../services/index.js';
import { isListening } from '../services/ports.js';
import { pathProblem } from '../services/resolve.js';
import { transientInstall } from '../services/transient.js';
import { type Ctx, json, show } from './context.js';

/** `info`: a fact worth knowing (local domains are off), neither a pass nor a problem. */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip' | 'info';

export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

const MARK: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✗', skip: '-', info: 'i' };

export interface DiagnoseOptions {
  /** Don't ask the registry for a newer version (`--offline`). */
  offline?: boolean;
  fetch?: typeof globalThis.fetch;
  /** The bin this CLI was run as (`process.argv[1]`), for how it was installed. */
  entry?: string;
}

/** What to do when the service manager can't be asked (the contract's §1: every failure has a fix). */
export function serviceManagerFix(kind: 'launchd' | 'systemd' | 'schtasks'): string {
  if (kind === 'systemd')
    return "run Hallway from a login session with systemd's user instance (`systemctl --user status` should answer; check that $XDG_RUNTIME_DIR is set, usually /run/user/$(id -u)). Without one, run `hallway serve` in a terminal instead";
  if (kind === 'launchd') return 'run Hallway from your own login session (not over SSH as another user, or with sudo): LaunchAgents live in the `gui/<uid>` domain';
  return "check that Task Scheduler is running (`schtasks /Query` should answer); without it, run `hallway serve` in a terminal instead";
}

export async function diagnose(ctx: Ctx, run: Runner = defaultRunner, opts: DiagnoseOptions = {}): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // ---------------- this install: Node, how it was installed (the CLI contract's §1 and §6) ----------------
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { engines?: { node?: string } };
  const engines = satisfiesEngines(process.versions.node, pkg.engines);
  if (engines.ok === false)
    add({ id: 'node-engines', status: 'fail', message: `this is Node ${process.versions.node}, and Hallway ${VERSION} needs Node ${pkg.engines?.node}`, fix: `install a Node that satisfies ${pkg.engines?.node} (nvm, fnm, volta or nodejs.org), then \`hallway service regenerate\`` });
  else add({ id: 'node-engines', status: 'pass', message: `Node ${process.versions.node} satisfies ${pkg.engines?.node ?? 'any Node'}` });
  const npm = { env: ctx.env };
  const info = detectInstall({ packageName: PACKAGE_NAME, envPrefix: 'HALLWAY', entry: opts.entry ?? process.argv[1], env: ctx.env, npmGlobalRoot: () => npmGlobalRoot(npm), fs });
  const how = describeInstall(info, PACKAGE_NAME);
  if (info.method === 'npx')
    add({ id: 'install-method', status: 'warn', message: `Hallway is ${how}, which can be deleted at any time; services can't run from there`, fix: '`npm i -g hallway`' });
  else if (info.canUpdate) add({ id: 'install-method', status: 'pass', message: `Hallway is ${how}: \`hallway update\` updates it` });
  else add({ id: 'install-method', status: 'pass', message: `Hallway is ${how}: \`hallway update\` can't update it, and says what to run instead` });

  // ---------------- the data home ----------------
  ctx.readOnly = true;
  if (!fs.existsSync(ctx.home))
    add({ id: 'data-home', status: 'warn', message: `the data home ${show(ctx.home)} doesn't exist yet`, fix: 'it is created the first time the daemon runs (`hallway service install`) or a command writes to it' });
  else
    try {
      fs.accessSync(ctx.home, fs.constants.R_OK | fs.constants.W_OK);
      add({ id: 'data-home', status: 'pass', message: `data home ${show(ctx.home)} is readable and writable` });
    } catch (e) {
      add({ id: 'data-home', status: 'fail', message: `data home ${show(ctx.home)}: ${(e as Error).message}`, fix: `check the permissions of ${show(ctx.home)} (or point $HALLWAY_HOME somewhere else)` });
      return checks;
    }
  const store = ctx.store();
  const problems = store.allProblems();
  if (!problems.length && fs.existsSync(ctx.home)) add({ id: 'files', status: 'pass', message: `${store.apps.size} app file${store.apps.size === 1 ? '' : 's'} and ${store.groups.size} bookmark group${store.groups.size === 1 ? '' : 's'}, all valid` });
  for (const p of problems)
    add({
      id: p.key === 'port' && /also declared by/.test(p.message) ? 'port-conflict' : 'files',
      status: p.severity === 'error' ? 'fail' : 'warn',
      message: `${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`,
      fix: p.severity === 'error' ? `edit ${show(p.path)}; the daemon keeps the last good version until then` : undefined,
    });

  // ---------------- the daemon ----------------
  const cfg = store.currentConfig();
  const daemon = await ctx.daemon();
  if (daemon) {
    add({ id: 'daemon', status: 'pass', message: `the daemon is answering on ${daemon.url} (version ${daemon.version})` });
    add({ id: 'port', status: 'pass', message: `port ${new URL(daemon.url).port || cfg.port} is Hallway's` });
    // an upgrade replaces the files, not the process: the daemon keeps serving the old dashboard and API until it's
    // restarted (D70)
    if (daemon.version !== VERSION)
      add({ id: 'daemon-version', status: 'fail', message: `the daemon is running version ${daemon.version}, but this CLI is ${VERSION}: it's still running the code it started with`, fix: '`hallway service restart` (or restart the `hallway serve` it runs in)' });
  } else if (await isListening(cfg.port))
    add({ id: 'port', status: 'fail', message: `something that isn't Hallway is listening on its port, ${cfg.port}`, fix: 'stop it, or give Hallway another port: in config.yaml' });
  else {
    add({ id: 'daemon', status: 'warn', message: `the daemon isn't running (nothing on http://localhost:${cfg.port})`, fix: '`hallway service install` runs it as a service' });
    add({ id: 'port', status: 'pass', message: `port ${cfg.port} is free for the daemon` });
  }

  let services: ReturnType<Ctx['services']> | null = null;
  try {
    services = ctx.services();
  } catch (e) {
    add({ id: 'service-manager', status: 'fail', message: (e as Error).message, fix: serviceManagerFix(ctx.platform().serviceManager) });
  }
  if (services) {
    const kind = services.manager.kind;
    try {
      const st = await services.status(DAEMON_LABEL);
      if (!st.installed) add({ id: 'daemon-service', status: 'warn', message: `the daemon isn't installed as a ${services.manager.noun}`, fix: '`hallway service install`' });
      else if (!st.running)
        add({ id: 'daemon-service', status: 'fail', message: `the daemon's service is installed (${show(st.label)}) but not running${st.lastExitCode !== null ? ` (last exit status ${st.lastExitCode})` : ''}`, fix: '`hallway service restart`; its logs are in logs/daemon.err.log' });
      else add({ id: 'daemon-service', status: 'pass', message: `the daemon's service is running (pid ${st.pid})` });
      // the job's own Hallway: still there, the same install as this CLI, and the version that's answering
      const m = st.installed ? services.readManifest(DAEMON_LABEL) : null;
      const jobCli = m?.program.find((p) => /cli\.js$/.test(p));
      if (jobCli) {
        const real = (p: string) => {
          try {
            return fs.realpathSync(p);
          } catch {
            return p;
          }
        };
        const mine = real(path.join(ROOT, 'dist', 'server', 'cli.js'));
        let installed: string | null = null;
        try {
          installed = JSON.parse(fs.readFileSync(path.join(packageRoot(path.dirname(jobCli)), 'package.json'), 'utf8')).version ?? null;
        } catch {
          /* gone: the unit check says so */
        }
        if (!fs.existsSync(jobCli))
          add({ id: 'unit', status: 'fail', message: `the daemon's service runs ${show(jobCli)}, which no longer exists (was that copy of Hallway removed?)`, fix: '`hallway service install` points it at this one' });
        else if (real(jobCli) !== mine)
          add({ id: 'unit', status: 'warn', message: `the daemon's service runs Hallway ${installed ?? '?'} from ${show(packageRoot(path.dirname(jobCli)))}, not this one (${VERSION}, ${show(ROOT)})`, fix: '`hallway service install` points it at this one' });
        else add({ id: 'unit', status: 'pass', message: `the daemon's service runs this install of Hallway (${show(ROOT)})` });
        if (daemon && installed && st.running && daemon.version !== installed)
          add({ id: 'running-version', status: 'fail', message: `the daemon answering is ${daemon.version}, but its service runs ${installed}: it hasn't been restarted since an update`, fix: '`hallway service restart`' });
        else if (daemon && installed && st.running) add({ id: 'running-version', status: 'pass', message: `the daemon is running the installed version, ${installed}` });
      }
      if (st.installed && kind === 'systemd') {
        const user = os.userInfo().username;
        const r = await run('loginctl', ['show-user', user, '--property=Linger']);
        if (r.code === 0 && /Linger=no/.test(r.stdout))
          add({ id: 'linger', status: 'warn', message: "lingering is off: Hallway's services stop when you log out and start only when you log in", fix: `\`sudo loginctl enable-linger ${user}\` (Hallway never runs sudo itself)` });
        else if (r.code === 0) add({ id: 'linger', status: 'pass', message: 'lingering is on: services run without a login session' });
      }
    } catch (e) {
      add({ id: 'service-manager', status: 'fail', message: (e as Error).message, fix: serviceManagerFix(ctx.platform().serviceManager) });
    }

    // ---------------- generated jobs: the PATH trap, a vanished Node, orphans ----------------
    const labels = services.manager.list();
    for (const label of labels) {
      const file = services.manager.file(label);
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const PATH = services.manager.readPath(text);
      // the delimiter servicePath() joined it with: `:`, or `;` on Windows
      const bad = (PATH ?? '').split(path.delimiter).map((d) => [d, pathProblem(d)] as const).filter(([, p]) => p);
      if (PATH === null) add({ id: 'job-path', status: 'warn', message: `${show(file)} sets no PATH`, fix: '`hallway service regenerate`' });
      else if (bad.length)
        add({ id: 'job-path', status: 'warn', message: `${show(file)}: PATH has ${bad.map(([d, p]) => `${d || '(empty)'} (${p})`).join(', ')}`, fix: `\`hallway service regenerate${slugOfLabel(label) ? ` ${slugOfLabel(label)}` : ''}\`` });
      const m = services.readManifest(label);
      const gone = [m?.node?.path, m?.program[0]].filter((p): p is string => !!p && !fs.existsSync(p));
      if (gone.length)
        add({
          id: 'job-program',
          status: 'fail',
          message: `${label} runs ${gone.join(' and ')}, which ${gone.length === 1 ? 'no longer exists' : 'no longer exist'}${m?.node && gone.includes(m.node.path) ? ` (was Node ${m.node.version} uninstalled?)` : ''}`,
          fix: `\`hallway service regenerate${slugOfLabel(label) ? ` ${slugOfLabel(label)}` : ''}\` points it at the current Node`,
        });
      // a job that runs Hallway from npx's cache (or the like) breaks whenever npm prunes it (D61). Its program is in
      // the manifest (not its PATH: that's job-path's business); on Windows the CLI is in the task (<label>.xml),
      // which runs `hallway supervise` on the job file
      let task = '';
      try {
        if (kind === 'schtasks') task = fs.readFileSync(file.replace(/\.json$/, '.xml'), 'utf8');
      } catch {
        /* no task file: the job file is all there is */
      }
      const transient = transientInstall([task, ...(m?.program ?? [])].join('\n'));
      if (transient)
        add({
          id: 'job-transient',
          status: 'warn',
          message: `${label} runs Hallway from ${transient.where}, which ${transient.owner} can delete at any time (the job would then fail to start)`,
          fix: '`npm i -g hallway && hallway service regenerate`',
        });
      // a forwarder runs `hallway forward` until it's killed: one started before an upgrade still runs the old code (D70)
      const stale = isForwardLabel(label) ? services.staleVersion(label) : null;
      if (stale && (await services.status(label).catch(() => null))?.running)
        add({ id: 'job-version', status: 'warn', message: `${label} is still running Hallway ${stale}'s code (this CLI is ${VERSION})`, fix: '`hallway service regenerate` restarts it' });
      const slug = slugOfLabel(label);
      if (slug && !store.apps.get(slug)?.value?.service)
        add({ id: 'job-orphan', status: 'warn', message: `${show(file)} has no app with a service: block behind it (apps/${slug}.yaml)`, fix: `\`hallway service rm ${slug}\` if it's left over, or restore the app` });
      if (!bad.length && PATH !== null && !gone.length && !transient && (!slug || store.apps.get(slug)?.value?.service)) add({ id: 'job', status: 'pass', message: `${label}: PATH and program look right` });
    }
    for (const slug of services.managedSlugs())
      if (!labels.includes(`hallway.app.${slug}`)) add({ id: 'job-missing', status: 'warn', message: `${slug} has a service: block but no generated job yet`, fix: `\`hallway start ${slug}\`` });
  }

  // ---------------- what the daemon sees: apps exposed on the network ----------------
  if (daemon) {
    try {
      const s = await daemon.get<StateResponse>('/api/state');
      for (const a of s.apps.filter((x) => x.identity?.exposed))
        add({ id: 'exposed', status: 'warn', message: `${a.slug} (port ${a.config?.port ?? '?'}) listens on every interface (${a.identity!.bindAddress}), so the local network can reach it`, fix: 'bind it to 127.0.0.1 (managed services get HOST=127.0.0.1)' });
    } catch {
      /* the daemon answered health; a failing state call isn't this check's business */
    }
  }

  // ---------------- networking: fronted mode (server/proxy/doctor.ts) ----------------
  const { networkChecks } = await import('../proxy/doctor.js');
  for (const c of await networkChecks({ store, platform: ctx.platform(), services, query: run, env: ctx.env, userHome: os.homedir() })) add(c);

  // ---------------- a newer Hallway (the third thing allowed to ask the registry, after update and update --check) ----------------
  if (opts.offline) add({ id: 'update', status: 'skip', message: "didn't ask the registry for a newer Hallway (--offline)" });
  else {
    try {
      const target = await resolveTarget({ packageName: PACKAGE_NAME, registry: resolveRegistry(ctx.env, (k) => npmConfigGet(k, npm)), ...(opts.fetch ? { fetch: opts.fetch } : {}) });
      const cmp = compareVersions(target.version, VERSION);
      const available = cmp > 0 && !isPrerelease(target.version);
      const command = info.canUpdate ? 'hallway update' : updateCommand(info, { packageName: PACKAGE_NAME, target: target.version }).command;
      const check: UpdateCheck = {
        name: PACKAGE_NAME,
        current: VERSION,
        target: target.version,
        tag: target.tag,
        updateAvailable: available,
        installMethod: info.method,
        canUpdate: info.canUpdate,
        command: available ? command : null,
        engines: target.engines,
        nodeOk: satisfiesEngines(process.versions.node, target.engines !== null ? { node: target.engines } : undefined).ok !== false,
        changelog: changelogUrl(target.version),
        checkedAt: new Date().toISOString(),
      };
      // shared with `update --check`, for `service status` to repeat; never creating the data home (doctor is read-only)
      if (fs.existsSync(ctx.home)) writeUpdateCheck(ctx.home, check);
      if (available) {
        add({ id: 'update', status: 'warn', message: `Hallway ${target.version} is available (this is ${VERSION})`, fix: `\`${command}\`` });
        ctx.err(`${updateNotice({ name: 'Hallway', current: VERSION, target: target.version, command, changelog: check.changelog })}\n\n`);
      } else add({ id: 'update', status: 'pass', message: `Hallway ${VERSION} is up to date (the registry's ${target.tag ?? 'latest'} is ${target.version})` });
    } catch (e) {
      add({ id: 'update', status: 'warn', message: `couldn't ask the registry for a newer Hallway: ${e instanceof RegistryError ? `${e.message} (${e.url})` : (e as Error).message}`, fix: '`hallway doctor --offline` skips this check' });
    }
  }

  return checks;
}

export async function doctor(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[], run?: Runner, opts: DiagnoseOptions = {}): Promise<number> {
  check('doctor', flags, ['json', 'offline'], pos, 0, rest);
  const checks = await diagnose(ctx, run, { ...opts, offline: !!flags.offline });
  const failed = checks.some((c) => c.status === 'fail');
  // the contract's schema (doctor.schema.json) has pass, warn, fail and skip: an info line is a pass, marked as info
  if (flags.json) ctx.out(json({ ok: !failed, version: VERSION, checks: checks.map((c) => (c.status === 'info' ? { ...c, status: 'pass', info: true } : c)) }));
  else {
    for (const c of checks) ctx.out(`${MARK[c.status]} ${c.message}${c.fix ? `\n    fix: ${c.fix}` : ''}\n`);
    const n = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
    ctx.out(`\n${n('pass')} ok, ${n('warn')} warning${n('warn') === 1 ? '' : 's'}, ${n('fail')} problem${n('fail') === 1 ? '' : 's'}\n`);
  }
  return failed ? 1 : 0;
}
