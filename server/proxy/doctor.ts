// `hallway doctor`'s fronted-mode checks (docs/03-networking.md, "`hallway doctor`"; D47). Read-only, and they ask the
// real thing: Caddy's admin socket, a TLS handshake through the redirect, the system resolver. Each is a pass / warn /
// fail line with a fix.
import fs from 'node:fs';
import path from 'node:path';
import type { HallwayConfig } from '../../shared/api.js';
import { dataPaths, tildify } from '../config.js';
import { type FrontingEnv, type Platform, type Runner } from '../platform/index.js';
import { findTool } from '../platform/fronting.js';
import { isListening } from '../services/ports.js';
import { CADDY_LABEL, DNSMASQ_LABEL } from '../services/spec.js';
import type { Services } from '../services/index.js';
import type { Store } from '../store/index.js';
import { CaddyUnreachable, runningConfig, sameConfig } from './admin.js';
import { CA_NAME, caddyPaths } from './caddy.js';
import { httpsUrl } from './names.js';
import { httpProbe, isLoopback, readRoot, resolve, tlsProbe } from './probe.js';
import { MIN_CADDY, isTrusted, portConflicts, versionAtLeast } from './setup.js';
import { delegatedTlds, tldVerdict } from './tld.js';

export interface NetCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  fix?: string;
}

export interface NetDeps {
  store: Store;
  platform: Platform;
  services: Services | null;
  query: Runner;
  env: NodeJS.ProcessEnv;
  userHome: string;
  /** For tests. */
  tlds?: Set<string> | null;
}

const SETUP = '`hallway setup` (it only fixes what is missing)';

