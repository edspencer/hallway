// The health state machine (docs/04-apps-health-services.md, "Health states"; D12), as a pure function so it can be
// tested without sockets or timers. A probe's outcome becomes a state according to `expected`; flap damping then
// decides whether the app's shown state actually changes.
import type { AppState } from '../../shared/api.js';
import type { Expected, ProbeOutcome } from './probe.js';

/** A probe outcome classified against what the app is expected to do. `starting`: inside a fresh start's grace period. */
export type Classified = Exclude<AppState, 'unknown'> | 'starting';

/**
 * Not listening is `down` only when the app should be running (and has had its grace period after a start);
 * otherwise it's `stopped`, shown calmly. Listening is judged on the HTTP answer whatever `expected` says.
 */
export function classify(outcome: ProbeOutcome, expected: Expected, inGrace: boolean): Classified {
  if (outcome === 'healthy') return 'healthy';
  if (outcome === 'unhealthy') return 'unhealthy';
  if (expected !== 'running') return 'stopped';
  return inGrace ? 'starting' : 'down';
}

export interface Health {
  state: AppState;
  /** A managed service that was just started and isn't listening yet (a transient sub-state of `unknown`). */
  starting: boolean;
  /** Consecutive non-healthy probes while shown as healthy (flap damping). */
  failures: number;
  /** Epoch ms of the last transition. */
  since: number;
}

export const initialHealth = (now: number): Health => ({ state: 'unknown', starting: false, failures: 0, since: now });

/**
 * The next health after a probe. Leaving `healthy` takes `failuresBeforeUnhealthy` consecutive failures (default 2);
 * one success returns to it; every other move is immediate. `changed` is true only when the shown state (or the
 * starting flag) changes: events are emitted on transitions, never on every probe.
 */
export function step(prev: Health, c: Classified, now: number, failuresBeforeUnhealthy = 2): { next: Health; changed: boolean } {
  const target: AppState = c === 'starting' ? 'unknown' : c;
  const starting = c === 'starting';
  if (prev.state === 'healthy' && target !== 'healthy') {
    const failures = prev.failures + 1;
    if (failures < failuresBeforeUnhealthy) return { next: { ...prev, failures }, changed: false };
  }
  if (target === prev.state && starting === prev.starting) return { next: { ...prev, failures: 0 }, changed: false };
  return { next: { state: target, starting, failures: 0, since: now }, changed: true };
}
