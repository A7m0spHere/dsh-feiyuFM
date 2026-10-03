import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { createMemoryCredentials } from '../src/providers/credentials-dpapi.mjs';
function fixture(api) {
  const store = new MusicStore();
  store.setCredentialReference({ provider: 'netease', accountId: 'a', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const calls = [];
  const provider = createNetEaseProvider({ store, credentials: createMemoryCredentials({ 'fishfm/netease': 'MUSIC_U=fixture' }), communityApi: api,
    transport: { request() { throw new Error('unexpected wire role'); } }, onLog: entry => calls.push(entry), now: () => 1000 });
  return { store, provider, calls };
}
test('daily recommendations are normalized, deduplicated and retain account origin without credentials', async () => {
  const f = fixture({ recommend_songs: async () => ({ status: 200, body: { code: 200, data: { dailySongs: [ { id: 1, name: 'New', ar: [{ name: 'Artist' }], dt: 60_000 }, { id: 1 }, {} ] } } }) });
  try {
    assert.equal(f.provider.getCapabilities().recommendation.status, 'available');
    const rows = await f.provider.getDiscoveryTracks();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].discovery.source, 'netease_daily');
    assert.equal(rows[0].durationMs, 60_000);
    assert.equal(f.calls.filter(c => c.type === 'platform-request').length, 1);
    assert.equal(JSON.stringify(rows).includes('MUSIC_U'), false);
  } finally { f.store.close(); }
});
test('recommendation errors fall back to personal FM, cancellation and invalid shapes never look like success', async () => {
  const f = fixture({ recommend_songs: async () => { throw { status: 502, body: { code: 502 } }; }, personal_fm: async () => ({ status: 200, body: { code: 200, data: [{ id: 2, duration: 100_000 }] } }) });
  try {
    assert.equal((await f.provider.getDiscoveryTracks())[0].discovery.source, 'netease_personal_fm');
    assert.equal(f.provider.getCapabilities().recommendation.status, 'degraded');
    await assert.rejects(f.provider.getDiscoveryTracks({ signal: AbortSignal.abort() }), { code: 'cancelled' });
    await assert.rejects(f.provider.getDiscoveryTracks({ limit: 201 }), { code: 'invalid_command' });
    const invalid = fixture({ recommend_songs: async () => ({ status: 200, body: { code: 200, data: {} } }) });
    try { await assert.rejects(invalid.provider.getDiscoveryTracks(), { code: 'provider_failure' }); }
    finally { invalid.store.close(); }
  } finally { f.store.close(); }
});

test('a recommendation authentication rejection expires the stored reference instead of continuing to advertise availability', async () => {
  const f = fixture({ recommend_songs: async () => { throw { status: 200, body: { code: 301 } }; } });
  try {
    await assert.rejects(f.provider.getDiscoveryTracks(), { code: 'login_required' });
    assert.equal(f.provider.getAccount().status, 'expired');
    assert.equal(f.provider.getCapabilities().recommendation.status, 'login_required');
  } finally { f.store.close(); }
});

test('multiple real seed relations are normalized and retained before account recommendations',async()=>{
 const seen=[];
 const f=fixture({recommend_songs:async()=>({status:200,body:{code:200,data:{dailySongs:[{id:90}]}}}),
  simi_song:async(params)=>{seen.push(params.id);return{status:200,body:{code:200,songs:[{id:99,name:'Related',ar:[{id:10,name:'A'}],dt:60000}]}};}});
 try{
  const seeds=[{provider:'netease',providerTrackId:'1'},{provider:'netease',providerTrackId:'2'}];
  const result=await f.provider.getDiscoveryTracks({seeds,limit:10});assert.equal(result[0].discovery.source,'netease_similar');
  assert.deepEqual(result[0].discovery.seedTrackKeys,['netease:1','netease:2']);assert.deepEqual(seen,['1','2']);assert.equal(result[1].discovery.source,'netease_daily');
  await assert.rejects(f.provider.getDiscoveryTracks({seeds,limit:201}),{code:'invalid_command'});
 }finally{f.store.close();}
});
