// The platform abstraction (D26). Everything that differs between macOS and Linux sits behind this interface: the
// native service manager that keeps the daemon and managed apps alive (launchd / systemd user units), how listening
// sockets are found (lsof / ss and /proc), and where boot time comes from. The rest of the server asks
// `currentPlatform()` and never branches on process.platform itself.
//
// macOS is the primary platform; Linux is implemented alongside it so the whole thing can be exercised on a Linux
// machine. Behaviour that can't be checked from Linux is listed as "unverified on macOS" in
// docs/11-research-notes.md until someone runs it on a Mac.
import { darwin } from './darwin.js';
import { linux } from './linux.js';

export type PlatformId = 'darwin' | 'linux';

export interface Platform {
  id: PlatformId;
  /** The native per-user service manager (D3): launchd LaunchAgents, or systemd user units. */
  serviceManager: 'launchd' | 'systemd';
  /** How the scanner lists listening TCP sockets (docs/04-apps-health-services.md, "Observed listeners"). */
  listenerSource: 'lsof' | 'ss';
  /** The directory per-user service definitions are written to. */
  userServiceDir(env?: NodeJS.ProcessEnv, home?: string): string;
  /** The file name of the service definition for a job label (D19: `hallway.daemon`, `hallway.app.<slug>`). */
  serviceFileName(label: string): string;
}

export class UnsupportedPlatformError extends Error {
  constructor(public platform: string) {
    super(`Hallway runs on macOS and Linux, not ${platform}`);
  }
}

const PLATFORMS: Record<PlatformId, Platform> = { darwin, linux };

export function platformFor(p: string = process.platform): Platform {
  if (p === 'darwin' || p === 'linux') return PLATFORMS[p];
  throw new UnsupportedPlatformError(p);
}

/** The platform this process runs on. Throws UnsupportedPlatformError elsewhere (Windows is a non-goal). */
export function currentPlatform(): Platform {
  return platformFor(process.platform);
}
