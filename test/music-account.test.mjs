import assert from 'node:assert/strict';
import test from 'node:test';
import { MusicStore } from '../src/storage.mjs';
import { createCoreHost, createProviderFacade, ProviderRegistry } from '../src/core-host.mjs';
import { createQQProvider } from '../src/providers/qq.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { createSettingsHandler } from '../src/ui/dsh-settings.mjs';
import { recentPlayback } from '../src/recent-playback.mjs';
import { createDiscoveryCache } from '../src/discovery.mjs';
import { mergeApprovedFilter } from '../src/approved-pool.mjs';
import { activateMusicAccount, initializeMusicAccount } from '../src/music-account.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { finishSummary, reserveSummary, startSummary } from '../src/persona.mjs';

const qqTrack = (id, title = id) => ({ provider: 'qq', providerTrackId: id, title, artist: 'Artist', durationMs: 180000 });

test('one Core accepts one QR and keeps library, likes and history separate across same-platform account switches', async () => {
  const store = new MusicStore();
  const vault = new Map();
  const credentials = { read: key => vault.get(key), write: (key, value) => vault.set(key, value), delete(key) { vault.delete(key); return true; } };
  const firstQr = Promise.withResolvers();
  const qrRequested = Promise.withResolvers();
  const lateImport = Promise.withResolvers();
  const importRequested = Promise.withResolvers();
  let accountId = 'first';
  let delayImport = false;
  const rows = [{ mid: 'same', name: 'First account', interval: 180 }];
  const qq = createQQProvider({ store, credentials, transport: { async request({ role }) {
    if (role === 'loginQr') return { body: { data: { unikey: 'qq', qrimg: 'data:image/png;base64,AA==' } } };
    if (role === 'loginPoll') return { body: { data: { code: 803, cookie: `qqmusic_session=${accountId}` } } };
    if (role === 'accountInfo') return { body: { data: { profile: { musicid: accountId } } } };
    if (role === 'resolve') return { body: { data: { playUrl: { same: { url: 'https://example.invalid/audio.mp3' } } } } };
    if (role === 'likedTracks' && delayImport) { importRequested.resolve(); return await lateImport.promise; }
    return { body: { songs: rows } };
  } } });
  const netease = { getAccount: () => ({ status: 'login_required' }), getCapabilities: () => ({}),
    beginLogin: async () => { qrRequested.resolve(); return await firstQr.promise; }, logout: async () => ({ status: 'login_required' }) };
  const registry = new ProviderRegistry({ providers: { netease, qq } });
  const replies = new Map();
  const host = createCoreHost({ store, providerRegistry: registry, platformsFacade: createProviderFacade({ registry, store }),
    accountIsolation: true, playbackMode: 'fake', output: { write(line) { const result = JSON.parse(line); replies.set(result.id, result); } } });
  let serial = 0;
  const request = async message => { const id = `request-${++serial}`; await host.handle({ ...message, id }); return replies.get(id); };
  const begin = provider => request({ type: 'login', provider, step: 'begin' });
  const poll = attemptId => request({ type: 'login', provider: 'qq', step: 'poll', attemptId });
  const login = async () => assert.equal((await poll((await begin('qq')).login.attemptId)).status, 'authorized');
  const logout = () => request({ type: 'logout', provider: 'qq' });

  try {
    await host.start();
    const neteaseLogin = begin('netease');
    await qrRequested.promise;
    assert.equal((await request({ type: 'platforms' })).platforms.netease.account.pending, true);
    assert.equal((await begin('qq')).error.code, 'music_login_pending');
    assert.equal((await request({ type: 'logout', provider: 'netease' })).ok, true);
    const qqAttempt = (await begin('qq')).login.attemptId;
    firstQr.resolve({ key: 'retired' });
    assert.equal((await neteaseLogin).error.code, 'cancelled');
    assert.equal((await poll('old-ticket')).error.code, 'music_login_changed');
    assert.equal((await poll(qqAttempt)).status, 'authorized');
    const firstRevision = host.snapshot().musicAccount.revision;
    assert.equal(host.snapshot().playbackSource.provider, 'qq');
    assert.equal((await begin('netease')).error.code, 'music_account_connected');
    assert.equal((await request({ type: 'playback-source', provider: 'netease', expectedRevision: firstRevision })).error.code, 'source_follows_account');

    assert.equal((await request({ type: 'import-platform', provider: 'qq', source: 'liked' })).ok, true);
    const track = qqTrack('same', 'First account');
    assert.equal((await request({ type: 'command', command: { type: 'requestTrack', track } })).ok, true);
    await host.core.waitForIdle();
    const playInstanceId = host.snapshot().current.playInstanceId;
    assert.equal((await request({ type: 'command', command: { type: 'setTrackFeedback', track, value: 1, playInstanceId } })).ok, true);
    delayImport = true;
    const oldImport = request({ type: 'import-platform', provider: 'qq', source: 'liked' });
    await importRequested.promise;
    assert.equal((await logout()).accountDisconnected, true);
    assert.equal(host.snapshot().current, null);
    assert.equal(host.snapshot().paused, true);
    accountId = 'second';
    await login();
    lateImport.resolve({ body: { songs: [{ mid: 'old-late', name: 'Old account only' }] } });
    assert.equal((await oldImport).error.code, 'cancelled');
    assert.equal((await request({ type: 'command', accountRevision: firstRevision, command: { type: 'requestTrack', track } })).error.code, 'music_account_changed');
    assert.equal(store.countEnvironment(), 0);
    assert.equal(store.listLikedTracks().length, 0);
    assert.equal(store.getHistory(playInstanceId), null);
    importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: [qqTrack('second-only')], requested: 1 });

    await logout();
    accountId = 'first';
    await login();
    assert.equal((await request({ type: 'library' })).library.tracks[0].providerTrackId, 'same');
    assert.equal(store.listLikedTracks().length, 1);
    assert.equal(store.getHistory(playInstanceId).end_reason, 'account_changed');
    assert.equal(store.getEnvironmentEntry(qqTrack('second-only')), null);
    assert.equal(store.getEnvironmentEntry(qqTrack('old-late')), null);
  } finally { await host.close(); store.close(); }
});

