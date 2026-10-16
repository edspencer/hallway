// `hallway run <slug> [--cwd DIR] [--port N] [--persist] [--name N] -- <command…>` (docs/04-apps-health-services.md,
// "`hallway run`"; D21): the one command agents use to start a server.
//   1. create or update apps/<slug>.yaml through the store: the command, its directory, a port (an existing app's
//      is kept, D17; `--port` pins a new app's; otherwise one is assigned from ports.assignRange);
//   2. generate the job and (re)start it, so the server belongs to launchd / systemd rather than the caller's session;
//   3. wait for the port (30 s), then report the URL and the log files; or report why not, with the last log lines.
// Re-running with no command reuses the recorded one, and keeps the recorded --persist choice unless given again.
import fs from 'node:fs';
import path from 'node:path';
import { expandHome, tildify } from '../config.js';
import { SLUG } from '../store/index.js';
import { appUrl } from '../views.js';
import { ServiceError, Services, appLabel, logFiles } from './index.js';
import { appLogs, formatLogs } from './logs.js';
import { assignPort, isListening, waitForPort } from './ports.js';

export interface RunRequest {
  slug: string;
  /** Empty or absent: the recorded command. */
  command?: string[];
  cwd?: string;
  port?: number;
  persist?: boolean;
  name?: string;
}

export interface RunOutcome {
  ok: boolean;
  slug: string;
  url: string;
  port: number;
  /** The app file was created by this run. */
  created: boolean;
  persist: boolean;
  logs: { out: string; err: string };
  /** Why it failed. */
  reason?: string;
  /** The last log lines, when it failed. */
  tail?: string;
  /** The job is still running (it failed only to listen in time). */
  stillRunning?: boolean;
}

export interface RunOptions {
  /** Where the command was given (the default --cwd). */
  cwd?: string;
  timeoutMs?: number;
  tailLines?: number;
  isFree?: (port: number) => Promise<boolean>;
  now?: () => Date;
}

export async function runApp(services: Services, req: RunRequest, opts: RunOptions = {}): Promise<RunOutcome> {
  const { store } = services;
  const { slug } = req;
  if (!SLUG.test(slug)) throw new ServiceError(`"${slug}" is not a valid slug: lower-case letters, digits and hyphens, starting and ending with a letter or digit`);
  const entry = store.apps.get(slug);
  const existing = entry ? services.app(slug) : null; // throws for a broken file: never write over it
  const given = req.command?.length ? req.command : null;
  const command = given ?? existing?.service?.command;
  if (!command) throw new ServiceError(`no command is recorded for ${slug}; give one: hallway run ${slug} -- <command…>`);

  let port: number;
  if (existing) {
    if (req.port !== undefined && req.port !== existing.port)
      throw new ServiceError(`${slug} already uses port ${existing.port}, and Hallway never changes an app's port (apps hardcode them). Leave out --port, or edit apps/${slug}.yaml yourself if you really mean it.`);
    port = existing.port;
  } else port = req.port ?? (await assignPort(store, { isFree: opts.isFree }));

  const here = opts.cwd ?? process.cwd();
  const cwd = req.cwd ? path.resolve(here, expandHome(req.cwd)) : given || !existing?.service?.cwd ? here : path.resolve(expandHome(existing.service.cwd));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new ServiceError(`the directory ${cwd} doesn't exist`);

  // --persist (or the recorded choice, re-running without a command) means a real service: at login, and restarted
  const keep = !given && existing?.service && !req.persist;
  const runAtLoad = keep ? existing!.service!.runAtLoad : !!req.persist;
  const keepAlive = keep ? existing!.service!.keepAlive : !!req.persist;
  const service = { command, cwd: tildify(cwd), runAtLoad, keepAlive };
  const expected = runAtLoad || keepAlive ? 'running' : 'adhoc';

  // something else on the port would make the job fail to bind, or (worse) look as if it had come up
  const label = appLabel(slug);
  const host = existing?.host ?? '127.0.0.1';
  const before = await services.status(label);
  if (!before.running && (await isListening(port, host === '0.0.0.0' ? '127.0.0.1' : host)))
    throw new ServiceError(`port ${port} is already in use by something Hallway didn't start. Stop that first (\`hallway status\` may say what it is).`);

  if (existing) await store.patchApp(slug, { ...(req.name ? { name: req.name } : {}), expected, service });
  else
    await store.createApp(
      slug,
      { name: req.name?.trim() || slug, port, expected, service },
      { header: ` Registered by \`hallway run\` on ${(opts.now?.() ?? new Date()).toISOString().slice(0, 10)}.` },
    );

  await services.startApp(slug, { restart: true });

  const cfg = services.store.currentConfig();
  const app = services.app(slug);
  const logs = logFiles(store.home, slug);
  const base = { slug, url: appUrl(slug, port, app.host, cfg), port, created: !existing, persist: runAtLoad || keepAlive, logs };
  let deadChecks = 0;
  const waited = await waitForPort(port, app.host, {
    timeoutMs: opts.timeoutMs ?? 30_000,
    // a job that has exited won't start listening: say so rather than wait out the timeout (twice, a second apart,
    // so a job still being spawned isn't mistaken for a dead one)
    abort: async () => {
      const st = await services.status(label);
      if (st.running) {
        deadChecks = 0;
        return null;
      }
      if (++deadChecks < 2) return null;
      return `it exited${st.lastExitCode !== null ? ` with status ${st.lastExitCode}` : ''} before listening on port ${port}`;
    },
  });
  if (waited.ok) return { ok: true, ...base };
  const st = await services.status(label);
  return { ok: false, ...base, reason: waited.reason, tail: formatLogs(appLogs(store.home, slug, opts.tailLines ?? 30)), stillRunning: st.running };
}
