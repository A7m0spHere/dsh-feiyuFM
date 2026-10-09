import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { createCoreHost, createProviderFacade, ProviderRegistry } from '../src/core-host.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { createPersonaModelService } from '../src/persona-model.mjs';
import { createPersonaScheduler, prepareRecommendations } from '../src/persona-scheduler.mjs';
import { createSettingsHandler } from '../src/ui/dsh-settings.mjs';

const route = { provider: 'configured', model: 'picker' };
const track = id => ({ provider: 'netease', providerTrackId: String(id), title: `Song ${id}`, artist: `Artist ${id}`, durationMs: 180000 });
const picked = { summary: '沿着参考歌曲挑了两首', picks: [{ i: 0, why: '与参考歌曲相近' }, { i: 2, why: '想试一点不同的' }] };
async function waitForPick(f){const deadline=Date.now()+2000;while(f.calls()===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.calls(),1);}

function fixture({ output = picked, empty = false, hold = null } = {}) {
  const store = new MusicStore(), messages = [], prompts = [], stages = [];
  let now = 1000, account = 'test-account', id = 0, calls = 0, searches = 0;
  store.setSetting('recommendation_mode_v1', 'filtered');
  store.setSetting('summary_daily_tokens', 100000);
  // A former model-authored playlist must not enter the new default pool.
  store.setSetting('model_recommendations_v1', { version: 1, source: 'llm-recommendations', callId: 'old',
    songs: [{ title: 'Old invented title', artist: 'Old artist' }], verified: [{ index: 0, track: track(999) }] });
  importSeedTracks({ store, provider: 'netease', source: 'playlist', sourceRef: 'references', tracks: [track(1)], requested: 1, now });
  const adapter = {
    getAccount: () => ({ status: 'authorized', accountId: account }),
    getCapabilities: () => ({ recommendation: { status: 'available' } }),
    async getDiscoveryTracks(options) {
      stages.push('netease');
      assert.ok(options.seeds.some(seed => seed.providerTrackId === '1'), 'reference songs drive platform recall');
      return empty ? [] : [2, 3, 4].map(id => ({ ...track(id), discovery: { source: 'netease_similar', seedTrackKey: 'netease:1' } }));
    },
    search() { searches++; throw new Error('The filter pipeline must not search model-authored titles'); },
    resolve: async item => ({ handle: `fake:${item.providerTrackId}` }),
  };
  const registry = new ProviderRegistry({ providers: { netease: adapter } });
  const facade = createProviderFacade({ registry, store, now: () => now });
  const host = createCoreHost({ store, providerRegistry: registry, platformsFacade: facade, playbackMode: 'fake', now: () => now,
    clock:{now:()=>now,sleep:async()=>{}},
    output: { write: line => messages.push(JSON.parse(line)) } });
  let ready;
  const bridge = {
    start: () => ready ??= host.start(),
    async request(message) {
      await bridge.start(); const requestId = `pipeline-${++id}`;
      await host.handle({ ...message, id: requestId });
      const answer = messages.findLast(value => value.id === requestId);
      if (answer?.ok === false||answer?.type==='error') throw Object.assign(new Error(answer.error.message), answer.error);
      return answer;
    },
    command: command => bridge.request({ type: 'command', command }),
  };
  const llm = {
    listProviders: () => [{ id: route.provider }], listModels: () => [{ id: route.model }],
    stream(options) {
      calls++; stages.push('llm');
      prompts.push(JSON.parse(options.messages[1].content[0].text));
      return (async function* () {
        if (hold) await hold;
        yield { type: 'text-delta', text: JSON.stringify(output) };
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const service = createPersonaModelService({ llm, bridge });
  const handler = createSettingsHandler(bridge, { current: service });
  return { store, host, facade, bridge, service, handler, prompts, stages, calls: () => calls, searches: () => searches,
    time: value => { now = value; }, account: value => { account = value; },
    async close() { service.dispose(); await host.close(); store.close(); } };
}

test('reference songs flow through NetEase recall, LLM picks and local playback without generated-title lookup', async () => {
  const f = fixture();
  try {
    const result = await f.handler('fishfm/persona-recommendations', route);
    assert.equal(result.ok, true, result.error?.message);
    assert.deepEqual(f.stages, ['netease', 'llm']);
    assert.deepEqual(f.prompts[0].candidates.map(item => item.key), ['netease:2', 'netease:3', 'netease:4']);
    assert.deepEqual(f.prompts[0].references, [['Song 1', 'Artist 1']]);
    assert.equal('candidateRevision' in f.prompts[0], false, 'batch identity stays local');
    assert.deepEqual(result.value.persona.recommendationPipeline.tracks.map(item => item.providerTrackId), ['2', '4']);
    assert.equal(f.host.snapshot().paused, true, 'preparing songs cannot undo user pause');
    await f.bridge.command({ type: 'resume', commandId: 'listen' }); await f.host.core.waitForIdle();
    assert.ok(['2', '4'].includes(f.host.snapshot().current.track.providerTrackId));
    await f.bridge.command({ type: 'next', commandId: 'listen-next' }); await f.host.core.waitForIdle();
    assert.ok(['2', '4'].includes(f.host.snapshot().current.track.providerTrackId));
    assert.equal(f.calls(), 1, 'play and next make no model requests');
    assert.equal(f.searches(), 0);
    assert.equal(f.store.countEnvironment(), 1, 'recommendations do not become uploaded reference songs');
    assert.equal(f.store.db.prepare('SELECT purpose FROM music_model_calls').get().purpose, 'discovery-filter');
    assert.equal(f.store.getSetting('recommendation_route_v1').model, route.model);
  } finally { await f.close(); }
});

test('an empty platform batch never calls the model or uses a former invented playlist', async () => {
  const f = fixture({ empty: true });
  try {
    await assert.rejects(prepareRecommendations({ ...f, route }), { code: 'no_candidates' });
    assert.equal(f.calls(), 0); assert.equal(f.facade.discoveryTracks().length, 0);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM music_model_calls').get().n, 0);
  } finally { await f.close(); }
});

test('a model cannot introduce a song that NetEase did not return', async () => {
  const f = fixture({ output: { summary: 'invented', picks: [{ i: 500, why: 'invented song' }] } });
  try {
    await assert.rejects(prepareRecommendations({ ...f, route }), { code: 'invalid_recommendations' });
    assert.deepEqual(f.facade.discoveryTracks(), []);
    const row = f.store.db.prepare('SELECT status,usage_json FROM music_model_calls').get();
    assert.equal(row.status, 'failed'); assert.equal(JSON.parse(row.usage_json).outputTokens, 40);
  } finally { await f.close(); }
});

test('an empty LLM selection avoids automatic repeats but allows immediate manual picking', async () => {
  const f = fixture({ output: { summary: '这批暂时没有合适的', picks: [] } });
  try {
    await prepareRecommendations({ ...f, route });
    assert.equal(f.facade.discoveryStatus().selectionComplete, true);
    assert.deepEqual(f.facade.discoveryTracks(), []);
    assert.equal((await f.bridge.request({ type: 'discovery-filter-status' })).filter.due, false);
    const scheduler = createPersonaScheduler(f);
    assert.equal((await scheduler.checkDiscoveryFilter()).filterSkipped, 'not_due'); scheduler.stop();
    assert.equal(f.calls(), 1);
    f.time(62000); // 平台刷新仍保留 1 分钟节流，模型不再等待 15 分钟。
    assert.equal((await f.bridge.request({type:'persona'})).persona.recommendationAvailability.reason,null);
    await prepareRecommendations({...f,route});
    assert.equal(f.calls(),2,'no_candidates does not impose a manual waiting period');
    assert.equal(f.host.snapshot().paused,true);
  } finally { await f.close(); }
});

test('a candidate refresh rejects a late model response but keeps measured usage', async () => {
  const gate = Promise.withResolvers(), f = fixture({ hold: gate.promise });
  let pending;
  try {
    pending = assert.rejects(prepareRecommendations({ ...f, route }), { code: 'stale_candidates' });pending.catch(()=>{});
    await waitForPick(f);
    f.facade.clearDiscovery(); gate.resolve(); await pending;
    assert.deepEqual(f.facade.discoveryTracks(), []);
    assert.equal(f.store.db.prepare('SELECT status FROM music_model_calls').get().status, 'failed');
  } finally { gate.resolve();await pending?.catch(()=>{}); await f.close(); }
});

test('pausing while the LLM picks songs keeps playback paused after completion', async () => {
  const gate = Promise.withResolvers(), f = fixture({ hold: gate.promise });
  let pending;
  try {
    pending = prepareRecommendations({ ...f, route });pending.catch(()=>{});
    await waitForPick(f);
    await f.bridge.command({ type: 'pause', commandId: 'pause-during-pick' });
    gate.resolve(); await pending; await f.host.core.waitForIdle();
    assert.equal(f.host.snapshot().paused, true); assert.equal(f.host.playback.playing, false);
  } finally { gate.resolve();await pending?.catch(()=>{}); await f.close(); }
});

test('automatic filtering can bootstrap from configured models without generating a summary first', async () => {
  const f = fixture();
  try {
    await f.bridge.start(); await f.facade.refreshDiscovery();
    const scheduler = createPersonaScheduler(f);
    assert.equal((await scheduler.checkDiscoveryFilter()).filterRan, true);
    assert.equal(f.calls(), 1); assert.equal(f.store.getSetting('recommendation_route_v1').model, route.model);
    assert.equal((await scheduler.check()).skipped, 'playlist_pipeline'); scheduler.stop();
  } finally { await f.close(); }
});

test('account changes discard selected songs and an exhausted playlist asks for another bounded batch', async () => {
  const f = fixture();
  try {
    await prepareRecommendations({ ...f, route });
    await f.bridge.command({ type: 'resume', commandId: 'start-batch' }); await f.host.core.waitForIdle();
    await f.bridge.command({ type: 'next', commandId: 'consume-first' }); await f.host.core.waitForIdle();
    const status=(await f.bridge.request({type:'discovery-filter-status'})).filter;
    assert.equal(status.due,true,JSON.stringify({status,pipeline:f.facade.discoveryStatus(),candidates:f.facade.recommendationCandidates().map(track=>track.providerTrackId)}));
    assert.equal(f.calls(), 1);
    const current = f.host.snapshot().current.track.providerTrackId;
    assert.ok(!f.facade.recommendationCandidates().some(item => item.providerTrackId === current));
    f.account('another-account'); assert.deepEqual(f.facade.discoveryTracks(), []);
  } finally { await f.close(); }
});

test('manual batch replacement skips cooldown while shared budget still blocks platform and model requests', async () => {
  const f = fixture();
  try {
    await prepareRecommendations({ ...f, route });
    f.time(62000); await f.facade.refreshDiscovery({ manual: true });
    const availability=(await f.bridge.request({type:'persona'})).persona.recommendationAvailability;
    assert.equal(availability.reason,null);
    assert.equal(availability.retryAt,null);
    assert.equal(availability.retryAfterMs,0);
    await prepareRecommendations({ ...f, route });
    assert.equal(f.calls(),2,'another batch can be picked within one minute');
    assert.deepEqual(f.facade.discoveryTracks().map(track=>track.providerTrackId),['2','4']);
    const beforeStages=f.stages.length;
    f.time(1000000); f.store.setSetting('summary_daily_tokens', 0);
    await assert.rejects(prepareRecommendations({ ...f, route }), { code: 'budget_exhausted' });
    assert.equal((await f.bridge.request({type:'persona'})).persona.recommendationAvailability.reason,'budget_exhausted');
    assert.equal(f.calls(), 2);
    assert.equal(f.stages.length,beforeStages,'budget prevents both platform refresh and model dispatch');
  } finally { await f.close(); }
});

test('running filter is visible across clients and a second request leaves the first batch and pause alone',async()=>{
 const gate=Promise.withResolvers(),f=fixture({hold:gate.promise});let pending;
 try{
  pending=prepareRecommendations({...f,route});await waitForPick(f);
  const view=(await f.bridge.request({type:'persona'})).persona;
  assert.equal(view.recommendationAvailability.reason,'summary_busy');
  assert.equal(view.recommendationAvailability.runningPurpose,'discovery-filter');
  assert.equal(view.ledger.today.attempts,1,'reservation/start invalidate the cached UI ledger');
  const beforeStages=f.stages.length;
  await assert.rejects(prepareRecommendations({...f,route}),{code:'summary_busy'});
  assert.equal(f.stages.length,beforeStages);
  gate.resolve();await pending;
  assert.equal((await f.bridge.request({type:'persona'})).persona.recommendationAvailability.reason,null);
  f.time(62000);
  await prepareRecommendations({...f,route});assert.equal(f.calls(),2);
  assert.equal(f.host.snapshot().paused,true);
 }finally{gate.resolve();await pending?.catch(()=>{});await f.close();}
});

test('a smaller remaining budget reduces the candidate batch without exceeding conservative reservation', async()=>{
 const baseline=fixture();let cap;
 try{await prepareRecommendations({...baseline,route});cap=baseline.store.db.prepare('SELECT reserved_tokens FROM music_model_calls').get().reserved_tokens-1;}
 finally{await baseline.close();}
 const f=fixture();
 try{
  f.store.setSetting('summary_daily_tokens',cap);
  await prepareRecommendations({...f,route});
  assert.ok(f.prompts[0].candidates.length<3);
  assert.ok(f.store.db.prepare('SELECT reserved_tokens FROM music_model_calls').get().reserved_tokens<=cap);
  assert.equal(f.calls(),1);assert.ok(f.facade.discoveryTracks().every(track=>['2','3','4'].includes(track.providerTrackId)));
 }finally{await f.close();}
});

test('turning off autonomous listening prevents automatic model calls while manual picking remains available',async()=>{
 const f=fixture();
 try{
  await f.bridge.start();await f.facade.refreshDiscovery();
  await f.bridge.command({type:'setListening',value:false,commandId:'turn-off-auto'});
  const scheduler=createPersonaScheduler(f);
  assert.equal((await scheduler.checkDiscoveryFilter()).filterSkipped,'not_due');scheduler.stop();
  assert.equal(f.calls(),0);
  await prepareRecommendations({...f,route});assert.equal(f.calls(),1);
  assert.equal(f.host.snapshot().settings.listening,false);assert.equal(f.host.playback.playing,false);
 }finally{await f.close();}
});

test('the first real-host upgrade changes the default pipeline without clearing input, history or controls',async()=>{
 const store=new MusicStore();let host;
 try{
  importSeedTracks({store,provider:'netease',source:'playlist',tracks:[track(1)],requested:1});
  store.setSetting('recommendation_mode_v1','llm');
  store.upsertTrack(track(8),1000);
  assert.equal(store.recordHistory({playInstanceId:'before-upgrade',track:track(8),selectedBy:'user',progressSource:'audio',effectiveMs:5000,agentListening:false,audible:true,endReason:'paused',endedAt:1000}),true);
  store.setCoreState({revision:1,commandVersion:1,decisionVersion:1,settings:{listening:false,humanPlayback:false,discovery:true,discoveryRate:.7,strategy:'focus'},
    current:null,queue:[],paused:true,status:'idle',blockUntil:null,lastError:null});
  const registry=new ProviderRegistry({providers:{netease:{getAccount:()=>({status:'authorized'}),getCapabilities:()=>({recommendation:{status:'available'}}),getDiscoveryTracks:async()=>[track(8)]}}});
  const facade=createProviderFacade({registry,store});
  host=createCoreHost({store,providerRegistry:registry,platformsFacade:facade,playbackMode:'real',output:{write(){}}});
  await host.start();
  assert.equal(store.getSetting('recommendation_mode_v1'),'filtered');assert.equal(store.getSetting('recommendation_pipeline_v1'),1);
  assert.equal(store.countEnvironment(),1);assert.ok(store.getHistory('before-upgrade'));
  assert.equal(host.snapshot().settings.listening,false);assert.equal(host.snapshot().settings.humanPlayback,false);
  assert.equal(host.snapshot().settings.discoveryRate,.7);assert.equal(host.snapshot().settings.strategy,'focus');
  assert.equal(host.playback.supervisor.pid,null,'migration requires no audio process or sound');
  await facade.refreshDiscovery();
  assert.ok(facade.recommendationCandidates().some(track=>track.providerTrackId==='8'),'replaying an old pending history is not a new 30-minute cooldown');
 }finally{await host?.close();store.close();}
});
