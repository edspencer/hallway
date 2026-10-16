// What each state looks like, and the counts the header, the tab title and the favicon show. Pure: no DOM, no React,
// so it's tested under node (test/dashboard.test.ts).
import type { AppState, AppView, StateResponse } from '../../shared/api.js';

/** What a card shows: the five health states, plus `starting` (a managed service in its grace period, v1). */
export type DoorState = AppState | 'starting';

/**
 * Colour is never the only signal: every state has a shape and a word (docs/05-ui.md, "App card"). `says` is the
 * state in a plain sentence, for tooltips and the drawer: the door imagery stays in the visuals, never in the words
 * (05-ui.md, "Visual direction").
 */
export const STATE_META: Record<DoorState, { mark: string; label: string; says: string }> = {
  healthy: { mark: '●', label: 'healthy', says: 'Up' },
  unhealthy: { mark: '▲', label: 'unhealthy', says: 'Answering, but with errors' },
  down: { mark: '■', label: 'down', says: 'Not answering, and it should be running' },
  stopped: { mark: '○', label: 'stopped', says: 'Off, which is fine' },
  unknown: { mark: '◌', label: 'unknown', says: 'Not checked yet' },
  starting: { mark: '◐', label: 'starting', says: 'Starting' },
};

export function doorState(a: Pick<AppView, 'health'>): DoorState {
  return a.health.starting ? 'starting' : a.health.state;
}

export interface Counts {
  up: number;
  down: number;
  unhealthy: number;
  stopped: number;
  unknown: number;
  total: number;
}

export function countStates(apps: Pick<AppView, 'health'>[]): Counts {
  const c: Counts = { up: 0, down: 0, unhealthy: 0, stopped: 0, unknown: 0, total: apps.length };
  for (const a of apps) {
    const s = doorState(a);
    if (s === 'healthy') c.up++;
    else if (s === 'down') c.down++;
    else if (s === 'unhealthy') c.unhealthy++;
    else if (s === 'stopped') c.stopped++;
    else c.unknown++; // unknown, starting
  }
  return c;
}

/**
 * The tab title (D22): `(2 down · 1 unhealthy) Hallway`, or just the name when nothing is wrong. Only `down` and
 * `unhealthy` count; `stopped` never does (D12).
 */
export function tabTitle(c: Pick<Counts, 'down' | 'unhealthy'>, name = 'Hallway'): string {
  const parts = [c.down ? `${c.down} down` : '', c.unhealthy ? `${c.unhealthy} unhealthy` : ''].filter(Boolean);
  return parts.length ? `(${parts.join(' · ')}) ${name}` : name;
}

/** The favicon's status mark: none when all is well. */
export function faviconMark(c: Pick<Counts, 'down' | 'unhealthy'>): 'down' | 'unhealthy' | null {
  return c.down ? 'down' : c.unhealthy ? 'unhealthy' : null;
}

/** The second line under a door's name: `repo @ branch` for a worktree sibling, else the description. Not the label
 * when the name already is it (a claimed worktree is named after its label). */
export function subtitle(app: Pick<AppView, 'name' | 'identity' | 'config'>): string | null {
  const label = app.identity?.label;
  return (label && label !== app.name ? label : null) ?? app.config?.description ?? null;
}

/** Whether the daemon is looking for listeners: it has a scanner and `scan.enabled` is on. */
export function isScanning(state: Pick<StateResponse, 'daemon' | 'config'>): boolean {
  return state.daemon.providers.scanner && state.config.config.scan.enabled;
}