export async function networkChecks(deps: NetDeps): Promise<NetCheck[]> {
  const { store, platform } = deps;
  const cfg: HallwayConfig = store.currentConfig();
  const out: NetCheck[] = [];
  const add = (c: NetCheck) => out.push(c);
  if (cfg.mode === 'direct') {
    add({ id: 'networking', status: 'skip', message: 'fronted mode is off (mode: direct): apps are linked as http://localhost:<port>', fix: '`hallway setup` turns on https://<app>.localhost' });
    return out;
  }
  const f = platform.fronting;
  const paths = caddyPaths(store.home);
  const base = cfg.domain.base;
  const dashboard = cfg.domain.dashboard;
  const custom = base !== 'localhost';
  const noRedirect = cfg.proxy.publicPort === cfg.proxy.httpsPort;
  const show = (p: string) => tildify(p);

  // ---------------- Caddy ----------------
  const caddy = cfg.proxy.caddy ?? findTool('caddy', deps.env.PATH, f.helperDirs);
  if (!caddy) {
    const how = f.installHelper('caddy', deps.env);
    add({ id: 'caddy', status: 'fail', message: "Caddy isn't installed (or isn't on your PATH)", fix: 'advice' in how ? how.advice : `\`${how.cmd.join(' ')}\`, then ${SETUP}` });
  }
  else {
    const r = await deps.query(caddy, ['version']);
    const v = r.code === 0 ? r.stdout.trim().split(/\s+/)[0] : null;
    if (!versionAtLeast(v, MIN_CADDY)) add({ id: 'caddy', status: 'fail', message: `Caddy ${v ?? '(unknown version)'} at ${caddy} is older than ${MIN_CADDY.join('.')}`, fix: 'upgrade Caddy' });
    else add({ id: 'caddy', status: 'pass', message: `Caddy ${v} (${caddy})` });
  }
  if (deps.services) {
    const st = await helperStatus(deps.services, CADDY_LABEL);
    if (!st) add({ id: 'caddy-service', status: 'skip', message: "can't ask the service manager about Hallway's Caddy (see above)" });
    else if (!st.installed) add({ id: 'caddy-service', status: 'fail', message: `Hallway's Caddy isn't installed as a ${f.userServiceNoun} (${CADDY_LABEL})`, fix: SETUP });
    else if (!st.running) add({ id: 'caddy-service', status: 'fail', message: `Hallway's Caddy (${CADDY_LABEL}) is installed but not running${st.lastExitCode !== null ? ` (last exit status ${st.lastExitCode})` : ''}`, fix: `its log is ${show(path.join(dataPaths(store.home).logs, 'caddy.err.log'))}; ${SETUP} restarts it` });
    else add({ id: 'caddy-service', status: 'pass', message: `Hallway's Caddy is running (${CADDY_LABEL}, pid ${st.pid})` });
  }
  let running: unknown = null;
  try {
    running = await runningConfig(paths.socket);
    const file = readJson(paths.config);
    if (!file) add({ id: 'caddy-config', status: 'warn', message: `${show(paths.config)} is missing`, fix: 'the daemon writes it when it runs in fronted mode: `hallway service restart`' });
    else if (!sameConfig(running, file)) add({ id: 'caddy-config', status: 'warn', message: `Caddy's running configuration isn't ${show(paths.config)}`, fix: 'the daemon pushes it on every change; is the daemon running? (`hallway service restart`)' });
    else add({ id: 'caddy-config', status: 'pass', message: `Caddy has the daemon's current configuration (its admin API is the private socket ${show(paths.socket)})` });
  } catch (e) {
    add({ id: 'caddy-config', status: 'fail', message: e instanceof CaddyUnreachable ? `Caddy's admin API isn't answering on ${show(paths.socket)}` : (e as Error).message, fix: SETUP });
  }
  const socketMode = safeMode(paths.socket);
  if (socketMode !== null && (socketMode & 0o077) !== 0) add({ id: 'caddy-socket', status: 'fail', message: `Caddy's admin socket ${show(paths.socket)} is reachable by other users (mode ${socketMode.toString(8)})`, fix: 'Caddy 2.7 or later makes it 0600; upgrade Caddy, then `hallway service restart`' });

  // ---------------- the ports ----------------
  const ours = (cmd: string) => cmd.includes(paths.config);
  const { conflicts: held } = await portConflicts(platform, [
    { port: cfg.proxy.httpsPort, what: 'proxy.httpsPort', oursIf: ours },
    { port: cfg.proxy.httpPort, what: 'proxy.httpPort', oursIf: ours },
  ]);
  for (const c of held) add({ id: 'caddy-ports', status: 'fail', message: c, fix: 'stop it, or pick other ports in config.yaml (proxy.httpsPort, proxy.httpPort), then ' + SETUP });

  const root = readRoot(paths.rootCert);
  const [https, http] = noRedirect ? [cfg.proxy.httpsPort, cfg.proxy.httpPort] : [443, 80];
  if (!noRedirect) {
    const { conflicts } = await portConflicts(platform, [
      { port: 443, what: 'HTTPS' },
      { port: 80, what: 'HTTP' },
    ]);
    for (const c of conflicts)
      add({ id: 'ports-80-443', status: 'fail', message: c, fix: "stop it: Hallway's redirect takes loopback 80 and 443 before it can see them. A container tool (Docker Desktop, Rancher Desktop, Colima, Lima) forwarding 80/443 is the usual culprit: turn that port forward off" });
  }
  const t = await tlsProbe(https, dashboard, root?.pem ?? null);
  const url = httpsUrl(dashboard, https);
  if (!t && (await isListening(https, '127.0.0.1', 1000)))
    add({ id: 'redirect', status: 'fail', message: `something answers on 127.0.0.1:${https}, but not with TLS: it isn't Hallway's Caddy`, fix: `\`sudo lsof -nP -iTCP:${https} -sTCP:LISTEN\` names what holds it` });
  else if (!t) add({ id: 'redirect', status: 'fail', message: `nothing answers on 127.0.0.1:${https}${noRedirect ? '' : `: the redirect from 443 to ${cfg.proxy.httpsPort} isn't in place`}`, fix: SETUP });
  else if (!t.issuer?.startsWith(CA_NAME)) add({ id: 'redirect', status: 'fail', message: `127.0.0.1:${https} answers with a certificate from ${t.issuer ?? 'someone else'}, not Hallway's Caddy`, fix: `\`sudo lsof -nP -iTCP:${https} -sTCP:LISTEN\` names what holds it` });
  else if (!t.ours) add({ id: 'redirect', status: 'fail', message: `${url} answers with Hallway's CA, but its certificate doesn't verify (${t.error})`, fix: 'restart Caddy: `hallway setup`' });
  else add({ id: 'redirect', status: 'pass', message: `${url} reaches Hallway's Caddy${noRedirect ? '' : ' through the redirect from 443'}` });
  const h = await httpProbe(http, dashboard);
  if (h?.status === 308) add({ id: 'redirect-http', status: 'pass', message: `http://${dashboard}${http === 80 ? '' : `:${http}`} redirects to HTTPS` });
  else add({ id: 'redirect-http', status: 'warn', message: `http://${dashboard}${http === 80 ? '' : `:${http}`} ${h ? `answers HTTP ${h.status}, not a redirect to HTTPS` : "doesn't answer"}`, fix: SETUP });

  // ---------------- certificates ----------------
  const fenv: FrontingEnv = {
    setupDir: path.join(dataPaths(store.home).generated, 'setup'),
    rootCert: paths.rootCert,
    rootSha1: root?.sha1 ?? null,
    httpsPort: cfg.proxy.httpsPort,
    httpPort: cfg.proxy.httpPort,
    dnsPort: cfg.domain.dnsPort,
    base,
    userHome: deps.userHome,
    tools: f.detect(deps.env),
  };
  if (!root) add({ id: 'ca', status: 'fail', message: `Hallway's certificate authority doesn't exist yet (${show(paths.rootCert)})`, fix: 'Caddy makes it when it starts: ' + SETUP });
  else if (await isTrusted({ platform, query: deps.query }, fenv)) add({ id: 'ca', status: 'pass', message: `Hallway's certificate authority (${root.subject}) is trusted by the system` });
  else add({ id: 'ca', status: 'fail', message: `Hallway's certificate authority (${root.subject}) isn't trusted by the system: browsers will warn`, fix: SETUP });
  if (root && firefoxInstalled(platform, deps.env))
    add({ id: 'firefox', status: 'warn', message: 'Firefox keeps its own certificate store', fix: 'in about:config, set security.enterprise_roots.enabled to true (or import the root from ' + show(paths.rootCert) + ')' });

  // ---------------- names ----------------
  if (!custom) {
    const a = await resolve(`hallway-doctor.${base}`);
    if (a.length && a.every(isLoopback)) add({ id: 'dns', status: 'pass', message: '*.localhost resolves to loopback' });
    else add({ id: 'dns', status: 'warn', message: `the system resolver doesn't resolve *.localhost${a.length ? ` to loopback (${a.join(', ')})` : ''}: browsers do it themselves, but curl and other tools may not`, fix: platform.id === 'linux' ? 'systemd-resolved (or nss-myhostname) resolves *.localhost' : undefined });
  } else {
    const v = tldVerdict(base, deps.tlds !== undefined ? deps.tlds : await delegatedTlds(dataPaths(store.home).cache));
    add({ id: 'tld', status: v.verdict === 'ok' ? 'pass' : v.verdict === 'warn' ? 'warn' : 'fail', message: `${base}: ${v.reason}`, fix: v.verdict === 'ok' ? undefined : 'a name under .internal, e.g. myname.internal: `hallway setup --domain myname.internal`' });
    if (deps.services) {
      const st = await helperStatus(deps.services, DNSMASQ_LABEL);
      if (!st) add({ id: 'dnsmasq', status: 'skip', message: "can't ask the service manager about Hallway's dnsmasq (see above)" });
      else if (!st.running) add({ id: 'dnsmasq', status: 'fail', message: `Hallway's dnsmasq (${DNSMASQ_LABEL}) isn't running`, fix: SETUP });
      else add({ id: 'dnsmasq', status: 'pass', message: `Hallway's dnsmasq is running (pid ${st.pid})` });
    }
    const listeners = (await platform.listListeners()).filter((l) => l.port === cfg.domain.dnsPort);
    if (listeners.length && listeners.every((l) => isLoopback(l.address))) add({ id: 'dnsmasq-bind', status: 'pass', message: `dnsmasq listens on loopback only (127.0.0.1:${cfg.domain.dnsPort})` });
    else if (listeners.length) add({ id: 'dnsmasq-bind', status: 'fail', message: `something on port ${cfg.domain.dnsPort} listens beyond loopback (${listeners.map((l) => l.address).join(', ')}): an open resolver on your network`, fix: `stop it; Hallway's dnsmasq binds 127.0.0.1 only` });
    const installed = f.installed(fenv).resolver.filter((p) => fs.existsSync(p));
    if (!installed.length) add({ id: 'resolver', status: 'fail', message: `the system resolver isn't pointed at Hallway's dnsmasq for ${base}`, fix: SETUP });
    for (const name of [base, `hallway-doctor.${base}`]) {
      const a = await resolve(name);
      if (a.length && a.every(isLoopback)) add({ id: 'resolve', status: 'pass', message: `${name} resolves to loopback` });
      else add({ id: 'resolve', status: 'fail', message: `${name} ${a.length ? `resolves to ${a.join(', ')}, not loopback` : "doesn't resolve"}`, fix: SETUP });
    }
  }
  return out;
}

async function helperStatus(services: Services, label: string) {
  try {
    return await services.status(label);
  } catch {
    return null;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeMode(file: string): number | null {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return null;
  }
}

function firefoxInstalled(platform: Platform, env: NodeJS.ProcessEnv): boolean {
  if (platform.id === 'darwin') return fs.existsSync('/Applications/Firefox.app');
  return !!findTool('firefox', env.PATH, ['/usr/bin', '/usr/local/bin', '/snap/bin']);
}
