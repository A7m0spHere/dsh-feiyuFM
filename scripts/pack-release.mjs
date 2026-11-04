// GitHub archives must declare ordinary dependencies: they contain no bundled
// node_modules. Add the bundle flag only to a disposable npm release staging tree.
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export function verifyLockedRuntime(directory = root) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(directory, 'npm-shrinkwrap.json'), 'utf8'));
  if (lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) throw new Error('Release version and shrinkwrap version differ');
  const dependencies = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  if (dependencies(manifest.dependencies) !== dependencies(lock.packages[''].dependencies)) throw new Error('Release dependencies and shrinkwrap differ');
  const entries = Object.entries(lock.packages).filter(([path, pinned]) => path && !pinned.dev);
  for (const [path, pinned] of entries) {
    if (!path.startsWith('node_modules/') || path.split('/').includes('..')) throw new Error('Invalid locked runtime path');
    const file = join(directory, path, 'package.json');
    if (!existsSync(file)) throw new Error(`Missing locked runtime dependency: ${path}`);
    if (JSON.parse(readFileSync(file, 'utf8')).version !== pinned.version) throw new Error(`Locked runtime version differs: ${path}`);
  }
  return entries.map(([path, pinned]) => ({ path, version: pinned.version }));
}

export function normalizeBundledFtpOverride(directory) {
  if (resolve(directory) === root) throw new Error('Bundled metadata normalization requires a staging tree');
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const version = manifest.overrides?.['basic-ftp'];
  if (!version) return [];
  const uriFile = join(directory, 'node_modules/get-uri/package.json');
  const uri = JSON.parse(readFileSync(uriFile, 'utf8'));
  const ftp = JSON.parse(readFileSync(join(directory, 'node_modules/basic-ftp/package.json'), 'utf8'));
  const lockFile = join(directory, 'npm-shrinkwrap.json'), lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  if (typeof version !== 'string' || ftp.version !== version || !uri.dependencies?.['basic-ftp']
    || !lock.packages?.['node_modules/get-uri']?.dependencies?.['basic-ftp']) throw new Error('Reviewed bundled FTP override no longer matches the runtime tree');
  // Consumer roots do not inherit a dependency package's overrides. Describe
  // the already-selected FTP replacement in the shipped metadata too; no
  // upstream JavaScript, version or license text is changed.
  const from = uri.dependencies['basic-ftp'];
  uri.dependencies['basic-ftp'] = version;
  lock.packages['node_modules/get-uri'].dependencies['basic-ftp'] = version;
  writeFileSync(uriFile, JSON.stringify(uri, null, 2) + '\n');
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
  return [{ package: `${uri.name}@${uri.version}`, dependency: 'basic-ftp', from, to: version }];
}

export function packRelease({ dryRun = false, destination = root } = {}) {
  const runtime = verifyLockedRuntime();
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
    const metadataOverrides = normalizeBundledFtpOverride(staging);
    const args = ['pack', '--ignore-scripts', '--json', ...(dryRun ? ['--dry-run'] : ['--pack-destination', resolve(destination)])];
    const npmCli = process.env.npm_execpath ?? (process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null);
    const npm = npmCli ? { command: process.execPath, args: [npmCli, ...args] } : { command: 'npm', args };
    const result = spawnSync(npm.command, npm.args, { cwd: staging, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Release pack failed (${result.status ?? result.error?.code})`);
    const packs = JSON.parse(result.stdout);
    packs[0].metadataOverrides = metadataOverrides;
    const paths = new Set(packs[0].files.map(file => file.path));
    for (const entry of runtime) if (!paths.has(`${entry.path}/package.json`)) throw new Error(`Packed runtime dependency is absent: ${entry.path}`);
    return packs;
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
