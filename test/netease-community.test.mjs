import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { MusicStore } from '../src/storage.mjs';
import { createMemoryCredentials } from '../src/providers/credentials-dpapi.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';

const SECRET = 'MUSIC_U=private-session-value; __csrf=private-csrf-value';
const song = (id, name = `Song ${id}`) => ({ id, name, ar: [{ name: 'Artist' }], dt: 181_000 });

function fixture(api, { accountId = null } = {}) {
  const store = new MusicStore();
  const credentials = createMemoryCredentials({ 'fishfm/netease': SECRET });
  store.setCredentialReference({ provider: 'netease', accountId, credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const provider = createNetEaseProvider({ transport: { request: async () => { throw new Error('unexpected direct request'); }, useSecret() {} },
    communityApi: api, credentials, store, now: () => 2 });
  return { store, credentials, provider, close: () => store.close() };
}

test('direct search distinguishes platform business failures, malformed replies and genuine empty results', async () => {
  const context = fixture({});
  let body;
  const provider = createNetEaseProvider({
    transport: { request: async () => ({ status: 200, body }), useSecret() {} },
    communityApi: {}, credentials: context.credentials, store: context.store,
  });
  try {
    for (const code of [406, 502]) {
      body = { code };
      await assert.rejects(() => provider.search('Song'), error => error.code === 'provider_failure' && error.details.stage === 'search' && error.details.platformCode === code);
    }
    for (const reply of [{ code: 200 }, { code: 200, result: { songs: 'bad' } }, '<html>not a search response</html>']) {
      body = reply;
      await assert.rejects(() => provider.search('Song'), error => error.code === 'provider_failure');
    }
    body = { code: 200, result: { songCount: 0 } };
    assert.deepEqual((await provider.search('Song')).tracks, []);
    body = { code: 200, result: { songs: [song('1')], songCount: 1 } };
    assert.equal((await provider.search('Song')).tracks[0].providerTrackId, '1');
    body = { code: 301 };
    await assert.rejects(() => provider.search('Song'), error => error.code === 'login_required');
    assert.equal(context.store.getCredentialReference('netease').state, 'expired');
  } finally { context.close(); }
});

test('an old authorized account recovers profile.userId before recent-history import and passes it to the community API', async () => {
  const calls = [];
  const context = fixture({
    async login_status(params) {
      calls.push({ method: 'login_status', params });
      return { status: 200, body: { data: { code: 200, profile: { userId: 87654321 } } }, cookie: [] };
    },
    async user_record(params) {
      calls.push({ method: 'user_record', params });
      return { status: 200, body: { code: 200, weekData: [{ song: song('101') }, { song: song('102') }] }, cookie: [] };
    },
  });
  try {
    const result = await context.provider.getSeedTracks({ limit: 10 });
    assert.equal(result.source, 'recent');
    assert.deepEqual(result.tracks.map((track) => track.providerTrackId), ['101', '102']);
    assert.deepEqual(result.tracks.map((track) => track.title), ['Song 101', 'Song 102']);
    assert.equal(calls[1].params.uid, '87654321');
    assert.equal(calls[1].params.type, 1);
    assert.equal(context.store.getCredentialReference('netease').account_id, '87654321');
    assert.equal(Object.hasOwn(calls[1].params, 'cookie'), true);
    const publicData = JSON.stringify({ result, reference: context.store.getCredentialReference('netease') });
    assert.equal(publicData.includes('private-session-value'), false);
    assert.equal(publicData.includes('private-csrf-value'), false);
  } finally { context.close(); }
});

test('explicit playlist selection is validated and preserves source reference without claiming fallback',async()=>{
 const context=fixture({
  async user_playlist(){return{status:200,body:{code:200,playlist:[{id:10,name:'First',creator:{userId:'42'},trackCount:1},{id:20,name:'Chosen',creator:{userId:'42'},trackCount:1}]}};},
  async playlist_detail(params){assert.equal(params.id,'20');return{status:200,body:{code:200,playlist:{trackIds:[{id:1}]}}};},
  async song_detail(){return{status:200,body:{code:200,songs:[{...song(1),ar:[{id:99,name:'Artist'}]}]}};},
 },{accountId:'42'});
 try{
  assert.equal((await context.provider.getUserPlaylists()).length,2);
  const result=await context.provider.getSeedTracks({source:'playlist',playlistId:'20',limit:5});
  assert.equal(result.sourceRef,'20');assert.equal(result.degraded,false);assert.equal(result.tracks[0].artists[0].id,'99');
  await assert.rejects(context.provider.getSeedTracks({source:'playlist',playlistId:'999',limit:5}),/No NetEase seed source/);
 }finally{context.close();}
});

test('failed recent history degrades to likes, resolves liked IDs to song metadata, and returns a secret-free source trail', async () => {
  const calls = [];
  const context = fixture({
    async login_status(params) {
      calls.push({ method: 'login_status', params });
      return { status: 200, body: { data: { code: 200, profile: { userId: '42' } } }, cookie: [] };
    },
    async user_record(params) {
      calls.push({ method: 'user_record', params });
      return { status: 200, body: { code: 502, msg: 'temporarily unavailable' }, cookie: [] };
    },
    async likelist(params) {
      calls.push({ method: 'likelist', params });
      return { status: 200, body: { code: 200, ids: ['7', '8'] }, cookie: [] };
    },
    async song_detail(params) {
      calls.push({ method: 'song_detail', params });
      return { status: 200, body: { code: 200, songs: [song('7', 'Like A'), song('8', 'Like B')] }, cookie: [] };
    },
  });
  try {
    const result = await context.provider.getSeedTracks({ limit: 2 });
    assert.equal(result.source, 'liked');
    assert.deepEqual(result.tracks.map((track) => track.title), ['Like A', 'Like B']);
    assert.equal(result.attempts[0].stage, 'user_record');
    assert.equal(result.attempts[0].platformCode, 502);
    assert.equal(result.attempts[1].count, 2);
    assert.equal(calls.find((call) => call.method === 'likelist').params.uid, '42');
    assert.equal(calls.find((call) => call.method === 'song_detail').params.ids, '7,8');
    const persisted = JSON.stringify({ result, references: context.store.db.prepare('SELECT * FROM credential_references').all() });
    assert.equal(persisted.includes('private-session-value'), false);
    assert.equal(persisted.includes('private-csrf-value'), false);
  } finally { context.close(); }
});

test('cookie refreshes from community API responses are written to the credential store and never returned', async () => {
  const rotated = 'MUSIC_U=rotated-private-value; __csrf=rotated-private-csrf';
  const context = fixture({
    async login_status(params) {
      assert.equal(params.cookie, SECRET);
      return { status: 200, body: { data: { code: 200, profile: { userId: 9 } } },
        cookie: ['MUSIC_U=rotated-private-value; Path=/; HttpOnly', '__csrf=rotated-private-csrf; Path=/'] };
    },
    async user_record(params) {
      assert.equal(params.cookie, rotated);
      return { status: 200, body: { code: 200, weekData: [{ song: song('9') }] }, cookie: [] };
    },
  });
  try {
    const result = await context.provider.getSeedTracks({ limit: 1 });
    assert.equal(context.credentials.read('fishfm/netease'), rotated);
    assert.equal(JSON.stringify(result).includes('rotated-private'), false);
    assert.equal(JSON.stringify(context.store.db.prepare('SELECT * FROM credential_references').all()).includes('rotated-private'), false);
  } finally { context.close(); }
});

test('a valid profile without userId stops import before any seed endpoint is called', async () => {
  const calls = [];
  const context = fixture({
    async login_status() {
      calls.push('login_status');
      return { status: 200, body: { data: { code: 200, account: {}, profile: { nickname: 'listener' } } }, cookie: [] };
    },
    async user_record() { calls.push('user_record'); return { status: 200, body: { code: 200, weekData: [] } }; },
    async likelist() { calls.push('likelist'); return { status: 200, body: { code: 200, ids: [] } }; },
  });
  try {
    await assert.rejects(() => context.provider.getSeedTracks({ limit: 10 }), (error) => {
      assert.equal(error.code, 'account_id_unavailable');
      assert.equal(error.details.stage, 'login_status');
      assert.match(error.message, /profile\.userId/);
      assert.equal(error.message.includes('private-session-value'), false);
      return true;
    });
    assert.deepEqual(calls, ['login_status']);
  } finally { context.close(); }
});

test('playlist fallback chooses a user-owned playlist and resolves its track IDs', async () => {
  const calls = [];
  const context = fixture({
    async login_status() { return { status: 200, body: { data: { code: 200, profile: { userId: 42 } } }, cookie: [] }; },
    async user_record() { return { status: 200, body: { code: 200, weekData: [] }, cookie: [] }; },
    async likelist() { return { status: 200, body: { code: 200, ids: [] }, cookie: [] }; },
    async user_playlist(params) {
      calls.push({ method: 'user_playlist', params });
      return { status: 200, body: { code: 200, playlist: [
        { id: 1, specialType: 5, userId: 42 }, { id: 2, specialType: 0, userId: 99 },
        { id: 3, specialType: 0, userId: 42 },
      ] }, cookie: [] };
    },
    async playlist_detail(params) {
      calls.push({ method: 'playlist_detail', params });
      return { status: 200, body: { code: 200, playlist: { trackIds: [{ id: 31 }, { id: 32 }] } }, cookie: [] };
    },
    async song_detail(params) {
      calls.push({ method: 'song_detail', params });
      return { status: 200, body: { code: 200, songs: [song('31'), song('32')] }, cookie: [] };
    },
  });
  try {
    const result = await context.provider.getSeedTracks({ limit: 3 });
    assert.equal(result.source, 'playlist');
    assert.deepEqual(calls.map((call) => call.method), ['user_playlist', 'playlist_detail', 'song_detail']);
    assert.equal(calls[0].params.uid, '42');
    assert.equal(calls[1].params.id, 3);
    assert.equal(calls[2].params.ids, '31,32');
    assert.deepEqual(result.tracks.map((track) => track.providerTrackId), ['31', '32']);
  } finally { context.close(); }
});

test('a guest-shaped login_status response expires the old credential and blocks seed calls', async () => {
  const calls = [];
  const context = fixture({
    async login_status() {
      calls.push('login_status');
      return { status: 200, body: { data: { code: 200, account: null, profile: null } }, cookie: [] };
    },
    async user_record() { calls.push('user_record'); return { status: 200, body: { code: 200, weekData: [] } }; },
  }, { accountId: 'old-account-id' });
  try {
    const restored = await context.provider.restore();
    assert.equal(restored.status, 'expired');
    assert.equal(context.store.getCredentialReference('netease').state, 'expired');
    assert.equal(context.provider.getAccount().status, 'expired');
    await assert.rejects(() => context.provider.getSeedTracks({ limit: 10 }), { code: 'login_required' });
    assert.deepEqual(calls, ['login_status']);
  } finally { context.close(); }
});

test('the default SDK and its diagnostics cannot write banners or session values to Core stdout/stderr', () => {
  const script = [
    'import { createNetEaseProvider } from "./src/providers/netease.mjs";',
    'const quietProvider = createNetEaseProvider({ transport: { async request() {}, useSecret() {} } });',
    'const credential = { read: () => "MUSIC_U=private-session-value", write() {} };',
    'const store = { getCredentialReference: () => ({ state: "authorized", account_id: "7" }), setCredentialReference() {} };',
    'const provider = createNetEaseProvider({ transport: { async request() {}, useSecret() {} }, credentials: credential, store,',
    '  communityApi: { async login_status() { console.error("Cookie=MUSIC_U=private-session-value"); return { status: 200, body: { data: { code: 200, profile: { userId: 7 } } }, cookie: [] }; } } });',
    'await provider.restore(); process.stdout.write("READY\\n");',
  ].join(' ');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'READY\n');
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.includes('MUSIC_U='), false);
  assert.equal(child.stderr.includes('private-session-value'), false);
});
