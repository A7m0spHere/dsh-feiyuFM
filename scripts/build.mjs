import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
if (dirname(output) !== root) throw new Error('Build output escaped repository');

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) copyFileSync(source, target);
  }
}

const check = spawnSync(process.execPath, ['scripts/check.mjs'], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status ?? 1);
rmSync(output, { recursive: true, force: true });
copyTree(join(root, 'src'), join(output, 'src'));
copyTree(join(root, 'bin'), join(output, 'bin'));
writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'module', private: true }, null, 2) + '\n');
const smoke = spawnSync(process.execPath, [join(output, 'bin', 'fishfm-debug.mjs')], { input: 'snapshot\nexit\n', encoding: 'utf8', cwd: root });
if (smoke.status !== 0) {
  process.stderr.write(smoke.stderr);
  process.exit(smoke.status ?? 1);
}
console.log('Built dist/ and ran debug smoke');
