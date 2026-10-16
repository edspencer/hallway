// Windows: supported where feasible, best effort (D58). Nothing here needs administrator rights. What isn't done yet
// says so rather than guessing: the scanner sees no listeners, managed services refuse with a message, and fronted
// mode is unsupported (setup refuses before doing anything). The parts that can be checked are checked on GitHub's
// hosted Windows runners; everything else is "unverified on a real Windows desktop" in docs/11-research-notes.md.
import os from 'node:os';
// Windows paths whatever OS this runs on, so this platform's logic is tested on macOS and Linux too
import { win32 as path } from 'node:path';
import type { Platform } from './index.js';
import { FrontingUnsupported, type Fronting } from './fronting.js';
import { type ServiceManager, ServiceManagerError, type ServiceStatus } from './services.js';

export const WINDOWS_SERVICES_UNSUPPORTED = "managed services aren't supported on Windows yet: start the server yourself and register it (hallway claim <port>)";
export const WINDOWS_FRONTING_UNSUPPORTED = "fronted mode isn't supported on Windows: apps keep their http://localhost:<port> addresses";

function unsupportedServices(dir: string): ServiceManager {
  const refuse = async (): Promise<never> => {
    throw new ServiceManagerError(WINDOWS_SERVICES_UNSUPPORTED);
  };
  return {
    kind: 'schtasks',
    unsupported: WINDOWS_SERVICES_UNSUPPORTED,
    file: (label) => path.join(dir, `${label}.xml`),
    render: () => {
      throw new ServiceManagerError(WINDOWS_SERVICES_UNSUPPORTED);
    },
    readPath: () => null,
    write: refuse,
    start: refuse,
    stop: refuse,
    restart: refuse,
    remove: refuse,
    status: async (label): Promise<ServiceStatus> => ({ label, installed: false, loaded: false, running: false, pid: null, lastExitCode: null, state: null, enabled: null }),
    list: () => [],
  };
}

const refuseFronting = (): never => {
  throw new FrontingUnsupported(WINDOWS_FRONTING_UNSUPPORTED);
};

export const win32Fronting: Fronting = {
  unsupported: WINDOWS_FRONTING_UNSUPPORTED,
  redirect: refuseFronting,
  unredirect: refuseFronting,
  trust: refuseFronting,
  untrust: refuseFronting,
  resolver: refuseFronting,
  unresolver: refuseFronting,
  installed: () => ({ redirect: [], trust: [], resolver: [] }),
  userServiceNoun: 'scheduled task',
  detect: () => ({ nft: null, certutil: null, systemctl: null, resolved: false, caStore: null }),
  helperDirs: [],
  installHelper: () => ({ advice: WINDOWS_FRONTING_UNSUPPORTED }),
};

export const win32: Platform = {
  id: 'win32',
  serviceManager: 'schtasks',
  listenerSource: 'netstat',
  // where the scheduled tasks' definitions are kept (D58); nothing is written there yet
  userServiceDir: (env = process.env, home = os.homedir()) =>
    path.join(env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.join(home, 'AppData', 'Local'), 'hallway', 'tasks'),
  serviceFileName: (label) => `${label}.xml`,
  services: ({ env = process.env, home = os.homedir() } = {}) => unsupportedServices(win32.userServiceDir(env, home)),
  // `start` is a cmd built-in and would need quoting for `&`; the URL handler takes the URL as one argument
  openCommand: (url) => ['rundll32', ['url.dll,FileProtocolHandler', url]],
  fronting: win32Fronting,
  // Windows' default dynamic port range since Vista is IANA's (`netsh int ipv4 show dynamicport tcp`)
  ephemeralPorts: () => ({ from: 49152, to: 65535 }),
  async listListeners() {
    return [];
  },
  async processInfo() {
    return new Map();
  },
  async bootTime() {
    return Math.round(Date.now() - os.uptime() * 1000);
  },
};
