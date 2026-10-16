// `hallway mcp`: a stdio MCP server for clients that prefer stdio (D8). It is a bridge, not a second server: every
// message read from stdin is POSTed to the daemon's `/mcp`, and whatever comes back (a JSON body, or the events of an
// SSE stream) is written to stdout, one message per line. So there is one writer (the daemon), and the bridge needs
// no knowledge of the tools; it works with clients of either protocol era (2025's initialize handshake, or 2026-07-28's
// per-request metadata), because the daemon's handler speaks both and is stateless.
//
// What the bridge adds is what the Streamable HTTP binding asks of a client and stdio doesn't carry: the
// `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, and cancellation (stdio's `notifications/cancelled`
// becomes closing that request's HTTP response).
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

type Json = Record<string, unknown>;
type Id = string | number;

/** The legacy (2025) protocol version a client negotiated in its `initialize`, mirrored into later requests' headers. */
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';

/** RFC 9110 visible ASCII and spaces, no leading or trailing space, and not already the sentinel: else Base64. */
export function headerValue(v: string): string {
  const plain = /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/.test(v) && !(v.startsWith('=?base64?') && v.endsWith('?='));
  return plain ? v : `=?base64?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/** The headers the Streamable HTTP binding wants on a POST of `msg`. */
export function headersFor(msg: Json, negotiated: string | null): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const params = (msg.params ?? {}) as Json;
  const meta = (params._meta ?? {}) as Json;
  const version = typeof meta[META_VERSION] === 'string' ? (meta[META_VERSION] as string) : msg.method === 'initialize' ? null : negotiated;
  if (version) h['mcp-protocol-version'] = version;
  if (typeof msg.method === 'string') h['mcp-method'] = msg.method;
  const name = msg.method === 'resources/read' ? params.uri : msg.method === 'tools/call' || msg.method === 'prompts/get' ? params.name : undefined;
  if (typeof name === 'string') h['mcp-name'] = headerValue(name);
  return h;
}

/** The `data:` payloads of an SSE stream, as they arrive. */
export async function* sseMessages(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = '';
  let data: string[] = [];
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + (buf.startsWith('\r\n', nl) ? 2 : 1));
      if (line === '') {
        if (data.length) yield data.join('\n');
        data = [];
      } else if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
      // comments (`:` keep-alives), `event:`, `id:` and `retry:` lines carry nothing to forward
    }
  }
  if (data.length) yield data.join('\n');
}

export interface BridgeOptions {
  /** The daemon's base URL, e.g. http://127.0.0.1:4255. */
  base: string;
  /** What to tell the user (in a JSON-RPC error) when the daemon has gone away. */
  notRunning: string;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  fetch?: typeof fetch;
}

/** Run the bridge until stdin ends. Resolves when everything in flight has finished or been cancelled. */
export function runBridge({ base, notRunning, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, fetch: doFetch = fetch }: BridgeOptions): Promise<void> {
  const endpoint = `${base}/mcp`;
  const inflight = new Map<Id, AbortController>();
  const pending = new Set<Promise<void>>();
  let negotiated: string | null = null;

  const send = (msg: unknown) => {
    stdout.write(JSON.stringify(msg) + '\n');
  };
  const error = (id: Id | null, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });

  /** Forward one JSON-RPC payload from the daemon, noting a legacy initialize's negotiated version on the way. */
  const forward = (text: string) => {
    let msg: Json;
    try {
      msg = JSON.parse(text);
    } catch {
      stderr.write(`hallway mcp: the daemon sent something that isn't JSON: ${text.slice(0, 200)}\n`);
      return;
    }
    const result = msg.result as Json | undefined;
    if (result && typeof result.protocolVersion === 'string' && 'serverInfo' in result) negotiated = result.protocolVersion;
    send(msg);
  };

  async function post(msg: Json) {
    const id = 'id' in msg && msg.method !== undefined ? (msg.id as Id) : null;
    const ac = new AbortController();
    if (id !== null) inflight.set(id, ac);
    try {
      const res = await doFetch(endpoint, { method: 'POST', headers: headersFor(msg, negotiated), body: JSON.stringify(msg), signal: ac.signal });
      const type = res.headers.get('content-type') ?? '';
      if (res.status === 202 || id === null) {
        await res.body?.cancel();
        return;
      }
      if (type.includes('text/event-stream') && res.body) {
        for await (const data of sseMessages(res.body)) forward(data);
        return;
      }
      const text = await res.text();
      let body: Json | null = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (body && body.jsonrpc === '2.0' && ('result' in body || 'error' in body)) forward(text);
      else error(id, -32603, `the Hallway daemon answered HTTP ${res.status}${body && typeof body.error === 'string' ? `: ${body.error}` : ''}`);
    } catch (e) {
      if (ac.signal.aborted) return; // cancelled: no response, as the spec says
      if (id !== null) error(id, -32603, `${notRunning} (${(e as Error).cause ? ((e as Error).cause as Error).message : (e as Error).message})`);
      else stderr.write(`hallway mcp: ${(e as Error).message}\n`);
    } finally {
      if (id !== null) inflight.delete(id);
    }
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg: Json;
      try {
        msg = JSON.parse(line);
      } catch {
        error(null, -32700, 'Parse error: each line must be one JSON-RPC message');
        return;
      }
      if (typeof msg.method !== 'string') return; // a response: the daemon never asks the client anything
      if (msg.method === 'notifications/cancelled') {
        const id = (msg.params as Json | undefined)?.requestId as Id | undefined;
        if (id !== undefined) inflight.get(id)?.abort();
        return;
      }
      const p = post(msg);
      pending.add(p);
      void p.finally(() => pending.delete(p));
    });
    rl.on('close', async () => {
      // stdin closed: the client has gone, so long-lived listen streams can go too; let ordinary requests finish
      const listening = [...inflight.entries()];
      for (const [, ac] of listening) setTimeout(() => ac.abort(), 2000).unref();
      await Promise.allSettled([...pending]);
      resolve();
    });
  });
}
