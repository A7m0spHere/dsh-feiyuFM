// Inspect the exact npm payload, rather than assuming files/ignore rules work.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { updateDependencyNotices } from './dependency-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
updateDependencyNotices(root, { check: true });
const npm = process.platform === 'win32'
  ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm pack --dry-run --ignore-scripts --json'] }
  : { command: 'npm', args: ['pack', '--dry-run', '--ignore-scripts', '--json'] };
const result = spawnSync(npm.command, npm.args, { cwd: root, encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr || result.error?.message}`);
const [pack] = JSON.parse(result.stdout);
const paths = new Set(pack.files.map(file => file.path));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.private, undefined);
assert.equal(manifest.license, 'SEE LICENSE IN THIRD_PARTY_NOTICES.md');
const beta = /^\d+\.\d+\.\d+-beta\.\d+$/.test(manifest.version);
assert.ok(beta || /^\d+\.\d+\.\d+$/.test(manifest.version), 'Expected a stable or numbered beta version');
assert.equal(manifest.publishConfig.tag, beta ? 'beta' : 'latest');
assert.deepEqual(manifest.os, ['darwin', 'win32']);
for (const path of [
  'package.json', 'index.js', 'cordis.patch.yml', 'bin/fishfm-core.mjs',
  'src/ui/dsh-client.js', 'src/playback/host/macos-host-launcher.mjs',
  'src/playback/host/fishfm-macos-host.swift', 'src/playback/host/wpf-media-host.ps1',
  'src/providers/dpapi-helper.ps1',
  'src/ui/assets/whale-idle.png', 'src/ui/assets/whale-listening.png', 'src/ui/assets/whale-dj.png',
  'src/ui/assets/whale-pot-dance.gif', 'src/ui/assets/whale-pot-still.png',
  ...['glm', 'deepseek', 'claude', 'gemini', 'gpt', 'grok'].map(name => `src/ui/assets/dolls/doll-${name}.png`),
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'npm-shrinkwrap.json', 'docs/DELIVERY.md', 'CHANGELOG.md',
  'node_modules/@unblockneteasemusic/server/COPYING',
  'node_modules/@unblockneteasemusic/server/COPYING.LESSER',
  'node_modules/@unblockneteasemusic/server/src/provider/match.js',
  'node_modules/node-windows/bin/sudowin/LICENSE.txt',
  'node_modules/@tokenizer/token/README.md',
  'node_modules/agent-base/README.md',
  'node_modules/degenerator/README.md',
  'node_modules/https-proxy-agent/README.md',
  'node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/cookie-signature/Readme.md',
]) assert.ok(paths.has(path), `Missing runtime/release file: ${path}`);
assert.ok(!paths.has('DEPENDENCY_LICENSES.md'), 'Copyright notices must remain consolidated');
const copyright = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
const dependencySection = copyright.split('<!-- BEGIN GENERATED DEPENDENCY NOTICES -->')[1]
  .split('<!-- END GENERATED DEPENDENCY NOTICES -->')[0];
for (const [, path] of dependencySection.matchAll(/`(node_modules\/[^`]+)`/g)) {
  assert.ok(paths.has(path), `Declared upstream notice is absent from package: ${path}`);
}
for (const path of paths) {
  // Bundled upstream runtime trees keep their own license/data files. Project
  // exclusions apply to our payload; dependency versions get installed-smoke checks.
  if (path.startsWith('node_modules/')) continue;
  assert.ok(!/^(?:test|scripts|spikes|prototypes|\.github|\.tmp|dist)\//.test(path), `Development file leaked: ${path}`);
  assert.ok(!/(?:\.dpapi|\.sqlite|\.cookie|\.secret|\.env(?:\.|$)|\.(?:wav|mp3|flac|m4a)$)/i.test(path), `Excluded asset/data leaked: ${path}`);
  assert.ok(path !== 'AGENTS.md', 'Agent instructions must not be shipped');
}
// All playback artwork must be present in the payload; user data stays excluded.
console.log(`Package verified: ${pack.filename}; ${pack.entryCount} files; ${(pack.size / 1e6).toFixed(2)} MB compressed`);
