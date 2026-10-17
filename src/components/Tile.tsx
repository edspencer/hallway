// A favicon, brand or monogram tile (docs/05-ui.md, "Thumbnails", tier 1), and the dominant colour of the icon, which
// becomes the door's paint. The colour is read from the image in a canvas (src/lib/colour.ts); icons come from the
// daemon, so the canvas is never tainted. A brand mark (D63, src/lib/brands.ts) needs no canvas: its colour is the
// registry's hex, known up front.
import { useEffect, useState } from 'react';
import type { BrandEntry } from '../lib/brands';
import { dominantColour, monogram } from '../lib/colour';

const colours = new Map<string, string | null>();

/** The dominant colour of the image at `url` (null: none, or not loaded yet). Cached per URL. */
export function useImageColour(url: string | null): string | null {
  const [colour, setColour] = useState<string | null>(() => (url ? (colours.get(url) ?? null) : null));
  useEffect(() => {
    if (!url) return setColour(null);
    if (colours.has(url)) return setColour(colours.get(url) ?? null);
    let live = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      let c: string | null = null;
      try {
        const n = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = n;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, n, n);
          c = dominantColour(ctx.getImageData(0, 0, n, n).data);
        }
      } catch {
        c = null;
      }
      colours.set(url, c);
      if (live) setColour(c);
    };
    img.onerror = () => colours.set(url, null);
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return colour;
}

/** Is an `icon:` value text to draw (an emoji) rather than `auto` or an image? */
export const isGlyph = (icon: string | undefined) => !!icon && icon !== 'auto' && !/^(https?:|\/|~\/|\.\/)/.test(icon) && !/\.\w{2,4}$/.test(icon) && [...icon].length <= 4;

export function Tile({ name, src, glyph, brand, className = '' }: { name: string; src: string | null; glyph?: string | null; brand?: BrandEntry | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <span className={`hw-tile ${brand && !src ? 'hw-tile--brand' : ''} ${className}`} aria-hidden="true">
      {src && !broken ? (
        <img src={src} alt="" width={32} height={32} decoding="async" onError={() => setBroken(true)} />
      ) : brand ? (
        <svg className="hw-tile-brand" viewBox="0 0 24 24" role="img" aria-label={brand.title}>
          <path d={brand.path} />
        </svg>
      ) : glyph ? (
        <span className="hw-tile-glyph">{glyph}</span>
      ) : (
        <span className="hw-tile-mono">{monogram(name)}</span>
      )}
    </span>
  );
}
