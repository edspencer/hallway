// What a listener is, for people (D72): what it answers (a page, an API, a sign-in…), where it belongs in the tray
// (a project, an app on this machine, something forwarded, a cluster's own components, a desktop app's internals) and
// what to call it, the most specific name first. Pure: everything comes from the observation.
import type { HttpAnswer, ListenerRole } from '../../shared/api.js';
import type { Observation } from './types.js';
import { fallbackName } from './observations.js';

/** Names that say nothing about what a project is: a directory called `service` or `app`, a bare protocol or runtime. */
const GENERIC = /^(app|apps|application|service|services|server|srv|web|www|site|api|backend|frontend|front|back|client|ui|src|dist|build|public|static|mobile|data|main|default|dev|demo|test|tmp|temp|ssh|http|node|nodejs|python[\d.]*|ruby|java|go|deno|bun|runner|worker|daemon|helper)$/i;

export const isGenericName = (name: string | null | undefined) => !name || GENERIC.test(name.trim());

/** Paths a sign-in sends you to. */
const SIGN_IN = /(log-?in|sign-?in|auth|oauth|sso|session|account|saml|openid|cas\/)/i;

/** What `GET /` said, as a kind (D72). */
export function answerOf(http: Observation['http']): HttpAnswer {
  if (!http) return { kind: 'not-http', status: null, tls: false, location: null };
  const { status } = http;
  const type = http.contentType ?? null;
  const location = http.location ?? null;
  const base = { status, tls: !!http.tls, location };
  if (status === 401 || status === 403 || status === 407) return { kind: 'sign-in', ...base };
  if (status >= 300 && status < 400) return { kind: location && SIGN_IN.test(location) ? 'sign-in' : 'redirect', ...base };
  if (status >= 500) return { kind: 'error', ...base };
  const html = type ? /html/.test(type) : http.title !== null;
  if (status >= 200 && status < 300) return { kind: html ? 'page' : 'api', ...base };
  // 404 and other 4xx: a web server with nothing at `/` (an API usually says so in JSON)
  return { kind: type && /json|xml/.test(type) ? 'api' : 'empty', ...base };
}

const isDotDir = (dir: string, home: string) => dir.startsWith(home + '/.') || dir.startsWith(home + '\\.');

/** Where it belongs in the tray (D72). */
export function roleOf(o: Observation, home: string): ListenerRole {
  if (o.via) return o.via.tool.id === 'kubernetes' || o.via.kubernetes?.system ? 'cluster' : 'forwarded';
  if (o.app) return 'internal';
  if (o.tool) return 'app';
  if (o.project) return isDotDir(o.project.root, home) ? 'app' : 'project';
  if (o.supervisor) return 'app';
  if (o.http?.title || fallbackName(o)) return 'app';
  return 'other';
}

/**
 * What to call it, most specific first (D72): the container or Kubernetes service behind a forwarder; a desktop app's
 * name; a tool's page title or package; a project's name, unless it says nothing (`service`, `app`), when the page's
 * title does better; with no project, the supervisor or executable (D62) unless that says nothing either, then the
 * title; else the process and port.
 */
export function nameOf(o: Observation): string {
  const title = o.http?.title?.trim() || null;
  const v = o.via;
  if (v?.container) return v.container.name;
  if (v?.kubernetes) return v.kubernetes.system ? `Kubernetes ${v.kubernetes.name}` : v.kubernetes.name;
  if (v) return title ?? (v.tool.id === 'ssh' && v.host ? `Tunnel to ${v.host}` : `${v.tool.name} :${o.port}`);
  if (o.app) return o.app.name;
  if (o.tool) return title ?? o.tool;
  if (o.project) return !isGenericName(o.project.name) ? o.project.name : (title ?? o.project.name);
  // no project: the supervisor or executable (D62), unless that says nothing either (`ssh`, `app`)
  const fallback = fallbackName(o);
  if (fallback && !isGenericName(fallback)) return fallback;
  return title ?? fallback ?? `${o.process ?? 'unknown'} :${o.port}`;
}

/** Where to open it. */
export const openUrlOf = (o: Pick<Observation, 'port' | 'http'>) => `${o.http?.tls ? 'https' : 'http'}://localhost:${o.port}`;

/**
 * What to call each listener. Worktree siblings (listeners from different checkouts of one repository) become
 * `repo @ branch`, so three copies of one dashboard on three ports can be told apart; a lone linked worktree is
 * labelled the same way. Everything else is `nameOf` (D72): the container behind a forwarder, the desktop app, the
 * project's name (or the page's title when the name says nothing), else its supervisor's label or its executable
 * (`fallbackName`), else its process name and port.
 */
export function labelListeners(list: Observation[]): void {
  const checkouts = new Map<string, Set<string>>();
  for (const l of list) {
    if (!l.git || l.via || l.app || l.tool) continue;
    const s = checkouts.get(l.git.commonDir) ?? new Set();
    s.add(l.git.toplevel);
    checkouts.set(l.git.commonDir, s);
  }
  for (const l of list) {
    const g = l.git;
    if (g && g.branch && !l.via && !l.app && !l.tool && (g.worktree || (checkouts.get(g.commonDir)?.size ?? 0) > 1)) l.label = `${g.repo} @ ${g.branch}`;
    else l.label = nameOf(l);
  }
}
