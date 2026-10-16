// Linux: systemd user units, listeners from `ss` (falling back to /proc/net/tcp{,6}), boot time from /proc/stat's
// btime. Pulled forward from v2 so the daemon can be run and tested end to end on a Linux machine (D26).
import os from 'node:os';
import path from 'node:path';
import type { Platform } from './index.js';
import { systemdManager, unitName } from './systemd.js';

export const linux: Platform = {
  id: 'linux',
  serviceManager: 'systemd',
  listenerSource: 'ss',
  // `systemctl --user` reads units from $XDG_CONFIG_HOME/systemd/user (default ~/.config/systemd/user).
  userServiceDir: (env = process.env, home = os.homedir()) =>
    path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'systemd', 'user'),
  // hallway.daemon → hallway-daemon.service, hallway.app.<slug> → hallway-app-<slug>.service (D37)
  serviceFileName: unitName,
  services: ({ run, env = process.env, home = os.homedir() } = {}) => systemdManager({ dir: linux.userServiceDir(env, home), run }),
  openCommand: (url) => ['xdg-open', [url]],
};
