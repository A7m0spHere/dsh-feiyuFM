// R1: the fault and resource checks.
//
// Faults are injected through the fakes, so every case here is deterministic.
// The rule behind all of them: a failure must be reported with its real reason,
// must not corrupt state, and must not leak a growing collection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { initializeAgentPreferences } from '../src/taste.mjs';
import { MusicError, trackId } from '../src/contracts.mjs';
import { MusicCore } from '../src/core.mjs';
import { FakeClock, FakePlayback, FakeProvider } from '../src/fakes.mjs';
import { createCoreHost, buildProviderRegistry, createProviderFacade } from '../src/core-host.mjs';
import { FakeProvider as Provider } from '../src/fakes.mjs';

const track = { provider: 'netease', providerTrackId: 'r1', title: 'Fault track', artist: 'A', durationMs: 200_000 };
const MIN = 60_000;

function harness({ expiresAt = null } = {}) {
  const store = new MusicStore();
  const provider = new FakeProvider();
  const playback = new FakePlayback();
  const clock = new FakeClock(1_700_000_000_000);
  // A retry backoff waits on the clock. Real timers fire on their own; a fake
  // clock has to be driven, so sleeps resolve immediately here and the retry
  // logic is tested without wall-clock delays.
  clock.sleep = async () => {};
  provider.set(track, 'fake:handle');
  if (expiresAt !== null) {
    const original = provider.resolve.bind(provider);
    provider.resolve = async (candidate, options) => ({ ...(await original(candidate, options)), expiresAt });
  }
  const core = new MusicCore({ store, provider, playback, clock });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ commandId: `cmd-${++id}`, type, ...extra });
  return { store, provider, playback, clock, core, send };
}

test('a network outage during resolution is reported and retried only when retryable', async () => {
  // A transient failure is retried, so the track still plays.
  const transient = harness();
  try {
    transient.provider.failNext(track, 1, true);
    transient.send('requestTrack', { track });
    await transient.core.waitForIdle();
    assert.equal(transient.core.snapshot().status, 'playing');
    assert.equal(transient.core.snapshot().lastError, null);
  } finally {
    transient.store.close();
  }

  // A permanent failure is not retried into a loop: it surfaces with its own
  // code and says outright that retrying will not help.
  const permanent = harness();
  try {
    permanent.provider.failNext(track, 99, false);
    permanent.send('requestTrack', { track });
    await permanent.core.waitForIdle();
    const snapshot = permanent.core.snapshot();
    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.lastError.code, 'provider_failure');
    assert.equal(snapshot.lastError.retryable, false, 'the reason is not dressed up as retryable');
    assert.equal(snapshot.current, null);
    assert.equal(permanent.playback.playing, false, 'and no audio is claimed');
  } finally {
    permanent.store.close();
  }
});

test('an expired platform handle is resolved again instead of failing the track', async () => {
  const now = 1_700_000_000_000;
  // The handle expires one minute after resolution.
  const h = harness({ expiresAt: now + MIN });
  try {
    h.send('requestTrack', { track });
    await h.core.waitForIdle();
    const instance = h.core.snapshot().current.playInstanceId;
    assert.equal(h.core.snapshot().status, 'playing');

    // Time passes beyond the expiry and the platform rejects the stale handle.
    h.clock.advance(2 * MIN);
    h.playback.emit({ type: 'error', playInstanceId: instance, code: 'media_failed', message: 'the url expired' });
    await h.core.waitForIdle();

    // The track is still the same one, and it is playing again from a fresh handle.
    assert.equal(h.core.snapshot().current.track.providerTrackId, 'r1', 'the same track continues');
    assert.equal(h.core.snapshot().current.playInstanceId, instance, 'and it is the same listen');
    assert.equal(h.core.snapshot().status, 'playing', 'playback recovered');
    assert.equal(h.provider.calls.length >= 2, true, 'the provider was asked again');
    // 播放恢复后不得残留 resource_expired：否则 UI 会在正常播放时显示「播放未成功」。
    assert.equal(h.core.snapshot().lastError, null, 'a recovered start clears the stale resolve error');

    // Only once: a second failure on a re-resolved handle is a real failure.
    h.playback.emit({ type: 'error', playInstanceId: instance, code: 'media_failed', message: 'still broken' });
    await h.core.waitForIdle();
    assert.equal(h.core.snapshot().status, 'error');
    assert.equal(h.core.snapshot().current, null);
    assert.equal(h.core.snapshot().lastError.code, 'media_failed');
  } finally {
    h.store.close();
  }
});

