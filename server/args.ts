// Command-line parsing for `hallway`, kept apart from cli.ts (which runs on import) so it can be unit-tested.
// Exit codes (docs/07-cli.md): 0 success, 1 error, 2 usage error (with the usage printed): a UsageError is the 2.

/** Bad usage: exit 2, with the usage. Anything else thrown exits 1. */
export class UsageError extends Error {}

/** Options that take a value (`--port 5050` or `--port=5050`). */
const VALUE_FLAGS = ['port'];
/** Options that don't. */
const BOOLEAN_FLAGS = ['snippet'];

export interface ParsedArgs {
  pos: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') flags.help = '1';
    else if (a === '-v' || a === '--version') flags.version = '1';
    else if (a === '-q' || a === '--quiet') flags.quiet = '1';
    else if (a.startsWith('--')) {
      if (BOOLEAN_FLAGS.includes(a.slice(2))) {
        flags[a.slice(2)] = '1';
        continue;
      }
      const eq = a.indexOf('=');
      const [k, v] = eq > 0 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), argv[++i]];
      if (!VALUE_FLAGS.includes(k)) throw new UsageError(`unknown option --${k}`);
      if (v === undefined) throw new UsageError(`--${k} needs a value`);
      flags[k] = v;
    } else if (a.startsWith('-') && a.length > 1) throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, flags };
}

/** Each command takes its own options and at most `max` arguments. */
export function check(cmd: string, flags: Record<string, string>, allowed: string[], args: string[], max: number) {
  const bad = Object.keys(flags).find((k) => !allowed.includes(k));
  if (bad) throw new UsageError(`${cmd} doesn't take --${bad}`);
  if (args.length > max) throw new UsageError(`unexpected argument '${args[max]}'`);
}
