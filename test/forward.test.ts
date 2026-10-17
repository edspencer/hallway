// `hallway forward` (server/forward.ts, D65): the byte pipe launchd's sockets hand connections to on macOS. Tested here
// on a normal listening port, on every OS: what goes in comes out, both ways, for request/response, a WebSocket
// upgrade that stays open, half-close, a slow reader (backpressure), and errors that must not take the process down.
// The fd 0 part (launchd's socket as stdin) needs launchd: CI's macOS fronted-mode job runs it for real.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { forwardServer, listenForward } from '../server/forward.ts';
import { ROOT } from './fixture.ts';

const portOf = (s: net.Server) => (s.address() as net.AddressInfo).port;
// every server's open connections, so closing it doesn't wait on fetch's keep-alive or an upgraded socket
const open = new WeakMap<net.Server, Set<net.Socket>>();
const listen = (s: net.Server) => {
  const socks = new Set<net.Socket>();
  open.set(s, socks);
  s.on('connection', (c: net.Socket) => (socks.add(c), c.on('close', () => socks.delete(c))));
  return new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r(portOf(s))));
};
const close = (s: net.Server) =>
  new Promise<void>((r) => {
    s.close(() => r());
    for (const c of open.get(s) ?? []) c.destroy();
  });

/** A forwarder on a free port, to `to`. */
async function forwarder(to: number, log: string[] = []) {
  const s = forwardServer({ port: to, log: (l) => log.push(l) });
  const socks = new Set<net.Socket>();
  open.set(s, socks);
  s.on('connection', (c: net.Socket) => (socks.add(c), c.on('close', () => socks.delete(c))));
  await listenForward(s, 0);
  return s;
}

// ---- a WebSocket echo server, by hand (RFC 6455's handshake and text frames; enough to prove the bytes flow) ----
const accept = (key: string) => crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
function frame(text: string): Buffer {
  const p = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x81, p.length]), p]); // FIN + text, unmasked (server → client), < 126 bytes
}
function unmask(buf: Buffer): string {
  const len = buf[1] & 0x7f;
  const mask = buf.subarray(2, 6);
  return Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4])).toString();
}
function wsEchoServer() {
  const s = http.createServer((req, res) => res.end(`hello from ${req.headers.host}`));
  s.on('upgrade', (req, sock: net.Socket) => {
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept(String(req.headers['sec-websocket-key']))}\r\n\r\n`);
    sock.on('data', (d: Buffer) => {
      if ((d[0] & 0x0f) === 0x8) return sock.end(); // close frame
      sock.write(frame(`echo: ${unmask(d)}`));
    });
  });
  return s;
}

describe('hallway forward: the pipe', () => {
  const upstream = wsEchoServer();
  let up = 0;
  let fwd: net.Server;
  before(async () => {
    up = await listen(upstream);
    fwd = await forwarder(up);
  });
  after(async () => {
    await close(fwd);
    await close(upstream);
  });

  test('request and response, Host untouched (it is bytes, not HTTP)', async () => {
    // fetch won't set Host; http.request will
    const body = await new Promise<string>((resolve, reject) =>
      http
        .get({ host: '127.0.0.1', port: portOf(fwd), path: '/', headers: { host: 'review.localhost' }, agent: false }, (res) => {
          let t = '';
          res.on('data', (d) => (t += d));
          res.on('end', () => resolve(t));
        })
        .on('error', reject),
    );
    assert.equal(body, 'hello from review.localhost');
  });

  test('many at once', async () => {
    const all = await Promise.all(Array.from({ length: 40 }, () => fetch(`http://127.0.0.1:${portOf(fwd)}/`).then((r) => r.text())));
    assert.equal(all.filter((t) => t.startsWith('hello')).length, 40);
  });

  test('a WebSocket upgrade, through it, stays open and carries messages both ways (an HMR socket)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${portOf(fwd)}/`);
    const got: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onopen = () => ws.send('one');
      ws.onmessage = async (e) => {
        got.push(String(e.data));
        if (got.length === 1) {
          // idle for a while, as an HMR socket is between edits: nothing times it out
          await new Promise((r) => setTimeout(r, 300));
          ws.send('two');
        } else resolve();
      };
    });
    assert.deepEqual(got, ['echo: one', 'echo: two']);
    ws.close();
  });
});

