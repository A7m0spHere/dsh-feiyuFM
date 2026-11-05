import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PlaybackService } from '../src/playback/service.mjs';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';
import { fakeBackend, wpfBackend } from '../src/playback/backends.mjs';

const wait = async predicate => {
  const deadline = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Playback condition timed out'); await new Promise(resolve => setTimeout(resolve, 30)); }
};
async function serviceFor(t, backend) {
  const supervisor = new PlaybackSupervisor({ backend, startupTimeoutMs: 15_000 });
  const service = new PlaybackService({ supervisor, progressIntervalMs: 0 });
  const events = [];
  service.onEvent(event => events.push(event));
  t.after(() => service.close({ gracefulTimeoutMs: 3000 }));
  return { service, supervisor, events };
}
test('pipe seek goes forward, backward and to zero without a second start or credit for the skipped interval', async t => {
  const h = await serviceFor(t, fakeBackend({ durationMs: 20_000, tickMs: 20 }));
  await h.service.load({ resource: { handle: 'fake:seek' }, playInstanceId: 'seek', version: 1, autoplay: true });
  await wait(() => h.events.some(event => event.type === 'started'));
  for (const [index, positionMs] of [10_000, 500, 0].entries()) {
    await h.service.seek({ playInstanceId: 'seek', positionMs, version: index + 2 });
    assert.equal(h.events.findLast(row => row.type === 'positioned').positionMs, positionMs);
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(h.events.filter(row => row.type === 'started').length, 1);
  assert.ok(h.events.filter(row => row.type === 'progress').every(row => row.effectiveDeltaMs < 1000));
  await h.service.pause({ version: 5 });
  await h.service.seek({ playInstanceId: 'seek', positionMs: 3000, version: 6 });
  assert.equal(h.supervisor.hostState.status, 'paused');
  assert.equal(h.supervisor.hostState.positionMs, 3000);
});
test('a failed pipe seek reconciles real position while keeping the audio host and current instance', async t => {
  const h = await serviceFor(t, fakeBackend({ durationMs: 20_000, seekFailure: true }));
  await h.service.load({ resource: { handle: 'fake:seek' }, playInstanceId: 'seek', version: 1, autoplay: true });
  const pid = h.supervisor.pid;
  await assert.rejects(h.service.seek({ playInstanceId: 'seek', positionMs: 10_000, version: 2 }), { code: 'seek_failed' });
  assert.equal(h.supervisor.pid, pid);
  assert.equal(h.service.active.playInstanceId, 'seek');
  assert.ok(h.service.active.positionMs < 5000);
  assert.equal(h.events.filter(row => row.type === 'error').length, 0);
});
function silentWav(seconds = 20) {
  const bytes = seconds * 8000 * 2, b = Buffer.alloc(44 + bytes);
  b.write('RIFF'); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}
test('real muted WPF seeks forward/backward/zero and seeks while paused without reopening media',
  { skip: process.platform !== 'win32' || process.env.FISHFM_TEST_REAL_AUDIO === '0', timeout: 40_000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'feiyufm-seek-'));
    const file = join(directory, 'silent.wav'); writeFileSync(file, silentWav());
    const h = await serviceFor(t, wpfBackend({ volume: 0, warmHolders: 0 }));
    try {
      await h.service.load({ resource: { handle: pathToFileURL(file).href }, playInstanceId: 'real-seek', version: 1, muted: true, autoplay: true });
      await wait(() => h.events.some(row => row.type === 'started'));
      const pid = h.supervisor.pid;
      for (const [index, positionMs] of [9000, 2000, 0].entries()) {
        const answer = await h.service.seek({ playInstanceId: 'real-seek', positionMs, version: index + 2 });
        assert.ok(Math.abs(answer.positionMs - positionMs) <= 500, `${positionMs}: actual ${answer.positionMs}`);
        assert.equal(h.supervisor.pid, pid);
        assert.equal(h.supervisor.hostState.status, 'playing');
      }
      await h.service.pause({ version: 5 });
      const answer = await h.service.seek({ playInstanceId: 'real-seek', positionMs: 6000, version: 6 });
      assert.ok(Math.abs(answer.positionMs - 6000) <= 500);
      assert.equal(h.supervisor.hostState.status, 'paused');
      assert.equal(h.events.filter(row => row.type === 'started').length, 1);
    } finally { await h.service.close({ gracefulTimeoutMs: 3000 }); rmSync(directory, { recursive: true, force: true }); }
  });
