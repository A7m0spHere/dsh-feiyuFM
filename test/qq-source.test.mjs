import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { MusicCore } from '../src/core.mjs';
import { FakePlayback } from '../src/fakes.mjs';
import { playbackSourceView, savePlaybackSource } from '../src/playback-source.mjs';
import { ProviderRegistry, buildSelector, createCoreHost, createProviderFacade } from '../src/core-host.mjs';
import { createDiscoveryCache } from '../src/discovery.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { createQQProvider } from '../src/providers/qq.mjs';
import { createQQCommunityTransport } from '../src/providers/qq-transport.mjs';
import { createQQUpstream } from '../src/providers/qq-upstream.mjs';
import { createPersonaModelService } from '../src/persona-model.mjs';

const track = (provider, id = 'same-id') => ({ provider, providerTrackId: id, title: `${provider} song`, artist: 'Artist', durationMs: 180000 });
function credentials() {
  const records = new Map();
  return { read: key => records.get(key) ?? null, write: (key, value) => records.set(key, value), delete: key => records.delete(key) };
}
function accountProvider(name, accountId = 'a') {
  return { name, getAccount: () => ({ status: 'authorized', accountId }),
    getCapabilities: () => ({ recommendation: { status: 'available' } }),
    resolve: async value => ({ handle: `https://example.invalid/${value.provider}.mp3` }),
    getDiscoveryTracks: async () => [{ ...track(name), discovery: { source: `${name}_daily`, fetchedAt: 1000, expiresAt: 9999999 } }],
    logout: async () => ({ status: 'login_required' }) };
}

test('playback source defaults without writing and rejects concurrent configuration changes', () => {
  const store = new MusicStore();
  try {
    assert.equal(playbackSourceView(store).provider, 'netease');
    assert.equal(store.getSetting('playback_source_v1', null), null);
    assert.deepEqual(savePlaybackSource(store, 'qq', 0), { version: 1, revision: 1, provider: 'qq' });
    assert.throws(() => savePlaybackSource(store, 'netease', 0), { code: 'playback_source_conflict' });
    assert.equal(savePlaybackSource(store, 'qq', 1).revision, 1);
    assert.throws(() => savePlaybackSource(store, 'other', 1), { code: 'invalid_playback_source' });
  } finally { store.close(); }
});

test('two signed-in platforms resolve the same ID on their own platform', async () => {
  const registry = new ProviderRegistry({ providers: { netease: accountProvider('netease'), qq: accountProvider('qq') } });
  const store = new MusicStore();
  const facade = createProviderFacade({ registry, store });
  try {
    assert.match((await facade.resolve(track('netease'))).handle, /netease/);
    assert.match((await facade.resolve(track('qq'))).handle, /qq/);
  } finally { facade.closeDiscovery(); await registry.close(); store.close(); }
});

test('selected-source recall ignores changes to the other account and cancels an old source generation', async () => {
  const store = new MusicStore();
  const netease = accountProvider('netease');
  const qq = accountProvider('qq');
  const calls = [];
  for (const provider of [netease, qq]) {
    const original = provider.getDiscoveryTracks;
    provider.getDiscoveryTracks = async options => { calls.push(provider.name); return original(options); };
  }
  const registry = new ProviderRegistry({ providers: { netease, qq } });
  const cache = createDiscoveryCache({ registry, store, now: () => 1000 });
  try {
    cache.setEnabled(true);
    await cache.refresh();
    const owner = cache.status().candidateOwner;
    qq.getAccount = () => ({ status: 'expired', accountId: 'changed' });
    assert.equal(cache.status().candidateOwner, owner);
    assert.equal(cache.candidates().length, 1);
    assert.deepEqual(calls, ['netease']);
    savePlaybackSource(store, 'qq', 0);
    assert.notEqual(cache.status().candidateOwner, owner);
    assert.equal(cache.candidates().length, 0);
    qq.getAccount = () => ({ status: 'authorized', accountId: 'b' });
    await cache.refresh();
    assert.equal(cache.candidates()[0].provider, 'qq');
  } finally { cache.close(); store.close(); }
});

test('library fallback and normal selection stay on the selected source', () => {
  const store = new MusicStore();
  try {
    for (const provider of ['netease', 'qq']) importSeedTracks({ store, provider, source: 'liked', tracks: [track(provider)], requested: 1 });
    savePlaybackSource(store, 'qq', 0);
    const selector = buildSelector({ store });
    assert.equal(selector.next({ discoveryRate: 0, libraryFallback: true }).track.provider, 'qq');
  } finally { store.close(); }
});

