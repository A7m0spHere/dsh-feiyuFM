import test from 'node:test';import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';import {importSeedTracks} from '../src/environment.mjs';
import {reserveSummary,startSummary,finishSummary,personaView,setSummaryOutputTokens} from '../src/persona.mjs';
import {createPersonaModelService} from '../src/persona-model.mjs';
import {parseModelRecommendations,createModelRecommendationResolver,modelRecommendations,STRATEGY_KEY,STRATEGY_PURPOSE} from '../src/model-recommendations.mjs';
import {buildSelector,createProviderFacade,createCoreHost} from '../src/core-host.mjs';
import {MusicCore} from '../src/core.mjs';import {FakeProvider,FakePlayback,FakeClock} from '../src/fakes.mjs';
import {resetRecommendationTaste,undoRecommendationReset,setTrackFeedback} from '../src/feedback.mjs';
const t=(id,title='Song '+id,artist='Artist '+id)=>({provider:'netease',providerTrackId:String(id),title,artist,durationMs:100000});
const snapshot={settings:{listening:true,humanPlayback:false,discovery:true,discoveryRate:1,strategy:'normal'},current:null,paused:true};
const route={provider:'configured',model:'configured'};
const text=JSON.stringify({summary:'按输入歌曲的艺人线索探索，这是模型推测。',songs:[['New 1','Singer 1'],['New 2','Singer 2']]});
function fixture(){const store=new MusicStore();importSeedTracks({store,provider:'netease',source:'recent',tracks:[t(1),t(2)],requested:2,now:1000});return store;}
function generate(store,at=2000,body=text){const p=reserveSummary({store,snapshot,...route,purpose:STRATEGY_PURPOSE,now:at});startSummary(store,p.callId);const result=finishSummary({store,callId:p.callId,status:'completed',text:body,usage:{inputTokens:100,outputTokens:50},now:at+1});return{p,result};}