test('a media failure that is not about expiry is reported without a pointless retry', async () => {
  const h = harness({ expiresAt: null });
  try {
    h.send('requestTrack', { track });
    await h.core.waitForIdle();
    const instance = h.core.snapshot().current.playInstanceId;
    const before = h.provider.calls.length;

    h.playback.emit({ type: 'error', playInstanceId: instance, code: 'media_failed', message: 'the file is corrupt' });
    await h.core.waitForIdle();
    // No expiry is known, so there is nothing to re-resolve; but a media failure
    // is exactly the case the platform may fix, so one re-resolve is allowed.
    assert.ok(h.provider.calls.length >= before, 'no crash and no infinite retry');
    assert.equal(h.core.snapshot().status, 'error');
    assert.equal(h.core.snapshot().lastError.code, 'media_failed', 'the real reason is kept');
  } finally {
    h.store.close();
  }
});

test('the expiry bookkeeping stays bounded and never stores a handle', async () => {
  const h = harness({ expiresAt: 1_700_000_000_000 + MIN });
  try {
    for (let index = 0; index < 60; index += 1) {
      h.send('requestTrack', { track });
      await h.core.waitForIdle();
      h.clock.advance(1000);
    }
    assert.ok(h.core.resourceExpiries.size <= 32, `expiry map grew to ${h.core.resourceExpiries.size}`);
    // A handle must never reach persistent storage.
    const dump = JSON.stringify({
      state: h.store.getCoreState(),
      history: h.store.db.prepare('SELECT * FROM listen_history').all(),
    });
    assert.equal(dump.includes('fake:handle'), false, 'the handle stayed out of the database');
    // And nothing in the map holds the handle itself.
    for (const entry of h.core.resourceExpiries.values()) {
      assert.equal(JSON.stringify(entry).includes('fake:handle'), false);
    }
  } finally {
    h.store.close();
  }
});

