// Types shared by the daemon (server/) and the dashboard (src/). Keep this file free of imports and of anything that
// needs Node or the DOM: it's compiled by both tsconfigs.
//
// These are the HTTP API's contract (docs/02-architecture.md, "HTTP API"). The dashboard builds against them, and the
// scanner, prober and uptime modules fill the slots marked "provider" (server/providers.ts), so change them only by
// adding optional fields. Times are ISO 8601 strings; durations are milliseconds; paths are absolute unless the field
// says otherwise.

/** `GET /api/health`: the daemon's own health (docs/02-architecture.md, "HTTP API"). */
export interface HealthResponse {
  ok: true;
  version: string;
}

/** An app's health classification (docs/04-apps-health-services.md, "Health states"; D12). */
export type AppState = 'healthy' | 'unhealthy' | 'down' | 'stopped' | 'unknown';

/** Where an app came from (D11). */
export type AppSource = 'declared' | 'discovered' | 'observed';

/** `expected:` in an app file: should it always be up, is it off on purpose, or is it up only sometimes (D12)? */
export type Expected = 'running' | 'stopped' | 'adhoc';

/** `mode:` in config.yaml (docs/03-networking.md): links to `localhost:<port>`, or Caddy in front (v1). */
export type Mode = 'direct' | 'fronted';

// ---------------------------------------------------------------------------------------------------------------
// Problems with the files in the data home
// ---------------------------------------------------------------------------------------------------------------

/**
 * Something wrong with a file in the data home: a YAML syntax error or a validation error (`severity: 'error'`: the
 * entity keeps its last good version, if it had one), or something worth knowing that doesn't stop it working
 * (`'warning'`: an unknown key, which is kept; two apps on one port).
 */
export interface FileProblem {
  severity: 'error' | 'warning';
  /** The file, relative to the data home, with `/` separators: `apps/foo.yaml`, `config.yaml`. */
  file: string;
  /** The absolute path, e.g. for an "open in editor" link. */
  path: string;
  /** 1-based line and column, when the problem can be pinned to a place in the file. */
  line?: number;
  col?: number;
  /** The key it concerns, as a dotted path (`health.path`, `links.0.url`), when there is one. */
  key?: string;
  message: string;
}

// ---------------------------------------------------------------------------------------------------------------
// The files' contents, after validation and defaults (docs/02-architecture.md, "File formats")
// ---------------------------------------------------------------------------------------------------------------

export interface AppHealthCheck {
  path: string;
  /** Null: any 2xx. */
  expectStatus: number | null;
}

export interface AppProxy {
  preserveHost: boolean;
  aliases: string[];
}

export interface AppService {
  command: string[];
  cwd: string | null;
  env: Record<string, string>;
  runAtLoad: boolean;
  keepAlive: boolean;
}

export interface AppLink {
  label: string;
  /** A path on the app (`/api`) or a full URL; exactly one of the two. */
  path?: string;
  url?: string;
}

/** `apps/<slug>.yaml`, with defaults applied. Unknown keys are kept in the file but not shown here. */
export interface AppConfig {
  name: string;
  description: string | null;
  port: number;
  host: string;
  expected: Expected;
  /** Null: probe `GET /`. */
  health: AppHealthCheck | null;
  proxy: AppProxy;
  /** Null: not a managed service. */
  service: AppService | null;
  links: AppLink[];
  project: { dir: string | null; repo: string | null } | null;
  tags: string[];
  icon: string;
}

export interface BookmarkLink {
  title: string;
  url: string;
  description: string | null;
  icon: string;
  tags: string[];
}

/** `bookmarks/<group>.yaml`, with defaults applied. */
export interface BookmarkGroupConfig {
  title: string;
  order: number;
  collapsed: boolean;
  links: BookmarkLink[];
}

/** `ignore.yaml`. */
export interface IgnoreConfig {
  ports: number[];
  processes: string[];
  dirs: string[];
}

export type DashboardSection = 'apps' | 'observed' | 'bookmarks';

/** `config.yaml`, with defaults applied. */
export interface HallwayConfig {
  version: 1;
  port: number;
  mode: Mode;
  domain: { base: string; dashboard: string; tls: boolean };
  probe: { intervalSeconds: number; liveIntervalSeconds: number; timeoutMs: number; concurrency: number; failuresBeforeUnhealthy: number };
  ports: { assignRange: [number, number] };
  services: { startGraceSeconds: number; logMaxBytes: number; logGenerations: number };
  scan: { enabled: boolean; intervalSeconds: number; includeEphemeralPorts: boolean; minPort: number };
  thumbnails: { mode: 'favicon' | 'screenshot' | 'card' };
  dashboard: { title: string | null; sections: DashboardSection[]; theme: 'auto' | 'dark' | 'light' };
}

