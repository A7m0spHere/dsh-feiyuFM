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
    assert.equal(core.snapshot().status, 'selecting', 'fallback probe stays in selecting without flashing error');
    assert.equal(core.snapshot().paused, false);
    assert.equal(core.snapshot().lastError, null);
    core.dispatch({ type: 'pause', commandId: 'user-pause' });
    probeGate.resolve();
    await core.waitForIdle();
    assert.equal(aborted, true);
    assert.equal(core.snapshot().paused, true);
    assert.equal(core.snapshot().current, null);
    assert.equal(core.snapshot().lastError, null);
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

test('fallback playability probe skips tracks already blocked by the 50-track recent window', async () => {
  const store = new MusicStore();
  const clock = new FakeClock(90_000);
  const playback = new FakePlayback();
  store.setSetting('recommendation_mode_v1', 'filtered');
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  const recentTracks = Array.from({ length: 20 }, (_, i) => qqTrack(`a-recent-${String(i + 1).padStart(2, '0')}`));
  const freshTracks = [qqTrack('z-vip-1'), qqTrack('z-ok-1')];
  importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: [...recentTracks, ...freshTracks], requested: 22, now: clock.now() });
  store.setSetting('recent_playback_v1', {
    version: 1,
    entries: recentTracks.map((item, idx) => ({
      playInstanceId: `p-${idx}`, trackKey: `qq:${item.providerTrackId}`, startedAt: clock.now() - 1000 * (20 - idx),
    })),
  });
  const probed = [];
  const provider = {
    async resolve(track) {
      if (track.providerTrackId === 'z-ok-1') return { handle: 'fake:z-ok-1' };
      throw new MusicError('media_unavailable', 'restricted');
    },
    async checkPlayability(_name, tracks) {
      probed.push(tracks.map(t => t.providerTrackId));
      return { playable: ['qq:z-ok-1'], unplayable: [], checked: tracks.length, skipped: false };
    },
    discoveryTracks: () => [],
  };
  const core = new MusicCore({ store, provider, playback, clock, selector: buildSelector({ store, now: () => clock.now() }) });
  playback.onEvent(e => core.onPlaybackEvent(e));
  try {
    core.dispatch({ type: 'resume', commandId: 'start-fresh-only' });
    await core.waitForIdle();
    assert.equal(core.snapshot().status, 'playing');
    assert.equal(core.snapshot().current.track.providerTrackId, 'z-ok-1');
    if (probed.length) {
      assert.equal(probed[0].some(id => id.startsWith('a-recent-')), false, 'probe batch must not spend slots on recent-window tracks');
    }
  } finally {
    store.close();
  }
});

