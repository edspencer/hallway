// `hallway app add|ls|edit|rm` and `hallway bookmark add|ls|rm|edit` (docs/07-cli.md, "Apps" and "Bookmarks").
// Every write goes through the store; a running daemon sees it through its file watcher.
import { spawnSync } from 'node:child_process';
import type { AppView, AppsResponse, BookmarkGroupView, Expected } from '../../shared/api.js';
import { UsageError, check, need } from '../args.js';
import { parsePort } from '../config.js';
import { ProviderRegistry } from '../providers.js';
import { appLabel } from '../services/index.js';
import { assignPort } from '../services/ports.js';
import { SLUG } from '../store/index.js';
import { appViews, groupViews } from '../views.js';
import { type Ctx, json, show, table } from './context.js';

const EXPECTED: Expected[] = ['running', 'stopped', 'adhoc'];

/** Open a file in $VISUAL / $EDITOR (default vi), which may carry its own arguments (`code -w`). */
function edit(ctx: Ctx, file: string): number {
  const editor = ctx.env.VISUAL || ctx.env.EDITOR || 'vi';
  const r = spawnSync(`${editor} '${file.replace(/'/g, `'\\''`)}'`, { shell: true, stdio: 'inherit', env: ctx.env });
  if (r.error) throw new Error(`couldn't run ${editor}: ${r.error.message}`);
  return r.status ?? 1;
}

/** After a hand edit: say what's wrong with the file, if anything. */
function reportFile(ctx: Ctx, rel: string): number {
  const store = ctx.store();
  store.loadAll();
  const problems = store.allProblems().filter((p) => p.file === rel);
  if (!problems.length) return 0;
  for (const p of problems) ctx.err(`${p.severity}: ${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}\n`);
  return problems.some((p) => p.severity === 'error') ? 1 : 0;
}

/** Declared apps from the files, and discovered ones and health from the daemon when it's running. */
export async function listApps(ctx: Ctx): Promise<{ apps: AppView[]; live: boolean }> {
  const daemon = await ctx.daemon();
  if (daemon) return { apps: (await daemon.get<AppsResponse>('/api/apps')).apps, live: true };
  return { apps: appViews({ store: ctx.store(), providers: new ProviderRegistry() }, false), live: false };
}

export async function app(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  const [sub, ...args] = pos;
  switch (sub) {
    case 'add': {
      check('app add', flags, ['port', 'name', 'expected', 'health', 'json'], args, 1, rest);
      need('app add', args, ['slug']);
      const slug = args[0];
      if (!SLUG.test(slug)) throw new UsageError(`"${slug}" is not a valid slug: lower-case letters, digits and hyphens, starting and ending with a letter or digit`);
      let port: number | undefined;
      if (flags.port !== undefined) {
        const p = parsePort(flags.port);
        if (p === null || p === 0) throw new UsageError(`--port must be a port number (1-65535), not '${flags.port}'`);
        port = p;
      }
      if (flags.expected !== undefined && !EXPECTED.includes(flags.expected as Expected)) throw new UsageError(`--expected must be one of ${EXPECTED.join(', ')}`);
      if (flags.health !== undefined && !flags.health.startsWith('/')) throw new UsageError('--health must be a path starting with "/", e.g. /api/health');
      const store = ctx.store();
      if (store.apps.has(slug)) throw new Error(`apps/${slug}.yaml already exists; change it with \`hallway app edit ${slug}\``);
      port ??= await assignPort(store);
      const e = await store.createApp(slug, {
        name: flags.name?.trim() || slug,
        port,
        ...(flags.expected ? { expected: flags.expected } : {}),
        ...(flags.health ? { health: { path: flags.health } } : {}),
      });
      if (flags.json) ctx.out(json({ slug, file: e.path, config: e.value }));
      else ctx.out(`Declared ${slug} on port ${port}: ${show(e.path)}\n`);
      return 0;
    }
    case 'ls': {
      check('app ls', flags, ['json'], args, 0, rest);
      const { apps } = await listApps(ctx);
      if (flags.json) {
        ctx.out(json({ apps }));
        return 0;
      }
      if (!apps.length) {
        ctx.out('No apps yet. Declare one with `hallway app add <slug> --port <n>`, or start one with `hallway run <slug> -- <command>`.\n');
        return 0;
      }
      ctx.out(
        table(
          ['SLUG', 'NAME', 'PORT', 'EXPECTED', 'SOURCE', 'SERVICE', 'URL'],
          apps.map((a) => [
            a.slug + (a.problems.some((p) => p.severity === 'error') ? ' (!)' : ''),
            a.name,
            String(a.config?.port ?? '-'),
            a.config?.expected ?? '-',
            a.source === 'discovered' ? `discovered (${a.adapter})` : a.source,
            a.managed ? (a.config?.service?.keepAlive || a.config?.service?.runAtLoad ? 'service' : 'run') : '-',
            a.url ?? '-',
          ]),
        ),
      );
      const broken = apps.filter((a) => a.problems.some((p) => p.severity === 'error'));
      if (broken.length) ctx.out(`\n(!) ${broken.map((a) => a.file).join(', ')} ${broken.length === 1 ? 'has' : 'have'} errors: \`hallway doctor\` lists them.\n`);
      return 0;
    }
    case 'edit': {
      check('app edit', flags, [], args, 1, rest);
      need('app edit', args, ['slug']);
      const e = ctx.store().apps.get(args[0]);
      if (!e) throw new Error(`no app '${args[0]}' (apps/${args[0]}.yaml doesn't exist); declare it with \`hallway app add\``);
      const code = edit(ctx, e.path);
      return code || reportFile(ctx, e.file);
    }
    case 'rm': {
      check('app rm', flags, [], args, 1, rest);
      need('app rm', args, ['slug']);
      const slug = args[0];
      const store = ctx.store();
      if (!store.apps.has(slug)) throw new Error(`no app '${slug}'`);
      // a managed app's job goes with it: nothing should keep running an app that no longer exists
      const services = ctx.services();
      if (services.manager.list().includes(appLabel(slug))) {
        await services.removeLabel(appLabel(slug));
        ctx.out(`Stopped and removed ${slug}'s service.\n`);
      }
      const dest = await store.deleteApp(slug);
      ctx.out(`Removed ${slug}: apps/${slug}.yaml moved to ${show(dest)}\n`);
      return 0;
    }
    default:
      throw new UsageError(sub ? `unknown app command '${sub}'; app needs one of: add, ls, edit, rm` : 'app needs one of: add, ls, edit, rm');
  }
}

export async function bookmark(ctx: Ctx, pos: string[], flags: Record<string, string>, rest?: string[]): Promise<number> {
  const [sub, ...args] = pos;
  const store = () => ctx.store();
  switch (sub) {
    case 'add': {
      check('bookmark add', flags, ['title', 'description', 'json'], args, 2, rest);
      need('bookmark add', args, ['group', 'url']);
      const [group, url] = args;
      if (!SLUG.test(group)) throw new UsageError(`"${group}" is not a valid group name: lower-case letters, digits and hyphens`);
      const e = await store().addBookmark(group, { url, ...(flags.title ? { title: flags.title } : {}), ...(flags.description ? { description: flags.description } : {}) });
      const link = e.value!.links.at(-1)!;
      if (flags.json) ctx.out(json({ group, file: e.path, link }));
      else ctx.out(`Added "${link.title}" (${link.url}) to ${e.value!.title}: ${show(e.path)}\n`);
      return 0;
    }
    case 'ls': {
      check('bookmark ls', flags, ['json'], args, 1, rest);
      // bookmarks are only file data: read the files (the daemon would add nothing, and might not have seen the
      // last write yet)
      let groups: BookmarkGroupView[] = groupViews(store());
      if (args[0]) groups = groups.filter((g) => g.group === args[0]);
      if (flags.json) {
        ctx.out(json({ groups }));
        return 0;
      }
      if (!groups.length) {
        ctx.out(args[0] ? `No bookmark group '${args[0]}'.\n` : 'No bookmarks yet. Add one with `hallway bookmark add <group> <url>`.\n');
        return 0;
      }
      const rows: string[][] = [];
      for (const g of groups) {
        if (!g.config) rows.push([g.group, '', '(the file has errors)', '']);
        else g.config.links.forEach((l, i) => rows.push([i === 0 ? g.group : '', String(i + 1), l.title, l.url]));
        if (g.config && !g.config.links.length) rows.push([g.group, '', '(no links)', '']);
      }
      ctx.out(table(['GROUP', '#', 'TITLE', 'URL'], rows));
      return 0;
    }
    case 'rm': {
      check('bookmark rm', flags, [], args, 2, rest);
      need('bookmark rm', args, ['group', 'url|number']);
      const [group, which] = args;
      // numbers are as `bookmark ls` shows them, from 1
      const target = /^\d+$/.test(which) ? Number(which) - 1 : which;
      if (target === -1) throw new UsageError('link numbers start at 1 (as `hallway bookmark ls` shows them)');
      const l = await store().removeBookmark(group, target);
      ctx.out(`Removed "${l.title ?? l.url}" (${l.url}) from bookmarks/${group}.yaml\n`);
      return 0;
    }
    case 'edit': {
      check('bookmark edit', flags, [], args, 1, rest);
      need('bookmark edit', args, ['group']);
      const e = store().groups.get(args[0]);
      if (!e) throw new Error(`no bookmark group '${args[0]}' (bookmarks/${args[0]}.yaml doesn't exist); start one with \`hallway bookmark add ${args[0]} <url>\``);
      const code = edit(ctx, e.path);
      return code || reportFile(ctx, e.file);
    }
    default:
      throw new UsageError(sub ? `unknown bookmark command '${sub}'; bookmark needs one of: add, ls, rm, edit` : 'bookmark needs one of: add, ls, rm, edit');
  }
}
