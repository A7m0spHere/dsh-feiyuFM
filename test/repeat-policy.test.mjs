import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MusicStore} from '../src/storage.mjs';
import {MusicCore} from '../src/core.mjs';
import {createSelector} from '../src/selection.mjs';
import {FakePlayback,FakeProvider,FakeClock} from '../src/fakes.mjs';
import {recentPlayback,recordPlaybackStart,RECENT_PLAYBACK_KEY} from '../src/recent-playback.mjs';

const epoch=Date.parse('2026-10-21T10:00:00+08:00');
const track=id=>({provider:'netease',providerTrackId:String(id),title:`Repeat ${id}`,artist:`Artist ${id}`,durationMs:180000});
const remember=(store,id,index,at=epoch+index*180000)=>recordPlaybackStart(store,{track:track(id),playInstanceId:`played-${index}`},at);
function fixture(count=3,path=':memory:'){
 const store=new MusicStore(path),playback=new FakePlayback(),provider=new FakeProvider(),clock=new FakeClock(epoch);
 const tracks=Array.from({length:count},(_,i)=>track(i));
 const selector=createSelector({store,listFamiliar:()=>tracks,now:()=>clock.now()});
 const core=new MusicCore({store,playback,provider,selector,clock});
 playback.onEvent(e=>core.onPlaybackEvent(e));
 return{store,playback,provider,clock,core,tracks};
}

test('five intervening songs still exclude a favourite after 56.7 minutes or a new day',()=>{
 const store=new MusicStore();
 try{
  for(let i=0;i<6;i++)remember(store,i,i);
  store.setPreference({targetType:'track',targetKey:'netease:0',affinity:0.95,source:'seed',updatedAt:epoch});
  const favourite={...track(0),discovery:{llmRank:1}};
  const selector=createSelector({store,listFamiliar:()=>[favourite,...Array.from({length:6},(_,i)=>track(i+1))]});
  for(const at of[epoch+56.7*60000,epoch+3*86400000]){
   const decision=selector.decide({at,discoveryRate:0});
   assert.equal(decision.track.providerTrackId,'6');
   assert.equal(decision.detail.repeat.relaxed,false);
  }
 }finally{store.close();}
});

test('100 candidates over 200 actual starts never repeat inside the last 50 instances',async()=>{
 const f=fixture(100),sequence=[];
 try{
  f.core.dispatch({type:'chooseSelf',commandId:'start'});await f.core.waitForIdle();
  for(let i=0;i<200;i++){
   const current=f.core.snapshot().current;
   assert.ok(current);
   const key=current.track.providerTrackId;
   assert.equal(sequence.slice(-50).includes(key),false,`repeat at ${i}`);
   sequence.push(key);
   if(i===199)break;
   f.clock.advance(180000);
   f.playback.emit({type:'progress',playInstanceId:current.playInstanceId,positionMs:180000,effectiveDeltaMs:180000,progressSource:'audio'});
   f.playback.emit({type:'ended',playInstanceId:current.playInstanceId});
   await f.core.waitForIdle();
  }
  assert.equal(recentPlayback(f.store).length,50);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM music_model_calls').get().n,0);
 }finally{f.store.close();}
});

test('a small pool waits after every track starts once and new candidates resume without replay',async()=>{
 const f=fixture(3),sequence=[];
 f.store.setPreference({targetType:'track',targetKey:'netease:0',affinity:0.95,source:'seed',updatedAt:epoch});
 try{
  f.core.dispatch({type:'chooseSelf',commandId:'start'});await f.core.waitForIdle();
  for(let i=0;i<3;i++){
   const current=f.core.snapshot().current;
   sequence.push(current.track.providerTrackId);
   f.clock.advance(180000);
   f.playback.emit({type:'progress',playInstanceId:current.playInstanceId,positionMs:180000,effectiveDeltaMs:180000});
   f.playback.emit({type:'ended',playInstanceId:current.playInstanceId});await f.core.waitForIdle();
  }
  assert.equal(new Set(sequence).size,3);
  assert.equal(f.core.snapshot().current,null);
  assert.equal(f.core.snapshot().paused,false);
  assert.equal(f.core.snapshot().lastSelection.reason,'recent-window-exhausted');
  const decisions=f.store.getSetting('decision_history_v1').length;
  f.clock.advance(86400000);
  assert.equal(f.core.selectAutonomously(),false,'time alone cannot release the count window');
  assert.equal(f.store.getSetting('decision_history_v1').length,decisions+1,'one explicit retry makes one decision');
  assert.throws(()=>f.core.dispatch({type:'next',commandId:'no-replay'}),e=>e.code==='no_candidates'&&e.message.includes('50'));
  f.tracks.push(track(3));
  assert.equal(f.core.selectAutonomously(),true);
  await f.core.waitForIdle();
  assert.equal(f.core.snapshot().current.track.providerTrackId,'3');
  assert.equal(recentPlayback(f.store).length,4);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM music_model_calls').get().n,0);
 }finally{f.store.close();}
});

