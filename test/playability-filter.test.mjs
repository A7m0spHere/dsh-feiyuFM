import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { MusicCore, MAX_UNAVAILABLE_SKIPS } from '../src/core.mjs';
import { FakeClock, FakePlayback } from '../src/fakes.mjs';
import { buildSelector, createCoreHost, createProviderFacade, ProviderRegistry } from '../src/core-host.mjs';
import { createDiscoveryCache } from '../src/discovery.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { createQQProvider } from '../src/providers/qq.mjs';
import { createQQCommunityTransport } from '../src/providers/qq-transport.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { neteaseEndpoints } from '../src/providers/endpoints/netease.mjs';
import { MusicError, UNAVAILABLE_BACKOFF_MS } from '../src/contracts.mjs';

const qqTrack = (id, title = `Song ${id}`) => ({
  provider: 'qq', providerTrackId: String(id), title, artist: 'Artist', durationMs: 180_000,
});
const neteaseTrack = (id, title = `Song ${id}`) => ({
  provider: 'netease', providerTrackId: String(id), title, artist: 'Artist', durationMs: 180_000,
});

function memoryCredentials(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    read: key => map.get(key) ?? null,
    write: (key, value) => map.set(key, value),
    delete: key => { map.delete(key); return true; },
  };
}

test('QQ batch playability check separates full tracks from restricted/preview ones without leaking URLs', async () => {
  const vault = memoryCredentials({ 'fishfm/qq': 'qqmusic_session=active' });
  const store = new MusicStore();
  store.setCredentialReference({ provider: 'qq', accountId: '7', credentialRef: 'fishfm/qq', state: 'authorized', updatedAt: 1 });
  const paths = [];
  const upstream = {
    async close() {},
    async request(input) {
      paths.push({ path: input.path, query: input.query });
      if (input.path === '/login/refresh') return { status: 200, body: { data: { rotated: false } } };
      if (input.path === '/login/status') return { status: 200, body: { data: { profile: { str_musicid: '7' } } } };
      if (input.path.startsWith('/getMusicPlay/')) {
        return {
          status: 200,
          body: {
            data: {
              playUrl: {
                ok1: { url: 'https://example.invalid/full-ok1.mp3' },
                vip1: { url: '', restriction: { key: 'url_unavailable' } },
                prev1: { url: 'https://example.invalid/preview.mp3', preview: true },
              },
            },
          },
        };
      }
      assert.fail(`unexpected path ${input.path}`);
    },
  };
  const transport = createQQCommunityTransport({ credentials: vault, upstream });
  const provider = createQQProvider({ store, credentials: vault, transport });
  try {
    await provider.restore();
    const result = await provider.checkPlayability([qqTrack('ok1'), qqTrack('vip1'), qqTrack('prev1'), qqTrack('ok1')]);
    assert.deepEqual(result.playable, ['qq:ok1']);
    assert.deepEqual(result.unplayable, ['qq:vip1', 'qq:prev1']);
    assert.equal(result.checked, 3);
    assert.equal(result.skipped, false);
    assert.equal(JSON.stringify(result).includes('example.invalid'), false, 'handles must not leave checkPlayability');
    const playCalls = paths.filter(item => item.path.startsWith('/getMusicPlay/'));
    assert.equal(playCalls.length, 1);
    assert.equal(playCalls[0].path, '/getMusicPlay/ok1,vip1,prev1');
    assert.equal(playCalls[0].query.quality, '128');
  } finally {
    await provider.dispose();
    store.close();
  }
});

