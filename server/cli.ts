#!/usr/bin/env node
// `hallway [command] …`: the command-line entry point (the package's bin; `npm run hallway -- …` from a checkout).
// With no command it runs the daemon in the foreground (`serve`). The full command set is docs/07-cli.md; commands
// arrive milestone by milestone (docs/08-roadmap.md).
import { DEFAULT_PORT, HOME, ROOT, VERSION, dataPaths, devOverrides, parsePort, tildify } from './config.js';
import { UsageError, check, parseArgs } from './args.js';
import { DEFAULT_URL, agentGuide, readGuide, snippet } from './guide.js';

const USAGE = `Usage: hallway [command] [options]

Daemon
  serve [--port <n>] [--quiet]      (the default) Run the daemon in the foreground: the dashboard and API on
                                    http://localhost:<port> (127.0.0.1 only). If Hallway already answers on
                                    the port, it says where and exits.
          --port <n>       the port (default ${DEFAULT_PORT}, or $PORT, or port: in config.yaml)
          --quiet, -q      print just the "Hallway on <url>" line: no banner, no hints (the banner
                           is only shown on a terminal anyway)
  open                              Open the dashboard in your browser.
  service install                   Run the daemon as a service (a LaunchAgent / systemd user unit).
  service uninstall | status | restart

Apps and discovery
  status [slug] [--json]            Every app's state, address, port and uptime.
  scan [--json]                     Look for listeners nobody has named.
  claim <port|id> [--slug S] [--name N] [--expected E]
                                    Turn an observed listener into a declared app.
  ignore <port|id> [--by port|process|dir]
                                    Hide an observed listener.
  lost [--json]                     What was running before the last reboot and isn't now.
  lost restart|service <id|port> [--slug S]
                                    Start one again: once, or as a service. (Like \`hallway run\`.)
  lost dismiss <id|port> | --all    Clear one, or the whole notice.
  app add <slug> [--port N] [--name N] [--expected E] [--health PATH]
  app ls [--json] | app edit <slug> | app rm <slug>

Running servers
  run <slug> [--cwd DIR] [--port N] [--persist] [--name N] -- <command...>
                                    Start a server as a service on a stable port, wait for it, print its URL.
                                    $PORT in the command (quote it: '$PORT') becomes the app's port.
  stop <slug> | start <slug> | restart <slug>
  logs <slug> [--lines N] [--follow]
  service add <slug> [-- <command...>]
                                    Keep a declared app running: at login, and restarted if it exits.
  service rm <slug>                 Stop managing it (the app stays declared).
  service regenerate [slug]         Rewrite the generated services (e.g. after a Node upgrade).

Bookmarks
  bookmark add <group> <url> [--title T] [--description D]
  bookmark ls [group] [--json] | bookmark rm <group> <url|number> | bookmark edit <group>

Fronted mode (https://<app>.localhost, or your own domain)
  setup [--trust user|system|none] [--domain BASE] [--port N] [--print] [--yes]
                                    Run Caddy for your apps on https://<app>.localhost. Asks which tier:
                                    user = User certificate (recommended): trusted for your account only, no admin;
                                    system = System-wide certificate: every account, needs admin (and --domain);
                                    none = No HTTPS: plain HTTP, nothing asks for anything.
                                    Shows the plan and asks before it runs anything. --print shows the plan and
                                    runs nothing; --yes doesn't ask (needed without a terminal). Run it again
                                    with another --trust to switch tier. --port 4443 puts links on Caddy's own
                                    port when something else holds 443 (https://<app>.localhost:4443);
                                    --port 443 moves them back.
  teardown [--uninstall-packages] [--print] [--yes]
                                    Undo setup and go back to http://localhost:<port> links. Asks first, like setup.

Coding agents
  mcp                               An MCP server on stdio, for agents that want one: a bridge to the running
                                    daemon's http://localhost:<port>/mcp.
  hook check-command                A pre-tool-use hook (Claude Code's PreToolUse on Bash): blocks a bare
                                    dev-server start and suggests the \`hallway run\` for it. See \`hallway guide\`.

Thumbnails
  thumbs enable                     Screenshots of your apps on their doors: installs a browser (Chromium's
                                    headless shell, about 300 MB) into the data home and turns them on.
  thumbs disable                    Turn them off and delete the browser and the screenshots.
  thumbs refresh [slug]             Take the screenshots again now.  thumbs status: what's installed.

Other
  doctor [--json]                   Check the daemon, the data home, the services and fronted mode, with fixes.
  guide [--snippet]                 The guide for coding agents (AGENT-GUIDE.md), or just the paragraph
                                    for an agent instruction file (CLAUDE.md, AGENTS.md).
  --version | --help

Data: $HALLWAY_HOME (default ~/.hallway). Exit codes: 0 ok, 1 error, 2 usage error.`;

