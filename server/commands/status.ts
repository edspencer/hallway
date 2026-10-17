// `hallway status`, `scan`, `claim`, `ignore` and `open` (docs/07-cli.md, "Status and discovery"). With the daemon
// running they ask it (it has health history, the scanner's identities and discovered apps); without it they read
// the files and look for themselves, once.
import { spawn } from 'node:child_process';
import type { AppHealth, AppView, ClaimRequest, Expected, ObservedListener, ObservedResponse, StateResponse } from '../../shared/api.js';
import { UsageError, check, need } from '../args.js';
import { parsePort } from '../config.js';
import { ProviderRegistry } from '../providers.js';
import { probeOnce } from '../services/probe.js';
import { appViews } from '../views.js';
import { publicUrl } from '../proxy/names.js';
import { type Ctx, json, show, table } from './context.js';
import { offlineObserved, offlineClaim } from './offline.js';

const STATE_MARK: Record<string, string> = { healthy: '●', unhealthy: '▲', down: '✖', stopped: '○', unknown: '·' };

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(v >= 0.9995 ? 0 : 1)}%`);

/** Every app with its health: from the daemon, or from the files plus one probe each. */
async function appsWithHealth(ctx: Ctx): Promise<{ apps: AppView[]; live: boolean; observed: ObservedListener[] }> {
  const daemon = await ctx.daemon();
  let apps: AppView[];
  let observed: ObservedListener[] = [];
  if (daemon) {
    const s = await daemon.get<StateResponse>('/api/state');
    if (s.daemon.providers.health) return { apps: s.apps, live: true, observed: s.observed };
    // a daemon without health checks: its apps (and anything it discovered), probed here
    ({ apps, observed } = s);
  } else apps = appViews({ store: ctx.store(), providers: new ProviderRegistry() }, false);
  await Promise.all(
    apps.map(async (a) => {
      if (!a.config) return;
      a.health = { ...a.health, ...(await probeOnce(a.slug, a.config)) } as AppHealth;
    }),
  );
  return { apps, live: !!daemon, observed };
}

export async function status(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('status', flags, ['json'], pos, 1, rest);
  const { apps, live, observed } = await appsWithHealth(ctx);
  const slug = pos[0];
  const shown = slug ? apps.filter((a) => a.slug === slug) : apps;
  if (slug && !shown.length) throw new Error(`no app '${slug}'`);
  if (flags.json) {
    ctx.out(json(slug ? shown[0] : { daemon: live, apps: shown, observed }));
    return 0;
  }
  if (!shown.length) ctx.out('No apps yet. Start one with `hallway run <slug> -- <command>`, or declare one with `hallway app add`.\n');
  else
    ctx.out(
      table(
        ['', 'SLUG', 'STATE', 'ADDRESS', 'PORT', 'UPTIME 24H', 'SOURCE'],
        shown.map((a) => [
          STATE_MARK[a.health.state] ?? '·',
          a.slug,
          a.health.starting ? 'starting' : a.health.state + (a.problems.some((p) => p.severity === 'error') ? ' (file error)' : ''),
          a.url ?? '-',
          String(a.config?.port ?? '-'),
          pct(a.health.uptime24h),
          a.source + (a.managed ? ', service' : ''),
        ]),
      ),
    );
  if (slug) {
    const a = shown[0];
    const lines = [
      a.health.detail ? `Detail:  ${a.health.detail}` : null,
      a.file ? `File:    ${show(a.path!)}` : null,
      a.identity?.pid ? `Process: pid ${a.identity.pid}${a.identity.command ? `, ${a.identity.command}` : ''}${a.identity.cwd ? ` (in ${show(a.identity.cwd)})` : ''}` : null,
      ...a.problems.map((p) => `${p.severity === 'error' ? 'Error' : 'Warning'}: ${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`),
    ].filter(Boolean);
    if (a.managed) lines.push(`Logs:    ${show(ctx.home)}/logs/${a.slug}.out.log (\`hallway logs ${a.slug}\`)`);
    if (lines.length) ctx.out('\n' + lines.join('\n') + '\n');
  }
  if (!slug && observed.length) ctx.out(`\n${observed.length} unnamed listener${observed.length === 1 ? '' : 's'}: \`hallway scan\` lists ${observed.length === 1 ? 'it' : 'them'}.\n`);
  if (!live) ctx.out(`\n(The daemon isn't running: this is one probe of each app. \`hallway service install\` keeps it running.)\n`);
  return 0;
}

