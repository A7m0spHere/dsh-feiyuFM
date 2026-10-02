import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryCache } from '../src/discovery.mjs';
import { MusicStore } from '../src/storage.mjs';
import { ProviderRegistry, createProviderFacade, createCoreHost } from '../src/core-host.mjs';
import { importSeedTracks } from '../src/environment.mjs';
const t = id => ({ provider: 'netease', providerTrackId: String(id), title: `Song ${id}`, durationMs: 60_000 });
function fixture() {
  const store = new MusicStore();
  let time = 1000, account = 'account-a', calls = 0, pending = null, failing = false;
  const adapter = { getAccount: () => ({ status: 'authorized', accountId: account }), getCapabilities: () => ({ recommendation: { status: 'available' } }),
    getDiscoveryTracks: async () => { calls++; if (pending) return pending; if (failing) throw new Error('network'); return [t(1),t(2),t(3),t(3)]; },
    resolve: async () => ({ handle: 'fake:discovery' }) };
  const registry = new ProviderRegistry({ providers: { netease: adapter } });
  const cache = createDiscoveryCache({ registry, store, now: () => time });
  return { store, cache, registry, calls: () => calls, time: value => { time = value; }, account: value => { account = value; }, pending: value => { pending = value; }, fail: value => { failing = value; } };
}
test('discovery filters imported, effectively heard and unavailable tracks without adding to the user environment', async () => {
  const f = fixture();
  try {
    importSeedTracks({ store: f.store, provider: 'netease', source: 'recent', tracks: [t(1)], requested: 1 });
    f.store.upsertTrack(t(2),1000);
    f.store.recordHistory({ playInstanceId:'heard',track:t(2),selectedBy:'agent',progressSource:'audio',effectiveMs:40_000,agentEffectiveMs:40_000,agentListening:true,audible:true,endReason:'ended',endedAt:1000 });
    f.cache.setEnabled(true); await f.cache.refresh();
    assert.deepEqual(f.cache.tracks().map(x=>x.providerTrackId),['3']);
    assert.equal(f.store.countEnvironment(),1);
    assert.equal(f.store.listAgentKnownTracks()[0].provider_track_id,'2');
    f.store.markUnavailable(t(3),'media_unavailable',10_000);
    assert.equal(f.cache.tracks().length,0);
    assert.equal(f.cache.status().state,'empty');
  } finally { f.cache.close(); f.store.close(); }
});
test('single flight, budget and off/on toggles bound refreshes; late results cannot repopulate a disabled pool', async () => {
  const f = fixture(); let release;
  f.pending(new Promise(resolve=>{release=resolve;}));
  try {
    f.cache.setEnabled(true);
    const first=f.cache.refresh(), second=f.cache.refresh();
    assert.equal(first,second);
    await Promise.resolve(); assert.equal(f.calls(),1);
    f.cache.setEnabled(false); release([t(3)]); await first;
    assert.equal(f.cache.tracks().length,0);
    f.cache.setEnabled(true); await f.cache.refresh();
    assert.equal(f.calls(),1,'toggle must not bypass request budget');
    f.time(2_000_000); f.pending(null); await f.cache.refresh();
    assert.equal(f.calls(),2);
  } finally { f.cache.close(); f.store.close(); }
});
test('temporary failures retain valid cache, expiry and account changes discard it', async () => {
  const f = fixture();
  try {
    f.cache.setEnabled(true); await f.cache.refresh();
    f.time(2_000_000); f.fail(true); await f.cache.refresh();
    assert.equal(f.cache.status().state,'ready'); assert.equal(f.cache.tracks().length,3);
    f.time(30_000_000); assert.equal(f.cache.tracks().length,0);
    f.account('account-b'); assert.equal(f.cache.tracks().length,0);
    assert.equal(f.store.getSetting('discovery_cache_v1').entries.length,0);
  } finally { f.cache.close(); f.store.close(); }
});
test('discovery shutdown drops late network results without touching a closed store', async () => {
  const f = fixture(); let reject;
  f.pending(new Promise((_, fail)=>{reject=fail;}));
  f.cache.setEnabled(true); const work=f.cache.refresh(); await Promise.resolve();
  f.cache.close(); f.store.close(); reject(new Error('late-network-error'));
  await assert.doesNotReject(work);
});
test('a background discovery request never blocks a user pause and keeps ready as the first host message', async () => {
  const f = fixture(); let release;
  f.pending(new Promise(resolve=>{release=resolve;}));
  const facade=createProviderFacade({registry:f.registry,store:f.store,now:()=>1000});
  const messages=[];
  const host=createCoreHost({store:f.store,providerRegistry:f.registry,platformsFacade:facade,playbackMode:'fake',output:{write(line){messages.push(JSON.parse(line));}}});
  try {
    await host.start(); assert.equal(messages[0].type,'ready');
    await host.handle({type:'command',command:{type:'pause',commandId:'pause-during-refresh'}});
    assert.equal(host.snapshot().paused,true);
    release([t(3)]); await facade.refreshDiscovery();
    assert.equal(host.snapshot().paused,true,'refresh does not start music');
  } finally { await host.close(); f.cache.close(); f.store.close(); }
});