test('switching automatic source preserves current playback and pause while logout stops only its platform', async () => {
  const store = new MusicStore();
  const registry = new ProviderRegistry({ providers: { netease: accountProvider('netease'), qq: accountProvider('qq') } });
  const facade = createProviderFacade({ registry, store });
  const replies = [];
  const host = createCoreHost({ store, providerRegistry: registry, platformsFacade: facade, playbackMode: 'fake', output: { write: line => replies.push(JSON.parse(line)) } });
  try {
    await host.start();
    host.core.dispatch({ type: 'requestTrack', track: track('netease'), commandId: 'play-ne' });
    await host.core.waitForIdle();
    host.core.dispatch({ type: 'pause', commandId: 'pause-ne' });
    const before = host.snapshot();
    await host.handle({ type: 'playback-source', provider: 'qq', expectedRevision: 0, id: 'source' });
    assert.equal(host.snapshot().current.playInstanceId, before.current.playInstanceId);
    assert.equal(host.snapshot().commandVersion, before.commandVersion);
    assert.equal(host.snapshot().paused, true);
    await host.handle({ type: 'logout', provider: 'qq', id: 'logout-qq' });
    assert.equal(host.snapshot().current.playInstanceId, before.current.playInstanceId);
    await host.handle({ type: 'logout', provider: 'netease', id: 'logout-ne' });
    assert.equal(host.snapshot().current, null);
    assert.equal(host.snapshot().paused, true);
  } finally { await host.close(); store.close(); }
});

test('resource caches reject a late result after the owning account changes', async () => {
  const store = new MusicStore();
  let context = 'first';
  let finish;
  const provider = { resourceContext: () => context, resolve: () => new Promise(resolve => { finish = resolve; }) };
  const core = new MusicCore({ store, provider, playback: new FakePlayback() });
  try {
    const pending = core._resolveResource(track('qq'), new AbortController().signal, 1);
    context = 'second';
    finish({ handle: 'https://example.invalid/old.mp3' });
    await assert.rejects(pending, { code: 'cancelled' });
    assert.equal(core.resourceCache.size, 0);
  } finally { store.close(); }
});

test('QQ normalization uses MID, singer and seconds, and rejects previews for the requested MID', async () => {
  const store = new MusicStore();
  const vault = credentials();
  vault.write('fishfm/qq', 'qqmusic_session=test');
  store.setCredentialReference({ provider: 'qq', accountId: 'a', credentialRef: 'fishfm/qq', state: 'authorized', updatedAt: 1 });
  const raw = { id: 123, mid: 'realMID', name: 'Song', singer: [{ mid: 'artistMID', name: 'Singer' }], interval: 240 };
  const provider = createQQProvider({ store, credentials: vault, transport: { request: async ({ role }) => ({ status: 200, body: role === 'search'
    ? { items: [raw] } : role === 'lyrics' ? { lyric: '[00:01.00]hello', trans: '[00:01.00]你好' }
      : { data: { playUrl: { wrong: { url: 'https://example.invalid/wrong' }, realMID: { url: 'https://example.invalid/preview', preview: true } } } } }) } });
  try {
    const value = (await provider.search('song')).tracks[0];
    assert.equal(value.providerTrackId, 'realMID');
    assert.equal(value.artist, 'Singer');
    assert.equal(value.durationMs, 240000);
    assert.equal((await provider.lyrics(value)).lines[0].translation, '你好');
    await assert.rejects(provider.resolve(value), { code: 'media_unavailable' });
  } finally { store.close(); }
});

test('QQ lyrics use the SDK MID parameter and decode the response without refreshing the session', async () => {
  const vault = credentials();
  const store = new MusicStore();
  const requests = [];
  const lrc = '[00:01.00]原文';
  const translation = Buffer.from('[00:01.00]译文').toString('base64');
  const upstream = { close: async () => {}, request: async input => {
    requests.push(input);
    return { status: 200, body: { response: { code: 0, lyric: lrc, trans: translation } } };
  } };
  const transport = createQQCommunityTransport({ credentials: vault, upstream });
  transport.useSecret('qqmusic_session=active');
  const provider = createQQProvider({ store, credentials: vault, transport });
  try {
    const result = await provider.lyrics(track('qq', 'songMID'));
    assert.equal(result.lines[0].text, '原文');
    assert.equal(result.lines[0].translation, '译文');
    assert.deepEqual(requests.map(({ path, query, token }) => ({ path, query, token })),
      [{ path: '/getLyric', query: { songmid: 'songMID', trans: 1 }, token: '' }]);
  } finally { await provider.dispose(); store.close(); }
});

