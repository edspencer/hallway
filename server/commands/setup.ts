// `hallway setup [--domain BASE] [--print] [--yes]` and `hallway teardown [--uninstall-packages] [--print] [--yes]`:
// fronted mode's one privileged step and its undo (docs/03-networking.md, "Privileged setup"; D47). The work is in
// server/proxy/setup.ts; this turns a Ctx into its dependencies, including the terminal it asks on (D67).
import os from 'node:os';
import readline from 'node:readline';
import { UsageError, check } from '../args.js';
import { defaultRunner } from '../platform/index.js';
import { type SetupDeps, SetupError, setup as runSetup, teardown as runTeardown } from '../proxy/setup.js';
import { SLUG } from '../store/schema.js';
import type { Ctx } from './context.js';

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
  check('setup', flags, ['domain', 'print', 'yes'], args, 0, rest);
  const domain = flags.domain?.toLowerCase().replace(/\.$/, '');
  if (domain !== undefined && !HOSTNAME.test(domain)) throw new UsageError(`--domain must be a host name such as myname.internal, not '${flags.domain}'`);
  if (domain && SLUG.test(domain) && domain !== 'localhost') throw new UsageError(`--domain needs at least two labels (e.g. ${domain}.internal), so that apps can live under it`);
  try {
    return await runSetup(deps(ctx, flags), { domain, print: !!flags.print });
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
