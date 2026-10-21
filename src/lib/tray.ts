// The observed tray, grouped (D73): your projects (one group per repository, its worktrees and branches together),
// apps on this machine, what each container tool forwards (a cluster's own components folded away), desktop apps'
// internal ports (folded away), and anything else. Pure, so it's tested under node.
import type { HttpAnswer, ObservedListener } from '../../shared/api.js';

export type TrayGroupKind = 'projects' | 'apps' | 'forwarded' | 'internal' | 'other';

/** A run of rows under one heading inside a group: a repository, a desktop app, a cluster's components. */
export interface TraySet {
  key: string;
  /** Null: the group's rows need no heading of their own (apps on this machine, a tool's containers). */
  title: string | null;
  /** The repository's directory, the app's bundle id… */
  detail: string | null;
  rows: ObservedListener[];
  /** Shut until opened: a cluster's own components. */
  folded: boolean;
}

export interface TrayGroup {
  key: string;
  kind: TrayGroupKind;
  title: string;
  /** What's in it, in a few words: "Containers and Kubernetes", "Internal ports of desktop apps". */
  blurb: string;
  sets: TraySet[];
  /** Every row, in order. */
  rows: ObservedListener[];
  /** Rows that answer with a web page. */
  pages: number;
  /** Shut until opened: desktop apps' internals, anything unidentified that isn't a page. */
  folded: boolean;
}

/** Pages first, then what you'd still open (a sign-in, a redirect), then APIs, then the rest. */
const ANSWER_ORDER: Record<HttpAnswer['kind'], number> = { page: 0, 'sign-in': 1, redirect: 2, api: 3, empty: 4, error: 5, 'not-http': 6 };

export const byAnswer = (a: ObservedListener, b: ObservedListener) => ANSWER_ORDER[a.answer.kind] - ANSWER_ORDER[b.answer.kind] || a.port - b.port;

/** What a folded group holds, in a few words: its sets' headings, else its rows' names. */
export function foldSummary(g: TrayGroup): string {
  const titles = g.sets.map((s) => s.title).filter((t): t is string => !!t);
  const names = titles.length ? titles : [...new Set(g.rows.map((o) => rowName(o)))];
  return names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
}

/** What the machine is called in headings. */
export function machineWord(platform: string | null | undefined): string {
  return platform === 'darwin' ? 'this Mac' : platform === 'win32' ? 'this PC' : 'this computer';
}

/** The repository (or project) a row belongs to, for grouping: worktrees of one repository share it. */
function repoKey(o: ObservedListener): { key: string; title: string; detail: string | null } {
  const id = o.identity;
  if (id.repo) return { key: `repo:${id.repo}`, title: id.repo, detail: null };
  if (id.projectDir) return { key: `dir:${id.projectDir}`, title: id.name ?? o.name, detail: id.projectDir };
  return { key: `port:${o.port}`, title: o.name, detail: null };
}

const pagesIn = (rows: ObservedListener[]) => rows.filter((r) => r.answer.kind === 'page').length;

function group(key: string, kind: TrayGroupKind, title: string, blurb: string, sets: TraySet[], folded = false): TrayGroup {
  for (const s of sets) s.rows.sort(byAnswer);
  // sets with pages first, then by how many rows
  sets.sort((a, b) => Number(a.folded) - Number(b.folded) || pagesIn(b.rows) - pagesIn(a.rows) || (a.title ?? '').localeCompare(b.title ?? ''));
  const rows = sets.flatMap((s) => s.rows);
  return { key, kind, title, blurb, sets, rows, pages: pagesIn(rows), folded };
}

