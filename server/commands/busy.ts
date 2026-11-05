// `hallway busy [--json]`, and the busy check before `service stop` and `service restart` (the CLI contract's §4, D75):
// the running daemon is found through `<home>/runtime.json` only (server/contract/busy-client.ts), and asked /api/busy.
import { check } from '../args.js';
import { BUSY_NOUNS } from '../busy.js';
import { guardBusy, runBusyCommand } from '../contract/busy-client.js';
import { createOutput } from '../contract/output.js';
import type { Ctx } from './context.js';

const output = (ctx: Ctx, json: boolean) => createOutput({ tool: 'hallway', json, stdout: { write: ctx.out }, stderr: { write: ctx.err }, env: ctx.env });

/** 0 idle, 75 busy, 3 nothing answers. */
export async function busy(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  check('busy', flags, ['json'], pos, 0, rest);
  return runBusyCommand({ name: 'Hallway', home: ctx.home, out: output(ctx, !!flags.json), nouns: BUSY_NOUNS });
}

/** Null to go ahead (not busy, not running, or `--force`, which prints `Overriding: …`), or 75 after the refusal. */
export function refuseIfBusy(ctx: Ctx, flags: Record<string, string>, verb: string): Promise<number | null> {
  return guardBusy({
    name: 'Hallway',
    home: ctx.home,
    out: output(ctx, !!flags.json),
    nouns: BUSY_NOUNS,
    force: !!flags.force,
    hint: `Try \`hallway service ${verb}\` again once it has finished, or add --force.`,
  });
}
