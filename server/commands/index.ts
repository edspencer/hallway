// Every `hallway` command except `serve` and `guide` (server/cli.ts), by name. Each resolves with its exit code, or
// undefined while it keeps running (`logs --follow`).
import { hook, mcp } from './agents.js';
import { app, bookmark } from './apps.js';
import type { Ctx } from './context.js';
import { doctor } from './doctor.js';
import { logs, restart, run, service, start, stop } from './services.js';
import { setup, teardown } from './setup.js';
import { claim, ignore, open, scan, status } from './status.js';

export { makeCtx } from './context.js';

export type Command = (ctx: Ctx, args: string[], flags: Record<string, string>, rest: string[] | undefined) => Promise<number | undefined>;

export const COMMANDS: Record<string, Command> = {
  open,
  status,
  scan,
  claim,
  ignore,
  app,
  bookmark,
  doctor: (ctx, args, flags, rest) => doctor(ctx, args, flags, rest),
  run,
  stop,
  start,
  restart,
  logs,
  service,
  setup,
  teardown,
  mcp,
  hook: (ctx, args, flags, rest) => hook(ctx, args, flags, rest),
};