function printObserved(ctx: Ctx, observed: ObservedListener[]) {
  if (!observed.length) {
    ctx.out('Nothing unnamed is listening.\n');
    return;
  }
  // the column only when something has a supervisor: `launchd: com.example.api`, `systemd: api.service`
  const sup = observed.some((o) => o.identity.supervisor);
  ctx.out(
    table(
      ['PORT', 'ID', 'NAME', 'DIRECTORY', ...(sup ? ['SUPERVISED BY'] : []), 'COMMAND'],
      observed.map((o) => [
        String(o.port),
        o.id,
        o.identity.label ?? o.identity.name ?? o.identity.displayName ?? o.title ?? '-',
        o.identity.projectDir ?? o.identity.cwd ? show((o.identity.projectDir ?? o.identity.cwd)!) : '-',
        ...(sup ? [o.identity.supervisor ? `${o.identity.supervisor.manager}: ${o.identity.supervisor.label}` : '-'] : []),
        o.identity.command ?? o.identity.process ?? '-',
      ]),
    ),
  );
  ctx.out('\nName one with `hallway claim <port>`, or hide it with `hallway ignore <port>`.\n');
}

export async function scan(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('scan', flags, ['json'], pos, 0, rest);
  const daemon = await ctx.daemon();
  const observed = daemon ? (await daemon.post<ObservedResponse>('/api/scan', {})).observed : await offlineObserved(ctx);
  if (flags.json) ctx.out(json({ observed }));
  else printObserved(ctx, observed);
  return 0;
}

/** An observed listener by port or observation id. */
function pick(observed: ObservedListener[], which: string): ObservedListener {
  const port = /^\d+$/.test(which) ? Number(which) : null;
  const o = observed.find((x) => x.id === which || (port !== null && x.port === port));
  if (!o) throw new Error(`nothing unnamed is listening on ${port !== null ? `port ${port}` : `'${which}'`} (\`hallway scan\` lists what is)`);
  return o;
}

export async function claim(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('claim', flags, ['slug', 'name', 'expected', 'json'], pos, 1, rest);
  need('claim', pos, ['port|observation-id']);
  if (flags.expected !== undefined && !['running', 'stopped', 'adhoc'].includes(flags.expected)) throw new UsageError('--expected must be one of running, stopped, adhoc');
  const daemon = await ctx.daemon();
  const observed = daemon ? (await daemon.post<ObservedResponse>('/api/scan', {})).observed : await offlineObserved(ctx);
  const o = pick(observed, pos[0]);
  const slug = flags.slug ?? o.suggestedSlug;
  if (!slug) throw new UsageError(`no slug to suggest for port ${o.port}; give one with --slug`);
  const req: ClaimRequest = { slug, ...(flags.name ? { name: flags.name } : {}), ...(flags.expected ? { expected: flags.expected as Expected } : {}) };
  const view = daemon ? await daemon.post<AppView>(`/api/observed/${encodeURIComponent(o.id)}/claim`, req) : await offlineClaim(ctx, o, req);
  if (flags.json) ctx.out(json(view));
  else ctx.out(`Claimed port ${o.port} as ${view.slug}: ${view.path ? show(view.path) : `apps/${view.slug}.yaml`}\n`);
  return 0;
}

export async function ignore(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('ignore', flags, ['by'], pos, 1, rest);
  need('ignore', pos, ['port|observation-id']);
  const by = (flags.by ?? 'port') as 'port' | 'process' | 'dir';
  if (!['port', 'process', 'dir'].includes(by)) throw new UsageError('--by must be port, process or dir');
  const which = pos[0];
  const store = ctx.store();
  // a port needs nothing from the scanner
  if (by === 'port' && /^\d+$/.test(which)) {
    const port = parsePort(which);
    if (!port) throw new UsageError(`'${which}' is not a port number`);
    await store.addIgnore('port', port);
    ctx.out(`Ignoring port ${port} (ignore.yaml).\n`);
    return 0;
  }
  const daemon = await ctx.daemon();
  const observed = daemon ? (await daemon.get<ObservedResponse>('/api/observed')).observed : await offlineObserved(ctx);
  const o = pick(observed, which);
  const value = by === 'port' ? o.port : by === 'process' ? o.identity.process : (o.identity.projectDir ?? o.identity.cwd) && show((o.identity.projectDir ?? o.identity.cwd)!);
  if (value === null || value === undefined || value === '') throw new Error(`the ${by === 'dir' ? 'directory' : 'process name'} of the listener on port ${o.port} isn't known; ignore it by port instead`);
  if (daemon) await daemon.post(`/api/observed/${encodeURIComponent(o.id)}/ignore`, { by });
  else await store.addIgnore(by, value);
  ctx.out(`Ignoring ${by === 'port' ? 'port' : by === 'process' ? 'process' : 'directory'} ${value} (ignore.yaml).\n`);
  return 0;
}

export async function open(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('open', flags, [], pos, 0, rest);
  const cfg = ctx.store().currentConfig();
  const url = cfg.mode === 'fronted' ? publicUrl(cfg.domain.dashboard, cfg.proxy) : `http://localhost:${cfg.port}`;
  const daemon = await ctx.daemon();
  if (!daemon) ctx.err(`hallway: nothing is answering on http://localhost:${cfg.port}. Start the daemon with \`hallway service install\` (or \`hallway serve\`).\n`);
  const [cmd, args] = ctx.platform().openCommand(url);
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
  ctx.out(ok ? `Opening ${url}\n` : `Open ${url} in your browser (couldn't run ${cmd}).\n`);
  return daemon ? 0 : 1;
}
