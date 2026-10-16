// server/store/schema.ts: validation rules, defaults, and the generated file-format reference.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SLUG, defaultConfig, referenceMarkdown, reservedSlugs, validateApp, validateBookmarks, validateConfig, validateIgnore } from '../server/store/schema.ts';

const errors = (r: { issues: { severity: string; key: (string | number)[]; message: string }[] }) =>
  r.issues.filter((i) => i.severity === 'error').map((i) => `${i.key.join('.')}: ${i.message}`);
const warnings = (r: { issues: { severity: string; key: (string | number)[]; message: string }[] }) =>
  r.issues.filter((i) => i.severity === 'warning').map((i) => `${i.key.join('.')}: ${i.message}`);

describe('slugs', () => {
  test('the slug pattern is a DNS label', () => {
    for (const ok of ['a', 'my-app', 'app2', '0', 'a'.repeat(63)]) assert.ok(SLUG.test(ok), ok);
    for (const bad of ['', 'My-App', '-a', 'a-', 'a_b', 'a.b', 'a b', 'a'.repeat(64), 'é']) assert.ok(!SLUG.test(bad), bad);
  });

  test('reserved: www, api and the dashboard label', () => {
    assert.deepEqual(reservedSlugs(defaultConfig()).sort(), ['api', 'hallway', 'www']);
    assert.deepEqual(reservedSlugs({ domain: { base: 'myname.internal', dashboard: 'myname.internal', tls: true } }).sort(), ['api', 'www']);
    assert.deepEqual(reservedSlugs({ domain: { base: 'localhost', dashboard: 'hall.localhost', tls: true } }).sort(), ['api', 'hall', 'www']);
  });
});

describe('apps', () => {
  test('the minimal file gets every default', () => {
    const r = validateApp('my-app', { port: 5173 });
    assert.deepEqual(errors(r), []);
    assert.deepEqual(r.value, {
      name: 'my-app',
      description: null,
      port: 5173,
      host: '127.0.0.1',
      expected: 'running',
      health: null,
      proxy: { preserveHost: false, aliases: [] },
      service: null,
      links: [],
      project: null,
      tags: [],
      icon: 'auto',
    });
  });

  test('port is required and must be 1-65535', () => {
    assert.deepEqual(errors(validateApp('a', {})), ['port: is required']);
    assert.deepEqual(errors(validateApp('a', { port: 0 })), ['port: must be between 1 and 65535']);
    assert.deepEqual(errors(validateApp('a', { port: 65536 })), ['port: must be between 1 and 65535']);
    assert.deepEqual(errors(validateApp('a', { port: 80.5 })), ['port: must be a whole number, not 80.5']);
    assert.deepEqual(errors(validateApp('a', { port: '5173' })), ['port: must be a whole number, not string']);
  });

  test('enums, nested objects, lists and links', () => {
    assert.deepEqual(errors(validateApp('a', { port: 1, expected: 'sometimes' })), ['expected: must be one of running, stopped, adhoc, not "sometimes"']);
    assert.deepEqual(errors(validateApp('a', { port: 1, health: {} })), ['health.path: is required']);
    assert.deepEqual(errors(validateApp('a', { port: 1, health: { path: 'health' } })), ['health.path: must start with "/"']);
    assert.deepEqual(errors(validateApp('a', { port: 1, health: { path: '/h', expectStatus: 99 } })), ['health.expectStatus: must be between 100 and 599']);
    assert.deepEqual(errors(validateApp('a', { port: 1, tags: 'x' })), ['tags: must be a list, not string']);
    assert.deepEqual(errors(validateApp('a', { port: 1, links: [{ label: 'x' }] })), ['links.0: give either `path` or `url`']);
    assert.deepEqual(errors(validateApp('a', { port: 1, links: [{ label: 'x', path: '/a', url: 'https://x' }] })), ['links.0: give either `path` or `url`']);
    assert.deepEqual(errors(validateApp('a', { port: 1, links: [{ label: 'x', url: 'nope' }] })), ['links.0.url: not a URL (expected e.g. https://example.com/)']);
    assert.deepEqual(errors(validateApp('a', { port: 1, service: { command: [] } })), ['service.command: must have at least 1 item']);
    assert.deepEqual(errors(validateApp('a', { port: 1, proxy: { aliases: ['Bad Name'] } })).length, 1);
    assert.deepEqual(errors(validateApp('a', [1, 2])), [': must be a mapping (key: value lines), not a list']);
    const ok = validateApp('a', { port: 1, links: [{ label: 'API', path: '/api' }], service: { command: ['npm', 'run', 'dev'], env: { DEBUG: 1 } } });
    assert.deepEqual(errors(ok), []);
    assert.deepEqual(ok.value.links, [{ label: 'API', path: '/api' }]);
    assert.deepEqual(ok.value.service, { command: ['npm', 'run', 'dev'], cwd: null, env: { DEBUG: '1' }, runAtLoad: true, keepAlive: true });
  });

  test('a number is fine as a name; a boolean is not', () => {
    assert.equal(validateApp('a', { port: 1, name: 2048 }).value.name, '2048');
    assert.deepEqual(errors(validateApp('a', { port: 1, name: true })), ['name: must be text, not boolean']);
  });

  test('unknown keys are warnings, with a suggestion for a near miss', () => {
    const r = validateApp('a', { port: 1, expcted: 'adhoc', color: 'red' });
    assert.deepEqual(errors(r), []);
    assert.deepEqual(warnings(r), [
      `expcted: unknown key "expcted" (kept in the file, but Hallway doesn't use it); did you mean "expected"?`,
      `color: unknown key "color" (kept in the file, but Hallway doesn't use it)`,
    ]);
    assert.ok(!('expcted' in r.value));
  });
});

