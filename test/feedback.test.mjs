import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicStore} from '../src/storage.mjs';
import {importSeedTracks} from '../src/environment.mjs';
import {initializeAgentPreferences} from '../src/taste.mjs';
import {setTrackFeedback,trackFeedback,feedbackView,resetRecommendationTaste,undoRecommendationReset} from '../src/feedback.mjs';
import {scoreCandidate,createSelector} from '../src/selection.mjs';
import {selectRecommendationSeeds} from '../src/recommendation.mjs';
import {applyListenGrowth} from '../src/growth.mjs';
import {MusicCore} from '../src/core.mjs';
import {FakeClock,FakeProvider,FakePlayback} from '../src/fakes.mjs';
import {reserveSummary} from '../src/persona.mjs';
import {createSettingsHandler} from '../src/ui/dsh-settings.mjs';
import {buildSelector} from '../src/core-host.mjs';

const track=id=>({provider:'netease',providerTrackId:String(id),title:`Song ${id}`,artist:`Artist ${id}`,durationMs:100000});
const settings={listening:true,humanPlayback:false,discovery:true,discoveryRate:.7,strategy:'normal'};
function fixture(path=':memory:') {
 const store=new MusicStore(path);
 importSeedTracks({store,provider:'netease',source:'recent',requested:2,tracks:[track(1),track(2)],now:1000});
 initializeAgentPreferences({store,seed:1,now:1000});
 return store;
}
const entry=(id,start=1000)=>({playInstanceId:id,track:track(1),selectedBy:'agent',progressSource:'audio',agentListening:true,audible:false,
 effectiveMs:100000,agentEffectiveMs:100000,progressAccounting:'effective-delta',endReason:'ended',startedAt:start,endedAt:start+100000,durationMs:100000});

test('explicit feedback changes both pool rankings without rewriting agent taste, and is reversible',()=>{
 const store=fixture();try {
  const before=store.listPreferences();
  const score=t=>scoreCandidate({track:t,store,now:2000,plays:new Map(),randomValue:0});
  const baseline=score(track(1)).score;
  setTrackFeedback(store,track(1),1,2000);setTrackFeedback(store,track(1),1,2001);
  assert.equal(feedbackView(store,{}).liked,1);assert.equal(score(track(1)).score,baseline+.25);
  const picker=discovery=>createSelector({store,rng:()=>0,listFamiliar:()=>discovery?[]:[track(1),track(2)],listDiscovery:()=>discovery?[track(1),track(2)]:[]});
  for(const discovery of [false,true])assert.equal(picker(discovery).decide({discoveryRate:discovery?1:0,at:3000}).track.providerTrackId,'1');
  setTrackFeedback(store,track(1),-1,2002);
  assert.equal(score(track(1)).feedback,-.75);
  for(const discovery of [false,true])assert.equal(picker(discovery).decide({discoveryRate:discovery?1:0,at:3000}).track.providerTrackId,'2');
  assert.deepEqual(store.listPreferences(),before,'votes do not overwrite independent agent preferences');
  applyListenGrowth({store,entry:entry('grow'),durationMs:100000,now:3000});
  assert.equal(trackFeedback(store,track(1)),-1,'growth cannot undo an explicit user vote');
  setTrackFeedback(store,track(1),0,3001);assert.equal(score(track(1)).feedback,0);
  assert.equal(feedbackView(store,{}).reduced,0);
 }finally{store.close();}
});

test('liked discoveries enter the familiar pool and seed ranking, while reduced tracks cannot be seeds',()=>{
 const store=fixture();try {
  store.upsertTrack(track(3),2000);setTrackFeedback(store,track(3),1,2001);setTrackFeedback(store,track(1),-1,2001);
  const seeds=selectRecommendationSeeds({store,now:3000});assert.equal(seeds[0].providerTrackId,'3');assert.equal(seeds.some(t=>t.providerTrackId==='1'),false);
  assert.equal(buildSelector({store,now:()=>3000,rng:()=>0}).decide({discoveryRate:0}).track.providerTrackId,'3');
  assert.equal(store.countEnvironment(),2);assert.equal(store.hasEffectiveListen(track(3)),false,'a like is not fabricated listening');
 }finally{store.close();}
});