test('the same QQ account resumes its approved pool after startup verification', async () => {
  const store = new MusicStore();
  let account = { status: 'authorized', accountId: 'first' };
  let requests = 0;
  const at = 1000;
  const registry = new ProviderRegistry({ providers: { qq: {
    getAccount: () => account, getCapabilities: () => ({ recommendation: { status: 'available' } }),
    async getDiscoveryTracks() { requests++; return [{ ...qqTrack('recall'), discovery: { source: 'qq_daily', fetchedAt: at, expiresAt: at + 10000 } }]; },
  } } });
  const open = () => createDiscoveryCache({ registry, store, now: () => at });
  activateMusicAccount(store, 'qq', 'first');
  let cache = open();
  try {
    cache.setEnabled(true);
    await cache.refresh();
    const original = cache.status();
    mergeApprovedFilter(store, { source: 'llm-discovery-filter', callId: 'approval', generatedAt: at,
      candidateOwner: original.candidateOwner, tracks: cache.candidates(), picks: [{ trackKey: 'qq:recall', rank: 1 }] }, at);
    cache.close();
    account = { status: 'login_required', checking: true };
    cache = open();
    cache.setEnabled(true);
    await cache.refresh();
    assert.deepEqual(cache.playbackRecommendations(), []);
    account = { status: 'authorized', accountId: 'first' };
    assert.equal(cache.status().candidateRevision, original.candidateRevision);
    assert.equal(cache.playbackRecommendations()[0].providerTrackId, 'recall');
    assert.equal(requests, 1);
  } finally { cache.close(); store.close(); }
});

test('an earlier account’s model completion records usage without applying the result', () => {
  const store = new MusicStore();
  try {
    activateMusicAccount(store, 'qq', 'first');
    const snapshot = { settings: { discovery: true, discoveryRate: 0.25, listening: true } };
    const plan = reserveSummary({ store, snapshot, provider: 'sample', model: 'sample' });
    assert.equal(startSummary(store, plan.callId), true);
    activateMusicAccount(store, 'qq', 'second');
    const result = finishSummary({ store, callId: plan.callId, status: 'completed', text: 'Previous account summary', usage: { inputTokens: 10, outputTokens: 2 } });
    assert.equal(result.code, 'music_account_changed');
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 2);
    assert.equal(store.getSetting('persona_summary_v1'), null);
  } finally { store.close(); }
});

test('legacy rows are assigned through saved account references and unowned rows stay archived', () => {
  const store = new MusicStore();
  try {
    const oldNetEase = { ...qqTrack('111'), provider: 'netease' };
    store.setCredentialReference({ provider: 'netease', accountId: 'known', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
    importSeedTracks({ store, provider: 'netease', source: 'liked', tracks: [oldNetEase], requested: 1 });
    importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: [qqTrack('unowned')], requested: 1 });
    assert.equal(initializeMusicAccount(store, 'qq').provider, 'netease');
    assert.ok(store.getEnvironmentEntry(oldNetEase));
    assert.equal(store.countEnvironment(), 1);
    activateMusicAccount(store, 'qq', 'new');
    assert.equal(store.countEnvironment(), 0);
    assert.equal(store.db.prepare("SELECT count(*) count FROM music_account_archive WHERE account_key='legacy' AND table_name='user_environment'").get().count, 1);
    activateMusicAccount(store, 'netease', 'known');
    assert.ok(store.getEnvironmentEntry(oldNetEase));
  } finally { store.close(); }
});


