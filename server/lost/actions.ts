// What can be done about something lost at the last reboot (D54): run it again once (`hallway run` without
// --persist), make it a service (`hallway run --persist`, which is `service add` for an app that has its command), or
// dismiss it. Both runs go through runApp, the code behind the CLI's `hallway run`, so the process belongs to launchd
// or systemd, never to the daemon. Not reachable from MCP: no MCP tool starts a process (D10, D53).
//
// Something with no app yet is registered first, as a claim would (D17: on its own port), with the command and
// directory that were recorded while it was alive.
import fs from 'node:fs';
import type { LostActionRequest, LostActionResponse } from '../../shared/api.js';
import { tildify } from '../config.js';
import type { EventBus } from '../events.js';
import type { ProviderRegistry } from '../providers.js';
import { ServiceError, type Services } from '../services/index.js';
import { type RunOptions, runApp } from '../services/run.js';
import { NotFoundError, SLUG, ValidationError } from '../store/index.js';

export interface LostActionDeps {
  services: Services;
  providers: ProviderRegistry;
  bus?: EventBus;
  run?: RunOptions;
}

/** Run a lost item again: once (`persist: false`), or as a service that starts at login and restarts (`persist: true`). */
export async function reviveLost({ services, providers, run }: LostActionDeps, id: string, persist: boolean, body: LostActionRequest | null | undefined): Promise<LostActionResponse> {
  const { store } = services;
  if (body !== null && body !== undefined && (typeof body !== 'object' || (body.slug !== undefined && typeof body.slug !== 'string'))) throw new ValidationError('the body must be {} or {"slug": "..."}');
  const rec = providers.first('lostRecord', id);
  const item = providers.first('lost')?.items.find((i) => i.id === id);
  if (!rec || !item) throw new NotFoundError(`nothing lost at the last reboot has the id '${id}' (it may have been dismissed)`);

  let slug = item.slug;
  const existing = slug ? services.app(slug) : null; // throws for a broken file
  const command = existing?.service ? null : rec.command;
  if (!existing?.service && !command) throw new ServiceError(`no command was recorded for ${item.label}, so Hallway can't start it. Start it yourself, or with \`hallway run <slug> -- <command…>\`.`);
  const cwd = existing?.service ? undefined : (rec.cwd ?? undefined);
  if (cwd && !fs.existsSync(cwd)) throw new ServiceError(`${item.label} ran in ${tildify(cwd)}, which doesn't exist any more`);

  if (!slug) {
    slug = body?.slug ?? item.suggestedSlug;
    if (!slug || !SLUG.test(slug)) throw new ValidationError(`"${slug ?? ''}" is not a valid slug`, [{ key: 'slug', message: 'invalid slug' }]);
    // a claim's facts (claimFile in server/api.ts), with the port it had (D17); runApp adds the service: block
    const ident = item.identity;
    const dir = ident.projectDir ?? ident.cwd;
    await store.createApp(
      slug,
      {
        name: ident.label || ident.name || slug,
        ...(ident.description ? { description: ident.description } : {}),
        port: item.port,
        ...(ident.bindAddress === '::1' ? { host: '::1' } : {}),
        expected: 'adhoc',
        ...(dir ? { project: { dir: tildify(dir) } } : {}),
      },
      { header: ` Registered from what was running on port ${item.port} before the reboot, on ${new Date().toISOString().slice(0, 10)}.` },
    );
  }

  const o = await runApp(services, { slug, ...(command ? { command } : {}), ...(cwd ? { cwd } : {}), persist }, { cwd: cwd ?? store.home, ...run });
  await providers.first('lostChanged', id, slug);
  return { ok: o.ok, slug: o.slug, url: o.url, port: o.port, persist: o.persist, ...(o.reason ? { reason: o.reason } : {}), ...(o.tail ? { tail: o.tail } : {}), lost: providers.first('lost') };
}

/** Dismiss one lost item, or (no id) all of them. Resolves with how many went. */
export function dismissLost(providers: ProviderRegistry, id?: string): number {
  if (!providers.has('dismissLost')) throw new ServiceError('the "Lost at last reboot" notice is not available (the scanner is not running)');
  const n = providers.first('dismissLost', id) ?? 0;
  if (id !== undefined && n === 0) throw new NotFoundError(`nothing lost at the last reboot has the id '${id}'`);
  return n;
}
