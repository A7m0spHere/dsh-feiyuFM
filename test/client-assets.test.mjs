import test from 'node:test';
import assert from 'node:assert/strict';
import { registerClientAssets } from '../index.js';
import { clientArtwork } from '../src/ui/artwork-assets.mjs';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('FishFM local artwork whitelist serves GIF and extracted dolls and unloads cleanly', () => {
  const routes = new Map();
  let effectCleanup;
  let disposed = 0;
  registerClientAssets({
    webServer: { register(route) { routes.set(route.path, route); return () => { disposed += 1; routes.delete(route.path); }; } },
    effect(fn) { effectCleanup = fn(); },
  });
  assert.deepEqual([...routes.keys()].sort(), [...clientArtwork().files.keys()].sort());
  assert.ok(routes.has('/fishfm/assets/whale-pot-dance.gif'));
  const count = routes.size;
  for (const route of routes.values()) {
    const headers = {};
    let body;
    route.handler({ method: 'GET' }, { writeHead(status, value) { headers.status = status; Object.assign(headers, value); }, end(value) { body = value; } });
    assert.equal(headers.status, 200);
    const gif = route.path.endsWith('.gif');
    assert.equal(headers['content-type'], gif ? 'image/gif' : 'image/png');
    assert.ok(gif ? body.subarray(0, 6).toString() === 'GIF89a'
      : body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal(headers['content-length'], body.length);
  }
  let rejected = false;
  routes.values().next().value.handler({ method: 'POST' }, { writeHead(status) { rejected = status === 405; }, end() {} });
  assert.equal(rejected, true);
  effectCleanup();
  assert.equal(disposed, count);
  assert.equal(routes.size, 0);
});

test('public package without optional artwork registers only three PNGs and reports no GIF or dolls', () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-art-'));
  const routes = new Map();
  let cleanup;
  try {
    for (const name of ['idle', 'listening', 'dj']) copyFileSync(fileURLToPath(new URL(`../src/ui/assets/whale-${name}.png`, import.meta.url)), join(root, `whale-${name}.png`));
    assert.deepEqual(clientArtwork(root).capabilities, { gif: false, dolls: [] });
    registerClientAssets({ effect(fn) { cleanup = fn(); }, webServer: { register(route) {
      routes.set(route.path, route); return () => routes.delete(route.path);
    } } }, { assetRoot: root });
    assert.equal(routes.size, 3);
    cleanup(); assert.equal(routes.size, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