/** The tray's groups, in order, empty ones left out. */
export function trayGroups(observed: readonly ObservedListener[], platform?: string | null): TrayGroup[] {
  const machine = machineWord(platform);
  const projects = new Map<string, TraySet>();
  const apps: ObservedListener[] = [];
  const tools = new Map<string, { name: string; containers: ObservedListener[]; cluster: ObservedListener[] }>();
  const internal: ObservedListener[] = [];
  const other: ObservedListener[] = [];

  for (const o of observed) {
    switch (o.role) {
      case 'project': {
        const r = repoKey(o);
        const s = projects.get(r.key) ?? { key: r.key, title: r.title, detail: r.detail, rows: [], folded: false };
        s.rows.push(o);
        projects.set(r.key, s);
        break;
      }
      case 'app':
        apps.push(o);
        break;
      case 'forwarded':
      case 'cluster': {
        const via = o.identity.via;
        const id = via ? (via.tool.id === 'kubernetes' ? 'kubernetes' : via.tool.id) : 'forwarded';
        const t = tools.get(id) ?? { name: via?.tool.name ?? 'Forwarded', containers: [], cluster: [] };
        (o.role === 'cluster' ? t.cluster : t.containers).push(o);
        tools.set(id, t);
        break;
      }
      case 'internal':
        internal.push(o);
        break;
      default:
        other.push(o);
    }
  }

  // a repository whose rows share one branch says it once, in its heading
  for (const s of projects.values()) {
    const branches = new Set(s.rows.map((o) => o.identity.branch));
    const [only] = branches;
    if (branches.size === 1 && only && s.rows.length > 1) s.detail = `@ ${only}`;
  }
  const out: TrayGroup[] = [];
  if (projects.size) out.push(group('projects', 'projects', 'Your projects', 'Dev servers in your repositories', [...projects.values()]));
  if (apps.length) out.push(group('apps', 'apps', `Apps on ${machine}`, 'Tools and services you run', [{ key: 'apps', title: null, detail: null, rows: apps, folded: false }]));
  for (const [id, t] of tools) {
    const sets: TraySet[] = [];
    if (t.containers.length) sets.push({ key: `${id}:containers`, title: null, detail: null, rows: t.containers, folded: false });
    if (t.cluster.length) sets.push({ key: `${id}:cluster`, title: 'Kubernetes', detail: 'The cluster’s own components', rows: t.cluster, folded: true });
    const what = id === 'ssh' ? 'Ports forwarded over SSH' : id === 'kubectl' ? 'kubectl port-forward' : id === 'kubernetes' ? 'The cluster’s own components' : t.cluster.length && t.containers.length ? 'Containers and Kubernetes' : t.cluster.length ? 'Kubernetes' : 'Containers';
    out.push(group(`forwarded:${id}`, 'forwarded', t.name, what, sets));
  }
  // one set, each row named by its app: a heading per app would only repeat the name
  if (internal.length) out.push(group('internal', 'internal', 'App internals', 'Ports desktop apps open for themselves', [{ key: 'internal', title: null, detail: null, rows: internal, folded: false }], true));
  if (other.length) out.push(group('other', 'other', 'Other', 'Couldn’t tell what these are', [{ key: 'other', title: null, detail: null, rows: other, folded: false }], !other.some((o) => o.answer.kind === 'page')));
  return out;
}

/** What it answers, in a word or three (D73). */
export function answerText(a: HttpAnswer): string {
  switch (a.kind) {
    case 'page':
      return 'Web page';
    case 'api':
      return 'API';
    case 'sign-in':
      return 'Needs sign-in';
    case 'redirect':
      return a.location ? `Redirects to ${shortLocation(a.location)}` : 'Redirects';
    case 'error':
      return `Error ${a.status}`;
    case 'empty':
      return a.status === 404 ? 'Nothing at /' : `HTTP ${a.status}`;
    default:
      return 'Not HTTP';
  }
}

/** A redirect's target, short: the path for a local one, the host for another site. */
export function shortLocation(loc: string): string {
  try {
    const u = new URL(loc, 'http://localhost');
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.pathname.length > 24 ? u.pathname.slice(0, 23) + '…' : u.pathname;
    return u.hostname;
  } catch {
    return loc.slice(0, 24);
  }
}

/** Worth an Open button: it answers HTTP with something a browser shows. */
export const openable = (o: ObservedListener) => o.answer.kind === 'page' || o.answer.kind === 'sign-in' || o.answer.kind === 'redirect';

/** The words for "exposed" (D73): where it can be reached from. */
export function exposureWords(machine: string) {
  return { label: 'On your network', detail: `Other devices can reach it: it listens on every network interface, not just ${machine}.` };
}

/** What a row is called outside a repository's set: a forward nothing could name says so, rather than repeating its
 *  tool and port. */
