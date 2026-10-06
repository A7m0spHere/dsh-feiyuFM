// Run against a clean consumer outside the checkout, using only its installed files.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if (!process.argv[2]) throw new Error('Usage: node scripts/verify-installed-package.mjs <consumer-directory>');
const consumer = resolve(process.argv[2]);
const requireConsumer = createRequire(join(consumer, 'package.json'));
const root = dirname(requireConsumer.resolve('dsh-feiyufm-core/package.json'));
const checkout = fileURLToPath(new URL('../', import.meta.url));
assert.ok(!root.startsWith(checkout) || process.argv.includes('--dsh-profile'), 'Clean consumer must be outside this checkout');
const fromPackage = createRequire(join(root, 'package.json'));
const fromApi = createRequire(fromPackage.resolve('@neteasecloudmusicapienhanced/api'));
const fromPac = createRequire(fromApi.resolve('pac-proxy-agent'));
const fromUri = createRequire(fromPac.resolve('get-uri'));
let basicRoot = dirname(fromUri.resolve('basic-ftp'));
while (!existsSync(join(basicRoot, 'package.json'))) basicRoot = dirname(basicRoot);
const basic = JSON.parse(readFileSync(join(basicRoot, 'package.json'), 'utf8'));
assert.equal(basic.version, '6.2.2', 'Installed consumer did not retain the FTP fix');
assert.ok(basicRoot.startsWith(join(root, 'node_modules')), 'FTP fix must come from the bundled runtime tree');

const plugin = await import(pathToFileURL(join(root, 'index.js')));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, '0.1.0-beta.1');
assert.ok(existsSync(join(root, manifest.dsh.bundle.patch)));
assert.ok(existsSync(join(root, manifest.exports['./client'])));
assert.ok(!existsSync(join(root, 'src/ui/assets/whale-pot-dance.gif')));
const routes = new Map(), cleanups = [];
plugin.registerClientAssets({ effect(work) { cleanups.push(work()); }, webServer: {
  register(route) { routes.set(route.path, route); return () => routes.delete(route.path); },
} });
assert.equal(routes.size, 3);
for (const route of routes.values()) {
  route.handler({ method: 'GET' }, { writeHead(status, headers) {
    assert.equal(status, 200); assert.equal(headers['content-type'], 'image/png');
  }, end(body) { assert.ok(body.length > 0); } });
}
for (const cleanup of cleanups) cleanup();

const { CoreBridge } = await import(pathToFileURL(join(root, 'src/dsh-adapter.mjs')));
const command = plugin.coreCommand({ playback: 'fake', provider: 'fake', database: ':memory:', env: {} });
const bridge = new CoreBridge({ spawnCore: () => spawn(command.command, command.args, {
  env: command.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
}) });
try {
  await bridge.start();
  await bridge.command({ type: 'pause', commandId: 'package-smoke-pause' });
  const state = await bridge.request({ type: 'snapshot' });
  assert.equal(state.snapshot.paused, true);
} finally { await bridge.stop(); }

const { PlaybackSupervisor } = await import(pathToFileURL(join(root, 'src/playback/supervisor.mjs')));
const { PlaybackService } = await import(pathToFileURL(join(root, 'src/playback/service.mjs')));
const supervisor = new PlaybackSupervisor();
const service = new PlaybackService({ supervisor });
try {
  await supervisor.ensureHost();
  assert.equal((await service.hostSnapshot()).status, 'idle');
} finally { await service.close(); }
console.log(`ALL-PASS installed ${manifest.name}@${manifest.version}: FTP ${basic.version}, entry/assets/Core/WPF`);