test('NetEase rejects VIP freeTrialInfo on single resolve and batch checkPlayability', async () => {
  const store = new MusicStore();
  const vault = memoryCredentials({ 'fishfm/netease': 'MUSIC_U=secret' });
  store.setCredentialReference({ provider: 'netease', accountId: '42', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const resolveCalls = [];
  const provider = createNetEaseProvider({
    store,
    credentials: vault,
    communityApi: {},
    transport: {
      async request({ role, params }) {
        assert.equal(role, 'resolve');
        resolveCalls.push(params);
        if (Array.isArray(params.ids)) {
          return {
            status: 200,
            body: {
              data: [
                { id: 101, url: 'https://m7.music.126.net/full.mp3', freeTrialInfo: null },
                { id: 102, url: 'https://m7.music.126.net/trial.mp3', freeTrialInfo: { start: 0, end: 30 } },
                { id: 103, url: null },
              ],
            },
          };
        }
        return {
          status: 200,
          body: { data: [{ id: 102, url: 'https://m7.music.126.net/trial.mp3', freeTrialInfo: { start: 0, end: 30 } }] },
        };
      },
    },
  });
  try {
    await assert.rejects(() => provider.resolve(neteaseTrack('102')), { code: 'media_unavailable' });
    const checked = await provider.checkPlayability([neteaseTrack('101'), neteaseTrack('102'), neteaseTrack('103')]);
    assert.deepEqual(checked.playable, ['netease:101']);
    assert.deepEqual(checked.unplayable, ['netease:102', 'netease:103']);
    assert.equal(JSON.stringify(checked).includes('126.net'), false);
    assert.deepEqual(resolveCalls.at(-1), { ids: ['101', '102', '103'], br: 128000 });
    assert.deepEqual(neteaseEndpoints().resolve.body({ ids: ['101', '102'], br: 128000 }), { ids: '[101,102]', br: 128000 });
  } finally {
    store.close();
  }
});

test('discovery pre-checks candidates, marks unplayable tracks for 24h and runs at most one bounded refill round', async () => {
  const store = new MusicStore();
  let time = 10_000;
  const refs = Array.from({ length: 6 }, (_, i) => qqTrack(`seed-${i + 1}`));
  importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: refs, requested: 6, now: time });
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  const recallRounds = [];
  const probeCalls = [];
  const qq = {
    getAccount: () => ({ status: 'authorized', accountId: 'free-qq' }),
    getCapabilities: () => ({ recommendation: { status: 'available' } }),
    async getDiscoveryTracks({ seeds }) {
      const round = recallRounds.length;
      recallRounds.push(seeds.map(s => s.providerTrackId));
      return round === 0
        ? [qqTrack('vip-1'), qqTrack('vip-2'), qqTrack('ok-1')].map(t => ({ ...t, discovery: { source: 'qq_similar', fetchedAt: time, expiresAt: time + 3600_000 } }))
        : [qqTrack('vip-2'), qqTrack('vip-3'), qqTrack('ok-2')].map(t => ({ ...t, discovery: { source: 'qq_similar', fetchedAt: time, expiresAt: time + 3600_000 } }));
    },
    async checkPlayability(tracks) {
      const ids = tracks.map(t => t.providerTrackId);
      probeCalls.push(ids);
      return {
        playable: ids.filter(id => id.startsWith('ok-')).map(id => `qq:${id}`),
        unplayable: ids.filter(id => id.startsWith('vip-')).map(id => `qq:${id}`),
        checked: ids.length,
        skipped: false,
      };
    },
  };
  const registry = new ProviderRegistry({ providers: { qq } });
  const cache = createDiscoveryCache({ registry, store, now: () => time });
  try {
    cache.setEnabled(true);
    await cache.refresh();
    assert.equal(recallRounds.length, 2, 'low-yield round after filtering runs at most one bounded follow-up round');
    assert.deepEqual(cache.candidates().map(t => t.providerTrackId).sort(), ['ok-1', 'ok-2']);
    assert.equal(probeCalls[1].includes('vip-2'), false, 'already marked unavailable track is not probed again');
    const row = store.db.prepare("SELECT code, expires_at FROM track_availability WHERE track_key='qq:vip-1'").get();
    assert.equal(row.code, 'media_unavailable');
    assert.equal(row.expires_at, time + UNAVAILABLE_BACKOFF_MS.media_unavailable);
  } finally {
    cache.close();
    store.close();
  }
});

