import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicCore } from '../src/core.mjs';
import { MusicStore } from '../src/storage.mjs';
import { FakePlayback, FakeProvider } from '../src/fakes.mjs';

const track = { provider: 'netease', providerTrackId: '1', title: 'sample', durationMs: 100_000 };
async function fixture(t) {
  const store = new MusicStore(), playback = new FakePlayback();
  const core = new MusicCore({ store, playback, provider: new FakeProvider(), prefetchDelayMs: 999_999 });
  playback.onEvent(event => core.onPlaybackEvent(event));
  let serial = 0;
  const send = (type, extra = {}) => core.dispatch({ type, commandId: `seek-${++serial}`, ...extra });
  send('requestTrack', { track }); await core.waitForIdle();
  const id = core.state.current.playInstanceId;
  playback.emit({ type: 'started', playInstanceId: id });
  playback.emit({ type: 'progress', playInstanceId: id, positionMs: 1000, effectiveDeltaMs: 1000 });
  t.after(async () => { core._invalidate(); await core.waitForIdle(); store.close(); });
  return { core, store, playback, send, id };
}
test('forward and backward seeks keep the listen instance, effective time and pause intention', async t => {
  const h = await fixture(t);
  const before = structuredClone(h.core.state.current);
  for (const positionMs of [50_000, 500, 0]) {
    h.send('seek', { playInstanceId: h.id, positionMs }); await h.core.waitForIdle();
    assert.equal(h.core.state.current.positionMs, positionMs);
    assert.equal(h.core.state.current.playInstanceId, h.id);
    assert.equal(h.core.state.current.effectiveMs, before.effectiveMs);
    assert.equal(h.core.state.current.startedAt, before.startedAt);
    assert.equal(h.playback.playing, true);
  }
  h.send('pause'); await h.core.waitForIdle();
  h.send('seek', { playInstanceId: h.id, positionMs: 2000 }); await h.core.waitForIdle();
  assert.equal(h.core.state.paused, true); assert.equal(h.playback.playing, false);
  assert.equal(h.core.state.current.positionMs, 2000);
});
test('seek rejects old instances, out-of-range targets and unsupported hosts before mutation', async t => {
  const h = await fixture(t), revision = h.core.state.revision;
  assert.throws(() => h.send('seek', { playInstanceId: 'old', positionMs: 100 }), { code: 'stale_track' });
  for (const positionMs of [-1, 1.5, NaN, 100_000]) assert.throws(() => h.send('seek', { playInstanceId: h.id, positionMs }), { code: 'invalid_command' });
  h.playback.supportsSeek = false;
  assert.throws(() => h.send('seek', { playInstanceId: h.id, positionMs: 100 }), { code: 'seek_unsupported' });
  assert.equal(h.core.state.revision, revision);
});
test('seek failure preserves playback and does not replace the track or count a new listen', async t => {
  const h = await fixture(t);
  h.playback.failNextControl('seek');
  h.send('seek', { playInstanceId: h.id, positionMs: 5000 }); await h.core.waitForIdle();
  assert.equal(h.core.state.current.playInstanceId, h.id);
  assert.equal(h.core.state.status, 'playing');
  assert.equal(h.core.state.lastError, null);
  assert.equal(h.core.state.seekPending, null);
  assert.ok(h.core.state.seekError);
  assert.equal(h.core.state.current.positionMs, 1000);
});
test('pause and a newer point request reject a delayed seek completion without resuming or moving the new track', async t => {
  const h = await fixture(t);
  let release;
  h.playback.seek = () => new Promise(resolve => { release = resolve; });
  h.send('seek', { playInstanceId: h.id, positionMs: 30_000 }); await Promise.resolve();
  h.send('pause'); release({ positionMs: 30_000 }); await h.core.waitForIdle();
  assert.equal(h.core.state.paused, true); assert.equal(h.core.state.current.positionMs, 1000);
  h.send('seek', { playInstanceId: h.id, positionMs: 40_000 }); await Promise.resolve();
  h.send('requestTrack', { track: { ...track, providerTrackId: '2' } });
  release({ positionMs: 40_000 }); await h.core.waitForIdle();
  assert.equal(h.core.state.current.track.providerTrackId, '2'); assert.equal(h.core.state.current.positionMs, 0);
});
test('rapid queued seeks apply only the newest target', async t => {
  const h = await fixture(t);
  h.send('seek', { playInstanceId: h.id, positionMs: 3000 });
  h.send('seek', { playInstanceId: h.id, positionMs: 5000 });
  await h.core.waitForIdle();
  assert.equal(h.core.state.current.positionMs, 5000);
  assert.equal(h.playback.calls.filter(row => row.type === 'seek').length, 1);
});
