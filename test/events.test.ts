// server/events.ts and server/watcher.ts: the bus, the per-key debounce, the SSE stream (hello, change events with
// ids, the heartbeat), and real file edits in a data home arriving as events within a second.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { ServerEvent } from '../shared/api.ts';
import { DEBOUNCE_MS, EventBus, sseHandler } from '../server/events.ts';
import { startWatcher } from '../server/watcher.ts';
import { exitWatchdog, tmpStore } from './fixture.ts';

await exitWatchdog();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the bus', () => {
  test('emit reaches every subscriber; unsubscribe stops it; a throwing listener is contained', () => {
    const bus = new EventBus();
    const got: ServerEvent[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const off = bus.subscribe((e) => got.push(e));
    bus.emit({ type: 'config' });
    off();
    bus.emit({ type: 'config' });
    assert.deepEqual(got, [{ type: 'config' }]);
    assert.equal(bus.size, 1);
  });

  test('emitSoon debounces per key: a burst becomes one event, other keys are separate', async () => {
    const bus = new EventBus();
    const got: ServerEvent[] = [];
    bus.subscribe((e) => got.push(e));
    for (let i = 0; i < 5; i++) {
      bus.emitSoon('a', { type: 'app', slug: 'a', reason: 'config' }, 40);
      await sleep(10);
    }
    bus.emitSoon('b', { type: 'bookmarks', group: 'b' }, 40);
    assert.deepEqual(got, [], 'nothing before the quiet period');
    await sleep(80);
    assert.deepEqual(got, [
      { type: 'app', slug: 'a', reason: 'config' },
      { type: 'bookmarks', group: 'b' },
    ]);
  });

  test('emitSoon with a function computes the event when it fires (or nothing)', async () => {
    const bus = new EventBus();
    const got: ServerEvent[] = [];
    bus.subscribe((e) => got.push(e));
    let n = 0;
    bus.emitSoon('k', () => (++n, [{ type: 'config' }, { type: 'apps', reason: 'x' }]), 10);
    bus.emitSoon('k', () => (++n, [{ type: 'config' }]), 10);
    bus.emitSoon('z', () => null, 10);
    await sleep(40);
    assert.equal(n, 1, 'only the last call runs');
    assert.deepEqual(got, [{ type: 'config' }]);
    bus.emitSoon('f', { type: 'config' }, 10_000);
    bus.flush();
    assert.equal(got.length, 2);
  });
});