test('filtered user-start with 17 VIP tracks and 2 playable tracks skips restricted ones via one batch probe and plays', async () => {
  const store = new MusicStore();
  const clock = new FakeClock(50_000);
  const playback = new FakePlayback();
  store.setSetting('recommendation_mode_v1', 'filtered');
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  const vipTracks = Array.from({ length: 17 }, (_, i) => qqTrack(`vip-${String(i + 1).padStart(2, '0')}`));
  const playableTracks = [qqTrack('ok-lutra', 'Lutra'), qqTrack('ok-ignite', 'Ignite')];
  importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: [...vipTracks, ...playableTracks], requested: 19, now: clock.now() });

  const resolved = [];
  const probed = [];
  const provider = {
    async resolve(track) {
      resolved.push(track.providerTrackId);
      if (track.providerTrackId.startsWith('ok-')) return { handle: `fake:${track.providerTrackId}` };
      throw new MusicError('media_unavailable', 'QQ 音乐暂未提供完整播放链接。');
    },
    async checkPlayability(name, tracks) {
      assert.equal(name, 'qq');
      probed.push(tracks.map(t => t.providerTrackId));
      return {
        playable: tracks.filter(t => t.providerTrackId.startsWith('ok-')).map(t => `qq:${t.providerTrackId}`),
        unplayable: tracks.filter(t => t.providerTrackId.startsWith('vip-')).map(t => `qq:${t.providerTrackId}`),
        checked: tracks.length,
        skipped: false,
      };
    },
    discoveryTracks: () => [],
  };
  const core = new MusicCore({ store, provider, playback, clock, selector: buildSelector({ store, now: () => clock.now() }) });
  playback.onEvent(event => core.onPlaybackEvent(event));
  try {
    core.dispatch({ type: 'resume', commandId: 'start-library-fallback' });
    await core.waitForIdle();
    const snap = core.snapshot();
    assert.equal(snap.status, 'playing');
    assert.equal(snap.paused, false);
    assert.ok(['ok-lutra', 'ok-ignite'].includes(snap.current.track.providerTrackId));
    assert.equal(probed.length, 1, 'one batch probe clears the remaining VIP tracks');
    assert.ok(resolved.length <= 2, 'at most one failed resolve before playing a verified track');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM listen_history').get().n, 0);
    assert.equal(store.unavailableKeys(clock.now()).size, 17);

    // Next track immediately lands on the other playable song without retrying any VIP track.
    core.dispatch({ type: 'next', commandId: 'next-library-fallback' });
    await core.waitForIdle();
    assert.equal(core.snapshot().status, 'playing');
    assert.notEqual(core.snapshot().current.track.providerTrackId, snap.current.track.providerTrackId);
    assert.ok(['ok-lutra', 'ok-ignite'].includes(core.snapshot().current.track.providerTrackId));

    // Natural track end in filtered mode still does NOT fall back to the input library.
    core.onPlaybackEvent({ type: 'ended', playInstanceId: core.snapshot().current.playInstanceId });
    await core.waitForIdle();
    assert.equal(core.snapshot().current, null);
  } finally {
    store.close();
  }
});

test('explicit requestTrack on a VIP song reports media_unavailable without silently switching tracks', async () => {
  const store = new MusicStore();
  const clock = new FakeClock(60_000);
  const playback = new FakePlayback();
  importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: [qqTrack('vip-only'), qqTrack('ok-other')], requested: 2, now: clock.now() });
  const provider = {
    async resolve(track) {
      if (track.providerTrackId === 'ok-other') return { handle: 'fake:ok-other' };
      throw new MusicError('media_unavailable', 'QQ 音乐暂未提供完整播放链接。');
    },
  };
  const core = new MusicCore({ store, provider, playback, clock, selector: buildSelector({ store, now: () => clock.now() }) });
  try {
    core.dispatch({ type: 'requestTrack', track: qqTrack('vip-only'), commandId: 'explicit-vip' });
    await core.waitForIdle();
    assert.equal(core.snapshot().status, 'error');
    assert.equal(core.snapshot().paused, true);
    assert.equal(core.snapshot().current, null);
    assert.equal(core.snapshot().lastError.code, 'media_unavailable');
    assert.equal(store.isTrackAvailable(qqTrack('vip-only'), clock.now()), false);
  } finally {
    store.close();
  }
});

test('pausing during a fallback playability probe cancels skipping and preserves user pause', async () => {
  const store = new MusicStore();
  const clock = new FakeClock(70_000);
  const playback = new FakePlayback();
  store.setSetting('recommendation_mode_v1', 'filtered');
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: [qqTrack('vip-1'), qqTrack('ok-1')], requested: 2, now: clock.now() });
  const probeStarted = Promise.withResolvers();
  const probeGate = Promise.withResolvers();
  let aborted = false;
  const provider = {
    async resolve(track) {
      if (track.providerTrackId === 'ok-1') return { handle: 'fake:ok-1' };
      throw new MusicError('media_unavailable', 'restricted');
    },
    async checkPlayability(_name, _tracks, { signal }) {
      signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      probeStarted.resolve();
      await probeGate.promise;
      return { playable: ['qq:ok-1'], unplayable: [], checked: 1, skipped: false };
    },
    discoveryTracks: () => [],
  };
  const core = new MusicCore({ store, provider, playback, clock, selector: buildSelector({ store, now: () => clock.now() }) });
  try {
    core.dispatch({ type: 'resume', commandId: 'start-then-pause' });
    await probeStarted.promise;
    core.dispatch({ type: 'pause', commandId: 'user-pause' });
    probeGate.resolve();
    await core.waitForIdle();
    assert.equal(aborted, true);
    assert.equal(core.snapshot().paused, true);
    assert.equal(core.snapshot().current, null);
  } finally {
    probeGate.resolve();
    store.close();
  }
});