test('reset reseeds taste, preserves user data and votes, and restores an exact preference checkpoint',()=>{
 const store=fixture();try {
  store.setPreference({targetType:'track',targetKey:'netease:1',affinity:.95,source:'listen',updatedAt:2000});
  setTrackFeedback(store,track(1),1,2000);store.bumpSessionInfluence('session',track(1),2000);
  store.setCredentialReference({provider:'netease',accountId:'user',credentialRef:'local-ref',state:'authorized',updatedAt:1000});
  store.addConstraint({id:'ban',kind:'ban_track',track:track(2),createdAt:1000,summary:'user rule'});
  store.recordHistory(entry('previous'));store.setSetting('persona_summary_v1',{text:'old cached summary'});
  const prefs=store.listPreferences(),env=store.listEnvironment(),history=store.db.prepare('SELECT * FROM listen_history').all(),credential=store.getCredentialReference('netease');
  resetRecommendationTaste(store,{settings,current:{playInstanceId:'in-progress'}},{now:3000});
  assert.notEqual(store.getPreference('track','netease:1').affinity,.95);assert.equal(trackFeedback(store,track(1)),1);
  assert.deepEqual(store.listEnvironment(),env);assert.deepEqual(store.db.prepare('SELECT * FROM listen_history').all(),history);
  assert.deepEqual(store.getCredentialReference('netease'),credential);assert.equal(store.activeConstraints(4000).length,1);
  assert.equal(store.getSetting('persona_summary_v1'),null);assert.equal(store.getSessionInfluence('session',track(1)),0);
  undoRecommendationReset(store);assert.deepEqual(store.listPreferences(),prefs);assert.equal(store.getSessionInfluence('session',track(1)),1);
  assert.equal(store.getSetting('persona_summary_v1').text,'old cached summary');assert.equal(feedbackView(store,{}).canUndoReset,false);
 }finally{store.close();}
});

test('clearing votes is optional and undo respects later explicit votes including neutral',()=>{
 const store=fixture();try {
  setTrackFeedback(store,track(1),1,2000);setTrackFeedback(store,track(2),-1,2000);
  resetRecommendationTaste(store,{settings},{now:3000,clearFeedback:true});assert.equal(feedbackView(store,{}).liked,0);
  setTrackFeedback(store,track(1),0,4000);undoRecommendationReset(store);
  assert.equal(trackFeedback(store,track(1)),0);assert.equal(trackFeedback(store,track(2)),-1);
 }finally{store.close();}
});

test('old or in-flight growth cannot resurrect reset preferences, while fresh listening still grows',()=>{
 const store=fixture();try {
  resetRecommendationTaste(store,{settings,current:{playInstanceId:'current'}},{now:3000});
  const before=store.listPreferences();
  for(const e of [entry('pending',1000),entry('current',4000),{...entry('legacy'),startedAt:undefined}]) {
   assert.equal(applyListenGrowth({store,entry:e,durationMs:100000,now:5000}).reason,'preference-reset-boundary');
  }
  assert.deepEqual(store.listPreferences(),before);
  assert.equal(applyListenGrowth({store,entry:entry('fresh',4000),durationMs:100000,now:105000}).updated,true);
 }finally{store.close();}
});

