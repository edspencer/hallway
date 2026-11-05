// `hallway run`, `stop`, `start`, `restart`, `logs`, and `hallway service …` for apps and for the daemon itself
// (docs/07-cli.md, "Services and ad-hoc runs" and "Daemon"; the lifecycle is server/services/).
import fs from 'node:fs';
import path from 'node:path';
import { UsageError, check, need } from '../args.js';
import { VERSION, packageRoot, parsePort } from '../config.js';
import { hostPort } from '../loopback.js';
import { DAEMON_LABEL, NotInstalledError, appLabel, logFiles } from '../services/index.js';
import { appLogs, followFiles, formatLogs } from '../services/logs.js';
import { isListening, waitForPort } from '../services/ports.js';
import { runApp } from '../services/run.js';
import { appUrl } from '../views.js';
import { readUpdateCheck, updateNotice, updateSummary } from '../contract/update-check.js';
import { refuseIfBusy } from './busy.js';
import { type Ctx, json, locateDaemon, show, table } from './context.js';

const portFlag = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const p = parsePort(v);
  if (p === null || p === 0) throw new UsageError(`--port must be a port number (1-65535), not '${v}'`);
  return p;
};

const linesFlag = (v: string | undefined, def: number) => {
  if (v === undefined) return def;
  if (!/^\d+$/.test(v)) throw new UsageError(`--lines must be a number, not '${v}'`);
  return Number(v);
};

function logsLine(ctx: Ctx, slug: string) {
  const f = logFiles(ctx.home, slug);
  return `Logs: ${show(f.out)} and ${path.basename(f.err)} (\`hallway logs ${slug}\`)`;
}

// ---------------------------------------------------------------------------------------------------------------
// hallway run
// ---------------------------------------------------------------------------------------------------------------

export async function run(ctx: Ctx, pos: string[], flags: Record<string, string>, rest: string[] | undefined): Promise<number> {
  check('run', flags, ['cwd', 'port', 'persist', 'name', 'json'], pos, 1, rest, true);
  need('run', pos, ['slug']);
  const o = await runApp(ctx.services(), { slug: pos[0], command: rest, cwd: flags.cwd, port: portFlag(flags.port), persist: !!flags.persist, name: flags.name }, { cwd: ctx.cwd });
  if (flags.json) {
    ctx.out(json(o));
    return o.ok ? 0 : 1;
  }
  if (o.ok) {
    ctx.out(
      [
        `${o.slug} is up: ${o.url}${o.address ? ` (listening on ${hostPort(o.address, o.port)})` : ''}`,
        `  ${logsLine(ctx, o.slug)}`,
        o.persist
          ? '  It runs as a service: it starts at login and is restarted if it exits. `hallway stop ' + o.slug + '` to stop it.'
          : `  It runs outside this session, but won't come back after a reboot (add --persist for that). \`hallway stop ${o.slug}\` to stop it.`,
        '',
      ].join('\n'),
    );
    return 0;
  }
  ctx.err(`hallway: ${o.slug} didn't come up: ${o.reason}.\n`);
  ctx.err(o.tail ? `\nThe last lines of its logs:\n${o.tail}` : `\nIt wrote nothing to its logs (${show(o.logs.out)}).\n`);
  if (o.stillRunning) ctx.err(`\nIt's still running (perhaps on another port, or still starting). \`hallway stop ${o.slug}\` stops it.\n`);
  return 1;
}

// ---------------------------------------------------------------------------------------------------------------
// stop / start / restart / logs
// ---------------------------------------------------------------------------------------------------------------

/** After a start: wait for the port, and say where it is (or why not). */
async function report(ctx: Ctx, slug: string, verb: string, timeoutMs = 30_000): Promise<number> {
  const services = ctx.services();
  const c = services.managed(slug);
  const w = await waitForPort(c.port, c.host, { timeoutMs });
  if (w.ok) {
    ctx.out(`${slug} ${verb}: ${appUrl(slug, c.port, c.host, services.store.currentConfig())}\n`);
    return 0;
  }
  ctx.err(`hallway: ${slug} ${verb}, but ${w.reason}.\n`);
  const tail = formatLogs(appLogs(ctx.home, slug, 30));
  if (tail) ctx.err(`\nThe last lines of its logs:\n${tail}`);
  return 1;
}

