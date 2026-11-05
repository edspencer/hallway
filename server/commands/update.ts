// `hallway update [--check] [--to <version|tag>] [--yes] [--force] [--json]` (and its hidden alias `upgrade`): the CLI
// contract's §5, run by server/contract/update.ts, the reference's own sequence, with Hallway's hooks (D76):
//
//   busy       /api/busy, through runtime.json (busy.ts), and then, before the question, what happens to the apps
//   inspect    the daemon's job: installed, running, its URL (config.yaml's port) and its log
//   stop       `hallway update-jobs pause`: the daemon's job stopped (not disabled), and on Windows every running
//              app's supervisor too, since each runs `node <package>/cli.js supervise` and Windows can't replace a
//              loaded file (the contract's §7)
//   refresh    the NEW CLI's `service install --refresh`, then its `update-jobs resume`: every job rewritten in its
//              format, running ones whose definition changed restarted, the paused ones started again
//
// The reference's hooks are synchronous, and Hallway's service manager isn't, so stop and refresh run Hallway's own CLI
// as a child, as the reference's fixture does. `update-jobs` is internal: not in --help.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { UsageError, check } from '../args.js';
import { VERSION } from '../config.js';
import { BUSY_NOUNS } from '../busy.js';
import { guardBusy } from '../contract/busy-client.js';
import { createOutput } from '../contract/output.js';
import { readLiveRuntimeFile } from '../contract/runtime-file.js';
import { runUpdate, type ServiceSnapshot, type UpdateProduct } from '../contract/update.js';
import { DAEMON_LABEL, logFiles, slugOfLabel } from '../services/index.js';
import { appLogs, formatLogs } from '../services/logs.js';
import { type Ctx, json } from './context.js';

export const UPDATE_USAGE = `Usage: hallway update [--check] [--to <version|tag>] [--yes] [--force] [--json]
  --check   say whether there's a newer version, and change nothing
  --to      a version or a dist-tag (next); the only way to go to a lower version
  --yes     don't ask (needed without a terminal)
  --force   don't wait for the daemon to finish what it's doing (the health check and the rollback still run)`;

export const PACKAGE_NAME = 'hallway';
export const changelogUrl = (v: string) => `https://github.com/edspencer/hallway/releases/tag/v${v}`;

/** How a hook's child CLI ran. */
const ran = (r: ReturnType<typeof spawnSync>) => ({ status: r.status ?? 1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? (r.error ? r.error.message : '')) });

export interface UpdateHooks {
  /** Runs a Hallway CLI (`process.argv[1]`, or the new version's) with these arguments: mocked in tests. */
  runCli?: (cli: string, args: string[]) => { status: number; stdout: string; stderr: string };
}