test('all 50 started tracks stay blocked until a new actual start moves the oldest out',async()=>{
 const f=fixture(50),sequence=[];
 try{
  f.core.dispatch({type:'chooseSelf',commandId:'start'});await f.core.waitForIdle();
  for(let i=0;i<50;i++){
   const current=f.core.snapshot().current;assert.ok(current);
   sequence.push(current.track.providerTrackId);
   // Starting and immediately skipping still consumes a place in the window.
   if(i<49){f.core.dispatch({type:'next',commandId:`skip-${i}`});await f.core.waitForIdle();}
   else{f.playback.emit({type:'ended',playInstanceId:current.playInstanceId});await f.core.waitForIdle();}
  }
  assert.equal(new Set(sequence).size,50);
  assert.equal(f.core.snapshot().current,null);
  assert.equal(f.core.snapshot().lastSelection.reason,'recent-window-exhausted');
  const selector=createSelector({store:f.store,listFamiliar:()=>f.tracks});
  assert.equal(selector.decide({allowRepeatFallback:true,discoveryRate:0,at:f.clock.now()}).track,null,'legacy options cannot relax the hard window');
  f.tracks.push(track(50));
  assert.equal(f.core.selectAutonomously(),true);await f.core.waitForIdle();
  assert.equal(f.core.snapshot().current.track.providerTrackId,'50');
  assert.equal(recentPlayback(f.store).some(e=>e.trackKey===`netease:${sequence[0]}`),false);
  const current=f.core.snapshot().current;
  f.playback.emit({type:'ended',playInstanceId:current.playInstanceId});await f.core.waitForIdle();
  assert.equal(f.core.snapshot().current.track.providerTrackId,sequence[0]);
 }finally{f.store.close();}
});

test('cooldown relaxation permits only a song outside the 50-start window',()=>{
 const store=new MusicStore();
 try{
  for(let i=0;i<51;i++)remember(store,i,i,epoch+i*1000);
  store.recordHistory({playInstanceId:'older',track:track(0),selectedBy:'agent',progressSource:'audio',effectiveMs:1000,agentListening:true,audible:false,endReason:'ended',endedAt:epoch});
  const selector=createSelector({store,listFamiliar:()=>[track(0),track(1),track(50)]});
  const decision=selector.decide({discoveryRate:0,at:epoch+60000});
  assert.equal(decision.track.providerTrackId,'0');
  assert.equal(decision.detail.repeat.reason,'cooldown-exhausted');
 }finally{store.close();}
});

test('a recent queued song cannot bypass a fresh recommendation or a user-next library fallback',async()=>{
 const f=fixture();
 try{
  remember(f.store,0,0);remember(f.store,1,1);
  f.core.selector=createSelector({store:f.store,listFamiliar:options=>options.libraryFallback?[track(3)]:[track(0),track(1)]});
  f.core.setQueue([track(0)]);
  f.core.dispatch({type:'next',commandId:'next'});await f.core.waitForIdle();
  assert.equal(f.core.snapshot().current.track.providerTrackId,'3');
  assert.equal(f.core.snapshot().paused,true);
  assert.equal(f.core.snapshot().queue.length,1,'deferred queue intent is preserved');
  assert.equal(recentPlayback(f.store).length,2,'selection while paused is not a start');
 }finally{f.store.close();}
});

