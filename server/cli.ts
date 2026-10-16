#!/usr/bin/env node
// `hallway [command] …`: the command-line entry point (the package's bin; `npm run hallway -- …` from a checkout).
// With no command it runs the daemon in the foreground (`serve`). The full command set is docs/07-cli.md; commands
// arrive milestone by milestone (docs/08-roadmap.md).
import { DEFAULT_PORT, HOME, VERSION, dataPaths, devOverrides, parsePort, tildify } from './config.js';
import { UsageError, check, parseArgs } from './args.js';
import { DEFAULT_URL, agentGuide, readGuide, snippet } from './guide.js';

const USAGE = `Usage: hallway [command] [options]

Daemon
  serve [--port <n>] [--quiet]      (the default) Run the daemon in the foreground: the dashboard and API on
                                    http://localhost:<port> (127.0.0.1 only).
          --port <n>       the port (default ${DEFAULT_PORT}, or $PORT, or port: in config.yaml)
          --quiet, -q      print just the "Hallway on <url>" line
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
  setup [--domain BASE] [--print]   Run Caddy for your apps, redirect ports 443 and 80 to it and trust its
                                    certificates. Prints each step first; the privileged ones run through sudo.
                                    --print shows the plan and runs nothing.
  teardown [--uninstall-packages] [--print]
                                    Undo setup and go back to http://localhost:<port> links.

Other
  doctor [--json]                   Check the daemon, the data home, the services and fronted mode, with fixes.
  guide [--snippet]                 The guide for coding agents (AGENT-GUIDE.md), or just the paragraph
                                    for an agent instruction file (CLAUDE.md, AGENTS.md).
  --version | --help

Data: $HALLWAY_HOME (default ~/.hallway). Exit codes: 0 ok, 1 error, 2 usage error.`;

async function serve(flags: Record<string, string>) {
  const given = flags.port ?? process.env.PORT;
  let port = given === undefined || given === '' ? undefined : parsePort(given);
  if (port === null) throw new UsageError(`${flags.port !== undefined ? '--port' : 'PORT'} must be a port number (0-65535), not '${given}'`);
  const dev = devOverrides();
  const hostname = dev.bind ?? '127.0.0.1';
  const [{ startServer }, { Store }] = await Promise.all([import('./index.js'), import('./store/index.js')]);
  // the data home is created on first run, and read before binding: config.yaml may name the port
  const store = new Store(HOME).init();
  // `npm run dev`: the daemon sits next to Vite's dashboard port (see vite.config.ts)
  port ??= process.env.HALLWAY_DEV ? DEFAULT_PORT + 1 : store.currentConfig().port;
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
    if (code === 'EADDRINUSE') throw new Error(`port ${port} is already in use; pick another with --port <n> (is Hallway already running?)`);
    if (code === 'EACCES') throw new Error(`not allowed to listen on port ${port}; pick another with --port <n>`);
    throw e;
  }
  // the scanner, prober and uptime history (server/live.ts): plugged in once the port is ours
  const [{ startLive }, { providers }] = await Promise.all([import('./live.js'), import('./providers.js')]);
  await startLive({ store, bus: store.bus, providers, selfPorts: process.env.HALLWAY_DEV ? [bound, DEFAULT_PORT] : [bound] });
  // fronted mode: Caddy's config and the fallback page, pushed now and on every change (server/proxy/)
  const [{ startProxy, restartCommands }, { currentPlatform }] = await Promise.all([import('./proxy/index.js'), import('./platform/index.js')]);
  await startProxy({ store, bus: store.bus, daemonPort: bound, restart: restartCommands(currentPlatform().serviceManager) });
  let out = `Hallway on http://localhost:${bound}\n`;
  if (!flags.quiet) {
    out += `Data home: ${tildify(dataPaths(HOME).home)}\n`;
    const problems = store.allProblems().filter((p) => p.severity === 'error');
    if (problems.length) out += `${problems.length} file${problems.length === 1 ? ' has' : 's have'} errors (shown on the dashboard): ${problems.map((p) => p.file).join(', ')}\n`;
  }
  process.stdout.write(out);
  if (hostname !== '127.0.0.1' || dev.allowedHosts.length)
    process.stderr.write(
      `hallway: development overrides in effect: bound to ${hostname}${dev.allowedHosts.length ? `, also accepting Host ${dev.allowedHosts.join(', ')}` : ''}. Never use these outside development.\n`,
    );
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
      await serve(flags);
      return undefined;
    case 'guide': {
      check(cmd, flags, ['snippet'], args, 0, rest);
      const guide = readGuide();
      process.stdout.write(flags.snippet ? snippet(guide) : agentGuide({ guide, url: DEFAULT_URL, home: tildify(HOME) }));
      return 0;
    }
    default: {
      const { COMMANDS, makeCtx } = await commands();
      const run = COMMANDS[cmd];
      if (!run) throw new UsageError(`unknown command '${cmd}'`);
      return run(makeCtx(), args, flags, rest);
    }
  }
}

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
