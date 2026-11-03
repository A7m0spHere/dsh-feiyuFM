import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PlaybackService } from '../src/playback/service.mjs';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';
import { fakeBackend } from '../src/playback/backends.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function controlled() {
  const calls = [];
  const opens = [];
  const supervisor = {
    generation: 1, connected: true,
    request(command) {
      calls.push(command);
      if (command.type === 'preload') {
        const open = deferred(); opens.push(open); return open.promise;
      }
      return Promise.resolve(command.type === 'load' ? { positionMs: 0, playing: false } : {});
    },
  };
  const service = new PlaybackService({ supervisor });
  return { supervisor, service, calls, opens };
}

test('standby opens are shared and exact ready resources are reused without reopening', async () => {
  const h = controlled();
  const resource = { handle: 'fake:one' };
  const first = h.service.preload({ resource, version: 1 });
  const shared = h.service.preload({ resource, version: 1 });
  assert.equal(h.opens.length, 1);
  assert.equal(h.service.state().preloadStatus, 'loading');
  h.opens[0].resolve({ preloaded: true });
  await Promise.all([first, shared]);
  await h.service.preload({ resource, version: 2 });
  assert.equal(h.opens.length, 1);
  assert.equal(h.service.isPreloaded(resource), true);
  assert.equal(h.service.isPreloaded({ handle: 'fake:refreshed-url' }), false);
  h.supervisor.generation++;
  assert.equal(h.service.isPreloaded(resource), false, 'a replacement host cannot inherit standby readiness');
});

test('cancelled and late standby results cannot claim or cancel a newer target', async () => {
  const h = controlled();
  const controller = new AbortController();
  const old = h.service.preload({ resource: { handle: 'fake:old' }, version: 1, signal: controller.signal });
  const cancelled = assert.rejects(old, error => error.code === 'cancelled');
  controller.abort();
  const next = h.service.preload({ resource: { handle: 'fake:new' }, version: 2 });
  await cancelled;
  await delay(0);
  h.opens[1].resolve({ preloaded: true });
  await next;
  h.opens[0].resolve({ preloaded: true });
  await delay(0);
  assert.equal(h.service.isPreloaded({ handle: 'fake:new' }), true);
  assert.equal(h.calls.filter(call => call.type === 'preloadCancel').length, 1);
});

for (const control of ['pause', 'stop', 'load']) {
  test(`${control} invalidates standby readiness without an extra cancellation round trip`, async () => {
    const h = controlled();
    const resource = { handle: 'fake:ready' };
    const open = h.service.preload({ resource, version: 1 });
    h.opens[0].resolve({ preloaded: true });
    await open;
    if (control === 'load') await h.service.load({ resource, playInstanceId: 'new', version: 2, usePreload: true });
    else await h.service[control]({ version: 2 });
    assert.equal(h.service.isPreloaded(resource), false);
    assert.equal(h.calls.filter(call => call.type === 'preloadCancel').length, 0);
  });
}

test('failed standby open retains normal foreground load fallback', async () => {
  const h = controlled();
  const resource = { handle: 'fake:fallback' };
  const open = h.service.preload({ resource, version: 1 });
  const rejected = assert.rejects(open, /host unavailable/);
  h.opens[0].reject(new Error('host unavailable'));
  await rejected;
  assert.equal(h.service.isPreloaded(resource), false);
  assert.equal((await h.service.load({ resource, playInstanceId: 'fallback', version: 2 })).positionMs, 0);
});

for (const control of ['cancelPreload', 'pause', 'stop', 'load']) {
  test(`pipe host acknowledges pending preload on ${control} and preserves foreground requests`, async () => {
    const supervisor = new PlaybackSupervisor({ backend: fakeBackend({ openDelayMs: 150 }) });
    const service = new PlaybackService({ supervisor, openTimeoutMs: 1000, commandTimeoutMs: 1000 });
    try {
      await supervisor.ensureHost();
      const open = service.preload({ resource: { handle: 'fake:pending' }, version: 1 });
      const rejected = assert.rejects(open, error => error.code === 'cancelled');
      await delay(20);
      if (control === 'load') {
        await service.load({ resource: { handle: 'fake:foreground' }, playInstanceId: 'foreground', version: 2 });
      } else await service[control]({ version: 2 });
      await rejected;
      assert.equal(supervisor.transport.pending.size, 0, 'cancelled preload must not leave a pipe timeout behind');
      assert.equal(supervisor.connected, true);
      const state = await service.hostSnapshot();
      if (control === 'load') assert.equal(state.playInstanceId, 'foreground');
    } finally { await service.close({ gracefulTimeoutMs: 1000 }); }
  });
}