export function rowName(o: ObservedListener): string {
  const v = o.identity.via;
  return v && !v.container && !v.kubernetes && o.name === `${v.tool.name} :${o.port}` ? 'Unidentified forward' : o.name;
}

/** The line under a row's name: what's behind it, or where it runs. */
export function rowContext(o: ObservedListener, tildify: (p: string) => string): string | null {
  const id = o.identity;
  const via = id.via;
  if (via?.container) return via.container.image;
  if (via?.kubernetes && !via.kubernetes.system) return via.kubernetes.namespace ? `service in ${via.kubernetes.namespace}` : 'Kubernetes service';
  if (via?.host) return `via ${via.host}`;
  if (via) return null;
  if (id.app) return id.app.bundleId;
  const dir = id.projectDir ?? id.cwd;
  const where = id.repo ? id.repo + (id.branch ? ` @ ${id.branch}` : '') : dir && dir !== '/' ? tildify(dir) : null;
  if (id.tool) return where ? `${id.tool}, in ${where}` : id.tool;
  if (dir && dir !== '/') return tildify(dir);
  return id.supervisor ? id.supervisor.label : null;
}

/** A row's heading inside its set, and what goes under it. */
export interface RowLabel {
  title: string;
  /** The title is a branch or a script: set in the monospaced face. */
  mono: boolean;
  /** The rest of what tells it apart: the package in a monorepo, the branch, the image… */
  detail: string | null;
}

/**
 * How each row in a set is headed (D73). In a repository's set, what tells its rows apart: the package (a monorepo's
 * `mcp`), else the branch (a checkout and its worktrees), else, for several servers in one checkout, the script each
 * runs (`rig/a.mjs`). Elsewhere, the row's name and its context.
 */
export function rowLabels(set: TraySet, tildify: (p: string) => string = (p) => p): Map<string, RowLabel> {
  const out = new Map<string, RowLabel>();
  if (!set.key.startsWith('repo:') && !set.key.startsWith('dir:')) {
    for (const o of set.rows) out.set(o.id, { title: rowName(o), mono: false, detail: rowContext(o, tildify) });
    return out;
  }
  const sub = (o: ObservedListener) => (o.name !== set.title ? o.name : null);
  const together = new Map<string, number>();
  const key = (o: ObservedListener) => `${sub(o) ?? ''}\0${o.identity.branch ?? ''}`;
  for (const o of set.rows) together.set(key(o), (together.get(key(o)) ?? 0) + 1);
  const shared = set.detail?.startsWith('@ ') ? set.detail.slice(2) : null;
  for (const o of set.rows) {
    const branch = o.identity.branch === shared ? null : o.identity.branch;
    const script = o.identity.script ?? null;
    const crowded = (together.get(key(o)) ?? 0) > 1;
    if (crowded && script) out.set(o.id, { title: script, mono: true, detail: [sub(o), branch && `@ ${branch}`].filter(Boolean).join(' ') || null });
    else if (sub(o)) out.set(o.id, { title: sub(o)!, mono: false, detail: branch ? `@ ${branch}` : null });
    else if (branch) out.set(o.id, { title: branch, mono: true, detail: null });
    else out.set(o.id, { title: o.name, mono: false, detail: script });
  }
  return out;
}

/**
 * Everything a row can be found by, most telling first (the filter weights the first field): its name, then port,
 * page title, group, repository, branch, script, tool, desktop app, container and image, Kubernetes service,
 * forwarder, directory and process. One place, so the filter (and search, later) index the same things.
 */
export function searchFields(o: ObservedListener, group?: Pick<TrayGroup, 'title'> | null, short: (p: string | null) => string | null = (p) => p): (string | number | null | undefined)[] {
  const id = o.identity;
  const via = id.via;
  return [
    rowName(o),
    o.port,
    o.title,
    group?.title,
    id.repo,
    id.branch,
    id.script,
    id.tool,
    id.app?.name,
    via?.container?.name,
    via?.container?.image,
    via?.kubernetes?.name,
    via?.tool.name,
    short(id.projectDir ?? id.cwd),
    id.process,
    answerText(o.answer),
  ];
}
