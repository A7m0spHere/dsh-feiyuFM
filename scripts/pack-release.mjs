// GitHub archives must declare ordinary dependencies: they contain no bundled
// node_modules. Add the bundle flag only to a disposable npm release staging tree.
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export function packRelease({ dryRun = false, destination = root } = {}) {
  const staging = mkdtempSync(join(tmpdir(), 'feiyufm-release-'));
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const path of globSync([...manifest.files, 'README.md', 'LICENSE'], { cwd: root })) {
      mkdirSync(dirname(join(staging, path)), { recursive: true });
      cpSync(join(root, path), join(staging, path), { recursive: true });
    }
    cpSync(join(root, 'node_modules'), join(staging, 'node_modules'), { recursive: true });
    manifest.bundleDependencies = Object.keys(manifest.dependencies);
    writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    const args = ['pack', '--ignore-scripts', '--json', ...(dryRun ? ['--dry-run'] : ['--pack-destination', resolve(destination)])];
    const npmCli = process.env.npm_execpath ?? (process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null);
    const npm = npmCli ? { command: process.execPath, args: [npmCli, ...args] } : { command: 'npm', args };
    const result = spawnSync(npm.command, npm.args, { cwd: staging, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Release pack failed (${result.status ?? result.error?.code})`);
    return JSON.parse(result.stdout);
  } finally {
    // staging is created above, directly beneath tmpdir; never remove caller input.
    const child = relative(resolve(tmpdir()), staging);
    if (child && !child.startsWith('..') && !child.includes(':') && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--reject-source-publish')) throw new Error('请先 npm run pack:release，再测试并发布生成的 tgz；源码目录不直接发布。');
  const i = process.argv.indexOf('--pack-destination');
  const [pack] = packRelease({ dryRun: process.argv.includes('--dry-run'), ...(i < 0 ? {} : { destination: process.argv[i + 1] }) });
  console.log(JSON.stringify({ filename: pack.filename, size: pack.size, shasum: pack.shasum, integrity: pack.integrity, files: pack.files.length }));
}
