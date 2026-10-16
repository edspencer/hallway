// Types shared by the daemon (server/) and the dashboard (src/). Keep this file free of imports and of anything that
// needs Node or the DOM: it's compiled by both tsconfigs.

/** `GET /api/health`: the daemon's own health (docs/02-architecture.md, "HTTP API"). */
export interface HealthResponse {
  ok: true;
  version: string;
}

/** An app's health classification (docs/04-apps-health-services.md, "Health states"; D12). */
export type AppState = 'healthy' | 'unhealthy' | 'down' | 'stopped' | 'unknown';

/** Where an app came from (D11). */
export type AppSource = 'declared' | 'discovered' | 'observed';

// --- The scanner, prober and uptime store (docs/04-apps-health-services.md) -------------------------------------

/** How exposed a listener is: loopback only, every interface (reachable from the network), or specific addresses. */
export type BindScope = 'loopback' | 'all' | 'address';

/** Something the scanner found listening (`GET /api/observed`), with everything it worked out about it. */
export interface ObservedListener {
  /** Stable across restarts: a hash of the project root (or cwd), the port and the normalised command. */
  id: string;
  port: number;
  pid: number | null;
  /** The short process name (`node`, `python3`). */
  process: string | null;
  addresses: string[];
  bind: BindScope;
  /** `web` if it answered HTTP; `other` listeners go in a collapsed group. */
  kind: 'web' | 'other';
  http: { status: number; title: string | null; favicon: string | null } | null;
  command: string | null;
  argv: string[] | null;
  cwd: string | null;
  /** ISO time the process started. */
  startedAt: string | null;
  /** The session that launched it has gone: it was reparented to init/launchd or a subreaper. */
  orphan: boolean;
  project: {
    root: string;
    name: string;
    description: string | null;
    /** A guess: `vite`, `next`, `astro`, `express`, `python-http`, … */
    framework: string | null;
  } | null;
  git: {
    toplevel: string;
    /** The repository's name (its main checkout's directory), shared by all its worktrees. */
    repo: string;
    branch: string | null;
    lastCommitAt: string | null;
    /** A linked worktree, not the main checkout. */
    worktree: boolean;
    /** The repository's shared git dir: the same for every worktree of one repository. */
    commonDir: string;
    remote: string | null;
  } | null;
  /** What to call it: the project name, or `repo @ branch` when worktrees of one repository are running side by side. */
  label: string;
  firstSeen: string;
  lastSeen: string;
}

/** `GET /api/observed`: the latest scan. */
export interface ObservedResponse {
  scannedAt: string | null;
  /** Web listeners that are neither declared nor discovered: claim or ignore them. */
  listeners: ObservedListener[];
  /** Listeners that didn't answer HTTP. */
  other: ObservedListener[];
}

/** One bar of an uptime chart. `state` is the worst state seen in it; null means no data (the daemon wasn't running). */
export interface UptimeBucket {
  start: string;
  end: string;
  state: Exclude<AppState, 'unknown'> | null;
  samples: number;
  healthy: number;
  unhealthy: number;
  down: number;
  stopped: number;
  /** healthy / (samples − stopped), 0–1; null when every sample was `stopped` or there were none. */
  uptime: number | null;
  latencyP50: number | null;
}

/** `GET /api/apps/:slug/history?window=24h|7d|90d`. */
export interface HistoryResponse {
  slug: string;
  window: '24h' | '7d' | '90d';
  buckets: UptimeBucket[];
  /** Over the whole window, excluding `stopped` time; null with no data. */
  uptime: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
}
