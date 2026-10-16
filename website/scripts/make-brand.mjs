// Builds the site's icons and social card from the hand-authored SVGs in brand/:
//
//   brand/mark.svg     -> public/favicon.svg, src/assets/mark.svg (as is)
//                         public/favicon.ico (16/32/48, PNG-in-ICO), public/apple-touch-icon.png (180)
//   brand/og-image.svg -> public/og-image.png (1200x630)
//
// Run `npm run brand` after changing either SVG, look at the PNGs, and commit the results. The outputs are committed
// (like Local Review's brand copies) so a deploy never depends on this script. Local Review has a repo-level brand/
// kit that its site copies from; Hallway has no app yet, so its (placeholder) brand lives here, inside website/,
// where Cloudflare's build can see it.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (rel) => join(site, rel);

copyFileSync(p('brand/mark.svg'), p('public/favicon.svg'));
copyFileSync(p('brand/mark.svg'), p('src/assets/mark.svg'));

const mark = readFileSync(p('brand/mark.svg'));
const png = (size) => sharp(mark, { density: Math.ceil((72 * size) / 64) * 2 }).resize(size, size).png().toBuffer();

// iOS rounds the corners itself, and draws a transparent area black: flatten onto the tile colour.
await sharp(mark, { density: 72 * 6 }).resize(180, 180).flatten({ background: '#1f1a14' }).png().toFile(p('public/apple-touch-icon.png'));

// An ICO is a 6-byte header, one 16-byte directory entry per image, then the images; modern ICOs embed PNGs as is.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
	const e = 6 + 16 * i;
	header.writeUInt8(size, e); // width
	header.writeUInt8(size, e + 1); // height
	header.writeUInt8(0, e + 2); // palette colours
	header.writeUInt8(0, e + 3); // reserved
	header.writeUInt16LE(1, e + 4); // colour planes
	header.writeUInt16LE(32, e + 6); // bits per pixel
	header.writeUInt32LE(images[i].length, e + 8);
	header.writeUInt32LE(offset, e + 12);
	offset += images[i].length;
});
writeFileSync(p('public/favicon.ico'), Buffer.concat([header, ...images]));

await sharp(readFileSync(p('brand/og-image.svg')), { density: 144 }).resize(1200, 630).png().toFile(p('public/og-image.png'));

console.log('brand: favicon.svg, favicon.ico, apple-touch-icon.png, og-image.png, src/assets/mark.svg');