/** Read an SSE response's frames as they arrive. */
function sseReader(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    async next(timeout = 2000): Promise<string> {
      const deadline = Date.now() + timeout;
      for (;;) {
        const i = buf.indexOf('\n\n');
        if (i >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          return frame;
        }
        const r = await Promise.race([reader.read(), sleep(Math.max(0, deadline - Date.now())).then(() => null)]);
        if (!r) throw new Error(`no SSE frame within ${timeout} ms (have ${JSON.stringify(buf)})`);
        if (r.done) throw new Error('stream ended');
        buf += dec.decode(r.value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

describe('GET /api/events', () => {
  test('hello, then change events with incrementing ids, then a heartbeat', async () => {
    const bus = new EventBus();
    const app = new Hono().get('/events', sseHandler(bus, 100));
    const res = await app.request('/events');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);
    const sse = sseReader(res);
    const hello = await sse.next();
    assert.match(hello, /^event: hello\ndata: \{"t":\d+\}$/);
    bus.emit({ type: 'app', slug: 'foo', reason: 'config' });
    bus.emit({ type: 'config' });
    assert.equal(await sse.next(), 'event: change\ndata: {"type":"app","slug":"foo","reason":"config"}\nid: 1');
    assert.equal(await sse.next(), 'event: change\ndata: {"type":"config"}\nid: 2');
    assert.equal(await sse.next(), ': ping');
    bus.emit({ type: 'bookmarks' });
    assert.equal(await sse.next(), 'event: change\ndata: {"type":"bookmarks"}\nid: 3');
    assert.equal(bus.size, 1);
    await sse.cancel();
    await sleep(20);
    assert.equal(bus.size, 0, 'a closed stream unsubscribes');
  });
});

describe('the watcher', () => {
  const cleanups: (() => unknown)[] = [];
  after(async () => {
    for (const c of cleanups.reverse()) await c();
  });

  async function watched(debounceMs = 60) {
    const s = await tmpStore();
    const w = startWatcher(s.store, s.bus, debounceMs);
    cleanups.push(s.cleanup, () => w.close());
    await w.ready;
    // macOS's FSEvents can drop a write made the instant the watch reports ready; CI runners are slow to settle
    await sleep(100);
    const got: { e: ServerEvent; at: number }[] = [];
    s.bus.subscribe((e) => got.push({ e, at: Date.now() }));
    // "it arrives at all" on a loaded CI runner; the 1 s product requirement is checked by the timing test below
    const until = async (pred: (e: ServerEvent) => boolean, ms = 3000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const hit = got.find((g) => pred(g.e));
        if (hit) return hit.at;
        await sleep(10);
      }
      throw new Error(`no matching event within ${ms} ms; got ${JSON.stringify(got.map((g) => g.e))}`);
    };
    return { ...s, got, until };
  }

  test('creating, editing and deleting an app file arrive as events within a second', async () => {
    const { home, store, until, got } = await watched();
    const f = path.join(home, 'apps', 'foo.yaml');
    let t = Date.now();
    fs.writeFileSync(f, 'name: Foo\nport: 5173\n');
    assert.ok((await until((e) => e.type === 'apps' && e.reason === 'added')) - t < 1000);
    assert.equal(store.apps.get('foo')!.value!.name, 'Foo');
    got.length = 0;
    t = Date.now();
    fs.writeFileSync(f, 'name: Bar\nport: 5173\n');
    assert.ok((await until((e) => e.type === 'app' && e.reason === 'config')) - t < 1000);
    assert.equal(store.apps.get('foo')!.value!.name, 'Bar');
    got.length = 0;
    t = Date.now();
    fs.unlinkSync(f);
    assert.ok((await until((e) => e.type === 'app' && e.reason === 'removed')) - t < 1000);
    assert.ok(!store.apps.has('foo'));
  });

  test('a burst of writes to one file is one event', { timeout: 10_000 }, async () => {
    // The debounce is trailing: writes closer together than the window are one event. A wide window keeps the burst
    // (five writes ~5 ms apart) well inside it even on a loaded CI runner, where the 60 ms used elsewhere can be
    // outlasted by a single stalled tick and legitimately split the burst in two.
    const WINDOW = 400;
    const { home, store, until, got } = await watched(WINDOW);
    const f = path.join(home, 'bookmarks', 'g.yaml');
    const at: number[] = [];
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(f, `title: G${i}\nlinks: []\n`);
      at.push(Date.now());
      await sleep(5);
    }
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    assert.ok(Math.max(...gaps) < WINDOW, `the writes weren't a burst (gaps ${gaps.join(', ')} ms): the runner stalled`);
    await until((e) => e.type === 'bookmarks', 5000);
    // quiescence: nothing more for two whole windows, rather than a fixed sleep
    for (let n = got.length, quietSince = Date.now(); Date.now() - quietSince < 2 * WINDOW; await sleep(20))
      if (got.length !== n) [n, quietSince] = [got.length, Date.now()];
    assert.equal(got.filter((g) => g.e.type === 'bookmarks').length, 1, JSON.stringify(got.map((g) => g.e)));
    assert.equal(store.groups.get('g')!.value!.title, 'G4', 'and the one event carries the last write');
  });

  test('a broken file arrives as an error event; temp files and machine dirs are ignored', async () => {
    const { home, store, until, got } = await watched();
    fs.writeFileSync(path.join(home, 'apps', 'foo.yaml'), 'port: 1\n');
    await until((e) => e.type === 'apps');
    got.length = 0;
    fs.writeFileSync(path.join(home, 'apps', 'foo.yaml'), 'port: [\n');
    await until((e) => e.type === 'app' && e.reason === 'error');
    assert.equal(store.apps.get('foo')!.value!.port, 1);
    got.length = 0;
    fs.writeFileSync(path.join(home, 'apps', '.bar.yaml.tmp-1-abcdef12'), 'port: 2\n');
    fs.writeFileSync(path.join(home, 'state', 'observed.json'), '{}');
    fs.writeFileSync(path.join(home, 'notes.txt'), 'hi');
    await sleep(300);
    assert.deepEqual(got, []);
  });

  test("the store's own writes are announced once, not echoed by the watcher", async () => {
    const { store, got } = await watched();
    await store.putApp('foo', { port: 1 });
    await sleep(300);
    assert.deepEqual(
      got.map((g) => g.e),
      [
        { type: 'app', slug: 'foo', reason: 'config' },
        { type: 'apps', reason: 'added' },
      ],
    );
  });

  test('config.yaml and ignore.yaml edits', async () => {
    const { home, store, until } = await watched();
    fs.writeFileSync(path.join(home, 'config.yaml'), 'version: 1\nmode: fronted\n');
    await until((e) => e.type === 'config');
    assert.equal(store.currentConfig().mode, 'fronted');
    fs.writeFileSync(path.join(home, 'ignore.yaml'), 'ports: [631]\n');
    await until((e) => e.type === 'observed' && e.reason === 'ignored');
    assert.deepEqual(store.currentIgnore().ports, [631]);
  });
});