test('fresh QR login clears stale media_unavailable rows for that provider so upgraded accounts can replay', async () => {
  const store = new MusicStore();
  const vault = memoryCredentials();
  const qq = createQQProvider({
    store,
    credentials: vault,
    transport: {
      async request({ role }) {
        if (role === 'loginQr') return { status: 200, body: { data: { unikey: 'u1', qrimg: 'data:image/png;base64,AA==' } } };
        if (role === 'loginPoll') return { status: 200, body: { data: { code: 803, cookie: 'qqmusic_session=upgraded' } } };
        if (role === 'accountInfo') return { status: 200, body: { data: { profile: { musicid: 'user-1' } } } };
        return { status: 200, body: {} };
      },
    },
  });
  const registry = new ProviderRegistry({ providers: { qq } });
  const replies = new Map();
  const host = createCoreHost({
    store,
    providerRegistry: registry,
    platformsFacade: createProviderFacade({ registry, store }),
    accountIsolation: true,
    playbackMode: 'fake',
    output: { write(line) { const msg = JSON.parse(line); if (msg.id) replies.set(msg.id, msg); } },
  });
  let seq = 0;
  const req = async message => { const id = `r-${++seq}`; await host.handle({ ...message, id }); return replies.get(id); };
  try {
    await host.start();
    const firstAttempt = (await req({ type: 'login', provider: 'qq', step: 'begin' })).login.attemptId;
    assert.equal((await req({ type: 'login', provider: 'qq', step: 'poll', attemptId: firstAttempt })).status, 'authorized');
    store.markUnavailable(qqTrack('vip-1'), 'media_unavailable', Date.now() + UNAVAILABLE_BACKOFF_MS.media_unavailable);
    store.markUnavailable(qqTrack('tmp-1'), 'media_failed', Date.now() + 60_000);
    assert.equal(store.isTrackAvailable(qqTrack('vip-1'), Date.now()), false);

    assert.equal((await req({ type: 'logout', provider: 'qq' })).ok, true);
    const secondAttempt = (await req({ type: 'login', provider: 'qq', step: 'begin' })).login.attemptId;
    assert.equal((await req({ type: 'login', provider: 'qq', step: 'poll', attemptId: secondAttempt })).status, 'authorized');
    assert.equal(store.isTrackAvailable(qqTrack('vip-1'), Date.now()), true, 're-login clears stale VIP media_unavailable cache');
    assert.equal(store.isTrackAvailable(qqTrack('tmp-1'), Date.now()), false, 'non-entitlement failure rows are not silently removed');
  } finally {
    await host.close();
    store.close();
  }
});

test('user-next resets the unavailable skip counter after hitting the finite budget', async () => {
  const store = new MusicStore();
  const clock = new FakeClock(80_000);
  const playback = new FakePlayback();
  store.setSetting('recommendation_mode_v1', 'filtered');
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  const tracks = Array.from({ length: MAX_UNAVAILABLE_SKIPS + 3 }, (_, i) => qqTrack(`vip-${i + 1}`));
  importSeedTracks({ store, provider: 'qq', source: 'liked', tracks, requested: tracks.length, now: clock.now() });
  let attempts = 0;
  const provider = {
    async resolve() {
      attempts++;
      throw new MusicError('media_unavailable', 'restricted');
    },
  };
  const core = new MusicCore({ store, provider, playback, clock, selector: buildSelector({ store, now: () => clock.now() }) });
  try {
    core.dispatch({ type: 'resume', commandId: 'first-try' });
    await core.waitForIdle();
    assert.equal(attempts, MAX_UNAVAILABLE_SKIPS + 1);
    assert.equal(core.snapshot().paused, true);
    assert.equal(core.snapshot().status, 'error');

    core.dispatch({ type: 'resume', commandId: 'second-try' });
    await core.waitForIdle();
    assert.equal(attempts, tracks.length, 'a new explicit user start gets a fresh finite skip budget');
    assert.equal(core.snapshot().status, 'error');
    assert.equal(core.snapshot().lastError.code, 'media_unavailable');
  } finally {
    store.close();
  }
});
