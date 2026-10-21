// What the scanner records about a listener: the full identity it worked out, as kept in state/observed.json. The
// HTTP API's shapes (shared/api.ts) are derived from this by the daemon's wiring.
import type { Sniff } from './sniff.js';
import type { ListenerApp, ListenerVia } from '../../shared/api.js';
import type { Supervisor } from '../platform/listeners.js';

/** How exposed a listener is: loopback only, every interface (reachable from the network), or specific addresses. */
export type BindScope = 'loopback' | 'all' | 'address';

/** Something the scanner found listening, with everything it worked out about it. */
export interface Observation {
  /** Stable across restarts: a hash of the project root (or cwd), the port and the normalised command. */
  id: string;
  port: number;
  pid: number | null;
  ppid: number | null;
  /** The short process name (`node`, `python3`). */
  process: string | null;
  addresses: string[];
  bind: BindScope;
  /** `web` if it answered HTTP; `other` listeners go in a collapsed group. */
  kind: 'web' | 'other';
  http: Sniff | null;
  command: string | null;
  argv: string[] | null;
  cwd: string | null;
  /** ISO time the process started. */
  startedAt: string | null;
  /** The session that launched it has gone (it was reparented to init/launchd or a subreaper) and nothing supervises it. */
  orphan: boolean;
  /** The launchd job or systemd service keeping it running (absent in records from before 0.5.1, and on Windows). */
  supervisor?: Supervisor | null;
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
  /** It forwards the port for a container, a Kubernetes service or an SSH tunnel (D72). Absent before 0.9. */
  via?: ListenerVia | null;
  /** The desktop application it belongs to (D72). */
  app?: ListenerApp | null;
  /** A package run as a tool (npx, a global install), not the project in its working directory (D72). */
  tool?: string | null;
  /** What to call it: the project name, or `repo @ branch` when worktrees of one repository are running side by side. */
  label: string;
  firstSeen: string;
  lastSeen: string;
}
