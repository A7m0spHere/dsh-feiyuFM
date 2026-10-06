// Inspect the exact npm payload, rather than assuming files/ignore rules work.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32'
  ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm pack --dry-run --ignore-scripts --json'] }
  : { command: 'npm', args: ['pack', '--dry-run', '--ignore-scripts', '--json'] };
const result = spawnSync(npm.command, npm.args, { cwd: root, encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr || result.error?.message}`);
const [pack] = JSON.parse(result.stdout);
const paths = new Set(pack.files.map(file => file.path));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.private, undefined);
assert.equal(manifest.publishConfig.tag, 'beta');
assert.deepEqual(manifest.os, ['win32']);
assert.match(manifest.version, /^\d+\.\d+\.\d+-beta\.\d+$/);
for (const path of [
  'package.json', 'index.js', 'cordis.patch.yml', 'bin/fishfm-core.mjs',
  'src/ui/dsh-client.js', 'src/playback/host/wpf-media-host.ps1',
  'src/ui/assets/whale-idle.png', 'src/ui/assets/whale-listening.png', 'src/ui/assets/whale-dj.png',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'DEPENDENCY_LICENSES.md', 'npm-shrinkwrap.json', 'docs/DELIVERY.md', 'CHANGELOG.md',
]) assert.ok(paths.has(path), `Missing runtime/release file: ${path}`);
for (const path of paths) {
  // Bundled upstream runtime trees keep their own license/data files. Project
  // exclusions apply to our payload; dependency versions get installed-smoke checks.
  if (path.startsWith('node_modules/')) continue;
  assert.ok(!/^(?:test|scripts|spikes|prototypes|\.github|\.tmp|dist)\//.test(path), `Development file leaked: ${path}`);
  assert.ok(!/(?:whale-pot|doll-.*\.png|\.dpapi|\.sqlite|\.cookie|\.secret|\.env(?:\.|$)|\.(?:wav|mp3|flac|m4a)$)/i.test(path), `Excluded asset/data leaked: ${path}`);
  assert.ok(path !== 'AGENTS.md', 'Agent instructions must not be shipped');
}
// The shared client can use optional local artwork only when the host reports it.
console.log(`Package verified: ${pack.filename}; ${pack.entryCount} files; ${(pack.size / 1e6).toFixed(2)} MB compressed`);
