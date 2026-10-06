// Reproduce the user's local extraction without resizing/redrawing any pixels.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceAt = process.argv.indexOf('--source');
if (sourceAt < 0 || !process.argv[sourceAt + 1]) throw new Error('Usage: node scripts/import-doll-artwork.mjs --source <Workshop directory>');
const source = resolve(process.argv[sourceAt + 1], 'assets');
const target = fileURLToPath(new URL('../src/ui/assets/dolls/', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../docs/spikes/U12-doll-assets.json', import.meta.url), 'utf8'));
const images = manifest.files.map(row => {
  const bytes = readFileSync(join(source, row.file));
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Source image changed: ${row.file}`);
  return { name: row.file, bytes };
});
mkdirSync(target, { recursive: true });
for (const image of images) writeFileSync(join(target, image.name), image.bytes);
console.log(`Imported ${images.length} unchanged doll PNGs to ${target}`);
