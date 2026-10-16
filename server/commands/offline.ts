// The scanner, run once from the CLI when no daemon is running (`hallway scan`, `claim`, `ignore`).
import type { AppView, ClaimRequest, ObservedListener } from '../../shared/api.js';
import type { Ctx } from './context.js';

export async function offlineObserved(_ctx: Ctx): Promise<ObservedListener[]> {
  throw new Error("this needs the scanner, which runs in the daemon: start it with `hallway service install` (or `hallway serve`)");
}

export async function offlineClaim(_ctx: Ctx, _o: ObservedListener, _req: ClaimRequest): Promise<AppView> {
  throw new Error("this needs the scanner, which runs in the daemon: start it with `hallway service install` (or `hallway serve`)");
}
