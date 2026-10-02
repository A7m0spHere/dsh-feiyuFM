import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyClientBundle } from './client-bundle.mjs';

const min = [24, 14];
verifyClientBundle();
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== min[0] || minor < min[1]) throw new Error('Node 24.14 or newer within Node 24 is required');

const SKIP = new Set(['node_modules', 'dist', '.tmp', '.git']);
const files = [];
/** Nested modules must be checked too: Phase 2 adds subfolders under src/. */
function collect(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) collect(join(folder, entry.name));
    } else if (/\.(mjs|js)$/.test(entry.name)) {
      files.push(join(folder, entry.name));
    }
  }
}
for (const folder of ['src', 'bin', 'scripts', 'test']) collect(folder);
files.sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Checked ${files.length} modules on Node ${process.versions.node}`);
