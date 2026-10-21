// `hallway doctor`'s fronted-mode checks (docs/03-networking.md, "`hallway doctor`"; D47). Read-only, and they ask the
// real thing: Caddy's admin socket, a TLS handshake through the redirect, the system resolver. Each is a pass / warn /
// fail line with a fix.
import fs from 'node:fs';
import path from 'node:path';
import type { FrontingCheck, HallwayConfig } from '../../shared/api.js';
import { dataPaths, tildify } from '../config.js';
import { type FrontingEnv, type Platform, type Runner } from '../platform/index.js';
import { findTool } from '../platform/fronting.js';
import { isListening } from '../services/ports.js';
import { CADDY_LABEL, DNSMASQ_LABEL } from '../services/spec.js';
import type { Services } from '../services/index.js';
import type { Store } from '../store/index.js';
import { CaddyUnreachable, runningConfig, sameConfig } from './admin.js';
import { CA_NAME, caddyPaths } from './caddy.js';
import { publicPort, publicUrl } from './names.js';
import { frontingInfo } from './status.js';
import { httpProbe, isLoopback, readRoot, resolve, tlsProbe } from './probe.js';
import { MIN_CADDY, chosenCaddyPorts, isOurForwarder, isTrusted, lowPortsFor, portConflicts, versionAtLeast } from './setup.js';
import { conflictTitle, conflictsOf, containerOn, exposureText, holderText, whoHolds } from './conflicts.js';
import { currentTier, policyWarning } from './tiers.js';
import os from 'node:os';
import { forwards } from '../services/spec.js';
import { delegatedTlds, tldVerdict } from './tld.js';

