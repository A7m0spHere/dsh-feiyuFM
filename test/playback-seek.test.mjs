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

async function controlledSeek({ controlStatus = 'playing' } = {}) {
  let complete, fail;
  const supervisor = {
    hello: { capabilities: { seekInPlace: true } },
    request: async command => {
      if (command.type === 'load') return { positionMs: 60_000 };
      if (command.type === 'seek') return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      return { positionMs: 5000, state: { playInstanceId: 'seek-race', version: command.version,
        positionMs: 5000, status: command.type === 'snapshot' ? 'ended' : controlStatus } };
    },
  };
  const service = new PlaybackService({ supervisor, progressIntervalMs: 0 });
  const events = [];
  service.onEvent(event => events.push(event));
  await service.load({ resource: { handle: 'fake:race' }, playInstanceId: 'seek-race', version: 1 });
  service._onHostMessage({ type: 'event', event: 'started', playInstanceId: 'seek-race', version: 1 });
  return { service, supervisor, events, complete: value => complete(value), fail: error => fail(error) };
}

for (const control of ['setMuted', 'play']) {
  test(`a ${control} superseding an unconfirmed backward seek adopts its actual position`, async () => {
    const h = await controlledSeek();
    const seeking = h.service.seek({ playInstanceId: 'seek-race', positionMs: 5000, version: 2 });
    await h.service[control]({ playInstanceId: 'seek-race', muted: true, version: 3 });
    h.complete({ positionMs: 5000, state: { playInstanceId: 'seek-race', version: 2, positionMs: 5000, status: 'playing' } });
    await assert.rejects(seeking, { code: 'cancelled' });
    assert.equal(h.service.active.positionMs, 5000);
    assert.equal(h.events.findLast(row => row.type === 'positioned')?.version, 3);
    h.service._onHostMessage({ type: 'event', event: 'progress', playInstanceId: 'seek-race', version: 3, positionMs: 5500 });
    assert.equal(h.events.findLast(row => row.type === 'progress')?.positionMs, 5500);
    assert.equal(h.supervisor.hostState.version, 3);
  });
}

for (const failed of [false, true]) {
  test(`a song ending during a ${failed ? 'failed' : 'successful'} seek is reconciled once`, async () => {
    const h = await controlledSeek();
    const seeking = h.service.seek({ playInstanceId: 'seek-race', positionMs: 5000, version: 2 });
    h.service._onHostMessage({ type: 'event', event: 'ended', playInstanceId: 'seek-race', version: 2, positionMs: 65_000 });
    if (failed) {
      h.fail(Object.assign(new Error('Seek failed'), { code: 'seek_failed' }));
      await assert.rejects(seeking, { code: 'seek_failed' });
    } else {
      h.complete({ positionMs: 65_000, state: { playInstanceId: 'seek-race', version: 2, positionMs: 65_000, status: 'ended' } });
      await seeking;
    }
    assert.equal(h.events.filter(row => row.type === 'ended').length, 1);
    assert.equal(h.service.active, null);
    assert.equal(h.events.filter(row => row.type === 'progress').length, 0);
  });
}

for (const control of ['setMuted', 'play']) {
  test(`a ${control} replacing seek also reconciles a terminal host snapshot`, async () => {
    const h = await controlledSeek({ controlStatus: 'ended' });
    const seeking = h.service.seek({ playInstanceId: 'seek-race', positionMs: 5000, version: 2 });
    await h.service[control]({ playInstanceId: 'seek-race', muted: true, version: 3 });
    h.complete({ positionMs: 5000, state: { playInstanceId: 'seek-race', version: 2, positionMs: 5000, status: 'playing' } });
    await assert.rejects(seeking, { code: 'cancelled' });
    assert.equal(h.events.filter(row => row.type === 'ended').length, 1);
    assert.equal(h.service.active, null);
  });
}

test('a stale ending during seek cannot finish a timeline confirmed playing at the new position', async () => {
  const h = await controlledSeek();
  const seeking = h.service.seek({ playInstanceId: 'seek-race', positionMs: 5000, version: 2 });
  h.service._onHostMessage({ type: 'event', event: 'ended', playInstanceId: 'seek-race', version: 2, positionMs: 65_000 });
  h.complete({ positionMs: 5000, state: { playInstanceId: 'seek-race', version: 2, positionMs: 5000, status: 'playing' } });
  await seeking;
  assert.equal(h.events.filter(row => row.type === 'ended').length, 0);
  assert.equal(h.service.active.positionMs, 5000);
});

test('a normal pause cannot adopt a transient backward host reading without a seek', async () => {
  const h = await controlledSeek();
  const request = h.supervisor.request;
  h.supervisor.request = command => command.type === 'pause'
    ? { positionMs: 0, state: { playInstanceId: 'seek-race', version: 2, positionMs: 0, status: 'paused' } }
    : request(command);
  await h.service.pause({ version: 2 });
  assert.equal(h.service.active.positionMs, 60_000);
  assert.equal(h.events.filter(row => row.type === 'positioned').length, 0);
});

test('pause replacing a backward seek still adopts the actual lower position', async () => {
  const h = await controlledSeek({ controlStatus: 'paused' });
  const seeking = h.service.seek({ playInstanceId: 'seek-race', positionMs: 5000, version: 2 });
  await h.service.pause({ version: 3 });
  h.complete({ positionMs: 5000 });
  await assert.rejects(seeking, { code: 'cancelled' });
  assert.equal(h.service.active.positionMs, 5000);
  assert.equal(h.supervisor.hostState.status, 'paused');
});
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
