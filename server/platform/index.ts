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
import type { Fronting } from './fronting.js';
import type { ProcessInfo, RawListener } from './listeners.js';
import type { Runner, ServiceManager } from './services.js';

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
  /** Every listening TCP socket this user can see, one entry per address (merge them with `mergeListeners`). */
  listListeners(): Promise<RawListener[]>;
  /** Command, cwd, start time and parent of each PID still running (missing from the map: gone, or not visible). */
  processInfo(pids: number[]): Promise<Map<number, ProcessInfo>>;
  /** When the machine booted, epoch ms; null if it can't be read. */
  bootTime(): Promise<number | null>;
  /** The service manager for the daemon and managed apps (launchd.ts, systemd.ts). `run` is mocked in tests. */
  services(opts?: { run?: Runner; env?: NodeJS.ProcessEnv; home?: string }): ServiceManager;
  /** The command that opens a URL in the default browser (`open` / `xdg-open`). */
  openCommand(url: string): [string, string[]];
  /** Fronted mode's privileged parts: the 443/80 redirect, trusting the local CA, the custom-domain resolver (D47). */
  fronting: Fronting;
  /** The range the OS picks from when a program listens on port 0, where tool helpers end up: macOS uses IANA's
   * 49152–65535, Linux its own (`ip_local_port_range`, usually 32768–60999). */
  ephemeralPorts(): PortRange;
}

export interface PortRange {
  from: number;
  to: number;
}

export type { Listener, ProcessInfo, RawListener } from './listeners.js';
export { bindScope, connectAddress, mergeListeners } from './listeners.js';
export type { Runner, RunResult, ServiceManager, ServiceSpec, ServiceStatus } from './services.js';
export { ServiceManagerError, defaultRunner } from './services.js';
export type { Cmd, Fronting, FrontingEnv, Recipe, StagedFile } from './fronting.js';
export { FrontingUnsupported, MARK, dnsmasqConf } from './fronting.js';

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
