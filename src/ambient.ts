// Ambient status (D22, docs/05-ui.md): the tab title counts what's wrong, and the favicon is redrawn with a status
// mark, so a pinned or background tab shows trouble at a glance. Only `down` and `unhealthy` count (D12).
import { useEffect } from 'react';
import { faviconMark, tabTitle, type Counts } from './lib/status';

/** The mark's colours: read from the theme tokens, so the favicon follows the palette. */
function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

let base: Promise<HTMLImageElement> | null = null;
function baseIcon() {
  base ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = '/favicon.svg';
  });
  return base;
}

/** The working mark with a status badge in its corner: a square for down, a triangle for unhealthy. */
async function drawFavicon(mark: 'down' | 'unhealthy' | null): Promise<string | null> {
  if (!mark) return null;
  const img = await baseIcon();
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const ring = token('--hw-bg', '#15110e');
  ctx.fillStyle = mark === 'down' ? token('--hw-down', '#ff6b5e') : token('--hw-unhealthy', '#e8b44a');
  ctx.strokeStyle = ring;
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (mark === 'down') {
    ctx.roundRect(34, 34, 28, 28, 5);
  } else {
    ctx.moveTo(48, 31);
    ctx.lineTo(63, 61);
    ctx.lineTo(33, 61);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.fill();
  return canvas.toDataURL('image/png');
}

export function useAmbientStatus(counts: Pick<Counts, 'down' | 'unhealthy'> | null, name: string) {
  const { down = 0, unhealthy = 0 } = counts ?? {};
  useEffect(() => {
    document.title = tabTitle({ down, unhealthy }, name);
  }, [down, unhealthy, name]);
  useEffect(() => {
    let cancelled = false;
    void drawFavicon(faviconMark({ down, unhealthy }))
      .catch(() => null)
      .then((href) => {
        if (cancelled) return;
        let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.append(link);
        }
        link.type = href ? 'image/png' : 'image/svg+xml';
        link.href = href ?? '/favicon.svg';
      });
    return () => {
      cancelled = true;
    };
  }, [down, unhealthy]);
}
