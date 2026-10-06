import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('./assets/', import.meta.url));
export const DOLL_NAMES = Object.freeze(['glm', 'deepseek', 'claude', 'gemini', 'gpt', 'grok']);
// Packages ship the full set. Keep graceful fallback for older/incomplete installs.
export function clientArtwork(root = defaultRoot) {
  const files = new Map(['idle', 'listening', 'dj'].map(name =>
    [`/fishfm/assets/whale-${name}.png`, join(root, `whale-${name}.png`)]));
  const optional = ['whale-pot-dance.gif', 'whale-pot-still.png', ...DOLL_NAMES.map(name => `dolls/doll-${name}.png`)];
  for (const name of optional) if (existsSync(join(root, name))) files.set(`/fishfm/assets/${name}`, join(root, name));
  const gif = files.has('/fishfm/assets/whale-pot-dance.gif') && files.has('/fishfm/assets/whale-pot-still.png');
  const dolls = DOLL_NAMES.filter(name => files.has(`/fishfm/assets/dolls/doll-${name}.png`));
  return { files, capabilities: { gif, dolls } };
}
export const artworkCapabilities = clientArtwork().capabilities;
