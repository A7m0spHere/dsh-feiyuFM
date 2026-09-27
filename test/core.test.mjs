import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicCore } from '../src/core.mjs';
import { FakeClock, FakePlayback, FakeProvider } from '../src/fakes.mjs';
import { MusicStore } from '../src/storage.mjs';

const a = { provider: 'netease', providerTrackId: '1', title: 'A', durationMs: 180000 };
const b = { provider: 'qq', providerTrackId: '1', title: 'B', durationMs: 170000 };

function harness(store = new MusicStore()) {
  const provider = new FakeProvider();
  const playback = new FakePlayback();
  const clock = new FakeClock(new Date('2026-09-27T12:00:00+08:00').getTime());
  const core = new MusicCore({ store, provider, playback, clock });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ commandId: `cmd-${++id}`, type, ...extra });
  return { store, provider, playback, clock, core, send };
}

test('late resolve cannot replace a newer user track or undo pause', async () => {
  const h = harness();
  h.provider.defer(a);
  h.send('requestTrack', { track: a });
  await Promise.resolve();
  h.send('requestTrack', { track: b });
  assert.equal(h.provider.calls[0].signal.aborted, true);
  h.provider.release(a);
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().current.track.provider, 'qq');
  assert.equal(h.playback.loaded.playInstanceId, h.core.snapshot().current.playInstanceId);
  h.send('pause');
  assert.equal(h.playback.playing, false);
  const old = h.core.snapshot().current.playInstanceId;
  assert.equal(h.core.onPlaybackEvent({ type: 'ended', playInstanceId: old }), false);
  assert.equal(h.core.snapshot().paused, true);
  h.store.close();
});

test('pause cancels a slow resolve before playback begins', async () => {
  const h = harness();
  h.provider.defer(a);
  h.send('requestTrack', { track: a });
  await Promise.resolve();
  h.send('pause');
  assert.equal(h.provider.calls[0].signal.aborted, true);
  h.provider.release(a);
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().paused, true);
  assert.equal(h.playback.calls.some((call) => call.type === 'load'), false);
  h.store.close();
});

test('next while paused changes track but does not start playback', async () => {
  const h = harness();
  h.core.setQueue([a, b]);
  h.send('next');
  assert.equal(h.core.snapshot().current.track.provider, 'netease');
  assert.equal(h.core.snapshot().paused, true);
  assert.equal(h.playback.playing, false);
  h.send('resume');
  await h.core.waitForIdle();
  assert.equal(h.playback.playing, true);
  h.send('pause');
  h.send('next');
  assert.equal(h.core.snapshot().current.track.provider, 'qq');
  assert.equal(h.playback.playing, false);
  h.store.close();
});

test('duplicate ending and backward progress only count once', async () => {
  const h = harness();
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  const playInstanceId = h.core.snapshot().current.playInstanceId;
  assert.equal(h.core.onPlaybackEvent({ type: 'progress', playInstanceId, positionMs: 12000 }), true);
  assert.equal(h.core.onPlaybackEvent({ type: 'progress', playInstanceId, positionMs: 5000 }), false);
  h.playback.emit({ type: 'ended', playInstanceId }, 2);
  assert.equal(h.store.getHistory(playInstanceId).effective_ms, 12000);
  assert.equal(h.store.getTrackStats(a).play_count, 1);
  h.store.close();
});

