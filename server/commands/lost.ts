// `hallway lost [--json]`, `hallway lost dismiss <id|port>|--all`, `hallway lost restart|service <id|port> [--slug S]`
// (docs/07-cli.md, "Status and discovery"; D54): the "Lost at last reboot" notice from the terminal. With the daemon
// running they ask it (it knows what's back); without it, listing and dismissing read state/lost.json directly, and
// the two runs say to use `hallway run` (they need what the daemon recorded about each one).
import path from 'node:path';
import type { LostActionResponse, LostItem, LostNotice, LostResponse } from '../../shared/api.js';
import { UsageError, check, need } from '../args.js';
import { dataPaths } from '../config.js';
import { LostStore } from '../lost/index.js';
import { type Ctx, json, show, table } from './context.js';

const USAGE = 'lost [--json] | lost dismiss <id|port> | lost dismiss --all | lost restart <id|port> [--slug S] | lost service <id|port> [--slug S]';

const lostFile = (ctx: Ctx) => new LostStore(path.join(dataPaths(ctx.home).state, 'lost.json'));

/** The notice from state/lost.json, without the daemon: nothing is known to be back. */
function offlineNotice(ctx: Ctx): LostNotice | null {
  const f = lostFile(ctx).get();
  if (!f) return null;
  return {
    bootTime: f.bootTime,
    previousBootTime: f.previousBootTime,
    detectedAt: f.detectedAt,
    items: f.items.map((r) => {
      const o = r.observation;
      return {
        id: r.id,
        port: r.port,
        label: r.label,
        slug: r.slug,
        managed: false,
        title: o?.http?.title ?? null,
        identity: {
          pid: o?.pid ?? null, ppid: o?.ppid ?? null, process: o?.process ?? null, command: o?.command ?? r.command?.join(' ') ?? null, cwd: o?.cwd ?? r.cwd,
          projectDir: o?.project?.root ?? null, name: o?.project?.name ?? null, description: o?.project?.description ?? null, repo: o?.git?.repo ?? null,
          branch: o?.git?.branch ?? null, worktree: o?.git?.worktree ?? false, lastCommitAt: o?.git?.lastCommitAt ?? null, framework: o?.project?.framework ?? null,
          bindAddress: null, exposed: false, orphaned: false, supervisor: o?.supervisor ?? null, displayName: null, startedAt: o?.startedAt ?? null, label: null,
        },
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        back: false,
        suggestedSlug: null,
        command: r.command,
        cwd: r.cwd,
      } satisfies LostItem;
    }),
  };
}

/** An item by id, unique id prefix, or port. */
function pick(n: LostNotice | null, which: string): LostItem {
  const items = n?.items ?? [];
  const port = /^\d+$/.test(which) ? Number(which) : null;
  const hits = items.filter((i) => i.id === which || (port !== null && i.port === port) || (which.length >= 4 && i.id.startsWith(which)));
  if (!hits.length) throw new Error(`nothing lost at the last reboot matches '${which}' (\`hallway lost\` lists what is)`);
  if (hits.length > 1) throw new Error(`'${which}' matches ${hits.length} items; give the whole id`);
  return hits[0];
}

const where = (i: LostItem) => {
  const dir = i.identity.projectDir ?? i.identity.cwd ?? i.cwd;
  return dir ? `${show(dir)}${i.identity.branch ? ` @ ${i.identity.branch}` : ''}` : '-';
};

function print(ctx: Ctx, n: LostNotice | null, live: boolean) {
  if (!n) {
    ctx.out('Nothing was lost at the last reboot (or it has all been dismissed).\n');
    return;
  }
  const lost = n.items.filter((i) => !i.back).length;
  ctx.out(`Lost at the last reboot (the machine booted at ${new Date(n.bootTime).toLocaleString()}): ${n.items.length} item${n.items.length === 1 ? '' : 's'}${live ? `, ${lost} still not running` : ''}.\n\n`);
  ctx.out(
    table(
      ['ID', 'PORT', 'WHAT', 'WHERE', 'COMMAND', ...(live ? ['NOW'] : [])],
      n.items.map((i) => [i.id, String(i.port), i.label + (i.slug && i.slug !== i.label ? ` (${i.slug})` : ''), where(i), i.command?.join(' ') ?? i.identity.command ?? '-', ...(live ? [i.back ? 'back' : 'not running'] : [])]),
    ),
  );
  ctx.out('\nStart one again with `hallway lost restart <id>` (once) or `hallway lost service <id>` (at login, restarted if it exits); `hallway lost dismiss <id>` or `--all` to clear.\n');
  if (!live) ctx.out("(The daemon isn't running: this is state/lost.json, and nothing here is known to be back.)\n");
}

export async function lost(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  const [sub, ...args] = pos;
  const daemon = await ctx.daemon();
  switch (sub) {
    case undefined: {
      check('lost', flags, ['json'], args, 0, rest);
      const n = daemon ? (await daemon.get<LostResponse>('/api/lost')).lost : offlineNotice(ctx);
      if (flags.json) ctx.out(json({ daemon: !!daemon, lost: n }));
      else print(ctx, n, !!daemon);
      return 0;
    }
    case 'dismiss': {
      check('lost dismiss', flags, ['all'], args, 1, rest);
      if (!flags.all && !args.length) throw new UsageError('lost dismiss needs <id|port>, or --all');
      if (flags.all && args.length) throw new UsageError('give an id or --all, not both');
      if (flags.all) {
        const n = daemon ? (await daemon.post<{ dismissed: number }>('/api/lost/dismiss', {})).dismissed : lostFile(ctx).dismiss();
        ctx.out(n ? `Dismissed ${n} item${n === 1 ? '' : 's'}: the notice is gone.\n` : 'There was nothing to dismiss.\n');
        return 0;
      }
      const i = pick(daemon ? (await daemon.get<LostResponse>('/api/lost')).lost : offlineNotice(ctx), args[0]);
      if (daemon) await daemon.post(`/api/lost/${encodeURIComponent(i.id)}/dismiss`, {});
      else lostFile(ctx).dismiss(i.id);
      ctx.out(`Dismissed ${i.label} (port ${i.port}).\n`);
      return 0;
    }
    case 'restart':
    case 'service': {
      check(`lost ${sub}`, flags, ['slug', 'json'], args, 1, rest);
      need(`lost ${sub}`, args, ['id|port']);
      if (!daemon) throw new Error(`the daemon isn't running, so it can't tell what this was; start it (\`hallway service install\`), or run it yourself with \`hallway run <slug> --cwd <dir> -- <command>\``);
      const i = pick((await daemon.get<LostResponse>('/api/lost')).lost, args[0]);
      const r = await daemon.post<LostActionResponse>(`/api/lost/${encodeURIComponent(i.id)}/${sub}`, flags.slug ? { slug: flags.slug } : {});
      if (flags.json) {
        ctx.out(json(r));
        return r.ok ? 0 : 1;
      }
      if (r.ok) {
        ctx.out(`${r.slug} is up: ${r.url}\n`);
        ctx.out(r.persist ? '  It runs as a service: it starts at login and is restarted if it exits.\n' : "  It won't come back after another reboot (`hallway lost service` or `hallway service add` for that).\n");
        return 0;
      }
      ctx.err(`hallway: ${r.slug} didn't come up: ${r.reason}.\n`);
      if (r.tail) ctx.err(`\nThe last lines of its logs:\n${r.tail}`);
      return 1;
    }
    default:
      throw new UsageError(`unknown lost command '${sub}'; ${USAGE}`);
  }
}
