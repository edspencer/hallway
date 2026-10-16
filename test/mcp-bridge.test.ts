// server/mcp/bridge.ts and `hallway mcp`: the stdio bridge forwards to a real daemon's /mcp (so the daemon stays the
// one writer), in both protocol eras, adds the headers the HTTP binding wants, and says clearly when there's no daemon.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { EventBus } from '../server/events.ts';
import { startServer } from '../server/index.ts';
import { headerValue, headersFor, runBridge, sseMessages } from '../server/mcp/bridge.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { ROOT, exitWatchdog, tmpDir, rmTmp } from './fixture.ts';

void exitWatchdog();
const cleanups: (() => void | Promise<void>)[] = [];
after(async () => {
  for (const c of cleanups.reverse()) await c();
});

const cli = ['--import', 'tsx', path.join(ROOT, 'server/cli.ts')];

async function daemon() {
  const home = tmpDir('hw-bridge-');
  // the bridge finds the daemon through state/daemon.json (D46): config.yaml's 4255 is someone else's here
  const server = await startServer(0, { home, webDist: null, thumbs: false, bus: new EventBus(), providers: new ProviderRegistry() });
  cleanups.push(async () => {
    await server.close();
    rmTmp(home);
  });
  return { home, server };
}

describe('hallway mcp (a real child process)', () => {
  for (const era of ['legacy', 'auto'] as const)
    test(`an SDK stdio client (${era === 'legacy' ? '2025 handshake' : '2026-07-28'}) reaches the daemon's tools and writes through it`, async () => {
      const { home, server } = await daemon();
      const env = { ...process.env, HALLWAY_HOME: home, HOME: home } as Record<string, string>;
      delete env.PORT;
      const transport = new StdioClientTransport({ command: process.execPath, args: [...cli, 'mcp'], env, cwd: ROOT, stderr: 'pipe' });
      const client = new Client({ name: 'bridge-test', version: '1' }, era === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {});
      await client.connect(transport);
      cleanups.push(() => client.close());
      const tools = (await client.listTools()).tools.map((t) => t.name);
      assert.ok(tools.includes('add_bookmark'));
      const r = (await client.callTool({ name: 'add_bookmark', arguments: { group: `via-${era}`, url: 'https://example.com' } })) as { isError?: boolean };
      assert.ok(!r.isError);
      // written by the daemon's store: its in-memory copy already has it, with no watcher round-trip
      assert.equal(server.store.groups.get(`via-${era}`)?.value?.links[0].url, 'https://example.com');
      assert.ok(fs.existsSync(path.join(home, 'bookmarks', `via-${era}.yaml`)));
      const refused = (await client.callTool({ name: 'declare_app', arguments: { slug: 'x', port: 5000, service: { command: ['vite'] } } })) as { isError?: boolean; content: { text: string }[] };
      assert.ok(refused.isError);
      assert.match(refused.content[0].text, /^Refused/);
    });

  test('without a daemon it exits 1 and says how to start one', () => {
    const home = tmpDir('hw-bridge-none-');
    cleanups.push(() => rmTmp(home));
    // a port nothing listens on, so a daemon someone runs on 4255 can't be found by accident
    fs.writeFileSync(path.join(home, 'config.yaml'), 'version: 1\nport: 1\n');
    const r = spawnSync(process.execPath, [...cli, 'mcp'], { input: '', encoding: 'utf8', env: { ...process.env, HALLWAY_HOME: home, HOME: home }, cwd: ROOT });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /the Hallway daemon isn't running \(nothing answered on port 1\)\. Start it with `hallway service install`/i);
    assert.equal(r.stdout, '');
  });
});

describe('runBridge', () => {
  test('a daemon that goes away: each request gets a JSON-RPC error saying so', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const out: string[] = [];
    stdout.on('data', (d) => out.push(...String(d).trim().split('\n')));
    const done = runBridge({
      base: 'http://127.0.0.1:1',
      notRunning: "The Hallway daemon isn't running",
      stdin,
      stdout,
      stderr: new PassThrough(),
      fetch: async () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') });
      },
    });
    stdin.write('{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}\n');
    stdin.write('not json\n');
    stdin.end();
    await done;
    const msgs = out.map((l) => JSON.parse(l));
    assert.deepEqual(msgs.find((m) => m.id === 7)?.error.code, -32603);
    assert.match(msgs.find((m) => m.id === 7)?.error.message, /daemon isn't running \(connect ECONNREFUSED/);
    assert.equal(msgs.find((m) => m.id === null)?.error.code, -32700);
  });

  test('forwards SSE responses message by message, and cancels a request on notifications/cancelled', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const out: string[] = [];
    stdout.on('data', (d) => out.push(...String(d).trim().split('\n')));
    let aborted = false;
    const done = runBridge({
      base: 'http://x',
      notRunning: 'gone',
      stdin,
      stdout,
      stderr: new PassThrough(),
      fetch: (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        if (body.id === 1) {
          const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n: keep-alive\n\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
          return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
        }
        // id 2: never answers until aborted
        return new Promise((_, rej) =>
          init.signal!.addEventListener('abort', () => {
            aborted = true;
            rej(new Error('aborted'));
          }),
        );
      }) as typeof fetch,
    });
    stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status"}}\n');
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_status"}}\n');
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}\n');
    stdin.end();
    await done;
    assert.ok(aborted);
    const msgs = out.map((l) => JSON.parse(l));
    assert.deepEqual(
      msgs.map((m) => m.method ?? m.id),
      ['notifications/progress', 1],
    );
  });
});

describe('the HTTP binding headers', () => {
  test('protocol version from _meta, else the negotiated one; method; name (Base64 when not header-safe)', () => {
    const modern = headersFor({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_app', _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }, null);
    assert.equal(modern['mcp-protocol-version'], '2026-07-28');
    assert.equal(modern['mcp-method'], 'tools/call');
    assert.equal(modern['mcp-name'], 'get_app');
    assert.equal(modern.accept, 'application/json, text/event-stream');
    const legacy = headersFor({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'hallway://apps/x' } }, '2025-11-25');
    assert.equal(legacy['mcp-protocol-version'], '2025-11-25');
    assert.equal(legacy['mcp-name'], 'hallway://apps/x');
    assert.equal(headersFor({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }, '2025-11-25')['mcp-protocol-version'], undefined);
    assert.equal(headerValue('naïve'), `=?base64?${Buffer.from('naïve').toString('base64')}?=`);
    assert.equal(headerValue(' padded '), `=?base64?${Buffer.from(' padded ').toString('base64')}?=`);
    assert.equal(headerValue('=?base64?x?='), `=?base64?${Buffer.from('=?base64?x?=').toString('base64')}?=`);
  });

  test('sseMessages joins multi-line data and skips comments', async () => {
    const body = new Response('data: a\ndata: b\n\n:ping\n\nid: 3\ndata: c\r\n\r\n').body!;
    const got: string[] = [];
    for await (const m of sseMessages(body)) got.push(m);
    assert.deepEqual(got, ['a\nb', 'c']);
  });
});
