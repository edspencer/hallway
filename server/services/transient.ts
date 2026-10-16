// Is Hallway running from somewhere that won't last (D61)? `npx hallway` runs it out of npx's per-invocation cache
// (~/.npm/_npx/<hash>/node_modules/hallway, %LocalAppData%\npm-cache\_npx\<hash>\… on Windows), which npm prunes
// when it likes, and pnpm dlx, bunx and yarn dlx do the same in their own caches or temporary directories. That's
// fine for a foreground `hallway serve`, but a job that runs Hallway's own CLI (the daemon's, and on Windows every
// job, through `hallway supervise`) would break silently at some later login, and would stay pinned to that version.
// Pure: it looks only at the string, so POSIX and Windows paths are tested on every OS.

export interface Transient {
  /** What it is, for messages: "npx's cache". */
  where: string;
  /** Who can delete it: "npm". */
  owner: string;
}

const TRANSIENT: readonly { re: RegExp; where: string; owner: string }[] = [
  { re: /[/\\]_npx[/\\]/i, where: "npx's cache", owner: 'npm' },
  // pnpm 9+: <cache dir>/dlx/<hash>/… (~/.cache/pnpm, ~/Library/Caches/pnpm, %LocalAppData%\pnpm-cache)
  { re: /[/\\]pnpm[^/\\]*[/\\]dlx[/\\]/i, where: "pnpm dlx's cache", owner: 'pnpm' },
  { re: /[/\\]bunx-[^/\\]+[/\\]/i, where: "bunx's cache", owner: 'bun' },
  // older pnpm dlx and yarn dlx: a temporary dlx-<pid> directory
  { re: /[/\\]dlx-\d+[/\\]/i, where: 'a temporary dlx directory', owner: 'the package manager' },
];

/** Where `p` (a path, or any text with paths in it) is transient, or null if it isn't. */
export function transientInstall(p: string): Transient | null {
  const hit = TRANSIENT.find((t) => t.re.test(p));
  return hit ? { where: hit.where, owner: hit.owner } : null;
}

/** Why a command that would write a job running Hallway refuses; `again` is the command to run once it's installed. */
export function transientMessage(t: Transient, again?: string): string {
  return `Hallway is running from ${t.where}, which ${t.owner} can delete at any time. Install it first: \`npm i -g hallway\`, then ${again ? `run \`${again}\` again` : 'run the same command again with the installed `hallway`'}.`;
}
