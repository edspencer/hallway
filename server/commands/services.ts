// `hallway run`, `stop`, `start`, `restart`, `logs`, and `hallway service …` for apps and for the daemon itself
// (docs/07-cli.md, "Services and ad-hoc runs" and "Daemon"; the lifecycle is server/services/).
import path from 'node:path';
import { UsageError, check, need } from '../args.js';
import { parsePort } from '../config.js';
import { DAEMON_LABEL, appLabel, logFiles } from '../services/index.js';
import { appLogs, followFiles, formatLogs } from '../services/logs.js';
import { isListening, waitForPort } from '../services/ports.js';
import { runApp } from '../services/run.js';
import { appUrl } from '../views.js';
import { type Ctx, json, show, table } from './context.js';

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
        `${o.slug} is up: ${o.url}`,
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
  const store = ctx.store();
  if (!store.apps.has(slug) && slug !== 'daemon') throw new Error(`no app '${slug}'`);
  const l = appLogs(ctx.home, slug, linesFlag(flags.lines, 50));
  const f = logFiles(ctx.home, slug);
  const text = formatLogs(l);
  if (!flags.follow) {
    if (!text) ctx.err(`${slug} has written nothing to ${show(f.out)} or ${show(f.err)}${store.apps.get(slug)?.value?.service ? '' : " (it isn't a managed service, so Hallway doesn't capture its output)"}.\n`);
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

const SERVICE_USAGE = 'service needs one of: install, uninstall, status, restart, add <slug>, rm <slug>, regenerate [slug]';

export async function service(ctx: Ctx, pos: string[], flags: Record<string, string>, rest: string[] | undefined): Promise<number> {
  const [sub, ...args] = pos;
  const services = () => ctx.services();
  switch (sub) {
    case 'install': {
      check('service install', flags, [], args, 0, rest);
      const svc = services();
      const port = svc.store.currentConfig().port;
      const before = await svc.status(DAEMON_LABEL);
      if (!before.running && (await isListening(port)))
        throw new Error(`port ${port} is already in use (is \`hallway serve\` running in a terminal?). Stop that first, or set another port: in config.yaml.`);
      const r = await svc.installDaemon();
      const w = await waitForPort(port, '127.0.0.1', { timeoutMs: 15_000 });
      const kind = svc.manager.kind;
      ctx.out(`Installed Hallway's daemon as a ${kind === 'launchd' ? 'LaunchAgent' : 'systemd user unit'}: ${show(r.file)}\n`);
      if (w.ok) ctx.out(`It's running: http://localhost:${port}\n`);
      else {
        ctx.err(`hallway: the daemon was started, but ${w.reason}.\n`);
        const tail = formatLogs(appLogs(ctx.home, 'daemon', 30));
        if (tail) ctx.err(`\nThe last lines of its logs:\n${tail}`);
        return 1;
      }
      ctx.out(
        kind === 'launchd'
          ? 'It starts at login and is restarted if it exits.\n'
          : "It starts with your user session and is restarted if it exits. To keep it running while you're logged out, and start it at boot, enable lingering once: `loginctl enable-linger $USER`.\n",
      );
      return 0;
    }
    case 'uninstall': {
      check('service uninstall', flags, [], args, 0, rest);
      const svc = services();
      const st = await svc.uninstallDaemon();
      ctx.out(st.installed || st.loaded ? `Removed Hallway's daemon service (${show(svc.manager.file(DAEMON_LABEL))}).\n` : "Hallway's daemon wasn't installed as a service; nothing to do.\n");
      return 0;
    }
    case 'status': {
      check('service status', flags, ['json'], args, 0, rest);
      const svc = services();
      const st = await svc.status(DAEMON_LABEL);
      const port = svc.store.currentConfig().port;
      const daemon = await ctx.daemon();
      const manifest = svc.readManifest(DAEMON_LABEL);
      const out = { ...st, file: svc.manager.file(DAEMON_LABEL), manager: svc.manager.kind, url: `http://localhost:${port}`, answering: !!daemon, version: daemon?.version ?? null, node: manifest?.node ?? null };
      if (flags.json) {
        ctx.out(json(out));
        return 0;
      }
      const lines = [
        `Service:   ${out.installed ? show(out.file) : 'not installed (`hallway service install`)'}`,
        `Loaded:    ${st.loaded ? 'yes' : 'no'}${st.state ? ` (${st.state})` : ''}${st.enabled !== null ? `, ${st.enabled ? 'starts at login' : "doesn't start at login"}` : ''}`,
        `Running:   ${st.running ? `yes, pid ${st.pid}` : 'no'}${st.lastExitCode !== null ? ` (last exit status ${st.lastExitCode})` : ''}`,
        `Dashboard: ${daemon ? `${out.url} (version ${daemon.version})` : `nothing answering on ${out.url}`}`,
        ...(manifest?.node ? [`Node:      ${manifest.node.version} (${show(manifest.node.path)})`] : []),
      ];
      ctx.out(lines.join('\n') + '\n');
      return 0;
    }
    case 'restart': {
      check('service restart', flags, [], args, 0, rest);
      const svc = services();
      await svc.restartDaemon();
      const port = svc.store.currentConfig().port;
      const w = await waitForPort(port, '127.0.0.1', { timeoutMs: 15_000 });
      if (!w.ok) {
        ctx.err(`hallway: restarted the daemon, but ${w.reason}.\n`);
        return 1;
      }
      ctx.out(`Restarted Hallway's daemon: http://localhost:${port}\n`);
      return 0;
    }
    case 'add': {
      check('service add', flags, [], args, 1, rest, true);
      need('service add', args, ['slug']);
      const slug = args[0];
      const svc = services();
      const c = svc.app(slug);
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
      const r = await services().regenerate(args[0]);
      if (flags.json) ctx.out(json(r));
      else if (!r.length) ctx.out('No managed services to regenerate.\n');
      else ctx.out(table(['JOB', 'RESULT'], r.map((x) => [x.label, x.error ? `error: ${x.error}` : x.changed ? (x.restarted ? 'rewritten, restarted' : 'rewritten') : 'unchanged'])));
      return r.some((x) => x.error) ? 1 : 0;
    }
    default:
      throw new UsageError(sub ? `unknown service command '${sub}'; ${SERVICE_USAGE}` : SERVICE_USAGE);
  }
}