test('QQ recommendations look up the numeric song ID and keep MID for playback', async () => {
  const vault = credentials();
  const store = new MusicStore();
  vault.write('fishfm/qq', 'qqmusic_session=active');
  store.setCredentialReference({ provider: 'qq', accountId: '7', credentialRef: 'fishfm/qq', state: 'authorized', updatedAt: 1 });
  const requests = [];
  const upstream = { close: async () => {}, request: async input => {
    requests.push(input);
    switch (input.path) {
      case '/login/refresh': return { status: 200, body: { data: { rotated: false } } };
      case '/login/status': return { status: 200, body: { data: { profile: { str_musicid: '7' } } } };
      case '/user/daily-songs':
      case '/user/personal-fm': return { status: 422, body: { errorKey: 'resource.not-found' } };
      case '/getSongInfo/seedMID': return { status: 200, body: { response: {
        code: 0, songinfo: { code: 0, data: { track_info: { mid: 'seedMID', id: 12345 } } },
      } } };
      case '/getSongInfo/invalidMID': return { status: 200, body: { response: {
        code: 0, songinfo: { code: 0, data: { track_info: { mid: 'anotherMID', id: 67890 } } },
      } } };
      case '/song/similar': return { status: 200, body: { songs: [{ mid: 'newMID', id: 67890, name: 'Similar song' }] } };
      case '/getMusicPlay/newMID': return { status: 200, body: { data: { playUrl: {
        newMID: { url: 'https://example.invalid/complete-track.mp3' },
      } } } };
      default: assert.fail(input.path);
    }
  } };
  const transport = createQQCommunityTransport({ credentials: vault, upstream });
  const provider = createQQProvider({ store, credentials: vault, transport });
  try {
    assert.deepEqual(await provider.restore(), { status: 'authorized', accountId: '7' });
    assert.deepEqual(await provider.getDiscoveryTracks(), []);
    const result = await provider.getDiscoveryTracks({ seeds: [track('qq', 'seedMID'), track('qq', 'invalidMID')] });
    assert.deepEqual(result.map(value => [value.providerTrackId, value.discovery.source, value.discovery.seedTrackKey]),
      [['newMID', 'qq_similar', 'qq:seedMID']]);
    assert.deepEqual(requests.filter(input => input.path === '/song/similar').map(input => [input.query, input.token]),
      [[{ id: 12345 }, 'active']]);
    assert.equal(requests.find(input => input.path === '/getSongInfo/seedMID').token, '');
    assert.equal((await provider.resolve(result[0])).handle, 'https://example.invalid/complete-track.mp3');
  } finally { await provider.dispose(); store.close(); }
});

test('QQ session rotation persists before reuse and playlist import follows all pages', async () => {
  const vault = credentials();
  const requests = [];
  const upstream = { close: async () => {}, request: async input => {
    requests.push(input);
    if (input.path === '/login/refresh') return { status: 200, body: { data: { rotated: true, token: 'next' } } };
    return { status: 200, body: { songs: Array.from({ length: input.query.offset ? 50 : 100 }, (_, i) => ({ mid: `${input.query.offset ?? 0}-${i}` })), more: !input.query.offset } };
  } };
  const transport = createQQCommunityTransport({ credentials: vault, upstream });
  transport.setSessionWriter(value => vault.write('fishfm/qq', value));
  transport.useSecret('qqmusic_session=first');
  try {
    const value = await transport.request({ role: 'likedTracks', params: { limit: 150 } });
    assert.equal(value.body.songs.length, 150);
    assert.equal(vault.read('fishfm/qq'), 'qqmusic_session=next');
    assert.ok(requests.slice(1).every(input => input.token === 'next'));
    assert.equal(requests.at(-1).query.offset, 100);
  } finally { await transport.dispose(); }
});

