// macOS: launchd LaunchAgents in the gui/<uid> domain, listeners from `lsof`, boot time from `sysctl kern.boottime`
// (docs/04-apps-health-services.md). The primary platform.
import os from 'node:os';
import path from 'node:path';
import type { Platform } from './index.js';

export const darwin: Platform = {
  id: 'darwin',
  serviceManager: 'launchd',
  listenerSource: 'lsof',
  // LaunchAgents start at login, not boot: right for a laptop.
  userServiceDir: (_env = process.env, home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents'),
  serviceFileName: (label) => `${label}.plist`,
};
