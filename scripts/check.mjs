import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const min = [24, 14];
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== min[0] || minor < min[1]) throw new Error('Node 24.14 or newer within Node 24 is required');
const files = [];
for (const folder of ['src', 'bin', 'scripts', 'test']) {
  for (const name of readdirSync(folder)) if (name.endsWith('.mjs')) files.push(join(folder, name));
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Checked ${files.length} modules on Node ${process.versions.node}`);