test('a model generation sends song references and saves concrete suggestions with separate usage, cache and no taste writes',()=>{
 const store=fixture();try{
  const prefs=store.listPreferences(),{p,result}=generate(store);assert.equal(result.success,true);
  assert.deepEqual(JSON.parse(p.prompt).songs,[['Song 1','Artist 1'],['Song 2','Artist 2']]);assert.ok(Buffer.byteLength(p.prompt+p.system)<=1500);
  const view=personaView(store,snapshot,2100);assert.equal(view.recommendations.songs.length,2);assert.equal(view.recommendations.verified.length,0);
  assert.equal(view.summary,null);assert.equal(view.ledger.total.knownTokens,150);assert.equal(view.ledger.recent[0].purpose,STRATEGY_PURPOSE);
  assert.deepEqual(store.listPreferences(),prefs);assert.equal(store.getSetting('recommendation_mode_v1'),'llm');
  assert.equal(reserveSummary({store,snapshot,...route,purpose:STRATEGY_PURPOSE,now:2200}).cached,true);assert.equal(view.ledger.total.attempts,1);
 }finally{store.close();}
});
test('arbitrary directives, URLs, duplicate suggestions and malformed song lists cannot become a playlist',()=>{
 for(const bad of ['not json',JSON.stringify({summary:'x',songs:[['A','B']],setMode:'off'}),JSON.stringify({summary:'x',songs:[['https://example.invalid','B']]}),JSON.stringify({summary:'x',songs:[['A','B'],['A','B']]}),JSON.stringify({summary:'x',songs:[]})])assert.throws(()=>parseModelRecommendations(bad,{}),e=>e.code==='invalid_recommendations');
 assert.equal(parseModelRecommendations('```json\n'+text+'\n```',{}).songs.length,2);
});
test('an invalid model answer is billed as failure, preserves the previous playlist and cannot report success',async()=>{
 const store=fixture();try{
  generate(store,2000);const before=modelRecommendations(store);
  setTrackFeedback(store,t(1),1,3000);
  const bridge={async request(m){if(m.type==='persona-reserve')return{plan:reserveSummary({store,snapshot,...m,now:4000000})};if(m.type==='persona-start')return{started:startSummary(store,m.callId)};return{result:finishSummary({store,...m,now:4000001})};}};
  const service=createPersonaModelService({bridge,llm:{listProviders:()=>[{id:route.provider}],listModels:()=>[{id:route.model}],stream:async function*(){yield{type:'text-delta',text:'不是 JSON'};yield{type:'usage',usage:{inputTokens:20,outputTokens:10}};}}});
  await assert.rejects(()=>service.summarize(route,{purpose:STRATEGY_PURPOSE}),e=>e.code==='invalid_recommendations');service.dispose();
  assert.deepEqual(modelRecommendations(store),before);assert.equal(personaView(store,snapshot,4000002).ledger.total.knownTokens,180);
 }finally{store.close();}
});
test('missing inputs and too-small output caps fail before a model reservation',()=>{
 const store=new MusicStore();try{
  assert.throws(()=>reserveSummary({store,snapshot,...route,purpose:STRATEGY_PURPOSE}),e=>e.code==='no_facts');
  importSeedTracks({store,provider:'netease',source:'recent',tracks:[t(1)],requested:1});setSummaryOutputTokens(store,64);
  assert.throws(()=>reserveSummary({store,snapshot,...route,purpose:STRATEGY_PURPOSE}),e=>e.code==='strategy_output_limit');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM music_model_calls').get().n,0);
 }finally{store.close();}
});
test('search validation rejects wrong artist/version and only unique exact metadata enters the model pool',async()=>{
 const store=fixture();try{
  generate(store);let calls=0;
  const resolver=createModelRecommendationResolver({store,now:()=>10000,registry:{async search(_provider,query){calls++;return{tracks:query.includes('New 1')?[t(10,'New 1','Wrong singer'),t(11,'New 1','Singer 1')]:[t(12,'New 2','Singer 2'),t(13,'New 2','Singer 2')]};}}});
  await resolver.refresh();const playlist=modelRecommendations(store);
  assert.equal(calls,2);assert.equal(playlist.verified.length,1);assert.equal(playlist.verified[0].track.providerTrackId,'11');assert.equal(playlist.attempts[1].status,'ambiguous');assert.equal(store.countEnvironment(),2);
  const selector=buildSelector({store,now:()=>10000,rng:()=>0,listDiscovery:()=>[t(999,'Platform daily','Outside model list')]});
  const decision=selector.decide({discoveryRate:1});assert.equal(decision.track.providerTrackId,'11');assert.equal(decision.track.discovery.source,'llm_recommendation');
  resolver.close();
 }finally{store.close();}
});
test('LLM mode never asks NetEase for daily or similar recommendation candidates',async()=>{
 const store=fixture();try{
  generate(store);let platformCalls=0,searchCalls=0;
  const facade=createProviderFacade({store,now:()=>10000,registry:{providers:{netease:{getAccount:()=>({status:'authorized',accountId:'x'}),getDiscoveryTracks(){platformCalls++;throw Error('must not recommend');}}},async search(_p,q){searchCalls++;return{tracks:[q.includes('New 1')?t(11,'New 1','Singer 1'):t(12,'New 2','Singer 2')]};}}});
  facade.setDiscoveryEnabled(true);await facade.refreshDiscovery({manual:true});
  assert.equal(platformCalls,0);assert.equal(searchCalls,2);assert.deepEqual(facade.discoveryStatus().sources,['llm_recommendation']);facade.closeDiscovery();
 }finally{store.close();}
});
test('clearing or replacing inputs while a lookup is in flight cannot repopulate a discarded model playlist',async()=>{
 const store=fixture(),held=Promise.withResolvers();try{
  generate(store);const resolver=createModelRecommendationResolver({store,registry:{search:()=>held.promise},now:()=>10000});
  const pending=resolver.refresh();resetRecommendationTaste(store,snapshot,{clearLibrary:true,now:11000});
  held.resolve({tracks:[t(11,'New 1','Singer 1')]});await pending;
  assert.equal(modelRecommendations(store),null);assert.equal(store.countEnvironment(),0);resolver.close();
 }finally{store.close();}
});
test('clearing the input library clears source facts and all accumulated preferences, and undo restores every input row',()=>{
 const store=fixture();try{
  store.setPreference({targetType:'track',targetKey:'netease:1',affinity:.9,source:'listen',updatedAt:2000});generate(store);
  const env=store.db.prepare('SELECT * FROM user_environment').all(),sources=store.db.prepare('SELECT * FROM environment_sources').all(),prefs=store.listPreferences(),playlist=modelRecommendations(store);
  resetRecommendationTaste(store,snapshot,{clearLibrary:true,now:3000});
  assert.equal(store.countEnvironment(),0);assert.equal(store.countPreferences(),0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM environment_sources').get().n,0);assert.equal(modelRecommendations(store),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM music_model_calls').get().n,1);
  undoRecommendationReset(store);assert.deepEqual(store.db.prepare('SELECT * FROM user_environment').all(),env);assert.deepEqual(store.db.prepare('SELECT * FROM environment_sources').all(),sources);assert.deepEqual(store.listPreferences(),prefs);assert.deepEqual(modelRecommendations(store),playlist);
 }finally{store.close();}
});
test('Core host forwards the automatic flag so disabled automatic calls cannot reserve as manual calls',async()=>{
 const store=fixture(),out=[],host=createCoreHost({store,playbackMode:'fake',output:{write(c){out.push(JSON.parse(c));}}});try{
  await host.start();await host.handle({type:'persona-reserve',id:'auto',...route,automatic:true,purpose:STRATEGY_PURPOSE});
  assert.equal(out.at(-1).error.code,'automatic_disabled');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM music_model_calls').get().n,0);
 }finally{await host.close();store.close();}
});

