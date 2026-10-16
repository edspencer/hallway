// server/platform/: the macOS / Linux / Windows split (D26, D58). Every platform is tested on every OS: nothing here
// touches the machine, so the macOS paths are checked on Linux and Windows CI too (and every other way round).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UnsupportedPlatformError, currentPlatform, platformFor } from '../server/platform/index.ts';
import { parseLocalPortRange } from '../server/platform/linux.ts';

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

  test("each platform's ephemeral range: IANA's on macOS, ip_local_port_range on Linux", () => {
    assert.deepEqual(platformFor('darwin').ephemeralPorts(), { from: 49152, to: 65535 });
    assert.deepEqual(parseLocalPortRange('32768\t60999\n'), { from: 32768, to: 60999 });
    assert.deepEqual(parseLocalPortRange('1024 65535'), { from: 1024, to: 65535 });
    assert.equal(parseLocalPortRange(''), null);
    assert.equal(parseLocalPortRange('60999 32768'), null);
    assert.equal(parseLocalPortRange('0 70000'), null);
    const r = platformFor('linux').ephemeralPorts();
    assert.ok(r.from >= 1 && r.from <= r.to && r.to <= 65535);
  });

  test('Windows: per-user scheduled tasks under %LOCALAPPDATA%, the IANA ephemeral range, no fronted mode (D58)', () => {
    const p = platformFor('win32');
    assert.equal(p.serviceManager, 'schtasks');
    assert.equal(p.listenerSource, 'netstat');
    assert.equal(p.userServiceDir({ LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' }, 'C:\\Users\\someone'), 'C:\\Users\\someone\\AppData\\Local\\hallway\\tasks');
    assert.equal(p.userServiceDir({}, 'C:\\Users\\someone'), 'C:\\Users\\someone\\AppData\\Local\\hallway\\tasks');
    assert.deepEqual(p.ephemeralPorts(), { from: 49152, to: 65535 });
    assert.deepEqual(p.openCommand('http://localhost:4255/?a=1&b=2'), ['rundll32', ['url.dll,FileProtocolHandler', 'http://localhost:4255/?a=1&b=2']]);
    assert.match(p.fronting.unsupported ?? '', /fronted mode isn't supported on Windows/);
  });

  test('anything else is unsupported, with a clear message', () => {
    assert.throws(() => platformFor('freebsd'), (e) => e instanceof UnsupportedPlatformError && /macOS, Linux and Windows, not freebsd/.test(e.message));
  });

  test('currentPlatform matches the OS running the tests', () => {
    if (['darwin', 'linux', 'win32'].includes(process.platform)) assert.equal(currentPlatform().id, process.platform);
    else assert.throws(() => currentPlatform(), UnsupportedPlatformError);
  });
});
