// "Lost at last reboot" (docs/05-ui.md): the banner's words. Pure, tested under node.
import type { LostItem, LostNotice } from '../../shared/api';
import { tildify } from './format';

/** When the machine booted, as the banner says it: `Mon 28 Sep 20:05`. */
export function bootLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

/** What the banner's title counts: `6 apps`, `6 apps · 2 back`, `all 3 back`. */
export function lostCount(n: LostNotice): { lost: number; back: number; text: string } {
  const back = n.items.filter((i) => i.back).length;
  const lost = n.items.length - back;
  const apps = (k: number) => `${k} app${k === 1 ? '' : 's'}`;
  const text = lost === 0 ? (back === 1 ? 'it’s back' : `all ${back} are back`) : back ? `${apps(lost)} · ${back} back` : apps(lost);
  return { lost, back, text };
}

/** Where it ran from: `~/Code/my-app @ main`, or null when nothing was recorded. */
export function lostWhere(i: LostItem, home: string | null): string | null {
  const dir = i.identity.projectDir ?? i.identity.cwd ?? i.cwd;
  if (!dir) return null;
  return `${tildify(dir, home)}${i.identity.branch ? ` @ ${i.identity.branch}` : ''}`;
}

/** Its command as one line, with the user's home shortened. */
export function lostCommand(i: LostItem, home: string | null): string | null {
  const c = i.command?.join(' ') ?? i.identity.command;
  if (!c) return null;
  return home ? c.split(home + '/').join('~/') : c;
}