test('the packaged no-port QQ Worker starts, serves offline account status and closes', async () => {
  const upstream = createQQUpstream();
  try {
    const result = await upstream.request({ path: '/login/status', sessionSecret: 'a'.repeat(64), network: { mode: 'direct', url: '' } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, {});
  } finally { await upstream.close(); }
  await assert.rejects(upstream.request({ path: '/login/status' }), { code: 'cancelled' });
});


test('cancelling an obsolete source during model reservation closes the ledger without starting a stream', async () => {
  let release;
  let reserved;
  const reservedSignal = new Promise(resolve => { reserved = resolve; });
  const finished = [];
  let streams = 0;
  const service = createPersonaModelService({
    llm: { listProviders: async () => [{ id: 'p' }], listModels: async () => [{ id: 'm' }],
      async *stream() { streams++; } },
    bridge: { async request(message) {
      if (message.type === 'persona-reserve') {
        reserved();
        return new Promise(resolve => { release = () => resolve({ plan: { callId: 'reserved', maxTokens: 256, prompt: 'test', system: 'test' } }); });
      }
      if (message.type === 'persona-finish') { finished.push(message); return { result: { success: false } }; }
      return { started: true };
    } },
  });
  try {
    const pending = service.summarize({ provider: 'p', model: 'm' }, { purpose: 'discovery-filter' });
    await reservedSignal;
    service.cancel('discovery-filter');
    release();
    await assert.rejects(pending, { code: 'cancelled' });
    assert.equal(streams, 0);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].status, 'cancelled');
    assert.deepEqual(finished[0].usage, { inputTokens: 0, outputTokens: 0 });
  } finally { service.dispose(); }
});


test('cancelling a QQ playback waiter does not abort a shared refresh needed by an import', async () => {
  let release;
  let refreshSignal;
  let refreshCount = 0;
  const upstream = { close: async () => {}, request: async (input, options) => {
    if (input.path === '/login/refresh') {
      refreshCount++;
      refreshSignal = options.signal;
      return new Promise(resolve => { release = () => resolve({ status: 200, body: { data: { rotated: false } } }); });
    }
    return { status: 200, body: { songs: [], more: false } };
  } };
  const transport = createQQCommunityTransport({ credentials: credentials(), upstream });
  transport.useSecret('qqmusic_session=first');
  const pause = new AbortController();
  try {
    const playback = transport.request({ role: 'resolve', params: { songmid: 'song' }, signal: pause.signal });
    const importWork = transport.request({ role: 'likedTracks', params: { limit: 1 } });
    pause.abort();
    await assert.rejects(playback, { code: 'cancelled' });
    assert.equal(refreshSignal.aborted, false);
    release();
    assert.equal((await importWork).status, 200);
    assert.equal(refreshCount, 1);
  } finally { await transport.dispose(); }
});


test('a transient QQ restart validation failure is visible and can be retried with the stored session', async () => {
  const store = new MusicStore();
  const vault = credentials();
  vault.write('fishfm/qq', 'qqmusic_session=stored');
  store.setCredentialReference({ provider: 'qq', accountId: 'a', credentialRef: 'fishfm/qq', state: 'authorized', updatedAt: 1 });
  let fail = true;
  const provider = createQQProvider({ store, credentials: vault, transport: { requiresRestore: true,
    request: async () => {
      if (fail) throw Object.assign(new Error('temporary network failure'), { status: 502 });
      return { status: 200, body: { data: { profile: { musicid: 'a' } } } };
    } } });
  try {
    assert.equal(provider.getAccount().checking, true);
    await assert.rejects(provider.restore(), { code: 'provider_failure' });
    assert.equal(provider.getAccount().status, 'error');
    assert.equal(provider.getAccount().canRestore, true);
    assert.equal(vault.read('fishfm/qq'), 'qqmusic_session=stored');
    fail = false;
    assert.equal((await provider.restore()).status, 'authorized');
    assert.equal(provider.getAccount().status, 'authorized');
  } finally { store.close(); }
});


test('host shutdown invalidates playback before disposing a QQ runtime with an in-flight resolve', async () => {
  const store = new MusicStore();
  let release;
  let invalidatedBeforeDispose = false;
  const qq = accountProvider('qq');
  qq.resolve = () => new Promise(resolve => { release = resolve; });
  let host;
  qq.dispose = async () => {
    invalidatedBeforeDispose = host.core.abortController === null;
    release?.({ handle: 'https://example.invalid/late.mp3' });
  };
  const registry = new ProviderRegistry({ providers: { qq } });
  const facade = createProviderFacade({ registry, store });
  host = createCoreHost({ store, providerRegistry: registry, platformsFacade: facade, playbackMode: 'fake', output: { write() {} } });
  try {
    await host.start();
    host.core.dispatch({ type: 'requestTrack', track: track('qq'), commandId: 'closing-qq' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    await host.close();
    assert.equal(invalidatedBeforeDispose, true);
    assert.equal(host.core.resourceCache.size, 0);
  } finally { await host.close(); store.close(); }
});