test('an expired v11 NetEase account explicitly recovers its legacy data without claiming QQ data', async () => {
  const store = new MusicStore();
  const secrets = new Map([['fishfm/netease', 'MUSIC_U=expired']]);
  const credentials = {
    read: key => secrets.get(key),
    write: (key, value) => secrets.set(key, value),
    delete(key) { secrets.delete(key); return true; },
  };
  const netease = createNetEaseProvider({ store, credentials, transport: { async request() { assert.fail('unexpected NetEase request'); } },
    communityApi: {
      async login_qr_key() { return { body: { code: 200, data: { unikey: 'fixture' } } }; },
      async login_qr_check() { return { body: { code: 803, cookie: 'MUSIC_U=new' } }; },
      async login_status() { return { body: { code: 200, data: { profile: { userId: 42 } } } }; },
    },
  });
  const registry = new ProviderRegistry({ providers: { netease } });
  const replies = new Map();
  const host = createCoreHost({ store, providerRegistry: registry, platformsFacade: createProviderFacade({ registry, store }),
    accountIsolation: true, playbackMode: 'fake', output: { write(line) { const result = JSON.parse(line); replies.set(result.id, result); } } });
  let serial = 0;
  const request = async message => { const id = 'recovery-' + ++serial; await host.handle({ ...message, id }); return replies.get(id); };
  const api = createSettingsHandler({ async start() {}, async request(message) {
    const result = await request(message);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return result;
  } });
  const primary = { ...qqTrack('111'), provider: 'netease' };
  const backup = { ...qqTrack('222'), provider: 'netease' };
  const history = (playInstanceId, endedAt) => ({ playInstanceId, track: primary, selectedBy: 'user',
    progressSource: 'audio', effectiveMs: 60_000, agentListening: true, audible: true, endReason: 'ended', endedAt });
  try {
    // Version 11 preserved the library after expiration and cleared its account ID.
    store.db.exec('DROP TABLE music_account_archive; DELETE FROM schema_migrations WHERE version=12; PRAGMA user_version=11');
    store.setCredentialReference({ provider: 'netease', accountId: null, credentialRef: 'fishfm/netease', state: 'expired', updatedAt: 1 });
    importSeedTracks({ store, provider: 'netease', source: 'liked', tracks: [primary, backup], requested: 2, now: 1 });
    importSeedTracks({ store, provider: 'qq', source: 'liked', tracks: [qqTrack('unclaimed')], requested: 1, now: 1 });
    store.recordHistory(history('legacy-play', 100_000));
    store.db.prepare('INSERT INTO user_track_feedback VALUES (?, ?, ?)').run('netease:111', 1, 1);
    store.db.prepare('INSERT INTO user_track_feedback VALUES (?, ?, ?)').run('netease:222', 1, 1);
    store.setSetting('persona_summary_v1', { text: 'Unassigned model data' });
    store.migrate();

    await host.start();
    const loggedOutRevision = host.snapshot().musicAccount.revision;
    const restore = accountRevision => api('fishfm/recover-legacy-music', { provider: 'netease', accountRevision });
    assert.equal((await restore(loggedOutRevision)).error.code, 'login_required');
    const begun = await request({ type: 'login', provider: 'netease', step: 'begin' });
    const signedIn = await request({ type: 'login', provider: 'netease', step: 'poll', attemptId: begun.login.attemptId });
    assert.equal(signedIn.status, 'authorized');
    assert.equal(signedIn.login.accountId, '42');
    assert.equal((await request({ type: 'platforms' })).platforms.netease.legacyRecoveryAvailable, true);
    assert.equal(store.countEnvironment(), 0);
    assert.equal(store.getHistory('legacy-play'), null);
    assert.equal((await restore(loggedOutRevision)).error.code, 'music_account_changed');

    importSeedTracks({ store, provider: 'netease', source: 'recent', tracks: [primary], requested: 1, now: 2 });
    store.recordHistory(history('current-play', 200_000));
    store.db.prepare('INSERT INTO user_track_feedback VALUES (?, ?, ?)').run('netease:111', -1, 2);
    const accountRevision = host.snapshot().musicAccount.revision;
    const recovered = await restore(accountRevision);
    assert.equal(recovered.value?.legacyRestored, true, JSON.stringify(recovered.error));
    assert.equal(recovered.value.platforms.netease.legacyRecoveryAvailable, undefined);
    assert.equal(store.countEnvironment(), 2);
    assert.equal(store.getEnvironmentEntry(primary).source, 'recent');
    assert.deepEqual(store.listEnvironmentSources(primary).map(row => row.source), ['liked', 'recent']);
    assert.equal(store.getTrackStats(primary).effective_ms, 120_000);
    assert.equal(store.getHistory('legacy-play').track_key, 'netease:111');
    assert.deepEqual(recentPlayback(store).map(entry => entry.playInstanceId), ['legacy-play', 'current-play']);
    assert.deepEqual([...store.feedbackScores()], [['netease:111', -1], ['netease:222', 1]]);
    assert.equal(store.getSetting('feedback_revision_v1'), 1);
    assert.equal(store.getSetting('persona_summary_v1', null), null);
    assert.equal(store.getEnvironmentEntry(qqTrack('unclaimed')), null);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM music_account_archive WHERE account_key='legacy' AND table_name='user_environment'").get().count, 1);
    assert.equal((await restore(accountRevision)).value.legacyRestored, false);
    assert.equal(store.getTrackStats(primary).effective_ms, 120_000);
  } finally { await host.close(); store.close(); }
});
