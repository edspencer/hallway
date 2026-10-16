// server/platform/: the macOS / Linux split (D26). Both platforms are tested on every OS: nothing here touches the
// machine, so the macOS paths are checked on Linux CI too (and the other way round).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UnsupportedPlatformError, currentPlatform, platformFor } from '../server/platform/index.ts';

describe('platform', () => {
  test('macOS uses launchd LaunchAgents and lsof', () => {
    const p = platformFor('darwin');
    assert.equal(p.serviceManager, 'launchd');
    assert.equal(p.listenerSource, 'lsof');
    assert.equal(p.userServiceDir({}, '/Users/someone'), '/Users/someone/Library/LaunchAgents');
    assert.equal(p.serviceFileName('hallway.daemon'), 'hallway.daemon.plist');
  });

  test('Linux uses systemd user units (honouring an absolute $XDG_CONFIG_HOME) and ss', () => {
    const p = platformFor('linux');
    assert.equal(p.serviceManager, 'systemd');
    assert.equal(p.listenerSource, 'ss');
    assert.equal(p.userServiceDir({}, '/home/someone'), '/home/someone/.config/systemd/user');
    assert.equal(p.userServiceDir({ XDG_CONFIG_HOME: '/xdg' }, '/home/someone'), '/xdg/systemd/user');
    // the XDG spec says to ignore a relative value
    assert.equal(p.userServiceDir({ XDG_CONFIG_HOME: 'rel' }, '/home/someone'), '/home/someone/.config/systemd/user');
    assert.equal(p.serviceFileName('hallway.app.my-app'), 'hallway-app-my-app.service');
    assert.equal(p.serviceFileName('hallway.daemon'), 'hallway-daemon.service');
  });

  test('anything else is unsupported, with a clear message', () => {
    assert.throws(() => platformFor('win32'), (e) => e instanceof UnsupportedPlatformError && /macOS and Linux, not win32/.test(e.message));
  });

  test('currentPlatform matches the OS running the tests', () => {
    if (process.platform === 'darwin' || process.platform === 'linux') assert.equal(currentPlatform().id, process.platform);
    else assert.throws(() => currentPlatform(), UnsupportedPlatformError);
  });
});
