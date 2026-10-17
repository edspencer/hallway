// `hallway forward <port>`: what launchd runs to hand loopback 443 and 80 to Caddy without root (macOS, D65). Each
// forwarder is a LaunchAgent with a `Sockets` entry (launchd binds the privileged loopback port for it, as root) and
// `inetdCompatibility` `Wait = true`, so the job gets that *listening* socket as its stdin, fd 0, and is started on the
// first connection. It accepts on fd 0 for as long as it lives and pipes every connection, byte for byte, to Caddy on
// 127.0.0.1:<port>: TLS stays end to end (Caddy sees the real SNI and serves its own certificate), and WebSockets,
// HTTP/2 and anything else long-lived are just bytes. Internal (not in --help). `--listen <port>` listens on
// 127.0.0.1:<port> instead of fd 0, for trying it by hand and for tests.
//
// The rules: never crash on a connection's error (one bad client must not take the others down; launchd would start
// it again on the next connection anyway, but not without dropping every connection open at the time); honour
// half-close (one side's FIN is passed on, the other direction keeps flowing until it ends too); let `pipe` carry
// backpressure (a slow reader pauses the fast writer, so memory stays bounded); no timeouts (an idle WebSocket is
// still a connection someone wants).
import net from 'node:net';

export interface ForwardOptions {
  /** Where to forward to (Caddy). */
  port: number;
  host?: string;
  /** Errors worth a line in the job's log; every connection's error isn't. */
  log?: (s: string) => void;
}

/** A server that pipes each connection it accepts to host:port. Pure plumbing: the caller decides what it listens on. */
export function forwardServer({ port, host = '127.0.0.1', log = () => {} }: ForwardOptions): net.Server {
  // say a refused upstream once a minute at most: a stopped Caddy would otherwise fill the log, one line a request
  let lastRefused = 0;
  const server = net.createServer({ allowHalfOpen: true, noDelay: true }, (client) => {
    const upstream = net.connect({ port, host, allowHalfOpen: true, noDelay: true });
    client.pipe(upstream);
    upstream.pipe(client);
    const done = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', done);
    upstream.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ECONNREFUSED' && Date.now() - lastRefused > 60_000) {
        lastRefused = Date.now();
        log(`nothing answers on ${host}:${port} (is Hallway's Caddy running?); connections are being dropped`);
      }
      done();
    });
    // with half-close allowed, a socket only closes once both directions have ended (or one side was destroyed): then
    // the other is finished too, or has to be
    client.on('close', done);
    upstream.on('close', done);
  });
  // e.g. EMFILE on accept: say it, keep listening (Node carries on accepting after an accept error)
  server.on('error', (e) => log(`accept failed: ${e.message}`));
  return server;
}

/** Listen on fd 0 (launchd's socket) or on 127.0.0.1:<listen>; resolves once listening, rejects if it can't. */
export function listenForward(server: net.Server, listen: number | 'fd0'): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (e: Error) => reject(e);
    server.once('error', fail);
    const ok = () => {
      server.off('error', fail);
      resolve();
    };
    if (listen === 'fd0') server.listen({ fd: 0 }, ok);
    else server.listen(listen, '127.0.0.1', ok);
  });
}

/** The command: runs until killed. Resolves with an exit code only if it can't start. */
export async function forward(port: number, listen: number | 'fd0', log: (s: string) => void): Promise<number | undefined> {
  const server = forwardServer({ port, log });
  try {
    await listenForward(server, listen);
  } catch (e) {
    log(
      listen === 'fd0'
        ? `can't accept on fd 0 (${(e as Error).message}): \`hallway forward\` is run by launchd, which hands it a listening socket. To try it by hand: hallway forward ${port} --listen <port>`
        : `can't listen on 127.0.0.1:${listen}: ${(e as Error).message}`,
    );
    return 1;
  }
  const a = server.address();
  log(`forwarding ${a && typeof a === 'object' ? `${a.address.includes(':') ? `[${a.address}]` : a.address}:${a.port}` : 'fd 0'} to 127.0.0.1:${port}`);
  return undefined;
}