/** Resolves with an exit code when there's nothing to run (Hallway already answers on the port), else undefined. */
async function serve(flags: Record<string, string>): Promise<number | undefined> {
  const given = flags.port ?? process.env.PORT;
  let port = given === undefined || given === '' ? undefined : parsePort(given);
  if (port === null) throw new UsageError(`${flags.port !== undefined ? '--port' : 'PORT'} must be a port number (0-65535), not '${given}'`);
  const dev = devOverrides();
  const hostname = dev.bind ?? '127.0.0.1';
  const [{ startServer }, { Store }, { currentPlatform }] = await Promise.all([import('./index.js'), import('./store/index.js'), import('./platform/index.js')]);
  // the data home is created on first run, and read before binding: config.yaml may name the port
  const store = new Store(HOME).init();
  // `npm run dev`: the daemon sits next to Vite's dashboard port (see vite.config.ts)
  port ??= process.env.HALLWAY_DEV ? DEFAULT_PORT + 1 : store.currentConfig().port;
  const platform = currentPlatform();
  const { frontingInfo, frontingProvider } = await import('./proxy/status.js');
  let bound: number;
  try {
    ({ port: bound } = await startServer(port, {
      home: HOME,
      store,
      hostname,
      extraHosts: dev.allowedHosts,
      // under `npm run dev` Vite serves the dashboard; the daemon is the API only
      webDist: process.env.HALLWAY_DEV ? null : undefined,
    }));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      // `npx hallway` with the service already running: that's what was wanted, so say where it is (exit 0)
      const { findDaemon } = await import('./client.js');
      const running = await findDaemon(port);
      if (running) {
        const { alreadyRunning } = await import('./banner.js');
        const f = frontingInfo(store.currentConfig(), platform);
        process.stdout.write(alreadyRunning({ url: running.url, version: running.version, dashboardUrl: f.mode === 'fronted' ? f.dashboardUrl : null }));
        return 0;
      }
      throw new Error(`port ${port} is already in use by something that isn't Hallway; pick another with --port <n>`);
    }
    if (code === 'EACCES') throw new Error(`not allowed to listen on port ${port}; pick another with --port <n>`);
    throw e;
  }
  // the scanner, prober and uptime history (server/live.ts): plugged in once the port is ours
  const [{ startLive }, { providers }] = await Promise.all([import('./live.js'), import('./providers.js')]);
  await startLive({ store, bus: store.bus, providers, selfPorts: process.env.HALLWAY_DEV ? [bound, DEFAULT_PORT] : [bound] });
  // fronted mode: Caddy's config and the fallback page, pushed now and on every change (server/proxy/)
  const { startProxy, restartCommands } = await import('./proxy/index.js');
  const proxy = await startProxy({ store, bus: store.bus, daemonPort: bound, restart: restartCommands(platform.serviceManager) });
  // local domains for the dashboard: on or off, and in fronted mode doctor's checks, on request (D63)
  providers.register(
    frontingProvider({
      store,
      platform,
      machine: async () => {
        const [{ machineFacts }, { defaultRunner }] = await Promise.all([import('./proxy/tiers.js'), import('./platform/index.js')]);
        return machineFacts(platform, defaultRunner);
      },
      // the dashboard's Turn on (D65): User certificate or No HTTPS only, refused if the plan has a sudo step
      runSetup: async (trust, out, port) => {
        const [{ setupUnattended, captureExec }, { Services }, { defaultRunner }, os] = await Promise.all([import('./proxy/setup.js'), import('./services/index.js'), import('./platform/index.js'), import('node:os')]);
        return setupUnattended(
          { store, platform, services: () => new Services({ store, platform }), env: process.env, userHome: os.homedir(), query: defaultRunner, out, exec: captureExec(out), isRoot: process.getuid?.() === 0, confirm: { yes: true } },
          trust,
          port,
        );
      },
      proxyStatus: proxy.status,
      checks: async () => {
        const [{ networkChecks }, { Services }, { defaultRunner }, os] = await Promise.all([import('./proxy/doctor.js'), import('./services/index.js'), import('./platform/index.js'), import('node:os')]);
        let services: InstanceType<typeof Services> | null = null;
        try {
          services = new Services({ store, platform });
        } catch {
          /* no service manager: the checks that need one say so */
        }
        return networkChecks({ store, platform, services, query: defaultRunner, env: process.env, userHome: os.homedir() });
      },
    }),
  );
  const [{ startupMessage }, { transientInstall }] = await Promise.all([import('./banner.js'), import('./services/transient.js')]);
  const f = frontingInfo(store.currentConfig(), platform);
  const problems = store.allProblems().filter((p) => p.severity === 'error');
  process.stdout.write(
    startupMessage(
      {
        version: VERSION,
        url: `http://localhost:${bound}`,
        home: tildify(dataPaths(HOME).home),
        dashboardUrl: f.mode === 'fronted' ? f.dashboardUrl : null,
        localDomains: f.mode === 'direct' && !f.unsupported ? { dashboard: f.dashboardUrl, app: f.appUrl } : null,
        transient: transientInstall(ROOT)?.where ?? null,
        notes: problems.length ? [`${problems.length} file${problems.length === 1 ? ' has' : 's have'} errors (shown on the dashboard): ${problems.map((p) => p.file).join(', ')}`] : [],
        quiet: !!flags.quiet,
        dev: !!process.env.HALLWAY_DEV,
      },
      { isTTY: process.stdout.isTTY, columns: process.stdout.columns, env: process.env },
    ),
  );
  if (hostname !== '127.0.0.1' || dev.allowedHosts.length)
    process.stderr.write(
      `hallway: development overrides in effect: bound to ${hostname}${dev.allowedHosts.length ? `, also accepting Host ${dev.allowedHosts.join(', ')}` : ''}. Never use these outside development.\n`,
    );
  return undefined;
}