export async function update(ctx: Ctx, pos: string[], flags: Record<string, string>, rest: string[] | undefined, hooks: UpdateHooks = {}): Promise<number> {
  check('update', flags, ['check', 'to', 'yes', 'force', 'json'], pos, 0, rest);
  if (flags.to === '') throw new UsageError('--to needs a version or a dist-tag');
  const out = createOutput({ tool: 'hallway', json: !!flags.json, stdout: { write: ctx.out }, stderr: { write: ctx.err }, env: ctx.env });
  const runCli =
    hooks.runCli ??
    ((cli: string, args: string[]) => ran(spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: ctx.env, windowsHide: true, timeout: 5 * 60_000 })));
  const self = process.argv[1];

  // what inspect() reports: the job's file is enough to say "installed" (synchronously); whether it runs is asked once,
  // in the busy hook, which the sequence calls just before the first inspect()
  let svc: ReturnType<Ctx['services']> | null = null;
  try {
    svc = ctx.services();
  } catch {
    /* no service manager here (an unsupported OS): there's no service, only the package */
  }
  const unitFile = svc ? svc.manager.file(DAEMON_LABEL) : null;
  let running = false;
  let paused: string[] = [];
  const url = () => `http://127.0.0.1:${(svc?.store ?? ctx.store()).currentConfig().port}`;

  const product: UpdateProduct = {
    name: 'Hallway',
    tool: 'hallway',
    packageName: PACKAGE_NAME,
    envPrefix: 'HALLWAY',
    home: ctx.home,
    currentVersion: VERSION,
    entry: self,
    binSubpath: 'dist/server/cli.js',
    usage: UPDATE_USAGE,
    changelogUrl,
    async guardBusy({ force, home }) {
      const refused = await guardBusy({
        name: 'Hallway',
        home,
        out,
        nouns: BUSY_NOUNS,
        force,
        hint: 'Try `hallway update` again once it has finished, or add --force.',
      });
      if (refused !== null) return refused;
      // the last hook before the question: say up front what the update does to the apps
      if (svc) {
        running = (await svc.status(DAEMON_LABEL).catch(() => null))?.running ?? false;
        paused = await svc.jobsToPause().catch(() => []);
        const apps = svc.managedSlugs();
        if (paused.length)
          out.warn(
            `The update stops ${paused.length === 1 ? 'your running managed app' : `your ${paused.length} running managed apps`} (${paused.map((l) => slugOfLabel(l) ?? l).join(', ')}) while it installs, and starts ${paused.length === 1 ? 'it' : 'them'} again afterwards: on Windows each one runs through Hallway's own code.`,
          );
        else if (apps.length)
          out.warn(
            `Afterwards the new version rewrites your managed apps' jobs (${apps.join(', ')}); any it writes differently ${apps.length === 1 ? 'is' : 'are'} restarted.`,
          );
      }
      return null;
    },
    service: {
      inspect(): ServiceSnapshot {
        const installed = (unitFile !== null && fs.existsSync(unitFile)) || paused.length > 0;
        if (!installed) {
          // a `hallway serve` in a terminal, found where it says it is: the sequence asks it to be stopped first
          const live = readLiveRuntimeFile(ctx.home);
          return { installed: false, running: live !== null, ...(live ? { url: live.url } : {}) };
        }
        const hasDaemon = unitFile !== null && fs.existsSync(unitFile);
        return { installed: true, running, ...(hasDaemon ? { url: url(), log: logFiles(ctx.home, 'daemon').err } : {}) };
      },
      stop() {
        const r = runCli(self, ['update-jobs', 'pause']);
        if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim() || `\`hallway update-jobs pause\` exited ${r.status}`);
      },
      refresh(cli) {
        if (unitFile !== null && fs.existsSync(unitFile)) {
          const r = runCli(cli, ['service', 'install', '--refresh']);
          if (r.status !== 0) return r;
        }
        const resumed = runCli(cli, ['update-jobs', 'resume']);
        // an app that won't come back is worth saying, not worth rolling Hallway back for
        if (resumed.status !== 0) out.warn(`  Note: ${(resumed.stderr || resumed.stdout).trim() || "the apps' jobs couldn't all be rewritten"}`);
        return { status: 0, stdout: '', stderr: '' };
      },
      tail: (lines) => formatLogs(appLogs(ctx.home, 'daemon', lines)),
    },
  };

  return runUpdate(
    product,
    { check: !!flags.check, yes: !!flags.yes, force: !!flags.force, json: !!flags.json, ...(flags.to !== undefined ? { to: flags.to } : {}) },
    { out, env: ctx.env },
  );
}

/**
 * `hallway update-jobs pause|resume`, internal (not in --help): what `update`'s stop and refresh hooks run. `pause` is
 * run by the CLI being replaced, `resume` by the new one (or, on a rollback, the old one again).
 */
export async function updateJobs(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('update-jobs', flags, [], pos, 1, rest);
  const svc = ctx.services();
  if (pos[0] === 'pause') {
    const r = await svc.pauseForUpdate();
    ctx.out(json(r));
    return 0;
  }
  if (pos[0] === 'resume') {
    const r = await svc.resumeAfterUpdate();
    ctx.out(json(r));
    if (r.errors.length) ctx.err(`hallway: ${r.errors.join('; ')}\n`);
    return r.errors.length ? 1 : 0;
  }
  throw new UsageError('update-jobs needs pause or resume');
}
