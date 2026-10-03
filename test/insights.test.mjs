import test from 'node:test';import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';import {MusicCore} from '../src/core.mjs';import {FakePlayback,FakeProvider,FakeClock} from '../src/fakes.mjs';
import {buildSelector} from '../src/core-host.mjs';import {importSeedTracks} from '../src/environment.mjs';
import {describeMusicInsights,explainSelection} from '../src/insights.mjs';import {applyListenGrowth} from '../src/growth.mjs';
const track={provider:'netease',providerTrackId:'1',title:'Related',durationMs:60000,discovery:{source:'netease_similar',seedTrackKey:'netease:2'}};
test('explanations identify manual, account and real relationship origins without a fabricated model summary',()=>{
 assert.equal(explainSelection({current:{selectedBy:'user'}}).kind,'user');
 assert.equal(explainSelection({current:{selectedBy:'agent',origin:{source:'netease_similar'}}}).kind,'related');
 assert.equal(explainSelection({current:{selectedBy:'agent',origin:{source:'netease_daily'}}}).kind,'account');
});
test('decision-scoped stats separate target attempts, actual starts and valid unfamiliar history across resume',async()=>{
 const store=new MusicStore(),playback=new FakePlayback(),provider=new FakeProvider(),clock=new FakeClock(1000);
 const selector=buildSelector({store,now:()=>clock.now(),listDiscovery:()=>[track]});
 const core=new MusicCore({store,provider,playback,selector,clock,onListened:entry=>applyListenGrowth({store,entry,durationMs:entry.durationMs,now:clock.now()})});
 playback.onEvent(e=>core.onPlaybackEvent(e));
 try{
  core.dispatch({type:'setDiscoveryRate',value:1,commandId:'rate'});core.dispatch({type:'chooseSelf',commandId:'start'});await core.waitForIdle();
  const instance=core.snapshot().current.playInstanceId;core.dispatch({type:'pause',commandId:'pause'});await core.waitForIdle();core.dispatch({type:'resume',commandId:'resume'});await core.waitForIdle();
  let stats=describeMusicInsights(store,core.snapshot()).statistics;assert.equal(stats.observedStarts,1);assert.equal(stats.explorationAttempts,1);
  playback.emit({type:'progress',playInstanceId:instance,positionMs:50000});core.dispatch({type:'pause',commandId:'hold'});
  core._finishCurrent('ended');stats=describeMusicInsights(store,{...core.snapshot(),current:null}).statistics;
  assert.equal(stats.validUnfamiliarListens,1);assert.equal(stats.observedStarts,1);assert.equal(store.countEnvironment(),0);
 }finally{await core.waitForIdle();store.close();}
});
