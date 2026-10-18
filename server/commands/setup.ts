// `hallway setup [--trust user|system|none] [--domain BASE] [--print] [--yes]` and `hallway teardown [--uninstall-packages] [--print] [--yes]`:
// fronted mode and its undo (docs/03-networking.md, "Setup"; D47, D65). The work is in server/proxy/setup.ts; this turns
// a Ctx into its dependencies, including the terminal it asks on (the tier, D65; Continue?, D67).
import os from 'node:os';
import readline from 'node:readline';
import { UsageError, check } from '../args.js';
import { defaultRunner } from '../platform/index.js';
import { type SetupDeps, SetupError, setup as runSetup, teardown as runTeardown } from '../proxy/setup.js';
import { SLUG } from '../store/schema.js';
import { TIERS } from '../proxy/tiers.js';
import type { Trust } from '../../shared/api.js';
import type { Ctx } from './context.js';
import { restartStaleDaemon } from './services.js';

/** A host name: dot-separated DNS labels (the same rule config.yaml's domain.base has). */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** One line from the terminal; end of input (Ctrl-D) is an empty answer, which is no. */
function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(question, (a) => {
      answered = true;
      rl.close();
      resolve(a);
    });
    rl.on('close', () => {
      if (answered) return;
      process.stdout.write('\n');
      resolve('');
    });
  });
}

function deps(ctx: Ctx, flags: Record<string, string>): SetupDeps {
  return {
    store: ctx.store(),
    platform: ctx.platform(),
    services: () => ctx.services(),
    env: ctx.env,
    userHome: os.homedir(),
    query: defaultRunner,
    out: ctx.out,
    isRoot: process.getuid?.() === 0,
    // a question needs a terminal on both ends: the one it's asked on and the one that answers
    confirm: { yes: !!flags.yes, ask: process.stdin.isTTY && process.stdout.isTTY ? ask : undefined },
  };
}

export async function setup(ctx: Ctx, args: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('setup', flags, ['trust', 'domain', 'print', 'yes'], args, 0, rest);
  const trust = flags.trust;
  if (trust !== undefined && !TIERS.includes(trust as Trust)) throw new UsageError(`--trust is user, system or none, not '${trust}'`);
  const domain = flags.domain?.toLowerCase().replace(/\.$/, '');
  if (domain && domain !== 'localhost' && trust && trust !== 'system') throw new UsageError(`--domain needs --trust system: a custom domain needs the system resolver pointed at it, which needs an administrator (--trust ${trust} uses *.localhost)`);
  if (domain !== undefined && !HOSTNAME.test(domain)) throw new UsageError(`--domain must be a host name such as myname.internal, not '${flags.domain}'`);
  if (domain && SLUG.test(domain) && domain !== 'localhost') throw new UsageError(`--domain needs at least two labels (e.g. ${domain}.internal), so that apps can live under it`);
  try {
    const code = await runSetup(deps(ctx, flags), { domain, print: !!flags.print, trust: trust as Trust | undefined });
    // the daemon pushes Caddy's config from now on: one left running an older version after an upgrade would push that
    // version's (D70). Only once setup has run: never before the plan was agreed to, or when it was refused (D67).
    if (code === 0 && !flags.print) await restartStaleDaemon(ctx).catch((e) => ctx.err(`hallway: couldn't restart the daemon: ${(e as Error).message}\n`));
    return code;
  } catch (e) {
    if (e instanceof SetupError) {
      ctx.err(`hallway: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export async function teardown(ctx: Ctx, args: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('teardown', flags, ['uninstall-packages', 'print', 'yes'], args, 0, rest);
  try {
    return await runTeardown(deps(ctx, flags), { uninstallPackages: !!flags['uninstall-packages'], print: !!flags.print });
  } catch (e) {
    if (e instanceof SetupError) {
      ctx.err(`hallway: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}