describe('bookmarks, ignore, config', () => {
  test('bookmark groups: defaults from the group name and the URL', () => {
    const r = validateBookmarks('prod', { links: [{ url: 'https://admin.example.com/x' }, { title: 'BI', url: 'https://bi.example.com' }] });
    assert.deepEqual(errors(r), []);
    assert.equal(r.value.title, 'prod');
    assert.equal(r.value.order, 100);
    assert.equal(r.value.links[0].title, 'admin.example.com');
    assert.equal(r.value.links[1].title, 'BI');
    assert.deepEqual(errors(validateBookmarks('g', { links: [{ title: 'x' }] })), ['links.0.url: is required']);
  });

  test('ignore.yaml: duplicates are warnings', () => {
    const r = validateIgnore({ ports: [631, 631], processes: ['rapportd'] });
    assert.deepEqual(errors(r), []);
    assert.deepEqual(warnings(r), ['ports.1: 631 is listed twice']);
    assert.deepEqual(validateIgnore(null).value, { ports: [], processes: [], dirs: [] });
  });

  test('config.yaml: every key optional; derived dashboard host; a newer version is refused', () => {
    const d = defaultConfig();
    assert.equal(d.port, 4255);
    assert.equal(d.mode, 'direct');
    assert.equal(d.domain.dashboard, 'hallway.localhost');
    assert.deepEqual(d.ports.assignRange, [5100, 5999]);
    assert.equal(validateConfig({ domain: { base: 'myname.internal' } }).value.domain.dashboard, 'myname.internal');
    assert.deepEqual(errors(validateConfig({ version: 2 })), ['version: version 2 was written by a newer Hallway; this one understands version 1']);
    assert.deepEqual(errors(validateConfig({ ports: { assignRange: [6000, 5000] } })), ['ports.assignRange: the first port must not be above the second']);
    assert.deepEqual(errors(validateConfig({ ports: { assignRange: [6000] } })), ['ports.assignRange: must have exactly 2 items']);
    assert.deepEqual(errors(validateConfig({ mode: 'proxy' })), ['mode: must be one of direct, fronted, not "proxy"']);
    assert.deepEqual(errors(validateConfig({ dashboard: { title: null } })), []);
  });
});

describe('the reference', () => {
  test('documents every key of every file', () => {
    const md = referenceMarkdown();
    for (const k of ['`port`', '`expected`', '`health.path`', '`service.command`', '`links[].label`', '`links[].url`', '`ports`', '`domain.dashboard`', '`ports.assignRange`', '`dashboard.sections`'])
      assert.ok(md.includes(`| ${k} |`), k);
    assert.match(md, /\| `port` \| number 1–65535 \| \*\*required\*\* \|/);
    assert.match(md, /\| `expected` \| `running` \\\| `stopped` \\\| `adhoc` \| `running` \|/);
  });
});