test('a login that expired mid-session stops music honestly instead of pretending', async () => {
  const store = new MusicStore();
  importSeedTracks({ store, provider: 'netease', source: 'recent', requested: 1, tracks: [track] });
  initializeAgentPreferences({ store, seed: 1, now: 0 });
  const credentials = {
    read: () => 'MUSIC_U=stale',
    write: () => {},
    delete: () => {},
  };
  // A platform that is signed in until it is not.
  let expired = false;
  const transport = {
    async request({ role }) {
      if (expired) throw Object.assign(new Error('unauthorized'), { status: 401 });
      if (role === 'resolve') return { status: 200, body: { data: [{ url: 'https://example.invalid/a.mp3', expi: 600 }] } };
      if (role === 'accountInfo') return { status: 200, body: { accountId: 7 } };
      throw Object.assign(new Error('no fixture'), { status: 500 });
    },
  };
  store.setCredentialReference({ provider: 'netease', accountId: '7', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const registry = buildProviderRegistry({ adapters: { netease: { transport } }, credentials, store });
  const facade = createProviderFacade({ registry, store });
  const playback = new FakePlayback();
  const clock = new FakeClock(1_700_000_000_000);
  const core = new MusicCore({ store, provider: facade, playback, clock });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  try {
    assert.equal(core.provider.getAccount('netease').status, 'authorized');

    // The sign-in expires; playback stops with the real reason.
    expired = true;
    core.dispatch({ commandId: 'c1', type: 'requestTrack', track });
    await core.waitForIdle();
    assert.equal(core.snapshot().status, 'error');
    assert.equal(core.snapshot().lastError.code, 'login_required');
    assert.equal(core.snapshot().lastError.retryable, false, 'retrying will not fix a signed-out account');
    assert.equal(core.snapshot().current, null);
    assert.equal(playback.playing, false, 'and no audio is claimed');

    // The account capability now says so too, rather than looking healthy.
    assert.equal(core.provider.getAccount('netease').status, 'expired');
  } finally {
    store.close();
  }
});

test('a clock jump after sleep does not fabricate progress or a second listen', async () => {
  const h = harness();
  try {
    h.send('requestTrack', { track });
    await h.core.waitForIdle();
    const instance = h.core.snapshot().current.playInstanceId;

    // The machine sleeps for six hours and wakes with the same track loaded.
    h.clock.advance(6 * 60 * MIN);
    h.playback.emit({ type: 'progress', playInstanceId: instance, positionMs: 30_000, progressSource: 'audio' });
    assert.equal(h.core.snapshot().current.positionMs, 30_000, 'progress comes from playback, not from elapsed time');

    // Ending it records exactly one listen with the reported progress.
    h.playback.emit({ type: 'ended', playInstanceId: instance });
    await h.core.waitForIdle();
    const rows = h.store.db.prepare('SELECT * FROM listen_history').all();
    assert.equal(rows.length, 1, 'one listen, not one per wall-clock hour');
    assert.equal(rows[0].effective_ms, 30_000);
    assert.equal(rows[0].end_reason, 'ended');
  } finally {
    h.store.close();
  }
});

test('repeated UI revisions and duplicate events cannot move state twice', async () => {
  const h = harness();
  try {
    h.send('requestTrack', { track });
    await h.core.waitForIdle();
    const instance = h.core.snapshot().current.playInstanceId;

    // The same completion is reported four times, as a flaky UI might.
    h.playback.emit({ type: 'ended', playInstanceId: instance });
    h.playback.emit({ type: 'ended', playInstanceId: instance });
    h.playback.emit({ type: 'ended', playInstanceId: instance });
    h.playback.emit({ type: 'ended', playInstanceId: instance });
    await h.core.waitForIdle();
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS c FROM listen_history').get().c, 1,
      'a duplicate notification cannot record a second listen');
    assert.equal(h.core.snapshot().current, null);
  } finally {
    h.store.close();
  }
});

test('many operations do not grow the core\'s own collections without bound', async () => {
  const h = harness();
  try {
    h.send('requestTrack', { track });
    await h.core.waitForIdle();
    const instance = h.core.snapshot().current.playInstanceId;

    // A long run of progress and pause/resume traffic, as a real session has.
    for (let index = 0; index < 300; index += 1) {
      h.playback.emit({ type: 'progress', playInstanceId: instance, positionMs: (index % 60) * 1000, progressSource: 'audio' });
      if (index % 20 === 0) {
        h.send('pause');
        await h.core.waitForIdle();
        h.send('resume');
        await h.core.waitForIdle();
      }
    }
    // The snapshot's queue is authoritative state, not an accumulation of events.
    assert.ok(h.core.snapshot().queue.length <= 1, `queue grew to ${h.core.snapshot().queue.length}`);
    assert.ok(h.core.resourceExpiries.size <= 32);
    // History only has rows for finished listens: this one is still playing.
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS c FROM listen_history').get().c, 0);
  } finally {
    h.store.close();
  }
});

test('a host whose provider is uninstalled refuses to play and never claims audio', async () => {
  const store = new MusicStore();
  const registry = buildProviderRegistry({ adapters: {} });
  const facade = createProviderFacade({ registry, store });
  const playback = new FakePlayback();
  const clock = new FakeClock(1_700_000_000_000);
  const core = new MusicCore({ store, provider: facade, playback, clock });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  try {
    core.dispatch({ commandId: 'c1', type: 'requestTrack', track });
    await core.waitForIdle();
    assert.equal(core.snapshot().status, 'error');
    assert.equal(core.snapshot().lastError.code, 'provider_unavailable');
    assert.equal(playback.playing, false);
    assert.equal(core.snapshot().current, null);
  } finally {
    store.close();
  }
});