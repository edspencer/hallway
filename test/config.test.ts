// server/config.ts: the data home and its overrides, ~ handling, the package root, ports and the dev-only overrides.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORT, ROOT as PKG_ROOT, dataPaths, devOverrides, expandHome, packageRoot, parsePort, resolveHome, tildify } from '../server/config.ts';
import { ROOT, tmpDir } from './fixture.ts';

const HOME = '/home/someone';

describe('data home', () => {
  test('defaults to ~/.hallway with an empty environment', () => {
    assert.equal(resolveHome({}, HOME), '/home/someone/.hallway');
    assert.equal(resolveHome({ HALLWAY_HOME: '' }, HOME), '/home/someone/.hallway');
  });

  test('$HALLWAY_HOME overrides it, with ~ expanded and relative paths resolved', () => {
    assert.equal(resolveHome({ HALLWAY_HOME: '/srv/hw' }, HOME), '/srv/hw');
    assert.equal(resolveHome({ HALLWAY_HOME: '~/dotfiles/hallway' }, HOME), '/home/someone/dotfiles/hallway');
    assert.equal(resolveHome({ HALLWAY_HOME: '~' }, HOME), HOME);
    assert.equal(resolveHome({ HALLWAY_HOME: 'rel/dir' }, HOME), path.resolve('rel/dir'));
  });

  test('the layout separates editable files from machine-written ones', () => {
    const p = dataPaths('/d');
    assert.equal(p.config, '/d/config.yaml');
    assert.equal(p.apps, '/d/apps');
    assert.equal(p.bookmarks, '/d/bookmarks');
    assert.equal(p.ignore, '/d/ignore.yaml');
    for (const k of ['state', 'cache', 'generated', 'logs', 'backups'] as const) assert.equal(p[k], `/d/${k}`);
  });
});

describe('~ handling', () => {
  test('expandHome only expands a leading ~ or ~/', () => {
    assert.equal(expandHome('~', HOME), HOME);
    assert.equal(expandHome('~/Code/my-app', HOME), '/home/someone/Code/my-app');
    assert.equal(expandHome('~other/x', HOME), '~other/x');
    assert.equal(expandHome('/abs/~/x', HOME), '/abs/~/x');
  });

  test('tildify shows the home directory as ~, and nothing else', () => {
    assert.equal(tildify('/home/someone', HOME), '~');
    assert.equal(tildify('/home/someone/.hallway', HOME), '~/.hallway');
    assert.equal(tildify('/home/someone-else/.hallway', HOME), '/home/someone-else/.hallway');
    assert.equal(tildify('/srv/hallway', HOME), '/srv/hallway');
  });
});

describe('packageRoot', () => {
  test("finds Hallway's own package.json from any depth", () => {
    assert.equal(PKG_ROOT, ROOT);
    assert.equal(packageRoot(path.join(ROOT, 'server', 'platform')), ROOT);
  });

  test("skips other packages' package.json files, and fails clearly when there's none", () => {
    const dir = tmpDir('hw-test-root-');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'not-hallway' }));
      assert.throws(() => packageRoot(dir), /can't find Hallway's package.json/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ports', () => {
  test('the default is 4255 (HALL)', () => assert.equal(DEFAULT_PORT, 4255));

  test('parsePort accepts 0–65535 and nothing else', () => {
    assert.equal(parsePort('0'), 0);
    assert.equal(parsePort('4255'), 4255);
    assert.equal(parsePort('65535'), 65535);
    for (const bad of ['65536', '-1', '42.5', 'abc', '', '123456', ' 80']) assert.equal(parsePort(bad), null, bad);
  });
});

describe('development overrides', () => {
  test('are off unless set', () => {
    assert.deepEqual(devOverrides({}), { bind: null, allowedHosts: [] });
    assert.deepEqual(devOverrides({ HALLWAY_DEV_BIND: '  ', HALLWAY_DEV_ALLOWED_HOSTS: ' , ' }), { bind: null, allowedHosts: [] });
  });

  test('parse the bind address and a comma-separated, lower-cased host list', () => {
    assert.deepEqual(devOverrides({ HALLWAY_DEV_BIND: '0.0.0.0', HALLWAY_DEV_ALLOWED_HOSTS: 'Preview.Example.com, other.example.com' }), {
      bind: '0.0.0.0',
      allowedHosts: ['preview.example.com', 'other.example.com'],
    });
  });
});