test('explicit point play may repeat but ordinary next and immutable constraints still apply',async()=>{
 const f=fixture();
 try{
  remember(f.store,0,0);remember(f.store,1,1);
  f.core.dispatch({type:'requestTrack',track:track(0),commandId:'explicit'});await f.core.waitForIdle();
  assert.equal(f.core.snapshot().current.track.providerTrackId,'0');
  assert.equal(recentPlayback(f.store).length,3);
  f.store.addConstraint({id:'ban',kind:'ban_track',track:track(1),createdAt:epoch});
  f.store.markUnavailable(track(2),'media_unavailable',epoch+1000000);
  assert.throws(()=>f.core.dispatch({type:'next',commandId:'blocked-next'}),e=>e.code==='no_candidates');
  assert.equal(f.core.snapshot().current.track.providerTrackId,'0');
 }finally{f.store.close();}
});

test('pause, resume and a file-backed restart do not register the same instance twice',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fishfm-recent-')),path=join(dir,'music.sqlite');
 let f=fixture(3,path);
 try{
  f.core.dispatch({type:'requestTrack',track:track(0),commandId:'point'});await f.core.waitForIdle();
  const id=f.core.snapshot().current.playInstanceId;
  f.core.dispatch({type:'pause',commandId:'pause'});await f.core.waitForIdle();
  f.core.dispatch({type:'resume',commandId:'resume'});await f.core.waitForIdle();
  assert.equal(recentPlayback(f.store).length,1);
  f.store.close();f=fixture(3,path);
  assert.equal(f.core.snapshot().paused,true);
  f.core.dispatch({type:'resume',commandId:'restart-resume'});await f.core.waitForIdle();
  assert.equal(f.core.snapshot().current.playInstanceId,id);
  assert.equal(recentPlayback(f.store).length,1);
 }finally{f.store.close();rmSync(dir,{recursive:true,force:true});}
});

test('a selected load failure is not a playback start and a short successful skip is',async()=>{
 const f=fixture();
 try{
  f.playback.failNextLoad();
  f.core.dispatch({type:'requestTrack',track:track(0),commandId:'fail'});await f.core.waitForIdle();
  assert.equal(recentPlayback(f.store).length,0);
  f.core.dispatch({type:'requestTrack',track:track(1),commandId:'short'});await f.core.waitForIdle();
  f.core.dispatch({type:'pause',commandId:'paused'});await f.core.waitForIdle();
  f.core.dispatch({type:'next',commandId:'skip'});await f.core.waitForIdle();
  assert.equal(recentPlayback(f.store).length,1);
  assert.equal(recentPlayback(f.store)[0].trackKey,'netease:1');
 }finally{f.store.close();}
});

test('legacy bootstrap requires measured history and creates no additional listening records',()=>{
 const store=new MusicStore();
 try{
  for(const[id,ms]of[[0,0],[1,1000]])store.recordHistory({playInstanceId:`legacy-${id}`,track:track(id),selectedBy:'agent',progressSource:'audio',effectiveMs:ms,agentListening:true,audible:false,endReason:'skipped',endedAt:epoch+id});
  assert.deepEqual(recentPlayback(store).map(e=>e.trackKey),['netease:1']);
  assert.equal(store.getSetting(RECENT_PLAYBACK_KEY,null),null,'read-only compatibility projection');
  const core=new MusicCore({store,provider:new FakeProvider(),playback:new FakePlayback()});
  assert.deepEqual(recentPlayback(store).map(e=>e.trackKey),['netease:1']);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM listen_history').get().n,2);
  assert.equal(core.snapshot().paused,true);
 }finally{store.close();}
});

test('a missing start event is recovered from measured advance but not a seek-only position',async()=>{
 const f=fixture();
 try{
  f.playback.onEvent(()=>{});
  f.core.dispatch({type:'requestTrack',track:track(0),commandId:'point'});await f.core.waitForIdle();
  const id=f.core.snapshot().current.playInstanceId;
  f.core.onPlaybackEvent({type:'progress',playInstanceId:id,positionMs:2000,effectiveDeltaMs:0,progressSource:'audio'});
  assert.equal(recentPlayback(f.store).length,0);
  f.core.onPlaybackEvent({type:'progress',playInstanceId:id,positionMs:3000,effectiveDeltaMs:1000,progressSource:'audio'});
  assert.equal(recentPlayback(f.store).length,1);
  f.core.onPlaybackEvent({type:'started',playInstanceId:id});
  assert.equal(recentPlayback(f.store).length,1);
 }finally{f.store.close();}
});
