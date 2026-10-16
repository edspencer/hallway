// `hallway mcp` (the stdio bridge to the daemon's /mcp, D8) and `hallway hook check-command` (the pre-tool-use hook,
// D51): the two commands that coding agents run rather than people.
import { UsageError, check, need } from '../args.js';
import type { Ctx } from './context.js';

/** `hallway mcp`: stdio in and out, forwarded to the running daemon, so it stays the one writer. */
export async function mcp(ctx: Ctx, args: string[], flags: Record<string, string>, rest: string[] | undefined) {
  check('mcp', flags, [], args, 0, rest);
  const port = ctx.store().currentConfig().port;
  const daemon = await ctx.daemon();
  const notRunning = `The Hallway daemon isn't running (nothing answered on port ${port}). Start it with \`hallway service install\` (it then runs at login) or \`hallway serve\`, then reconnect`;
  if (!daemon) {
    // an MCP client shows a stdio server's stderr in its logs; exiting makes it report the server as failed
    ctx.err(`hallway mcp: ${notRunning}.\n`);
    return 1;
  }
  const { runBridge } = await import('../mcp/bridge.js');
  await runBridge({ base: daemon.url.replace('//localhost:', '//127.0.0.1:'), notRunning });
  return 0;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** `hallway hook check-command`: a Claude Code PreToolUse payload on stdin; a deny decision on stdout, or nothing. */
export async function hook(ctx: Ctx, args: string[], flags: Record<string, string>, rest: string[] | undefined, input: () => Promise<string> = readStdin) {
  need('hook', args, ['check-command']);
  check('hook', flags, [], args, 1, rest);
  if (args[0] !== 'check-command') throw new UsageError(`unknown hook '${args[0]}' (the only one is check-command)`);
  const { checkCommand } = await import('../hook.js');
  const r = checkCommand(await input());
  ctx.out(r.stdout);
  return r.exitCode;
}
