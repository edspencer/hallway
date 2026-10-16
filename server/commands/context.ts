// What every command gets: where to write, the data home, and lazily the store, the services and the daemon.
import os from 'node:os';
import { type Daemon, findDaemon } from '../client.js';
import { HOME, tildify } from '../config.js';
import { EventBus } from '../events.js';
import { type Platform, type Runner, currentPlatform } from '../platform/index.js';
import { Services } from '../services/index.js';
import { Store } from '../store/index.js';

export interface Ctx {
  home: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  out(s: string): void;
  err(s: string): void;
  store(): Store;
  services(): Services;
  daemon(): Promise<Daemon | null>;
  platform(): Platform;
  /** Read the data home without creating it (doctor is read-only). Set before the first `store()`. */
  readOnly: boolean;
}

export interface CtxOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  out?: (s: string) => void;
  err?: (s: string) => void;
  run?: Runner;
  platform?: Platform;
}

export function makeCtx(o: CtxOptions = {}): Ctx {
  const home = o.home ?? HOME;
  const env = o.env ?? process.env;
  let store: Store | undefined;
  let services: Services | undefined;
  let daemon: Promise<Daemon | null> | undefined;
  const ctx: Ctx = {
    home,
    env,
    cwd: o.cwd ?? process.cwd(),
    out: o.out ?? ((s) => process.stdout.write(s)),
    err: o.err ?? ((s) => process.stderr.write(s)),
    // the CLI's own bus: its writes reach a running daemon through the files (the watcher), not in-process events
    store: () => {
      if (store) return store;
      store = new Store(home, { bus: new EventBus() });
      if (ctx.readOnly) store.loadAll();
      else store.init();
      return store;
    },
    services: () => (services ??= new Services({ store: ctx.store(), platform: ctx.platform(), run: o.run, env, userHome: os.homedir() })),
    daemon: () => (daemon ??= findDaemon(ctx.store().currentConfig().port)),
    platform: () => o.platform ?? currentPlatform(),
    readOnly: false,
  };
  return ctx;
}

/** Fixed-width columns, two spaces apart, the last column unpadded. */
export function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  return all.map((r) => r.map((c, i) => (i === r.length - 1 ? c : (c ?? '').padEnd(widths[i]))).join('  ').trimEnd()).join('\n') + '\n';
}

export const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
export const show = (p: string) => tildify(p);