/** Resolves with the exit code, or undefined while the daemon runs. */
async function main(argv: string[]): Promise<number | undefined> {
  const parsed = parseArgs(argv);
  const { pos, flags } = parsed;
  if (flags.help) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  if (flags.version) {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  const [cmd = 'serve', ...args] = pos;
  const rest = parsed.rest;
  const commands = () => import('./commands/index.js');
  switch (cmd) {
    case 'serve':
      check(cmd, flags, ['port', 'quiet'], args, 0, rest);
      return serve(flags);
    case 'guide': {
      check(cmd, flags, ['snippet'], args, 0, rest);
      const guide = readGuide();
      process.stdout.write(flags.snippet ? snippet(guide) : agentGuide({ guide, url: DEFAULT_URL, home: tildify(HOME) }));
      return 0;
    }
    // what a Windows scheduled task runs (server/platform/supervise.ts, D60); internal, so not in --help
    case 'supervise': {
      check(cmd, flags, [], args, 1, rest);
      if (!args[0]) throw new UsageError('supervise needs a job file');
      const { supervise } = await import('./platform/supervise.js');
      return supervise(args[0], { log: (s) => process.stderr.write(`hallway: ${s}\n`) });
    }
    // what launchd runs to hand loopback 443 and 80 to Caddy (server/forward.ts, D65); internal, so not in --help
    case 'forward': {
      check(cmd, flags, ['listen'], args, 1, rest);
      const to = parsePort(args[0] ?? '');
      const listen = flags.listen === undefined ? 'fd0' : parsePort(flags.listen);
      if (!to || listen === null || listen === 0) throw new UsageError('forward needs a port to forward to (and --listen takes a port)');
      const { forward } = await import('./forward.js');
      return forward(to, listen, (s) => process.stderr.write(`${new Date().toISOString()} hallway forward: ${s}\n`));
    }
    default: {
      const { COMMANDS, makeCtx } = await commands();
      const run = COMMANDS[cmd];
      if (!run) throw new UsageError(`unknown command '${cmd}'`);
      return run(makeCtx(), args, flags, rest);
    }
  }
}

// `hallway doctor | head`: the reader has gone, so there's nothing left to cut off. Stop quietly, as other command-line
// tools do, rather than with a stack trace.
for (const stream of [process.stdout, process.stderr])
  stream.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EPIPE') throw e;
    process.exit(process.exitCode ?? 0);
  });

// exitCode, not exit(): exiting could cut off output still being written to a pipe
main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`hallway: ${(e as Error).message}\n`);
    if (e instanceof UsageError) process.stderr.write(`\n${USAGE}\n`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  },
);