describe('hallway forward: half-close, backpressure and errors', () => {
  test("half-close: the client's FIN reaches the server, and the server's late answer still comes back", async () => {
    // the server reads until the client ends its side, then answers, then ends its own
    const srv = net.createServer({ allowHalfOpen: true }, (c) => {
      let n = 0;
      c.on('data', (d) => (n += d.length));
      c.on('end', () => setTimeout(() => c.end(`got ${n} bytes`), 100));
    });
    const up = await listen(srv);
    const fwd = await forwarder(up);
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        const c = net.connect({ port: portOf(fwd), host: '127.0.0.1', allowHalfOpen: true });
        let out = '';
        c.on('data', (d) => (out += d));
        c.on('end', () => resolve(out));
        c.on('error', reject);
        c.end('x'.repeat(1000));
      });
      assert.equal(answer, 'got 1000 bytes');
    } finally {
      await close(fwd);
      await close(srv);
    }
  });

  test('backpressure: a slow reader pauses the upstream instead of the forwarder buffering everything', async () => {
    const chunk = Buffer.alloc(64 * 1024, 7);
    const total = 32 * 1024 * 1024;
    let written = 0;
    let waited = 0;
    // the upstream writes as fast as it's allowed to, counting how often it was told to wait
    const srv = net.createServer((c) => {
      const pump = () => {
        while (written < total) {
          written += chunk.length;
          if (!c.write(chunk)) {
            waited++;
            return c.once('drain', pump);
          }
        }
        c.end();
      };
      pump();
    });
    const up = await listen(srv);
    const fwd = await forwarder(up);
    try {
      const c = net.connect(portOf(fwd), '127.0.0.1');
      c.pause();
      await new Promise((r) => setTimeout(r, 400));
      // with nobody reading, only socket buffers' worth can have been written, not all 32 MB
      assert.ok(written < total / 2, `written ${written} of ${total} while the client read nothing`);
      let read = 0;
      await new Promise<void>((resolve) => {
        c.on('data', (d) => (read += d.length));
        c.on('end', () => resolve());
        c.resume();
      });
      assert.equal(read, total);
      assert.ok(waited > 0, 'the upstream was made to wait');
    } finally {
      await close(fwd);
      await close(srv);
    }
  });

  test('nothing on the upstream port: the client is dropped, the forwarder keeps going and says so once', async () => {
    // a port nothing listens on: listen, note it, close
    const s = net.createServer();
    const dead = await listen(s);
    await close(s);
    const log: string[] = [];
    const fwd = await forwarder(dead, log);
    try {
      for (let i = 0; i < 3; i++)
        await new Promise<void>((resolve) => {
          const c = net.connect(portOf(fwd), '127.0.0.1');
          c.on('error', () => {});
          c.on('close', () => resolve());
        });
      assert.equal(log.filter((l) => /nothing answers on 127\.0\.0\.1/.test(l)).length, 1, 'said once, not per connection');
      assert.ok(fwd.listening, 'still accepting');
    } finally {
      await close(fwd);
    }
  });

  test('a client that resets mid-stream takes only its own upstream connection down', async () => {
    let upstreamClosed = 0;
    const srv = net.createServer((c) => {
      c.on('close', () => upstreamClosed++);
      c.on('error', () => {});
      c.write('hi');
    });
    const up = await listen(srv);
    const fwd = await forwarder(up);
    try {
      const c = net.connect(portOf(fwd), '127.0.0.1');
      await new Promise((r) => c.once('data', r));
      c.resetAndDestroy();
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(upstreamClosed, 1);
      // and the next connection works
      const t = await new Promise<string>((resolve) => net.connect(portOf(fwd), '127.0.0.1').once('data', (d) => resolve(String(d))));
      assert.equal(t, 'hi');
    } finally {
      await close(srv);
      await close(fwd);
    }
  });
});

describe('hallway forward: the command', () => {
  const cli = path.join(ROOT, 'server', 'cli.ts');
  const run = (args: string[]) =>
    new Promise<{ code: number | null; err: string }>((resolve) => {
      execFile(process.execPath, ['--import', 'tsx', cli, ...args], { cwd: ROOT, timeout: 20_000 }, (e, _out, err) => resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, err }));
    });

  test('needs a port; with no socket on fd 0 it says it is run by launchd, and how to try it by hand', async () => {
    const usage = await run(['forward']);
    assert.equal(usage.code, 2);
    // stdin is a pipe here, not a listening socket
    const r = await run(['forward', '4443']);
    assert.equal(r.code, 1);
    assert.match(r.err, /can't accept on fd 0 .*run by launchd.*hallway forward 4443 --listen <port>/s);
  });

  test('--listen: forwards from a port, runs until killed', async () => {
    const srv = http.createServer((_q, s) => s.end('through'));
    const up = await listen(srv);
    const probe = net.createServer();
    const from = await listen(probe);
    await close(probe);
    const child = spawn(process.execPath, ['--import', 'tsx', cli, 'forward', String(up), '--listen', String(from)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    try {
      await new Promise((r) => child.stderr.once('data', r));
      assert.equal(await (await fetch(`http://127.0.0.1:${from}/`)).text(), 'through');
      assert.equal(child.exitCode, null, 'still running');
    } finally {
      child.kill();
      await close(srv);
    }
  });
});