/** A check (shared/api.ts): `info` is a fact worth knowing, neither a pass nor a problem. */
export type NetCheck = FrontingCheck;

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
    // an info line, not a problem: direct mode is the default. It's here so that someone whose browser said "refused" at
    // https://hallway.localhost learns why (D63)
    const f = frontingInfo(cfg, platform);
    if (f.unsupported) add({ id: 'networking', status: 'info', message: `local domains (fronted mode) are off: apps are linked as http://localhost:<port>. ${f.unsupported}` });
    else
      add({
        id: 'networking',
        status: 'info',
        message: `local domains are off (mode: direct), so nothing answers at ${f.dashboardUrl} or ${f.appUrl} (a browser says the connection was refused); apps are linked as http://localhost:<port>`,
        fix: '`hallway setup` turns them on, as User certificate unless you pick another tier: no administrator needed (it prints each step first; `hallway setup --print` shows the plan and runs nothing)',
      });
    return out;
  }
  const f = platform.fronting;
  const paths = caddyPaths(store.home);
  const base = cfg.domain.base;
  const dashboard = cfg.domain.dashboard;
  const custom = base !== 'localhost';
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

  const tier = currentTier(cfg);
  const https = cfg.proxy.scheme === 'https';
  const low = lowPortsFor(platform, tier, cfg);
  const pub = publicPort(cfg.proxy);
  const httpPort = low === 'none' ? cfg.proxy.httpPort : 80;
  const url = publicUrl(dashboard, cfg.proxy);
  const fenv: FrontingEnv = {
    setupDir: path.join(dataPaths(store.home).generated, 'setup'),
    rootCert: paths.rootCert,
    rootSha1: readRoot(paths.rootCert)?.sha1 ?? null,
    httpsPort: cfg.proxy.httpsPort,
    httpPort: cfg.proxy.httpPort,
    dnsPort: cfg.domain.dnsPort,
    base,
    userHome: deps.userHome,
    tools: f.detect(deps.env),
  };
  // macOS: the pf redirect an install from before the tiers has. With no forwarders yet it's still what serves 443
  const pf = f.lowPorts === 'sockets' && f.installed(fenv).redirect.some((p) => fs.existsSync(p));
  const forwarders = deps.services ? safeList(() => deps.services!.forwardersInstalled()) : null;
  if (pf)
    add({
      id: 'leftover-redirect',
      status: 'warn',
      message: forwarders?.length ? "the pf redirect an older Hallway installed (the hallway.pf LaunchDaemon and its anchor) is still there, and no longer used" : 'set up by an older Hallway, with a pf redirect run by root (the hallway.pf LaunchDaemon); launchd can hold 443 and 80 for Hallway now, with no root and nothing for another tool to switch off',
      fix: `\`hallway setup --trust ${tier}\` ${forwarders?.length ? 'removes it' : 'moves to launchd\'s sockets and removes it'} (it needs admin, this once)`,
    });
  if (low === 'sockets' && !(pf && !forwarders?.length) && deps.services && forwarders) {
    const want = forwards(cfg.proxy, cfg.proxy.scheme);
    const missing = want.filter((w) => !forwarders.includes(w.label));
    const statuses = await Promise.all(want.filter((w) => !missing.includes(w)).map(async (w) => ({ w, st: await helperStatus(deps.services!, w.label) })));
    const unloaded = statuses.filter((x) => x.st && !x.st.loaded).map((x) => x.w.label);
    const ports = https ? '443 and 80' : '80';
    if (missing.length) add({ id: 'low-ports', status: 'fail', message: `launchd isn't holding loopback ${ports} for Hallway: ${missing.map((m) => m.label).join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} installed`, fix: SETUP });
    else if (unloaded.length) add({ id: 'low-ports', status: 'fail', message: `${unloaded.join(', ')} ${unloaded.length === 1 ? "isn't" : "aren't"} loaded, so launchd isn't holding ${ports} for Hallway`, fix: SETUP });
    else add({ id: 'low-ports', status: 'pass', message: `${ports} on loopback: launchd, for hallway.caddy (${want.length} ${f.userServiceNoun}s)` });
  }
  // something else on 443/80 (D71): named, with its tool's own fix, and Caddy's port as the way to coexist
  const lowList = https ? [443, 80] : [80];
  const holdersOf = async () => {
    const { holders } = await whoHolds(platform, lowList.map((port) => ({ port, kind: 'standard' as const, oursIf: isOurForwarder })));
    return conflictsOf(holders, platform.id, containerOn(deps.query, deps.env, f.helperDirs, deps.userHome), deps.userHome);
  };
  const std = https ? 443 : 80;
  const alt = https ? cfg.proxy.httpsPort : cfg.proxy.httpPort;
  if (low !== 'none') {
    for (const c of await holdersOf())
      add({
        id: 'ports-80-443',
        status: 'fail',
        message: `${conflictTitle(c)}: ${holderText(c)}${c.addresses.length ? `, ${exposureText(c)}` : ''}`,
        fix: `${c.fix.join('; ')}. Or leave it running: \`hallway setup --port ${alt}\` puts links on Caddy's own port`,
      });
  } else if (chosenCaddyPorts(platform, cfg)) {
    // on Caddy's port by choice: say which, and whether the way back is open yet
    const held = await holdersOf();
    add({
      id: 'public-port',
      status: 'info',
      message: `links carry Caddy's own port, :${pub} (\`hallway setup --port ${alt}\`), so nothing is put on ${lowList.join(' and ')}${held.length ? `; ${held.map((c) => `${c.ports.join(' and ')} ${c.ports.length > 1 ? 'are' : 'is'} still held by ${c.tool?.name ?? c.process ?? 'another process'}`).join('; ')}` : `; ${std} is free now`}`,
      fix: held.length ? `${held[0].fix.join('; ')}; then \`hallway setup --port ${std}\`` : `\`hallway setup --port ${std}\` moves links to ${std}`,
    });
  }
  const via = low === 'sockets' && !(pf && !forwarders?.length) ? " through launchd's socket" : low !== 'none' ? ' through the redirect from 443' : '';
  const root = readRoot(paths.rootCert);
  if (https) {
    const t = await tlsProbe(pub, dashboard, root?.pem ?? null);
    const lsof = `\`sudo lsof -nP -iTCP:${pub} -sTCP:LISTEN\` names what holds it`;
    if (!t && (await isListening(pub, '127.0.0.1', 1000))) add({ id: 'redirect', status: 'fail', message: `something answers on 127.0.0.1:${pub}, but not with TLS: it isn't Hallway's Caddy`, fix: lsof });
    else if (!t) add({ id: 'redirect', status: 'fail', message: `nothing answers on 127.0.0.1:${pub}${low === 'redirect' ? `: the redirect from 443 to ${cfg.proxy.httpsPort} isn't in place` : low === 'sockets' ? `: launchd isn't passing it on to Caddy (\`launchctl print gui/$(id -u)/hallway.forward.https\` says why)` : ''}`, fix: SETUP });
    else if (!t.issuer?.startsWith(CA_NAME)) add({ id: 'redirect', status: 'fail', message: `something else answers on 127.0.0.1:${pub}, with a certificate from ${t.issuer ?? 'someone else'}, not Hallway's Caddy`, fix: `${lsof}. A container tool (Docker Desktop and the like) forwarding ${pub} is the usual culprit: turn that port forward off` });
    else if (!t.ours) add({ id: 'redirect', status: 'fail', message: `${url} answers with Hallway's CA, but its certificate doesn't verify (${t.error})`, fix: 'restart Caddy: `hallway setup`' });
    else add({ id: 'redirect', status: 'pass', message: `${url} reaches Hallway's Caddy${via}` });
    const h = await httpProbe(httpPort, dashboard);
    const plain = `http://${dashboard}${httpPort === 80 ? '' : `:${httpPort}`}`;
    if (h?.status === 308) add({ id: 'redirect-http', status: 'pass', message: `${plain} redirects to HTTPS` });
    else add({ id: 'redirect-http', status: 'warn', message: `${plain} ${h ? `answers HTTP ${h.status}, not a redirect to HTTPS` : "doesn't answer"}`, fix: SETUP });
  } else {
    const h = await httpProbe(pub, dashboard, 2000, '127.0.0.1', '/api/health');
    if (h) add({ id: 'redirect', status: 'pass', message: `${url} answers (plain HTTP${via})` });
    else add({ id: 'redirect', status: 'fail', message: `nothing answers at ${url}${low === 'sockets' ? `: launchd isn't passing port 80 on to Caddy (\`launchctl print gui/$(id -u)/hallway.forward.http\` says why)` : ''}`, fix: SETUP });
    add({ id: 'plain-http', status: 'info', message: "Safari won't keep Secure cookies over plain HTTP: an app that signs in with them won't stay signed in there", fix: platform.id === 'darwin' ? '`hallway setup --trust user` adds HTTPS, asking once for your own password or Touch ID' : `\`hallway setup --trust user\` adds HTTPS with no prompt (Chrome and Chromium trust it; links carry :${cfg.proxy.httpsPort})` });
  }

  // ---------------- certificates ----------------
  const systemTrusted = root ? await isTrusted({ platform, query: deps.query }, fenv) : false;
  const userTrusted = root && f.userTrusted ? await f.userTrusted(fenv, deps.query) : false;
  if (https) {
    if (!root) add({ id: 'ca', status: 'fail', message: `Hallway's certificate authority doesn't exist yet (${show(paths.rootCert)})`, fix: 'Caddy makes it when it starts: ' + SETUP });
    else if (tier === 'user') {
      if (userTrusted) add({ id: 'ca', status: 'pass', message: `Hallway's root is trusted for your account (${platform.id === 'darwin' ? 'your login keychain' : 'your NSS database, ~/.pki/nssdb'})` });
      else add({ id: 'ca', status: 'fail', message: `Hallway's certificate authority (${root.subject}) isn't trusted for your account: browsers will warn`, fix: '`hallway setup --trust user`' });
      if (platform.id === 'darwin')
        add({ id: 'ca-scope', status: 'info', message: "Not trusted system-wide: other accounts, and tools that bring their own CA list, won't trust it", fix: `Node: \`NODE_OPTIONS=--use-system-ca\`, or \`NODE_EXTRA_CA_CERTS=${show(paths.rootCert)}\`` });
      else add({ id: 'ca-scope', status: 'info', message: `Only Chrome and Chromium trust it; curl, Node and Firefox need ${show(paths.rootCert)}`, fix: `curl: \`--cacert ${show(paths.rootCert)}\`; Node: \`NODE_EXTRA_CA_CERTS=${show(paths.rootCert)}\`` });
    } else if (systemTrusted) add({ id: 'ca', status: 'pass', message: `Hallway's certificate authority (${root.subject}) is trusted by the system` });
    else add({ id: 'ca', status: 'fail', message: `Hallway's certificate authority (${root.subject}) isn't trusted by the system: browsers will warn`, fix: SETUP });
    if (root && firefoxInstalled(platform, deps.env))
      add({ id: 'firefox', status: 'warn', message: 'Firefox keeps its own certificate store', fix: 'in about:config, set security.enterprise_roots.enabled to true (or import the root from ' + show(paths.rootCert) + ')' });
  }
  // trusted as browsers check it (D72): a real verification of the served certificate, not "the root is in a store"
  if (https && root && f.osTrust && tier !== 'none' && out.some((c) => c.id === 'redirect' && c.status === 'pass')) {
    const v = await f.osTrust({ host: dashboard, port: pub }, tier, fenv, deps.query);
    if (v.trusted === true) add({ id: 'os-trust', status: 'pass', message: `${url}'s certificate is trusted by ${v.how} (if a browser still warns, quit and reopen it: Chrome can remember an error from before)` });
    else if (v.trusted === false) add({ id: 'os-trust', status: 'fail', message: `${url}'s certificate isn't trusted by ${v.how}: ${v.cause}. Browsers will warn`, fix: `\`hallway setup --trust ${tier}\` (it trusts Hallway's root again)` });
    else add({ id: 'os-trust', status: 'warn', message: `couldn't check ${url}'s certificate with ${v.how}: ${v.cause}` });
  }
  // a browser its organisation set to ignore certificates added to the OS (D72)
  if (https && f.browserPolicies && tier !== 'none') {
    const policies = await f.browserPolicies(os.userInfo().username, deps.query).catch(() => []);
    const w = policyWarning(policies, tier);
    if (w) add({ id: 'browser-policy', status: 'fail', message: w.split(' Use Safari')[0], fix: 'use Safari for these addresses, ask your IT team to allow certificates you add, or `hallway setup --trust none` (plain HTTP)' });
  }
  if (systemTrusted && tier !== 'system') add({ id: 'leftover-trust', status: 'warn', message: `Hallway's root is still trusted system-wide, which ${tier === 'none' ? 'No HTTPS' : 'User certificate'} doesn't use`, fix: `\`hallway setup --trust ${tier}\` removes it (it needs admin, this once)` });

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

function safeList(f: () => string[]): string[] | null {
  try {
    return f();
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