test('library clearing removes queued imported songs, preserves pause and undo restores the queue once',()=>{
 const store=fixture(),core=new MusicCore({store,provider:new FakeProvider(),playback:new FakePlayback(),clock:new FakeClock(3000)});try{
  core.setQueue([t(1),t(2)]);core.dispatch({type:'resetLibrary',value:{clearFeedback:false},commandId:'clear'});
  assert.equal(core.snapshot().queue.length,0);assert.equal(core.snapshot().paused,true);assert.equal(store.countEnvironment(),0);
  core.dispatch({type:'undoTasteReset',commandId:'restore'});assert.equal(core.snapshot().queue.length,2);assert.equal(store.countEnvironment(),2);
  core.dispatch({type:'undoTasteReset',commandId:'restore'});assert.equal(core.snapshot().queue.length,2);
 }finally{store.close();}
});

test('a fresh song playlist has its own cooldown but shares the daily budget and attempt ledger with display summaries',()=>{
 const store=fixture();try{
  const p=reserveSummary({store,snapshot,...route,now:1000});startSummary(store,p.callId);finishSummary({store,callId:p.callId,status:'completed',text:'只展示',usage:{inputTokens:10,outputTokens:5},now:1001});
  generate(store,2000);assert.equal(personaView(store,snapshot,2100).ledger.total.knownTokens,165);
  assert.equal(store.getSetting('summary_automatic_purpose'),STRATEGY_PURPOSE);
  setTrackFeedback(store,t(1),1,2200);
  assert.throws(()=>reserveSummary({store,snapshot,...route,purpose:STRATEGY_PURPOSE,now:2300}),e=>e.code==='summary_cooldown');
 }finally{store.close();}
});

test('an expired login does not prevent later model suggestions from matching already stored metadata',async()=>{
 const store=fixture();try{
  generate(store,2000,JSON.stringify({summary:'按参考歌曲推荐',songs:[['Unknown','Other artist'],['Song 1','Artist 1']]}));let searches=0;
  const resolver=createModelRecommendationResolver({store,registry:{async search(){searches++;throw Object.assign(Error('sign in'),{code:'login_required'});}},now:()=>3000});
  await resolver.refresh();assert.equal(searches,1);assert.equal(modelRecommendations(store).verified.length,1);assert.equal(modelRecommendations(store).verified[0].index,1);resolver.close();
 }finally{store.close();}
});

test('a persistence failure rolls back both input deletion and the in-memory queue',()=>{
 const store=fixture(),core=new MusicCore({store,provider:new FakeProvider(),playback:new FakePlayback(),clock:new FakeClock(3000)});try{
  core.setQueue([t(1),t(2)]);const before=core.snapshot(),persist=store.setCoreState.bind(store);
  store.setCoreState=()=>{throw Error('simulated write failure');};
  assert.throws(()=>core.dispatch({type:'resetLibrary',value:{clearFeedback:false},commandId:'clear-failed'}),/simulated write failure/);
  assert.deepEqual(core.snapshot(),before);assert.equal(store.countEnvironment(),2);assert.equal(store.hasCommand('clear-failed'),false);
  store.setCoreState=persist;
 }finally{store.close();}
});

test('catalogue aliases and multiple recordings with the same performer IDs resolve without replacing the model work',async()=>{
 const store=fixture();try{
  generate(store,2000,JSON.stringify({summary:'按参考歌曲推荐',songs:[['光年之外','邓紫棋'],['Faded','Alan Walker']]}));
  const resolver=createModelRecommendationResolver({store,now:()=>3000,registry:{async search(_p,q){return{tracks:q.includes('光年')?[{...t(51,'光年之外','G.E.M.邓紫棋'),artists:[{id:'1',name:'G.E.M.邓紫棋'}]}]:[{...t(52,'Faded','Alan Walker'),artists:[{id:'2',name:'Alan Walker'}]},{...t(53,'Faded (Remastered)','Alan Walker / Vocalist'),artists:[{id:'2',name:'Alan Walker'},{id:'3',name:'Vocalist'}]}]};}}});
  await resolver.refresh();const record=modelRecommendations(store);assert.equal(record.verified.length,2);assert.equal(record.verified[1].track.providerTrackId,'52');assert.equal(record.verified[1].versions,2);resolver.close();
 }finally{store.close();}
});
