// What the scanner records about a listener: the full identity it worked out, as kept in state/observed.json. The
// HTTP API's shapes (shared/api.ts) are derived from this by the daemon's wiring.

/** How exposed a listener is: loopback only, every interface (reachable from the network), or specific addresses. */
export type BindScope = 'loopback' | 'all' | 'address';

/** Something the scanner found listening, with everything it worked out about it. */
export interface Observation {
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