// ---------------------------------------------------------------------------------------------------------------
// Live data. The daemon core owns none of it: providers (server/providers.ts) fill it in. With no provider
// registered, health is `unknown` and every other slot is null or empty.
// ---------------------------------------------------------------------------------------------------------------

/** An app's current health. Provider: the prober. */
export interface AppHealth {
  state: AppState;
  /** A managed service inside its start grace period (shown as `◐ starting`), v1. */
  starting?: boolean;
  /** When the app entered `state`. */
  since: string | null;
  /** The last probe. */
  checkedAt: string | null;
  /** The last probe's HTTP status, if it got that far. */
  httpStatus: number | null;
  /** The last probe's latency (time to response headers). */
  latencyMs: number | null;
  /** A short explanation for people: "connection refused", "HTTP 502", "timed out after 5000 ms". */
  detail: string | null;
  /** Uptime over the last 24 h, 0–1, excluding stopped time; null with no data. */
  uptime24h: number | null;
  /** Median latency over the last 24 h. */
  latencyP50: number | null;
}

export type HistoryWindow = '24h' | '7d' | '90d';

/** One bar of an uptime bar. */
export interface UptimeBucket {
  start: string;
  end: string;
  /** The period's worst significant state; `nodata` when the daemon wasn't running (a gap, never "down"). */
  state: AppState | 'nodata';
  /** 0–1, excluding stopped time; null with no data. */
  uptime: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
}

/** Uptime and latency over a window. Provider: the uptime store. */
export interface AppHistory {
  window: HistoryWindow;
  buckets: UptimeBucket[];
  uptime: number | null;
  latency: { p50: number | null; p95: number | null; max: number | null };
}

/** What is known about the process behind a listening port. Provider: the scanner. Every field is best effort. */
export interface ListenerIdentity {
  pid: number | null;
  ppid: number | null;
  /** The process name (`node`, `python3`). */
  process: string | null;
  /** The full command line. */
  command: string | null;
  cwd: string | null;
  /** The nearest directory above `cwd` with a package.json, pyproject.toml, Cargo.toml, go.mod or .git. */
  projectDir: string | null;
  /** From package.json, else the README's first heading, else the directory name. */
  name: string | null;
  description: string | null;
  /** The repository's name (its top-level directory, or the parent repository's for a worktree). */
  repo: string | null;
  branch: string | null;
  worktree: boolean;
  lastCommitAt: string | null;
  /** A guess: `vite`, `astro`, `next`, `express`, `flask`, … */
  framework: string | null;
  /** The address it's bound to: `127.0.0.1`, `::1`, `*`, `0.0.0.0`. */
  bindAddress: string | null;
  /** Listening on every interface, not just loopback. */
  exposed: boolean;
  /** Its parent is PID 1: the session that started it is gone. */
  orphaned: boolean;
  startedAt: string | null;
  /** `repo @ branch` for worktree siblings, else null (docs/04, step 5). */
  label: string | null;
}

/** A listener the scanner found that is neither declared nor discovered. Provider: the scanner. */
export interface ObservedListener {
  /** Stable across restarts: a hash of project root, port and normalised command (docs/04, step 6). */
  id: string;
  port: number;
  /** Did `GET /` get an HTTP answer? Listeners that didn't go in the collapsed "other listeners" group. */
  http: boolean;
  httpStatus: number | null;
  /** The page's `<title>`. */
  title: string | null;
  /** A favicon URL found on the page, if any. */
  favicon: string | null;
  firstSeen: string;
  lastSeen: string;
  identity: ListenerIdentity;
  /** A slug to pre-fill the Claim form with. */
  suggestedSlug: string | null;
}

