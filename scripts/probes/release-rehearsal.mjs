// Local-only release rehearsal. Never writes a repository version or publishes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { verifyLockedRuntime } from '../pack-release.mjs';

const i = process.argv.indexOf('--out');
if (i < 0 || !process.argv[i + 1]) throw new Error('Pass --out <NEW directory>');
const root = resolve(import.meta.dirname, '../..'), out = resolve(process.argv[i + 1]);
if (existsSync(out)) throw new Error('Rehearsal output must be new');
const stage = join(out, 'source'); mkdirSync(stage, { recursive: true });
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const protectedFiles = ['package.json', 'npm-shrinkwrap.json', 'src/ui/dsh-client.js', 'THIRD_PARTY_NOTICES.md'];
const original = protectedFiles.map(file => hash(join(root, file)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const path of globSync([...manifest.files, 'README.md', 'LICENSE', 'package.json', 'scripts', 'test'], { cwd: root })) {
  mkdirSync(dirname(join(stage, path)), { recursive: true }); cpSync(join(root, path), join(stage, path), { recursive: true });
}
cpSync(join(root, 'node_modules'), join(stage, 'node_modules'), { recursive: true });
manifest.version = '0.1.1';
const lock = JSON.parse(readFileSync(join(stage, 'npm-shrinkwrap.json'), 'utf8'));
lock.version = manifest.version; lock.packages[''].version = manifest.version;
writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(stage, 'npm-shrinkwrap.json'), JSON.stringify(lock, null, 2) + '\n');
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const userConfig = join(out, 'empty-user.npmrc'), globalConfig = join(out, 'empty-global.npmrc');
writeFileSync(userConfig, ''); writeFileSync(globalConfig, '');
const config = ['--userconfig', userConfig, '--globalconfig', globalConfig, '--update-notifier=false'];
const report = { startedAt: new Date().toISOString(), version: '0.1.1', scope: 'temporary-version-only-no-publication', commands: [], registryRequests: [], artifacts: [] };
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
async function command(name, executable, args, cwd = stage, expected = 0) {
  const started = Date.now(); let log = '';
  const child = spawn(executable, args, { cwd, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  const exit = await new Promise((r, j) => { child.once('error', j); child.once('exit', r); });
  writeFileSync(join(out, `${name}.log`), log);
  report.commands.push({ name, exit, durationMs: Date.now() - started }); save();
  assert.equal(expected === 'nonzero' ? exit !== 0 : exit, expected === 'nonzero' ? true : expected, `${name} failed; inspect private log`);
  console.log(JSON.stringify({ name, exit })); return log;
}
const npm = (name, args, cwd, expected) => command(name, process.execPath, [npmCli, ...config, ...args], cwd, expected);
await npm('npm-version', ['--version']);
report.npm = readFileSync(join(out, 'npm-version.log'), 'utf8').trim();
for (const name of ['a', 'b']) {
  const destination = join(out, `artifact-${name}`); mkdirSync(destination);
  await npm(`pack-${name}`, ['--offline', 'run', 'pack:release', '--', '--pack-destination', destination]);
  const file = join(destination, 'dsh-feiyufm-0.1.1.tgz');
  report.artifacts.push({ name, sha256: hash(file) }); save();
}
assert.equal(report.artifacts[0].sha256, report.artifacts[1].sha256, 'Repeated tarballs must be byte-identical');
const tgz = join(out, 'artifact-a/dsh-feiyufm-0.1.1.tgz'), unpack = join(out, 'unpack'); mkdirSync(unpack);
await command('extract', 'tar', ['-xf', tgz, '-C', unpack]);
const packedRoot = join(unpack, 'package'), packed = JSON.parse(readFileSync(join(packedRoot, 'package.json'), 'utf8'));
assert.equal(packed.version, '0.1.1');
assert.deepEqual(packed.bundleDependencies.sort(), Object.keys(packed.dependencies).sort());
report.lockedRuntimeManifests = verifyLockedRuntime(packedRoot).length;
assert.equal(existsSync(join(packedRoot, 'scripts/pack-release.mjs')), false, 'Development lifecycle scripts must not ship');
for (const name of ['a', 'b']) {
  const consumer = join(out, `consumer-${name}`), cache = join(out, `empty-cache-${name}`); mkdirSync(consumer); mkdirSync(cache);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: `feiyufm-rehearsal-${name}`, private: true }));
  // Scripts remain enabled: installing a tgz must not run its directory-only
  // prepack/prepublish guard, and its bundled dependencies need no registry.
  await npm(`install-${name}`, ['install', '--offline', '--no-audit', '--no-fund', '--cache', cache, '--registry', 'http://127.0.0.1:9/', tgz], consumer);
  const installed = join(consumer, 'node_modules/dsh-feiyufm');
  assert.equal(verifyLockedRuntime(installed).length, report.lockedRuntimeManifests);
  await npm(`dependency-tree-${name}`, ['ls', '--all', '--omit=dev', '--offline', '--json'], consumer);
  await command(`installed-smoke-${name}`, process.execPath, [join(stage, 'scripts/verify-installed-package.mjs'), consumer], consumer);
}
// This server observes reads and rejects all writes. CLI --registry overrides
// publishConfig; --dry-run is mandatory, so no public registry is contacted.
const server = createServer((req, res) => {
  report.registryRequests.push({ method: req.method, path: new URL(req.url, 'http://localhost').pathname });
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ name: 'dsh-feiyufm', versions: {}, 'dist-tags': {} }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const registry = `http://127.0.0.1:${server.address().port}/`;
try {
  const log = await npm('tgz-publish-dry-run', ['publish', tgz, '--dry-run', '--json', '--provenance=false', '--registry', registry, '--cache', join(out, 'dry-run-cache')]);
  assert.ok(log.includes('dsh-feiyufm@0.1.1'), 'Dry-run must inspect the generated artifact');
  const guard = await npm('source-publish-dry-run', ['publish', '.', '--dry-run', '--registry', registry], stage, 'nonzero');
  assert.match(guard, /源码目录不直接发布/);
  assert.ok(report.registryRequests.every(r => r.method === 'GET'), 'A publish rehearsal attempted a write');
  report.lifecycle = { tgzDryRunSucceededWithScriptsEnabled: true, sourcePublishRejected: true, registryWrites: 0,
    note: 'npm publish tgz skips prepublishOnly/prepack/prepare/postpack/publish/postpublish; explicit tests and artifact verification are required before any real publish' };
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
report.repositoryFilesUnchanged = protectedFiles.every((file, n) => hash(join(root, file)) === original[n]);
assert.equal(report.repositoryFilesUnchanged, true);
report.finishedAt = new Date().toISOString(); save();
console.log(JSON.stringify({ repeatedSha256: report.artifacts[0].sha256, runtimeManifests: report.lockedRuntimeManifests, normalOfflineInstalls: 2, lifecycle: report.lifecycle, repositoryFilesUnchanged: true }));
