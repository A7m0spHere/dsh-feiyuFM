import test from 'node:test';
import assert from 'node:assert/strict';
import { registerClientAssets } from '../index.js';

test('FishFM artwork routes are whitelisted, read-only static PNGs and unload cleanly', () => {
  const routes = new Map();
  let effectCleanup;
  let disposed = 0;
  registerClientAssets({
    webServer: { register(route) { routes.set(route.path, route); return () => { disposed += 1; routes.delete(route.path); }; } },
    effect(fn) { effectCleanup = fn(); },
  });
  assert.deepEqual([...routes.keys()].sort(), [
    '/fishfm/assets/whale-dj.png', '/fishfm/assets/whale-idle.png', '/fishfm/assets/whale-listening.png',
  ]);
  for (const route of routes.values()) {
    const headers = {};
    let body;
    route.handler({ method: 'GET' }, { writeHead(status, value) { headers.status = status; Object.assign(headers, value); }, end(value) { body = value; } });
    assert.equal(headers.status, 200);
    assert.equal(headers['content-type'], 'image/png');
    assert.ok(body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal(headers['content-length'], body.length);
  }
  let rejected = false;
  routes.values().next().value.handler({ method: 'POST' }, { writeHead(status) { rejected = status === 405; }, end() {} });
  assert.equal(rejected, true);
  effectCleanup();
  assert.equal(disposed, 3);
  assert.equal(routes.size, 0);
});