export async function stop(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]) {
  check('stop', flags, [], pos, 1, rest);
  need('stop', pos, ['slug']);
  await ctx.services().stopApp(pos[0]);
  ctx.out(`${pos[0]} stopped (expected: stopped). \`hallway start ${pos[0]}\` starts it again.\n`);
  return 0;
}

export async function start(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]) {
  check('start', flags, [], pos, 1, rest);
  need('start', pos, ['slug']);
  await ctx.services().startApp(pos[0]);
  return report(ctx, pos[0], 'started');
}

export async function restart(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]) {
  check('restart', flags, [], pos, 1, rest);
  need('restart', pos, ['slug']);
  await ctx.services().restartApp(pos[0]);
  return report(ctx, pos[0], 'restarted');
}

export async function logs(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number | undefined> {
  check('logs', flags, ['lines', 'follow'], pos, 1, rest);
  need('logs', pos, ['slug']);
  const slug = pos[0];
  if (!ctx.store().apps.has(slug) && slug !== DAEMON_LOGS) throw new Error(`no app '${slug}'`);
  return showLogs(ctx, slug, flags);
}

/** `hallway logs daemon` shows the daemon's own logs, as `hallway service logs` does. */
const DAEMON_LOGS = 'daemon';

/** The last lines of a job's two logs, then (`--follow`) what it writes next. */
function showLogs(ctx: Ctx, slug: string, flags: Record<string, string>): number | undefined {
  const l = appLogs(ctx.home, slug, linesFlag(flags.lines, 50));
  const f = logFiles(ctx.home, slug);
  const text = formatLogs(l);
  if (!flags.follow) {
    const captured = slug === DAEMON_LOGS || ctx.store().apps.get(slug)?.value?.service;
    if (!text) ctx.err(`${slug} has written nothing to ${show(f.out)} or ${show(f.err)}${captured ? '' : " (it isn't a managed service, so Hallway doesn't capture its output)"}.\n`);
    ctx.out(text);
    return 0;
  }
  ctx.out(text || `==> ${show(f.out)}, ${path.basename(f.err)} (empty) <==\n`);
  followFiles([f.out, f.err], (s) => ctx.out(s));
  return undefined; // runs until interrupted
}

// ---------------------------------------------------------------------------------------------------------------
// hallway service …
// ---------------------------------------------------------------------------------------------------------------

/**
 * After the daemon's job was (re)started: wait until the daemon answers as this CLI's version. Just waiting for the
 * port isn't enough, because a daemon being replaced may still be answering, as the old version (D70).
 */
export async function waitForDaemon(ctx: Ctx, port: number, timeoutMs = 15_000): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  let seen: string | null = null;
  for (;;) {
    const d = await locateDaemon(ctx.home, port);
    if (d?.version === VERSION) return { ok: true };
    seen = d?.version ?? seen;
    if (Date.now() >= deadline)
      return { ok: false, reason: d ? `it still answers as version ${d.version}, not ${VERSION}` : `nothing answered on port ${port} after ${Math.round(timeoutMs / 1000)} s${seen ? ` (version ${seen} did, earlier)` : ''}` };
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * When the daemon answering is another version than this CLI (an upgrade that didn't restart it, D70): restart it if
 * it runs as Hallway's service and say so; otherwise say how. For commands that change what the daemon serves
 * (`hallway setup`). Says nothing when the versions match or no daemon answers.
 */
export async function restartStaleDaemon(ctx: Ctx): Promise<void> {
  const d = await ctx.daemon();
  if (!d || d.version === VERSION) return;
  const svc = ctx.services();
  const st = await svc.status(DAEMON_LABEL).catch(() => null);
  if (!st?.running) {
    ctx.err(`hallway: the daemon answering on ${d.url} is version ${d.version}, but this CLI is ${VERSION}; restart it (it isn't Hallway's service: a \`hallway serve\` in a terminal?) so the dashboard is this version's.\n`);
    return;
  }
  await svc.restartDaemon();
  forwarded(ctx.out, await svc.restartStaleForwarders());
  const w = await waitForDaemon(ctx, svc.store.currentConfig().port);
  if (w.ok) ctx.out(`Restarted the daemon: ${d.version} → ${VERSION}.\n`);
  else ctx.err(`hallway: restarted the daemon (it was ${d.version}), but ${w.reason}.\n`);
}

const forwarded = (say: (s: string) => void, labels: string[]) => labels.length && say(forwardersLine(labels));

/** The forwarders `service install` and `regenerate` restarted, for people. */
const forwardersLine = (labels: string[]) => `Restarted ${labels.length === 1 ? 'the forwarder' : `${labels.length} forwarders`} it left running (${labels.join(', ')}), onto ${VERSION}.\n`;

const SERVICE_USAGE = 'service needs one of: install, uninstall, start, stop, restart, status, logs, add <slug>, rm <slug>, regenerate [slug]';

/** `service status` (and `start`, `stop`, `restart`, `logs`) when there's no daemon job: the CLI contract's exit 4. */
const NOT_INSTALLED = 4;
/** `service status` when the job is installed but isn't running, or the daemon doesn't answer: exit 3. */
const NOT_RUNNING = 3;

/** The version of the Hallway a daemon job runs: the package.json above the cli.js in its program. Null if it's gone. */
function jobVersion(program: string[] | undefined): string | null {
  const cli = program?.find((p) => /cli\.js$/.test(p));
  if (!cli) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(packageRoot(path.dirname(cli)), 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/**
 * The daemon's service as `service status` reports it, and as `service install|start|stop|restart --json` carry it:
 * the job (installed, running, pid), whether the daemon answers and as which version, the version the job runs, the
 * port, the files, and what's wrong with it.
 */
async function daemonReport(ctx: Ctx) {
  const svc = ctx.services();
  const st = await svc.status(DAEMON_LABEL);
  const port = svc.store.currentConfig().port;
  // asked afresh: ctx.daemon() is the answer from before a start or stop
  const daemon = await locateDaemon(ctx.home, port);
  const manifest = st.installed ? svc.readManifest(DAEMON_LABEL) : null;
  const installedVersion = st.installed ? jobVersion(manifest?.program) : null;
  const logs = logFiles(ctx.home, 'daemon');
  const update = updateSummary(ctx.home, { currentVersion: VERSION });
  const warnings: string[] = [];
  if (manifest?.node && !fs.existsSync(manifest.node.path))
    warnings.push(`the Node the service runs (${show(manifest.node.path)}) has gone; \`hallway service regenerate\` points it at this one`);
  if (st.installed && manifest && !installedVersion) warnings.push("the Hallway the service runs has gone; `hallway service install` points it at this one");
  if (daemon && installedVersion && st.running && daemon.version !== installedVersion)
    warnings.push(`the daemon answering is ${daemon.version}, but the service runs ${installedVersion}; \`hallway service restart\``);
  return {
    ...st,
    file: svc.manager.file(DAEMON_LABEL),
    /** The contract's name for `file` (cli-contract schemas/service-status.schema.json). */
    unit: svc.manager.file(DAEMON_LABEL),
    manager: svc.manager.kind,
    port,
    url: `http://localhost:${port}`,
    answering: !!daemon,
    /** The version answering (kept from before `runningVersion`). */
    version: daemon?.version ?? null,
    runningVersion: daemon?.version ?? null,
    installedVersion,
    cliVersion: VERSION,
    node: manifest?.node ?? null,
    /** The contract's one log file: the daemon's stdout; `logs` has both. */
    log: logs.out,
    logs,
    warnings,
    // what the last `update --check` or `doctor` found, never asked afresh; left out, not null, with nothing to say
    ...(update ? { update } : {}),
  };
}

/** Until the daemon stops answering (after a stop), or the time is up. */
async function waitForGone(ctx: Ctx, port: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (await locateDaemon(ctx.home, port)) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return true;
}

/** The daemon's last log lines, after it didn't come up (the contract asks for 20). */
function daemonTail(ctx: Ctx) {
  const tail = formatLogs(appLogs(ctx.home, 'daemon', 20));
  if (tail) ctx.err(`\nThe last lines of its logs:\n${tail}`);
}

export async function service(ctx: Ctx, pos: string[], flags: Record<string, string>, rest: string[] | undefined): Promise<number | undefined> {
  const [sub, ...args] = pos;
  const services = () => ctx.services();
  // with --json, stdout carries the one JSON document and nothing else; what people read goes to stderr
  const say = flags.json ? ctx.err : ctx.out;
  const done = async (action: string, ok: boolean, extra: Record<string, unknown> = {}) => {
    if (flags.json) ctx.out(json({ ok, action, ...extra, ...(await daemonReport(ctx)) }));
    return ok ? 0 : 1;
  };
  // the contract's busy check (D75), where there's a service to stop: refused with 75 unless --force
  const busy = async (action: string) => {
    if (!(await services().status(DAEMON_LABEL)).installed) return null;
    const code = await refuseIfBusy(ctx, flags, action);
    if (code !== null && flags.json) ctx.out(json({ ok: false, action, error: 'busy', ...(await daemonReport(ctx)) }));
    return code;
  };
  const notInstalled = async (action: string, e: unknown) => {
    if (!(e instanceof NotInstalledError)) throw e;
    ctx.err(`hallway: ${e.message}.\n`);
    if (flags.json) ctx.out(json({ ok: false, action, error: e.message, ...(await daemonReport(ctx)) }));
    return NOT_INSTALLED;
  };
  switch (sub) {
    case 'install': {
      check('service install', flags, ['json', 'port', 'refresh'], args, 0, rest);
      const svc = services();
      svc.refuseTransient(DAEMON_LABEL);
      const before = await svc.status(DAEMON_LABEL);
      // --refresh re-renders the job that's installed, in this CLI's format: what `update` hands over through (D76). The
      // data home it records was adopted before this ran (server/cli.ts), and the port is config.yaml's, in that home.
      if (flags.refresh && !before.installed) {
        ctx.err(`hallway: Hallway's daemon isn't installed as a service, so there's nothing to refresh; install it with \`hallway service install\`.\n`);
        if (flags.json) ctx.out(json({ ok: false, action: 'install', error: 'not installed', ...(await daemonReport(ctx)) }));
        return NOT_INSTALLED;
      }
      const given = portFlag(flags.port);
      const was = svc.store.currentConfig().port;
      const port = given ?? was;
      if (!(before.running && port === was) && (await isListening(port)))
        throw new Error(`port ${port} is already in use (is \`hallway serve\` running in a terminal?). Stop that first, or ${given ? 'pick another --port' : 'set another port: in config.yaml'}.`);
      // the daemon's port lives in config.yaml (D44), where the CLI looks for it too
      if (given !== undefined && given !== was) await svc.store.patchConfig({ port: given });
      // a daemon that's running is replaced, never left serving (the CLI contract's §1, D76): after `npm i -g
      // hallway@latest` the job file is usually unchanged (same path), and `systemctl --user enable --now` leaves an
      // active unit alone. Which version it was, for the message: what it says beats its manifest (D70).
      const running = before.running ? await ctx.daemon() : null;
      const from = running ? (running.version !== VERSION ? running.version : null) : before.running ? svc.staleVersion(DAEMON_LABEL) : null;
      const r = await svc.installDaemon({ restart: before.running });
      const forwarders = await svc.restartStaleForwarders();
      const w = await waitForDaemon(ctx, port);
      say(`${flags.refresh ? 'Refreshed' : 'Installed'} Hallway's daemon as a ${svc.manager.noun}: ${show(r.file)}\n`);
      if (r.restarted) say(from ? `Restarted the daemon: ${from} → ${VERSION}.\n` : r.changed ? 'Restarted the daemon onto its new definition.\n' : 'Restarted the daemon.\n');
      forwarded(say, forwarders);
      const extra = { restartedFrom: r.restarted ? from : null, forwarders };
      if (!w.ok) {
        ctx.err(`hallway: the daemon was started, but ${w.reason}.\n`);
        daemonTail(ctx);
        return done('install', false, { error: w.reason, ...extra });
      }
      say(`It's running: http://localhost:${port}\n${svc.manager.lifetime}\n`);
      return done('install', true, extra);
    }
    case 'uninstall': {
      check('service uninstall', flags, ['json'], args, 0, rest);
      const svc = services();
      const st = await svc.uninstallDaemon();
      say(st.installed || st.loaded ? `Removed Hallway's daemon service (${show(svc.manager.file(DAEMON_LABEL))}).\n` : "Hallway's daemon wasn't installed as a service; nothing to do.\n");
      return done('uninstall', true, { wasInstalled: st.installed || st.loaded });
    }
    case 'status': {
      check('service status', flags, ['json'], args, 0, rest);
      const out = await daemonReport(ctx);
      const code = !out.installed ? NOT_INSTALLED : out.running && out.answering ? 0 : NOT_RUNNING;
      if (flags.json) {
        ctx.out(json(out));
        return code;
      }
      const lines = [
        `Service:   ${out.installed ? show(out.file) : 'not installed (`hallway service install`)'}`,
        `Loaded:    ${out.loaded ? 'yes' : 'no'}${out.state ? ` (${out.state})` : ''}${out.enabled !== null ? `, ${out.enabled ? 'starts at login' : "doesn't start at login"}` : ''}`,
        `Running:   ${out.running ? `yes, pid ${out.pid}` : 'no'}${out.lastExitCode !== null ? ` (last exit status ${out.lastExitCode})` : ''}`,
        `Dashboard: ${out.answering ? `${out.url} (version ${out.runningVersion})` : `nothing answering on ${out.url}`}`,
        ...(out.installedVersion ? [`Version:   ${out.installedVersion} installed${out.installedVersion !== VERSION ? ` (this CLI is ${VERSION})` : ''}`] : []),
        ...(out.node ? [`Node:      ${out.node.version} (${show(out.node.path)})`] : []),
        ...(out.installed ? [`Logs:      ${show(out.logs.out)} and ${path.basename(out.logs.err)} (\`hallway service logs\`)`] : []),
        ...out.warnings.map((w) => `Warning:   ${w}`),
      ];
      ctx.out(lines.join('\n') + '\n');
      // the last check's notice, repeated, on stderr (the CLI contract's §3)
      const last = out.update?.updateAvailable ? readUpdateCheck(ctx.home) : null;
      if (last)
        ctx.err(`\n${updateNotice({ name: 'Hallway', current: VERSION, target: last.target, command: last.command ?? 'hallway update', changelog: last.changelog })}\n`);
      return code;
    }
    case 'start': {
      check('service start', flags, ['json'], args, 0, rest);
      const svc = services();
      const port = svc.store.currentConfig().port;
      const was = await svc.status(DAEMON_LABEL);
      try {
        await svc.startDaemon();
      } catch (e) {
        return notInstalled('start', e);
      }
      const w = await waitForDaemon(ctx, port, 30_000);
      if (!w.ok) {
        ctx.err(`hallway: started the daemon, but ${w.reason}.\n`);
        daemonTail(ctx);
        return done('start', false, { error: w.reason });
      }
      say(was.running ? `Hallway's daemon was already running: http://localhost:${port}\n` : `Started Hallway's daemon: http://localhost:${port}\n`);
      return done('start', true, { wasRunning: was.running });
    }
    case 'stop': {
      check('service stop', flags, ['json', 'force'], args, 0, rest);
      const refused = await busy('stop');
      if (refused !== null) return refused;
      const svc = services();
      const port = svc.store.currentConfig().port;
      let was;
      try {
        was = await svc.stopDaemon();
      } catch (e) {
        return notInstalled('stop', e);
      }
      if (!(await waitForGone(ctx, port))) {
        // the job is stopped, so what still answers is something else: a `hallway serve` in a terminal, say
        const reason = `the service is stopped, but a daemon still answers on http://localhost:${port} (a \`hallway serve\` in a terminal?)`;
        ctx.err(`hallway: ${reason}.\n`);
        return done('stop', false, { error: reason, wasRunning: was.running });
      }
      say(
        `${was.running ? "Stopped Hallway's daemon" : "Hallway's daemon wasn't running"}. It stays stopped until \`hallway service start\`, or your next login or boot; \`hallway service uninstall\` keeps it off.\n`,
      );
      return done('stop', true, { wasRunning: was.running });
    }
    case 'restart': {
      check('service restart', flags, ['json', 'force'], args, 0, rest);
      const refused = await busy('restart');
      if (refused !== null) return refused;
      const svc = services();
      const was = await ctx.daemon();
      try {
        await svc.restartDaemon();
      } catch (e) {
        return notInstalled('restart', e);
      }
      const port = svc.store.currentConfig().port;
      const w = await waitForDaemon(ctx, port);
      const from = was && was.version !== VERSION ? was.version : null;
      if (!w.ok) {
        ctx.err(`hallway: restarted the daemon, but ${w.reason}.\n`);
        daemonTail(ctx);
        return done('restart', false, { error: w.reason, restartedFrom: from });
      }
      say(`Restarted Hallway's daemon${from ? ` (${from} → ${VERSION})` : ''}: http://localhost:${port}\n`);
      return done('restart', true, { restartedFrom: from });
    }
    case 'logs': {
      check('service logs', flags, ['lines', 'follow'], args, 0, rest);
      if (!(await services().status(DAEMON_LABEL)).installed) {
        ctx.err("hallway: Hallway's daemon isn't installed as a service (`hallway service install`). Logs it left from before: `hallway logs daemon`.\n");
        return NOT_INSTALLED;
      }
      return showLogs(ctx, DAEMON_LOGS, flags);
    }
    case 'add': {
      check('service add', flags, [], args, 1, rest, true);
      need('service add', args, ['slug']);
      const slug = args[0];
      const svc = services();
      const c = svc.app(slug);
      svc.refuseTransient(); // before the service: block is written
      if (rest?.length) await svc.store.patchApp(slug, { service: { command: rest, cwd: show(ctx.cwd), runAtLoad: true, keepAlive: true } });
      else if (!c.service) throw new UsageError(`apps/${slug}.yaml has no service: block; give the command: hallway service add ${slug} -- <command…>`);
      const r = await svc.startApp(slug);
      ctx.out(`${slug} is a managed service now (${show(r.file)}): it starts at login and is restarted if it exits.\n`);
      return report(ctx, slug, 'is running');
    }
    case 'rm': {
      check('service rm', flags, [], args, 1, rest);
      need('service rm', args, ['slug']);
      const svc = services();
      svc.managed(args[0]);
      await svc.removeApp(args[0]);
      ctx.out(`${args[0]} isn't a managed service any more: its job is stopped and removed, and apps/${args[0]}.yaml has no service: block. The app is still declared.\n`);
      return 0;
    }
    case 'regenerate': {
      check('service regenerate', flags, ['json'], args, 1, rest);
      const svc = services();
      const daemon = args[0] ? null : await ctx.daemon();
      const r = await svc.regenerate(args[0], { daemonVersion: daemon?.version ?? null });
      const port = svc.store.currentConfig().port;
      const daemonRestarted = r.some((x) => x.label === DAEMON_LABEL && x.restarted);
      const w = daemonRestarted ? await waitForDaemon(ctx, port) : ({ ok: true } as const);
      const result = (x: (typeof r)[number]) =>
        x.error ? `error: ${x.error}` : x.upgraded ? `${x.changed ? 'rewritten, ' : ''}restarted: ${x.upgraded} → ${VERSION}` : x.changed ? (x.restarted ? 'rewritten, restarted' : 'rewritten') : 'unchanged';
      if (flags.json) ctx.out(json(r));
      else if (!r.length) ctx.out('No managed services to regenerate.\n');
      else ctx.out(table(['JOB', 'RESULT'], r.map((x) => [x.label, result(x)])));
      if (!w.ok) ctx.err(`hallway: restarted the daemon, but ${w.reason}.\n`);
      return r.some((x) => x.error) || !w.ok ? 1 : 0;
    }
    default:
      throw new UsageError(sub ? `unknown service command '${sub}'; ${SERVICE_USAGE}` : SERVICE_USAGE);
  }
}

