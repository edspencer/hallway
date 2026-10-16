// server/guide.ts and the agent routes: AGENT-GUIDE.md's generated reference is in step with the schemas, the snippet,
// and /llms.txt, /llms-full.txt and /agent-guide.md rendered with live data.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_GUIDE, DEFAULT_URL, REF_BEGIN, REF_END, agentGuide, llmsTxt, readGuide, snippet, withReference } from '../server/guide.ts';
import { createApp } from '../server/index.ts';
import { ProviderRegistry } from '../server/providers.ts';
import { referenceMarkdown } from '../server/store/schema.ts';
import { ROOT, tmpStore } from './fixture.ts';

const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((c) => c()));

describe('AGENT-GUIDE.md', () => {
  test('ships in the package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.files.includes('AGENT-GUIDE.md'));
    assert.equal(AGENT_GUIDE, path.join(ROOT, 'AGENT-GUIDE.md'));
  });

  test("the committed reference matches the validator's schemas (run `npm run sync:guide` if not)", () => {
    const committed = fs.readFileSync(AGENT_GUIDE, 'utf8');
    assert.equal(committed, withReference(committed), 'AGENT-GUIDE.md is out of date: run `npm run sync:guide`');
    const between = committed.slice(committed.indexOf(REF_BEGIN) + REF_BEGIN.length, committed.indexOf(REF_END)).trim();
    assert.equal(between, referenceMarkdown());
  });

  test('withReference replaces whatever is between the markers', () => {
    const g = `# x\n\n${REF_BEGIN}\nstale\n${REF_END}\n`;
    assert.ok(withReference(g).includes('| `port` |'));
    assert.ok(!withReference(g).includes('stale'));
    assert.throws(() => withReference('# no markers'), /markers/);
  });

  test('the snippet is the blockquote, unquoted', () => {
    const s = snippet(readGuide());
    assert.match(s, /^Never start a long-running dev or preview server directly/);
    assert.match(s, /Run `hallway guide` for details\.\n$/);
    assert.doesNotMatch(s, /^>/m);
  });

  test('without a daemon: no live facts, but the data home', () => {
    const g = agentGuide({ guide: readGuide(), url: DEFAULT_URL, home: '~/.hallway-test' });
    assert.match(g, /No live data here/);
    assert.match(g, /`~\/\.hallway-test`/);
    assert.doesNotMatch(g, /<!-- live facts -->/);
  });

  test('stays generic: no personal names, machines or employers', () => {
    const g = readGuide();
    assert.doesNotMatch(g, /edspencer|valfenda|paddock|\/Users\/[a-z]/i);
  });
});

describe('the agent routes, with live data', () => {
  test('/llms.txt, /llms-full.txt and /agent-guide.md show this daemon, its data home and its apps', async () => {
    const s = await tmpStore();
    cleanups.push(s.cleanup);
    await s.store.putApp('my-app', { name: 'My App', port: 5173, expected: 'adhoc' });
    await s.store.putGroup('prod', { title: 'Production', links: [{ url: 'https://admin.example.com' }] });
    const app = createApp({ store: s.store, bus: s.bus, providers: new ProviderRegistry(), webDist: null });
    const get = (p: string) => app.request(p, { headers: { host: 'localhost:5050' } });

    const llms = await get('/llms.txt');
    assert.equal(llms.status, 200);
    assert.match(llms.headers.get('content-type') ?? '', /^text\/plain; charset=utf-8/);
    assert.equal(llms.headers.get('cache-control'), 'no-store');
    const t = await llms.text();
    assert.match(t, /^# Hallway\n\n> Hallway \(npm: `hallway`\)/);
    assert.ok(t.includes(`Served at http://localhost:5050, version `));
    assert.ok(t.includes(`Data home: \`${s.home}\``));
    assert.match(t, /- `my-app`: My App, port 5173, expected adhoc, http:\/\/localhost:5173/);
    assert.match(t, /- `prod`: Production \(1 link\)/);
    assert.match(t, /Mode: direct/);
    // the default URL is localised throughout
    assert.ok(!t.includes('localhost:4255'), 'URLs use the port the agent came in on');
    assert.match(t, /\[Agent guide\]\(http:\/\/localhost:5050\/agent-guide\.md\)/);

    const full = await (await get('/llms-full.txt')).text();
    assert.ok(full.startsWith(t));
    assert.match(full, /## File-format reference/);

    const guide = await get('/agent-guide.md');
    assert.match(guide.headers.get('content-type') ?? '', /^text\/markdown/);
    const g = await guide.text();
    assert.match(g, /^# Hallway: a guide for coding agents\n\n\*\*This Hallway, right now:\*\*/);
    assert.match(g, /\| `health\.path` \| text \| \*\*required\*\* \|/);
  });

  test('behind a TLS-terminating proxy the URLs are https', async () => {
    const s = await tmpStore();
    cleanups.push(s.cleanup);
    await s.store.patchConfig({ mode: 'fronted' });
    const app = createApp({ store: s.store, bus: s.bus, providers: new ProviderRegistry(), webDist: null });
    const t = await (await app.request('/llms.txt', { headers: { host: 'hallway.localhost', 'x-forwarded-proto': 'https' } })).text();
    assert.ok(t.includes('Served at https://hallway.localhost, version'), t);
  });

  test('an empty data home says so', () => {
    const t = llmsTxt({ guide: readGuide(), url: DEFAULT_URL, live: { version: '0.0.0', home: '/h', mode: 'direct', base: 'localhost', apps: [], groups: [] } });
    assert.match(t, /Apps \(pick a slug that isn't taken\):\n {2}- none yet/);
  });
});