test('NetEase checkPlayability expires stored credentials on HTTP 200 platform code 301', async () => {
  const store = new MusicStore();
  const vault = memoryCredentials({ 'fishfm/netease': 'MUSIC_U=expired' });
  store.setCredentialReference({ provider: 'netease', accountId: '42', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const provider = createNetEaseProvider({
    store,
    credentials: vault,
    communityApi: {},
    transport: {
      async request() { return { status: 200, body: { code: 301 } }; },
    },
  });
  try {
    await assert.rejects(() => provider.checkPlayability([neteaseTrack('101')]), { code: 'login_required' });
    assert.equal(provider.getAccount().status, 'expired');
  } finally {
    store.close();
  }
});

test('QQ reuses short-lived in-memory 128 handle once when 320 fails, preserves 320 for VIP, and clears on logout or expiry', async () => {
  const vault = memoryCredentials({ 'fishfm/qq': 'qqmusic_session=active' });
  const store = new MusicStore();
  let time = 100_000;
  store.setCredentialReference({ provider: 'qq', accountId: '7', credentialRef: 'fishfm/qq', state: 'authorized', updatedAt: 1 });
  const requests = [];
  let quality320Available = false;
  const upstream = {
    async close() {},
    async request(input) {
      requests.push({ path: input.path, quality: input.query?.quality });
      if (input.path === '/login/refresh') return { status: 200, body: { data: { rotated: false } } };
      if (input.path === '/login/status') return { status: 200, body: { data: { profile: { str_musicid: '7' } } } };
      if (input.path === '/getMusicPlay/free1,vip320,exp1') {
        return {
          status: 200,
          body: {
            data: {
              playUrl: {
                free1: { url: 'https://example.invalid/free1-128.mp3', expiresIn: 600 },
                vip320: { url: 'https://example.invalid/vip320-128.mp3', expiresIn: 600 },
                exp1: { url: 'https://example.invalid/exp1-128.mp3', expiresIn: 600 },
              },
            },
          },
        };
      }
      if (input.path === '/getMusicPlay/free1') {
        return input.query.quality === '320'
          ? { status: 200, body: { data: { playUrl: { free1: { url: '' } } } } }
          : { status: 200, body: { data: { playUrl: { free1: { url: 'https://example.invalid/free1-fresh-128.mp3', expiresIn: 600 } } } } };
      }
      if (input.path === '/getMusicPlay/vip320') {
        return quality320Available && input.query.quality === '320'
          ? { status: 200, body: { data: { playUrl: { vip320: { url: 'https://example.invalid/vip320-320.mp3', expiresIn: 600 } } } } }
          : { status: 200, body: { data: { playUrl: { vip320: { url: '' } } } } };
      }
      if (input.path === '/getMusicPlay/exp1') {
        return input.query.quality === '320'
          ? { status: 200, body: { data: { playUrl: { exp1: { url: '' } } } } }
          : { status: 200, body: { data: { playUrl: { exp1: { url: 'https://example.invalid/exp1-fresh-128.mp3', expiresIn: 600 } } } } };
      }
      assert.fail(`unexpected path ${input.path}`);
    },
  };
  const transport = createQQCommunityTransport({ credentials: vault, upstream, now: () => time });
  const provider = createQQProvider({ store, credentials: vault, transport, now: () => time });
  try {
    await provider.restore();
    const probed = await provider.checkPlayability([qqTrack('free1'), qqTrack('vip320'), qqTrack('exp1')]);
    assert.deepEqual(probed.playable, ['qq:free1', 'qq:vip320', 'qq:exp1']);
    assert.equal(JSON.stringify(probed).includes('example.invalid'), false, 'checkPlayability never leaks handles');

    // 1. Free account: 320 fails, consumes cached 128 handle without a second 128 request.
    requests.length = 0;
    const first = await provider.resolve(qqTrack('free1'), { version: 1 });
    assert.equal(first.handle, 'https://example.invalid/free1-128.mp3');
    assert.deepEqual(requests, [{ path: '/getMusicPlay/free1', quality: '320' }]);

    // 2. One-shot consume: a second resolve (e.g. recovery) must hit QQ upstream freshly.
    requests.length = 0;
    const recovery = await provider.resolve(qqTrack('free1'), { version: 2 });
    assert.equal(recovery.handle, 'https://example.invalid/free1-fresh-128.mp3');
    assert.deepEqual(requests, [
      { path: '/getMusicPlay/free1', quality: '320' },
      { path: '/getMusicPlay/free1', quality: '128' },
    ]);

    // 3. VIP account: 320 succeeds and is preferred over the cached 128 handle.
    quality320Available = true;
    requests.length = 0;
    const vip = await provider.resolve(qqTrack('vip320'), { version: 3 });
    assert.equal(vip.handle, 'https://example.invalid/vip320-320.mp3');
    assert.deepEqual(requests, [{ path: '/getMusicPlay/vip320', quality: '320' }]);

    // 4. Expired TTL (> 120s): does not reuse stale 128 handle.
    time += 121_000;
    requests.length = 0;
    const expired = await provider.resolve(qqTrack('exp1'), { version: 4 });
    assert.equal(expired.handle, 'https://example.invalid/exp1-fresh-128.mp3');
    assert.deepEqual(requests, [
      { path: '/getMusicPlay/exp1', quality: '320' },
      { path: '/getMusicPlay/exp1', quality: '128' },
    ]);

    // 5. Logout clears cached handles.
    await provider.checkPlayability([qqTrack('free1'), qqTrack('vip320'), qqTrack('exp1')]);
    await provider.logout();
    assert.equal(provider.getAccount().status, 'login_required');
  } finally {
    await provider.dispose();
    store.close();
  }
});

test('background library warmup runs after import and foreground fallback joins the in-flight probe without duplicating requests', async () => {
  const store = new MusicStore();
  let now = 200_000;
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  let checkCalls = 0;
  let aborted = false;
  const qq = {
    name: 'qq',
    getAccount: () => ({ status: 'authorized', accountId: 'free-1' }),
    getCapabilities: () => ({ recommendation: { status: 'available' } }),
    resourceContext: () => '1:authorized:free-1',
    async getSeedTracks() {
      return { source: 'liked', sourceRef: '', requested: 3, imported: 3, degraded: false, attempts: [], tracks: [qqTrack('vip-1'), qqTrack('vip-2'), qqTrack('ok-1')] };
    },
    async resolve(track) {
      if (track.providerTrackId === 'ok-1') return { handle: 'fake:ok-1' };
      throw new MusicError('media_unavailable', 'restricted');
    },
    async checkPlayability(tracks, { signal }) {
      checkCalls++;
      signal?.addEventListener('abort', () => { aborted = true; }, { once: true });
      started.resolve();
      await gate.promise;
      return {
        playable: tracks.filter(t => t.providerTrackId === 'ok-1').map(t => `qq:${t.providerTrackId}`),
        unplayable: tracks.filter(t => t.providerTrackId.startsWith('vip-')).map(t => `qq:${t.providerTrackId}`),
        checked: tracks.length,
        skipped: false,
      };
    },
    async logout() { return { status: 'login_required' }; },
  };
  const registry = new ProviderRegistry({ providers: { qq } });
  const facade = createProviderFacade({ registry, store, now: () => now });
  const replies = new Map();
  const host = createCoreHost({
    store,
    providerRegistry: registry,
    platformsFacade: facade,
    playbackMode: 'fake',
    now: () => now,
    clock: { now: () => now, sleep: async () => {} },
    output: { write(line) { const msg = JSON.parse(line); if (msg.id) replies.set(msg.id, msg); } },
  });
  store.setSetting('recommendation_mode_v1', 'filtered');
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  try {
    await host.start();
    // Import finishes immediately without waiting for background warmup.
    await host.handle({ type: 'import-platform', id: 'imp-1', provider: 'qq', source: 'liked' });
    assert.equal(replies.get('imp-1').ok, true);
    await started.promise;
    assert.equal(checkCalls, 1, 'import triggers one background library playability warmup');

    // User clicks start while warmup is still running; fallback joins the same in-flight probe!
    await host.handle({ type: 'command', id: 'start-1', command: { type: 'resume', commandId: 'start-during-warmup' } });
    gate.resolve();
    await host.core.waitForIdle();
    assert.equal(checkCalls, 1, 'foreground fallback joins the in-flight warmup instead of firing a duplicate batch');
    assert.equal(host.snapshot().status, 'playing');
    assert.equal(host.snapshot().current.track.providerTrackId, 'ok-1');
    assert.equal(store.isTrackAvailable(qqTrack('vip-1'), now), false);
    assert.equal(store.isTrackAvailable(qqTrack('vip-2'), now), false);
    assert.equal(aborted, false);
  } finally {
    gate.resolve();
    await host.close();
    store.close();
  }
});

test('QQ resolve retries full 320->128 fallback when cached 128 handle expires mid-flight', async () => {
  let time = 300_000;
  const store = new MusicStore();
  const vault = memoryCredentials({ 'fishfm/qq': 'qqmusic_session=active' });
  store.setCredentialReference({ provider: 'qq', accountId: '7', credentialRef: 'fishfm/qq', state: 'authorized', updatedAt: 1 });
  const requests = [];
  let probeDone = false;
  const upstream = {
    async close() {},
    async request(input) {
      requests.push({ path: input.path, quality: input.query?.quality ?? null });
      if (input.path === '/login/refresh') return { status: 200, body: { data: { rotated: false } } };
      if (input.path === '/login/status') return { status: 200, body: { data: { profile: { str_musicid: '7' } } } };
      if (input.path === '/getMusicPlay/edge1') {
        if (!probeDone && input.query.quality === '128') {
          probeDone = true;
          return { status: 200, body: { data: { playUrl: { edge1: { url: 'https://example.invalid/edge1-128.mp3', expiresIn: 600 } } } } };
        }
        if (input.query.quality === '320') {
          // Simulate slow 320 call crossing the 120s cache TTL boundary.
          time += 125_000;
          return { status: 200, body: { data: { playUrl: { edge1: { url: '' } } } } };
        }
        return { status: 200, body: { data: { playUrl: { edge1: { url: 'https://example.invalid/edge1-fresh-128.mp3', expiresIn: 600 } } } } };
      }
      assert.fail(`unexpected path ${input.path}`);
    },
  };
  const transport = createQQCommunityTransport({ credentials: vault, upstream, now: () => time });
  const provider = createQQProvider({ store, credentials: vault, transport, now: () => time });
  try {
    await provider.restore();
    await provider.checkPlayability([qqTrack('edge1')]);
    requests.length = 0;
    const resolved = await provider.resolve(qqTrack('edge1'), { version: 1 });
    assert.equal(resolved.handle, 'https://example.invalid/edge1-fresh-128.mp3');
    assert.deepEqual(requests, [
      { path: '/getMusicPlay/edge1', quality: '320' },
      { path: '/getMusicPlay/edge1', quality: '320' },
      { path: '/getMusicPlay/edge1', quality: '128' },
    ]);
  } finally {
    await provider.dispose();
    store.close();
  }
});

test('fallback probe still checks tracks outside warmup checkedKeys in libraries larger than 20 tracks', async () => {
  const store = new MusicStore();
  let now = 400_000;
  const probedBatches = [];
  // Track IDs sort as t01-vip..t20-vip (warmed up), then t21-vip..t30-vip + t31-ok (unchecked by warmup).
  const tracks = Array.from({ length: 31 }, (_, idx) => {
    const n = String(idx + 1).padStart(2, '0');
    return qqTrack(idx === 30 ? `t${n}-ok` : `t${n}-vip`);
  });
  const qq = {
    name: 'qq',
    getAccount: () => ({ status: 'authorized', accountId: 'free-big' }),
    getCapabilities: () => ({ recommendation: { status: 'available' } }),
    resourceContext: () => '1:authorized:free-big',
    async getSeedTracks() {
      return { source: 'liked', sourceRef: '', requested: tracks.length, imported: tracks.length, degraded: false, attempts: [], tracks };
    },
    async resolve(track) {
      if (track.providerTrackId === 't31-ok') return { handle: 'fake:t31-ok' };
      throw new MusicError('media_unavailable', 'restricted');
    },
    async checkPlayability(batch) {
      probedBatches.push(batch.map(t => t.providerTrackId));
      return {
        playable: batch.filter(t => t.providerTrackId.endsWith('-ok')).map(t => `qq:${t.providerTrackId}`),
        unplayable: batch.filter(t => t.providerTrackId.endsWith('-vip')).map(t => `qq:${t.providerTrackId}`),
        checked: batch.length,
        skipped: false,
      };
    },
    async logout() { return { status: 'login_required' }; },
  };
  const registry = new ProviderRegistry({ providers: { qq } });
  const facade = createProviderFacade({ registry, store, now: () => now });
  const playback = new FakePlayback();
  const clock = new FakeClock(now);
  const core = new MusicCore({
    store,
    provider: facade,
    playback,
    clock,
    selector: buildSelector({ store, now: () => clock.now(), rng: () => 0 }),
  });
  playback.onEvent(event => core.onPlaybackEvent(event));
  store.setSetting('recommendation_mode_v1', 'filtered');
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  try {
    importSeedTracks({ store, provider: 'qq', source: 'liked', tracks, requested: tracks.length, now });
    // Run the 20-track warmup (checks t01-vip..t20-vip only).
    await facade.warmLibraryPlayability('qq', { force: true });
    assert.equal(probedBatches.length, 1);
    assert.equal(probedBatches[0].length, 20);
    assert.equal(probedBatches[0].includes('t31-ok'), false);

    // rng() => 0 picks t21-vip first, which fails; fallback probe MUST check remaining t22-vip..t31-ok and play t31-ok.
    core.dispatch({ type: 'resume', commandId: 'start-big-lib' });
    await core.waitForIdle();
    assert.equal(probedBatches.length, 2, 'foreground fallback probes unchecked tracks beyond the first 20');
    assert.equal(probedBatches[1].includes('t31-ok'), true);
    assert.equal(core.snapshot().status, 'playing');
    assert.equal(core.snapshot().current.track.providerTrackId, 't31-ok');
  } finally {
    await facade.closeDiscovery();
    store.close();
  }
});

test('force library warmup cancels an older in-flight warmup and probes the latest library', async () => {
  const store = new MusicStore();
  let now = 500_000;
  const firstGate = Promise.withResolvers();
  const firstStarted = Promise.withResolvers();
  let firstAborted = false;
  let importCount = 0;
  const probedBatches = [];
  const qq = {
    name: 'qq',
    getAccount: () => ({ status: 'authorized', accountId: 'free-reimport' }),
    getCapabilities: () => ({ recommendation: { status: 'available' } }),
    resourceContext: () => '1:authorized:free-reimport',
    async getSeedTracks() {
      importCount++;
      const list = importCount === 1 ? [qqTrack('old-vip')] : [qqTrack('old-vip'), qqTrack('new-ok')];
      return { source: 'liked', sourceRef: '', requested: list.length, imported: list.length, degraded: false, attempts: [], tracks: list };
    },
    async checkPlayability(batch, { signal }) {
      const ids = batch.map(t => t.providerTrackId);
      probedBatches.push(ids);
      if (probedBatches.length === 1) {
        signal?.addEventListener('abort', () => { firstAborted = true; }, { once: true });
        firstStarted.resolve();
        await firstGate.promise;
        return { playable: [], unplayable: [], checked: 0, skipped: true };
      }
      return {
        playable: ids.filter(id => id === 'new-ok').map(id => `qq:${id}`),
        unplayable: ids.filter(id => id === 'old-vip').map(id => `qq:${id}`),
        checked: ids.length,
        skipped: false,
      };
    },
    async logout() { return { status: 'login_required' }; },
  };
  const registry = new ProviderRegistry({ providers: { qq } });
  const facade = createProviderFacade({ registry, store, now: () => now });
  const host = createCoreHost({
    store,
    providerRegistry: registry,
    platformsFacade: facade,
    playbackMode: 'fake',
    now: () => now,
    clock: { now: () => now, sleep: async () => {} },
    output: { write() {} },
  });
  store.setSetting('playback_source_v1', { version: 1, revision: 1, provider: 'qq' });
  try {
    await host.start();
    await host.handle({ type: 'import-platform', id: 'imp-1', provider: 'qq', source: 'liked' });
    await firstStarted.promise;

    // A second import triggers warmLibraryPlayability(..., { force: true }) and cancels the older probe.
    await host.handle({ type: 'import-platform', id: 'imp-2', provider: 'qq', source: 'liked' });
    assert.equal(firstAborted, true, 'force warmup aborts the older in-flight warmup');
    firstGate.resolve();
    const joined = await facade.joinLibraryWarmup('qq');
    assert.equal(joined?.checked, 2);
    assert.equal(probedBatches.length, 2);
    assert.deepEqual(probedBatches[1].sort(), ['new-ok', 'old-vip']);
    assert.equal(store.isTrackAvailable(qqTrack('old-vip'), now), false);
    assert.equal(store.isTrackAvailable(qqTrack('new-ok'), now), true);
  } finally {
    firstGate.resolve();
    await host.close();
    store.close();
  }
});