test('reset refuses while a summary is reserved and preserves the model ledger',()=>{
 const store=fixture();try {
  reserveSummary({store,snapshot:{settings},provider:'configured',model:'configured',now:3000});
  const prefs=store.listPreferences(),ledger=store.db.prepare('SELECT * FROM music_model_calls').all();
  assert.throws(()=>resetRecommendationTaste(store,{settings},{now:4000}),e=>e.code==='summary_busy');
  assert.deepEqual(store.listPreferences(),prefs);assert.deepEqual(store.db.prepare('SELECT * FROM music_model_calls').all(),ledger);
  assert.equal(feedbackView(store,{}).canUndoReset,false);
 }finally{store.close();}
});

test('current-song feedback rejects stale instances and reset commands are idempotent without changing pause',()=>{
 const store=fixture(),core=new MusicCore({store,provider:new FakeProvider(),playback:new FakePlayback(),clock:new FakeClock()});try {
  core.setQueue([track(1)]);core.dispatch({type:'next',commandId:'select'});
  const current=core.snapshot().current,feedback={type:'setTrackFeedback',track:track(1),value:1,playInstanceId:current.playInstanceId,commandId:'vote'};
  core.dispatch(feedback);core.dispatch(feedback);assert.equal(feedbackView(store,core.snapshot()).liked,1);assert.equal(core.snapshot().paused,true);
  assert.throws(()=>core.dispatch({...feedback,commandId:'stale',playInstanceId:'old'}),e=>e.code==='stale_track');
  const reset={type:'resetTaste',value:{clearFeedback:false},commandId:'reset'};core.dispatch(reset);
  const checkpoint=store.getSetting('preference_reset_backup_v1');core.dispatch(reset);assert.deepEqual(store.getSetting('preference_reset_backup_v1'),checkpoint);
  assert.equal(core.snapshot().current.playInstanceId,current.playInstanceId);assert.equal(core.snapshot().paused,true);
  core.dispatch({type:'undoTasteReset',commandId:'undo'});core.dispatch({type:'undoTasteReset',commandId:'undo'});
  assert.equal(core.snapshot().paused,true);
 }finally{store.close();}
});

test('v8 migrates without loss and feedback plus undo checkpoint survive a real file reopen',()=>{
 const folder=mkdtempSync(join(tmpdir(),'fm-feedback-')),path=join(folder,'music.sqlite');
 try {
  let store=fixture(path);const prefs=store.listPreferences();store.db.exec('DROP TABLE user_track_feedback; ALTER TABLE music_model_calls DROP COLUMN purpose; ALTER TABLE music_model_calls DROP COLUMN facts_json; DELETE FROM schema_migrations WHERE version>=9; PRAGMA user_version=8');store.close();
  store=new MusicStore(path);assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,10);assert.deepEqual(store.listPreferences(),prefs);
  setTrackFeedback(store,track(1),-1,2000);resetRecommendationTaste(store,{settings},{now:3000});store.close();
  store=new MusicStore(path);assert.equal(trackFeedback(store,track(1)),-1);assert.equal(feedbackView(store,{}).canUndoReset,true);
  undoRecommendationReset(store);assert.deepEqual(store.listPreferences(),prefs);store.close();
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('authenticated feedback strips extra fields and rejects malformed scores before Core dispatch',async()=>{
 let sent=null;
 const api=createSettingsHandler({async start(){},async command(c){sent=c;return{snapshot:{paused:true}};},async request(m){return m.type==='insights'?{insights:{feedback:{version:1}}}:{persona:null};}});
 const result=await api('fishfm/command',{type:'setTrackFeedback',value:1,playInstanceId:'current',track:{...track(1),cookie:'secret',handle:'private'}});
 assert.equal(result.ok,true);assert.deepEqual(sent.track,{provider:'netease',providerTrackId:'1',title:'',artist:'',durationMs:null});assert.equal(sent.playInstanceId,'current');
 for(const payload of [{type:'setTrackFeedback',value:2,playInstanceId:'current',track:track(1)},{type:'resetTaste',value:{clearFeedback:'yes'}}]) {
  sent=null;assert.equal((await api('fishfm/command',payload)).error.code,'invalid_command');assert.equal(sent,null);
 }
});
