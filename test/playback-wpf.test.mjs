// Real WPF regression: no play command is sent, so this test cannot emit sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';
import { PlaybackService } from '../src/playback/service.mjs';
import { wpfBackend } from '../src/playback/backends.mjs';

test('WPF accepts stop while a remote media open is stalled', { skip: process.platform !== 'win32' }, async () => {
  let requested;
  const received = new Promise(resolve => { requested = resolve; });
  const server = createServer(() => requested()); // Deliberately withhold HTTP headers.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const supervisor = new PlaybackSupervisor({ backend: wpfBackend() });
  const service = new PlaybackService({ supervisor, openTimeoutMs: 8000, commandTimeoutMs: 1500 });
  const controller = new AbortController();
  let loading;
  let cancelled;
  let guard;
  try {
    await supervisor.ensureHost();
    await service.setMuted({ muted: true, version: 1 });
    loading = service.load({ resource: { handle: `http://127.0.0.1:${server.address().port}/stalled.wav` }, playInstanceId: 'stalled-open', version: 1, signal: controller.signal });
    cancelled = assert.rejects(loading, error => error.code === 'cancelled');
    cancelled.catch(() => {});
    await Promise.race([received, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('WPF did not request the test media')), 5000); })]);
    clearTimeout(guard);
    controller.abort();
    await cancelled;
    const started = performance.now();
    await service.stop({ version: 2 });
    assert.ok(performance.now() - started < 1500, 'stop must not wait for the old media-open deadline');
    assert.equal(supervisor.connected, true);
    assert.equal((await service.hostSnapshot()).status, 'idle');
    assert.equal(supervisor.transport.pending.size, 0, 'superseded load must also receive an acknowledgement');
  } finally {
    clearTimeout(guard); controller.abort();
    await loading?.catch(() => {});
    await cancelled?.catch(() => {});
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await service.close({ gracefulTimeoutMs: 1500 });
    await closed;
  }
});
