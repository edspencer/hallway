// `hallway doctor [--json]`: read-only diagnostics, each a pass / warn / fail line with a suggested fix
// (docs/03-networking.md, "`hallway doctor`"). v0 checks the daemon, the data home and its files; with v1's services
// it also checks every generated job for the PATH trap (docs/04) and a recorded Node that has gone. The networking
// checks (Caddy, ports 80/443, the CA, DNS) arrive with fronted mode; in direct mode they don't apply.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StateResponse } from '../../shared/api.js';
import { check } from '../args.js';
import { type Runner, defaultRunner } from '../platform/index.js';
import { DAEMON_LABEL, slugOfLabel } from '../services/index.js';
import { isListening } from '../services/ports.js';
import { pathProblem } from '../services/resolve.js';
import { transientInstall } from '../services/transient.js';
import { type Ctx, json, show } from './context.js';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

const MARK: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✗', skip: '-' };

export async function diagnose(ctx: Ctx, run: Runner = defaultRunner): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

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
  if (daemon) add({ id: 'daemon', status: 'pass', message: `the daemon is answering on ${daemon.url} (version ${daemon.version})` });
  else if (await isListening(cfg.port))
    add({ id: 'daemon', status: 'fail', message: `something that isn't Hallway is listening on its port, ${cfg.port}`, fix: 'stop it, or give Hallway another port: in config.yaml' });
  else add({ id: 'daemon', status: 'warn', message: `the daemon isn't running (nothing on http://localhost:${cfg.port})`, fix: '`hallway service install` runs it as a service' });

  let services: ReturnType<Ctx['services']> | null = null;
  try {
    services = ctx.services();
  } catch (e) {
    add({ id: 'service-manager', status: 'fail', message: (e as Error).message });
  }
  if (services) {
    const kind = services.manager.kind;
    try {
      const st = await services.status(DAEMON_LABEL);
      if (!st.installed) add({ id: 'daemon-service', status: 'warn', message: `the daemon isn't installed as a ${services.manager.noun}`, fix: '`hallway service install`' });
      else if (!st.running)
        add({ id: 'daemon-service', status: 'fail', message: `the daemon's service is installed (${show(st.label)}) but not running${st.lastExitCode !== null ? ` (last exit status ${st.lastExitCode})` : ''}`, fix: '`hallway service restart`; its logs are in logs/daemon.err.log' });
      else add({ id: 'daemon-service', status: 'pass', message: `the daemon's service is running (pid ${st.pid})` });
      if (st.installed && kind === 'systemd') {
        const user = os.userInfo().username;
        const r = await run('loginctl', ['show-user', user, '--property=Linger']);
        if (r.code === 0 && /Linger=no/.test(r.stdout))
          add({ id: 'linger', status: 'warn', message: "lingering is off: Hallway's services stop when you log out and start only when you log in", fix: `\`loginctl enable-linger ${user}\`` });
        else if (r.code === 0) add({ id: 'linger', status: 'pass', message: 'lingering is on: services run without a login session' });
      }
    } catch (e) {
      add({ id: 'service-manager', status: 'fail', message: (e as Error).message });
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

  return checks;
}

export async function doctor(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[], run?: Runner): Promise<number> {
  check('doctor', flags, ['json'], pos, 0, rest);
  const checks = await diagnose(ctx, run);
  const failed = checks.some((c) => c.status === 'fail');
  if (flags.json) ctx.out(json({ ok: !failed, checks }));
  else {
    for (const c of checks) ctx.out(`${MARK[c.status]} ${c.message}${c.fix ? `\n    fix: ${c.fix}` : ''}\n`);
    const n = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
    ctx.out(`\n${n('pass')} ok, ${n('warn')} warning${n('warn') === 1 ? '' : 's'}, ${n('fail')} problem${n('fail') === 1 ? '' : 's'}\n`);
  }
  return failed ? 1 : 0;
}
