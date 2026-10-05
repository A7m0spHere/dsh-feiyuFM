// Real WPF regression for the warm audio pool. No play command is ever sent to a
// track with sound: the holders are muted and never played, and the measurement
// track is a generated silent WAV, so this test cannot emit audio.
//
// It is slow on purpose — filling the pool takes real playback time — so it
// carries its own per-test timeout instead of the suite default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';
import { PlaybackService } from '../src/playback/service.mjs';
import { wpfBackend, warmHoldersFromEnv } from '../src/playback/backends.mjs';

/** A silent PCM WAV: the timeline advances, the audio device stays quiet. */
function writeSilentWav(path, { seconds = 45, sampleRate = 8000 } = {}) {
  const frames = Math.max(1, Math.round(seconds * sampleRate));
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  writeFileSync(path, buffer);
}

function harness({ warmHolders, track }) {
  const markers = [];
  const supervisor = new PlaybackSupervisor({
    backend: wpfBackend({ volume: 0, warmHolders, warmResource: track }),
    onLog: (entry) => {
      if (typeof entry.line === 'string' && entry.line.includes('FISHFM_PLAYBACK_WARM')) {
        markers.push(entry.line.replace('FISHFM_PLAYBACK_', ''));
      }
    },
  });
  return { supervisor, markers, service: new PlaybackService({ supervisor, openTimeoutMs: 12000, commandTimeoutMs: 6000 }) };
}

async function waitFor(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return condition();
}

test('the warm pool fills during playback and makes the next load fast', { skip: process.platform !== 'win32', timeout: 180000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-warm-'));
  const track = join(directory, 'silent-track.wav');
  writeSilentWav(track, { seconds: 45 });
  const h = harness({ warmHolders: 4, track });
  try {
    await h.supervisor.ensureHost();
    await h.service.setMuted({ muted: true, version: 1 });
    const coldStarted = performance.now();
    await h.service.load({ resource: { handle: track }, playInstanceId: 'cold', version: 2 });
    const coldMs = performance.now() - coldStarted;
    await h.service.play({ playInstanceId: 'cold', version: 2 });

    // The pool fills only while a track is playing, one holder at a time, so it
    // needs a track long enough to hold all four. 45 s of silence is far longer
    // than the ~16 s the pool takes, which is what keeps this off the clock.
    const filled = await waitFor(() => h.markers.filter((line) => line.startsWith('WARM_READY')).length >= 4, 90000);
    const ready = h.markers.filter((line) => line.startsWith('WARM_READY')).length;
    assert.ok(filled, `expected four warm holders, saw ${ready}: ${h.markers.join(' | ')}`);

    const warmStarted = performance.now();
    await h.service.load({ resource: { handle: track }, playInstanceId: 'warm', version: 4 });
    const warmMs = performance.now() - warmStarted;
    assert.ok(warmMs < 2000, `a warm load should be well under two seconds, took ${warmMs.toFixed(0)}ms (cold was ${coldMs.toFixed(0)}ms)`);
    assert.ok(warmMs < coldMs / 2, `a warm load (${warmMs.toFixed(0)}ms) should be much faster than the cold one (${coldMs.toFixed(0)}ms)`);
    assert.equal((await h.service.hostSnapshot()).playInstanceId, 'warm');
  } finally {
    await h.service.close({ gracefulTimeoutMs: 3000 });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('warming is off when asked to be, and a cold host still serves loads', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-warmoff-'));
  const track = join(directory, 'silent-track.wav');
  writeSilentWav(track, { seconds: 45 });
  const h = harness({ warmHolders: 0, track });
  try {
    await h.supervisor.ensureHost();
    await h.service.setMuted({ muted: true, version: 1 });
    await h.service.load({ resource: { handle: track }, playInstanceId: 'off', version: 2 });
    await h.service.play({ playInstanceId: 'off', version: 2 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    assert.equal(h.markers.filter((line) => line.startsWith('WARM_READY')).length, 0, 'no holder may be opened when warming is disabled');
    assert.ok(h.markers.some((line) => line.startsWith('WARM_DISABLED')), `expected a WARM_DISABLED marker: ${h.markers.join(' | ')}`);
    assert.equal((await h.service.hostSnapshot()).status, 'playing');
  } finally {
    await h.service.close({ gracefulTimeoutMs: 3000 });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the host writes its own silent resource rather than shipping one', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-warmself-'));
  const track = join(directory, 'silent-track.wav');
  writeSilentWav(track, { seconds: 45 });
  // No warmResource: the host must generate the file itself. This is what a fresh
  // clone relies on, since audio is never committed to the repository.
  const markers = [];
  const supervisor = new PlaybackSupervisor({
    backend: wpfBackend({ volume: 0 }),
    onLog: (entry) => {
      if (typeof entry.line === 'string' && entry.line.includes('FISHFM_PLAYBACK_WARM')) markers.push(entry.line.replace('FISHFM_PLAYBACK_', ''));
    },
  });
  const service = new PlaybackService({ supervisor, openTimeoutMs: 12000, commandTimeoutMs: 6000 });
  try {
    await supervisor.ensureHost();
    await service.setMuted({ muted: true, version: 1 });
    await service.load({ resource: { handle: track }, playInstanceId: 'self', version: 2 });
    await service.play({ playInstanceId: 'self', version: 2 });
    const filled = await waitFor(() => markers.some((line) => line.startsWith('WARM_READY')), 40000);
    assert.ok(filled, `the host must warm from a resource it wrote itself: ${markers.join(' | ')}`);
    assert.ok(markers.some((line) => line.startsWith('WARM_CONFIGURED')), `expected WARM_CONFIGURED: ${markers.join(' | ')}`);
  } finally {
    await service.close({ gracefulTimeoutMs: 3000 });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the warm-holder count is configurable, and an unusable value falls back', () => {
  assert.equal(warmHoldersFromEnv({}), 4, 'the default is four holders');
  assert.equal(warmHoldersFromEnv({ FISHFM_PLAYBACK_WARM_HOLDERS: '0' }), 0, 'zero disables warming');
  assert.equal(warmHoldersFromEnv({ FISHFM_PLAYBACK_WARM_HOLDERS: '6' }), 6);
  assert.equal(warmHoldersFromEnv({ FISHFM_PLAYBACK_WARM_HOLDERS: '9' }), 4, 'out of range falls back to the default');
  assert.equal(warmHoldersFromEnv({ FISHFM_PLAYBACK_WARM_HOLDERS: 'lots' }), 4);
  assert.equal(warmHoldersFromEnv({ FISHFM_PLAYBACK_WARM_HOLDERS: '-1' }), 4);
  const args = wpfBackend({ volume: 0.35, warmHolders: 0 }).extraArgs({ pipeName: 'p', ownerPid: 1, protocol: 1 });
  assert.deepEqual(args, ['-PipeName', 'p', '-OwnerPid', '1', '-ProtocolVersion', '1', '-Volume', '0.35', '-WarmHolders', '0']);
  const envArgs = wpfBackend({ volume: 0.35, env: { FISHFM_PLAYBACK_WARM_HOLDERS: '0' } }).extraArgs({ pipeName: 'p', ownerPid: 1, protocol: 1 });
  assert.equal(envArgs[envArgs.indexOf('-WarmHolders') + 1], '0', 'the environment switch reaches the host');
});