/** An app read from another tool's registry (docs/04, "Discovered apps"). Provider: a discovery adapter. */
export interface DiscoveredApp {
  slug: string;
  name: string;
  port: number;
  host: string;
  /** The adapter's id, e.g. `paddock-pm`. */
  adapter: string;
  cwd: string | null;
  command: string | null;
  /** What the other tool says about it (`online`, `stopped`, …), verbatim. */
  status: string | null;
  url: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------------------------------------------

/** An app as the dashboard shows it: `GET /api/apps`, `/api/apps/:slug`, and `apps` in `/api/state`. */
export interface AppView {
  slug: string;
  source: AppSource;
  /** For discovered apps: the adapter's id. */
  adapter: string | null;
  /** `config.name`, or the slug when the file has never been valid. */
  name: string;
  /** Where to open it: `http://localhost:<port>` in direct mode, `https://<slug>.<base>` in fronted mode. */
  url: string | null;
  /**
   * The validated contents (declared apps). While the file is broken this is the last good version, or null if it has
   * never been valid since the daemon started.
   */
  config: AppConfig | null;
  /** For If-Match: the hash of the file's current bytes. Null for apps without a file. */
  etag: string | null;
  /** The file, relative to the data home (`apps/foo.yaml`), and its absolute path. */
  file: string | null;
  path: string | null;
  /** Errors and warnings for this app's file (the error, if any, is first). */
  problems: FileProblem[];
  /** A managed service (has a `service:` block). */
  managed: boolean;
  /** Provider slots: see "Live data" above. */
  health: AppHealth;
  /** The last 24 h, in `/api/state` and `/api/apps/:slug`; null without an uptime provider. */
  history: AppHistory | null;
  /** The process listening on the app's port, if the scanner knows it. */
  identity: ListenerIdentity | null;
}

/** A bookmark group: `GET /api/bookmarks` (`groups`), and `bookmarks` in `/api/state`. Sorted by order, then title. */
export interface BookmarkGroupView {
  /** The file name without `.yaml`. */
  group: string;
  /** While the file is broken, the last good version, or null. */
  config: BookmarkGroupConfig | null;
  etag: string | null;
  file: string;
  path: string;
  problems: FileProblem[];
}

/** `GET /api/config`, and `config` in `/api/state`. */
export interface ConfigView {
  /** The validated config with defaults (the last good version while the file is broken; defaults if never good). */
  config: HallwayConfig;
  etag: string | null;
  file: string;
  path: string;
  problems: FileProblem[];
}

/** About the running daemon. */
export interface DaemonInfo {
  version: string;
  /** The URL this request reached the daemon on: `http://localhost:4255`. */
  url: string;
  /** The data home, absolute, and as people see it (`~/.hallway`). */
  dataHome: string;
  dataHomeDisplay: string;
  startedAt: string;
  platform: string;
  /** Which providers are plugged in, so the dashboard can say "health checks aren't running" rather than show grey. */
  providers: { health: boolean; history: boolean; scanner: boolean; discovery: boolean };
}

/** `GET /api/state`: everything the dashboard needs in one call. */
export interface StateResponse {
  daemon: DaemonInfo;
  config: ConfigView;
  /** Declared apps, then discovered ones, sorted by name. */
  apps: AppView[];
  bookmarks: BookmarkGroupView[];
  /** Observed listeners, minus `ignore.yaml` (the scanner applies it). */
  observed: ObservedListener[];
  ignore: IgnoreConfig;
  /** Every error and warning in the data home, including those already attached to an app or group. */
  problems: FileProblem[];
}

/** `GET /api/apps`. */
export interface AppsResponse {
  apps: AppView[];
}

/** `GET /api/bookmarks`. */
export interface BookmarksResponse {
  groups: BookmarkGroupView[];
}

/** `GET /api/observed`. */
export interface ObservedResponse {
  observed: ObservedListener[];
}

/** The body of a 4xx/5xx. `issues` lists validation failures; `etag` comes with a 409 so the client can re-read. */
export interface ErrorResponse {
  error: string;
  issues?: { key: string; message: string }[];
  etag?: string | null;
}

/** `POST /api/observed/:id/claim`. */
export interface ClaimRequest {
  slug: string;
  name?: string;
  expected?: Expected;
}

/** `POST /api/observed/:id/ignore`: hide it by its port, its process name or its directory. */
export interface IgnoreRequest {
  by: 'port' | 'process' | 'dir';
}

// ---------------------------------------------------------------------------------------------------------------
// Live updates: `GET /api/events` (docs/02-architecture.md, "Live updates")
// ---------------------------------------------------------------------------------------------------------------

/**
 * The `data` of a `change` event on `/api/events`. A hint about what to refetch, never the data itself. The stream
 * opens with a `hello` event (`{ t: <ms since epoch> }`) and sends a `: ping` comment every 25 s.
 */
export type ServerEvent =
  /** `apps/<slug>.yaml` changed, was removed, or became invalid. */
  | { type: 'app'; slug: string; reason: 'config' | 'removed' | 'error' }
  /** The list of apps changed (a file appeared or went, or a discovery source changed). */
  | { type: 'apps'; reason: string }
  /** A health transition (not every probe). */
  | { type: 'state'; slug: string; state: AppState }
  | { type: 'bookmarks'; group?: string }
  | { type: 'observed'; reason: 'scan' | 'claimed' | 'ignored' }
  | { type: 'thumb'; slug: string }
  | { type: 'config' }
  /** v1. */
  | { type: 'reboot'; lost: string[] };
