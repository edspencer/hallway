// server/events.ts and server/watcher.ts: the bus, the per-key debounce, the SSE stream (hello, change events with
// ids, the heartbeat), and real file edits in a data home arriving as events within a second.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { ServerEvent } from '../shared/api.ts';
import { EventBus, sseHandler } from '../server/events.ts';
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

  test('emitSoon debounces per key: a burst becomes one event, other keys are separate', (t) => {
    // mocked timers: with real ones, a loaded machine can stretch a 10 ms sleep past the 40 ms window
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const bus = new EventBus();
    const got: ServerEvent[] = [];
    bus.subscribe((e) => got.push(e));
    // five calls 39 ms apart: each one restarts the 40 ms window
    for (let i = 0; i < 5; i++) {
      if (i) t.mock.timers.tick(39);
      bus.emitSoon('a', { type: 'app', slug: 'a', reason: 'config' }, 40);
    }
    bus.emitSoon('b', { type: 'bookmarks', group: 'b' }, 40);
    assert.deepEqual(got, [], 'nothing before the quiet period');
    t.mock.timers.tick(39);
    assert.deepEqual(got, [], 'still nothing 39 ms after the last call');
    t.mock.timers.tick(1);
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

  test('a burst of writes to one file is one event', { timeout: 30_000 }, async () => {
    // What makes a burst one event is the bus's per-key trailing debounce (its own test above, on mocked timers). What
    // the watcher must get right, and what this checks with the real file system, is the rest: every change to a file
    // goes through that one debounce key (chokidar's add and its changes alike), a re-read that finds nothing new says
    // nothing, and whenever the debounce fires the store re-reads the file, so the last write wins.
    //
    // It deliberately doesn't assert "one event" from wall-clock timing. On a stalled machine chokidar's deliveries lag
    // their writes unevenly (each goes through an async stat), and Node computes a new timer's deadline from the event
    // loop's cached time, so a timer set just after a stall can fire almost at once: the debounce can then legitimately
    // fire twice in one burst, giving two correct events. So it counts the debounce's firings: one firing must mean one
    // event, and a split burst (rare, a stall) is retried.
    const WINDOW = 400;
    const { home, store, bus, until, got } = await watched(WINDOW);
    const f = path.join(home, 'bookmarks', 'g.yaml');
    const keys = new Set<string>();
    let fires = 0;
    const emitSoon = bus.emitSoon.bind(bus);
    bus.emitSoon = (k, e, ms) => {
      keys.add(k);
      emitSoon(k, typeof e === 'function' ? () => (fires++, e()) : e, ms);
    };
    const quiet = async () => {
      // nothing more for two whole windows, rather than a fixed sleep
      for (let n = got.length + fires, since = Date.now(); Date.now() - since < 2 * WINDOW; await sleep(20))
        if (got.length + fires !== n) [n, since] = [got.length + fires, Date.now()];
    };
    let events = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      [fires, got.length] = [0, 0];
      keys.clear();
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(f, `title: G${attempt}-${i}\nlinks: []\n`);
        await sleep(5);
      }
      await until((e) => e.type === 'bookmarks', 5000);
      await quiet();
      events = got.filter((g) => g.e.type === 'bookmarks').length;
      assert.deepEqual([...keys], ['file:bookmarks/g.yaml'], 'every change went through the one key');
      assert.ok(events >= 1 && events <= fires, `${events} events from ${fires} firings: ${JSON.stringify(got.map((g) => g.e))}`);
      assert.equal(store.groups.get('g')!.value!.title, `G${attempt}-4`, 'the last write wins');
      if (fires === 1) break;
    }
    if (fires === 1) assert.equal(events, 1, 'one firing of the debounce is one event');
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
