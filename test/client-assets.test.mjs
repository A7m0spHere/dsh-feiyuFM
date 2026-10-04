import test from 'node:test';
import assert from 'node:assert/strict';
import { registerClientAssets } from '../index.js';

test('FishFM artwork routes whitelist PNG/GIF with matching MIME types and unload cleanly', () => {
  const routes = new Map();
  let effectCleanup;
  let disposed = 0;
  registerClientAssets({
    webServer: { register(route) { routes.set(route.path, route); return () => { disposed += 1; routes.delete(route.path); }; } },
    effect(fn) { effectCleanup = fn(); },
  });
  assert.deepEqual([...routes.keys()].sort(), [
    '/fishfm/assets/whale-dj.png', '/fishfm/assets/whale-idle.png', '/fishfm/assets/whale-listening.png',
    '/fishfm/assets/whale-pot-dance.gif', '/fishfm/assets/whale-pot-still.png',
  ]);
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
  assert.equal(disposed, 5);
  assert.equal(routes.size, 0);
});
