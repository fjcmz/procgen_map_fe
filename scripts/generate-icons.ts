import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');

const sourceMain = readFileSync(resolve(publicDir, 'icon.svg'));
const sourceMaskable = readFileSync(resolve(publicDir, 'icon-maskable.svg'));

async function render(svg: Buffer, size: number, outFile: string) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 26, g: 18, b: 9, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(resolve(publicDir, outFile));
  console.log(`wrote public/${outFile}`);
}

await Promise.all([
  render(sourceMain, 192, 'icon-192.png'),
  render(sourceMain, 512, 'icon-512.png'),
  render(sourceMaskable, 192, 'icon-maskable-192.png'),
  render(sourceMaskable, 512, 'icon-maskable-512.png'),
  render(sourceMain, 180, 'apple-touch-icon.png'),
  render(sourceMain, 32, 'favicon-32.png'),
]);