test('restart restores the selected track paused without inventing progress', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-'));
  const path = join(directory, 'test.sqlite');
  try {
    const first = harness(new MusicStore(path));
    first.send('requestTrack', { track: a });
    await first.core.waitForIdle();
    const id = first.core.snapshot().current.playInstanceId;
    first.core.onPlaybackEvent({ type: 'progress', playInstanceId: id, positionMs: 3000 });
    first.store.setCredentialReference({ provider: 'netease', credentialRef: 'os-keyring:slot-1', state: 'authorized', updatedAt: first.clock.now() });
    first.store.close();
    const second = harness(new MusicStore(path));
    assert.equal(second.core.snapshot().paused, true);
    assert.equal(second.core.snapshot().current.positionMs, 3000);
    assert.equal(second.playback.playing, false);
    assert.equal(second.store.getTrackStats(a), null);
    assert.equal(second.store.getCredentialReference('netease').credential_ref, 'os-keyring:slot-1');
    second.store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('commands are deduplicated and stale UI revisions are rejected', () => {
  const h = harness();
  const first = h.core.dispatch({ commandId: 'fixed', type: 'setHumanPlayback', value: false });
  h.core.dispatch({ commandId: 'fixed', type: 'setHumanPlayback', value: true });
  assert.equal(h.core.snapshot().settings.humanPlayback, false);
  assert.equal(h.core.snapshot().revision, first.revision);
  assert.throws(() => h.core.dispatch({ commandId: 'stale', type: 'pause', expectedRevision: 0 }), { code: 'stale_revision' });
  h.store.close();
});

test('today restriction does not auto resume at expiry; explicit choice does', async () => {
  const h = harness();
  h.core.setQueue([a]);
  h.send('stopForToday');
  assert.equal(h.core.selectAutonomously(), false);
  h.clock.advance(24 * 60 * 60 * 1000);
  assert.equal(h.core.selectAutonomously(), false);
  h.send('chooseSelf');
  assert.equal(h.core.snapshot().settings.listening, true);
  assert.equal(h.core.snapshot().paused, false);
  await h.core.waitForIdle();
  h.store.close();
});

test('ban constraint blocks point play and filters queued candidate', () => {
  const h = harness();
  h.send('banTrack', { track: a });
  assert.throws(() => h.send('requestTrack', { track: a }), { code: 'constraint_conflict' });
  h.core.setQueue([a, b]);
  h.send('next');
  assert.equal(h.core.snapshot().current.track.provider, 'qq');
  h.store.close();
});

test('nonretryable provider failure is bounded and does not count as listening', async () => {
  const h = harness();
  h.provider.failNext(a, 1, false);
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  assert.equal(h.provider.calls.length, 1);
  assert.equal(h.core.snapshot().status, 'error');
  assert.equal(h.store.getTrackStats(a), null);
  h.store.close();
});

test('retryable resolution stops after three attempts', async () => {
  const store = new MusicStore();
  const provider = new FakeProvider();
  const playback = new FakePlayback();
  const core = new MusicCore({ store, provider, playback,
    clock: { now: () => 1, sleep: async () => {} } });
  provider.failNext(a, 5, true);
  core.dispatch({ commandId: 'retry', type: 'requestTrack', track: a });
  await core.waitForIdle();
  assert.equal(provider.calls.length, 3);
  assert.equal(core.snapshot().lastError.code, 'provider_failure');
  assert.equal(playback.playing, false);
  store.close();
});

test('playback load failure is visible without a fabricated listen', async () => {
  const h = harness();
  h.playback.failNextLoad();
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().lastError.code, 'playback_failure');
  assert.equal(h.store.getTrackStats(a), null);
  h.store.close();
});

test('mode and switch combinations preserve explicit mute and pause', async () => {
  const h = harness();
  h.send('setMode', { value: 'off' });
  assert.deepEqual([h.core.snapshot().settings.listening, h.core.snapshot().settings.humanPlayback], [false, false]);
  h.send('setListening', { value: true });
  assert.deepEqual([h.core.snapshot().settings.listening, h.core.snapshot().settings.humanPlayback], [true, false]);
  assert.equal(h.core.snapshot().paused, true);
  h.send('setMode', { value: 'focus' });
  assert.equal(h.core.snapshot().settings.strategy, 'focus');
  assert.equal(h.core.snapshot().settings.humanPlayback, false);
  assert.equal(h.core.snapshot().paused, false);
  h.send('setHumanPlayback', { value: true });
  h.send('setListening', { value: false });
  assert.deepEqual([h.core.snapshot().settings.listening, h.core.snapshot().settings.humanPlayback], [false, true]);
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  assert.equal(h.playback.playing, true);
  h.store.close();
});

test('logical progress records agent activity without claiming audible playback', async () => {
  const h = harness();
  h.core.setQueue([a]);
  h.send('setMode', { value: 'silent' });
  await h.core.waitForIdle();
  const playInstanceId = h.core.snapshot().current.playInstanceId;
  h.playback.emit({ type: 'progress', playInstanceId, progressSource: 'logical', positionMs: 5000 });
  h.playback.emit({ type: 'ended', playInstanceId }, 2);
  const history = h.store.getHistory(playInstanceId);
  assert.equal(history.selected_by, 'agent');
  assert.equal(history.agent_listening, 1);
  assert.equal(history.audible, 0);
  assert.equal(history.progress_source, 'logical');
  h.store.close();
});

test('resume resets position when playback cannot seek, and rejects old events', async () => {
  const h = harness();
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  const playInstanceId = h.core.snapshot().current.playInstanceId;
  const oldVersion = h.core.snapshot().commandVersion;
  h.playback.emit({ type: 'progress', playInstanceId, positionMs: 5000 });
  h.send('pause');
  h.playback.supportsSeek = false;
  h.send('resume');
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().current.positionMs, 0);
  assert.equal(h.core.snapshot().status, 'playing');
  assert.equal(h.core.onPlaybackEvent({ type: 'ended', playInstanceId, version: oldVersion }), false);
  assert.equal(h.core.snapshot().current.playInstanceId, playInstanceId);
  h.store.close();
});
