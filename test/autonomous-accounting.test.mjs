import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicCore } from '../src/core.mjs';
import { MusicStore } from '../src/storage.mjs';
import { applyListenGrowth } from '../src/growth.mjs';
import { FakeClock, FakeProvider, FakePlayback } from '../src/fakes.mjs';
import { buildSelector, createCoreHost } from '../src/core-host.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { initializeAgentPreferences } from '../src/taste.mjs';
import { MusicError } from '../src/contracts.mjs';
const track = { provider: 'netease', providerTrackId: 'n1', artist: 'Artist', durationMs: 200_000 };
test('restoring an old position does not fabricate listening; disabled autonomy only records human progress', async () => {
  const store = new MusicStore(), provider = new FakeProvider(), playback = new FakePlayback();
  const clock = new FakeClock();
  store.setCoreState({ settings: { listening: true, humanPlayback: true }, queue: [], current: { track, playInstanceId: 'legacy', positionMs: 150_000, selectedBy: 'agent', agentListening: false }, revision: 0, commandVersion: 0, blockUntil: null });
  const core = new MusicCore({ store, provider, playback, clock });
  playback.onEvent(e => core.onPlaybackEvent(e));
  try {
    core.dispatch({ type: 'resume', commandId: 'resume' });
    await core.waitForIdle();
    playback.emit({ type: 'progress', playInstanceId: 'legacy', positionMs: 151_000, effectiveDeltaMs: 1000 });
    assert.equal(core.snapshot().current.effectiveMs, 1000);
    core.dispatch({ type: 'setListening', value: false, commandId: 'off' });
    await core.waitForIdle();
    core.dispatch({ type: 'resume', commandId: 'resume-off' });
    await core.waitForIdle();
    playback.emit({ type: 'progress', playInstanceId: 'legacy', positionMs: 190_000, effectiveDeltaMs: 1000 });
    assert.equal(core.snapshot().current.agentEffectiveMs, 1000);
    playback.emit({ type: 'ended', playInstanceId: 'legacy' });
    assert.equal(store.getHistory('legacy').effective_ms, 2000);
    assert.equal(store.getHistory('legacy').agent_effective_ms, 1000);
    const result = applyListenGrowth({ store, entry: store.pendingGrowthEntries()[0], durationMs: track.durationMs });
    assert.equal(result.updated, false);
  } finally { store.close(); }
});
test('a history/processing crash is replayable and duplicate growth has no effect', async () => {
  const store = new MusicStore();
  const entry = { playInstanceId: 'crash', track, selectedBy: 'agent', progressSource: 'audio', effectiveMs: 40_000, agentEffectiveMs: 40_000, agentListening: true, audible: true, endReason: 'ended', endedAt: 1000, durationMs: track.durationMs };
  store.recordHistory(entry);
  assert.equal(store.pendingGrowthEntries().length, 1);
  const host = createCoreHost({ store, playbackMode: 'fake', output: { write() {} } });
  try {
    await host.start();
    const after = store.getPreference('track', 'netease:n1').affinity;
    assert.equal(store.pendingGrowthEntries().length, 0);
    assert.equal(applyListenGrowth({ store, entry }).updated, false);
    assert.equal(store.getPreference('track', 'netease:n1').affinity, after);
    assert.throws(() => store.transaction(() => {
      applyListenGrowth({ store, entry: { ...entry, playInstanceId: 'rollback' } });
      throw new Error('crash-before-commit');
    }), /crash-before-commit/);
    assert.equal(store.getGrowthResult('rollback'), null);
    assert.equal(store.getPreference('track', 'netease:n1').affinity, after);
  } finally { await host.close(); store.close(); }
});
test('an unplayable autonomous candidate is excluded and replacement has a finite budget', async () => {
  const store = new MusicStore(), playback = new FakePlayback(), clock = new FakeClock();
  const tracks = [1, 2, 3, 4].map(id => ({ ...track, providerTrackId: String(id) }));
  importSeedTracks({ store, provider: 'netease', source: 'recent', requested: 4, tracks });
  initializeAgentPreferences({ store, seed: 123 });
  let calls = 0;
  const provider = { async resolve() { calls++; throw new MusicError('media_unavailable', 'no permission'); } };
  const core = new MusicCore({ store, provider, playback, clock, selector: buildSelector({ store, now: () => clock.now() }) });
  try {
    core.dispatch({ type: 'chooseSelf', commandId: 'start' });
    await core.waitForIdle();
    assert.equal(calls, 3);
    assert.equal(core.snapshot().paused, true);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM listen_history').get().n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM track_availability').get().n, 3);
  } finally { store.close(); }
});
test('a restarted selector continues the persisted random stream', async () => {
  const store = new MusicStore(), playback = new FakePlayback(), provider = new FakeProvider();
  importSeedTracks({ store, provider: 'netease', source: 'recent', requested: 1, tracks: [track] });
  initializeAgentPreferences({ store, seed: 123 });
  const selector = buildSelector({ store });
  const core = new MusicCore({ store, provider, playback, selector });
  try {
    core.dispatch({ type: 'chooseSelf', commandId: 'rng' });
    await core.waitForIdle();
    const nextWithoutRestart = selector.next({ discoveryRate: 0 });
    const nextAfterRestart = buildSelector({ store }).next({ discoveryRate: 0 });
    assert.equal(nextAfterRestart.detail.randomValue, nextWithoutRestart.detail.randomValue);
  } finally { store.close(); }
});
