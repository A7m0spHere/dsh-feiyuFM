import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {MusicStore} from '../src/storage.mjs';
import {setTrackFeedback,listTrackFeedback,clearTrackFeedback,feedbackRevision,trackFeedback,
  resetRecommendationTaste,undoRecommendationReset,feedbackView} from '../src/feedback.mjs';
import {createSettingsHandler} from '../src/ui/dsh-settings.mjs';
import {createCoreHost,ProviderRegistry,createProviderFacade} from '../src/core-host.mjs';
import {CoreBridge} from '../src/dsh-adapter.mjs';

const track=id=>({provider:'netease',providerTrackId:String(id),title:`歌曲 ${id}`,artist:`Artist ${id}`,durationMs:90000});
const add=(store,id,score=1,at=1000)=>{const t=track(id);store.upsertTrack(t,at);setTrackFeedback(store,t,score,at);return t;};
const clear=(store,t,commandId='clear',revision=feedbackRevision(store))=>clearTrackFeedback(store,{track:t,commandId,expectedRevision:revision},2000);

test('feedback management reads legacy votes without writes, searches literally and paginates in stable update order',()=>{
  const store=new MusicStore();try{
    for(let id=1;id<=26;id++)add(store,String(id).padStart(2,'0'),id%2?1:-1);
    store.upsertTrack({...track('special'),title:'100%_中文'},2000);setTrackFeedback(store,track('special'),1,2000);
    setTrackFeedback(store,track('01'),0,3000);store.removeSetting('feedback_revision_v1');
    const before=store.db.prepare('SELECT total_changes() n').get().n;
    const page=listTrackFeedback(store);
    assert.equal(page.revision,0);assert.equal(page.total,26);assert.equal(page.items.length,12);
    assert.deepEqual(page.items.slice(0,3).map(i=>i.key),['netease:special','netease:02','netease:03']);
    assert.equal(listTrackFeedback(store,{filter:'liked'}).matched,13);
    assert.equal(listTrackFeedback(store,{filter:'reduced',query:'ARTIST 02'}).matched,1);
    assert.equal(listTrackFeedback(store,{query:'%_'}).items[0].track.title,'100%_中文');
    assert.equal(listTrackFeedback(store,{query:'special'}).matched,1);
    assert.equal(listTrackFeedback(store,{offset:9999}).offset,24);
    assert.equal(listTrackFeedback(store,{query:'absent',offset:9999}).offset,0);
    assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
  }finally{store.close();}
});

test('neutral clears, command deduplication and independent revisions survive file reopen',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fm-fbm-')),path=join(dir,'db.sqlite');let store=new MusicStore(path);
  try{
    const t=add(store,'one');const revision=feedbackRevision(store);
    clear(store,t,'same',revision);const after=feedbackRevision(store);
    assert.equal(after,revision+1);assert.equal(listTrackFeedback(store).total,0);
    assert.equal(store.db.prepare('SELECT score FROM user_track_feedback').get().score,0);
    store.close();store=new MusicStore(path);clear(store,t,'same',revision);
    assert.equal(feedbackRevision(store),after);assert.equal(trackFeedback(store,t),0);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,11);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('a historical clear rejects other-window changes, including same-clock writes and reset generations',()=>{
  const store=new MusicStore();try{
    const t=add(store,'one');const old=feedbackRevision(store);
    setTrackFeedback(store,t,-1,1000);
    assert.throws(()=>clear(store,t,'stale',old),{code:'feedback_conflict'});
    assert.equal(trackFeedback(store,t),-1);
    const beforeReset=feedbackRevision(store);resetRecommendationTaste(store,{},{});
    assert.throws(()=>clear(store,t,'reset-stale',beforeReset),{code:'feedback_conflict'});
    const beforeUndo=feedbackRevision(store);undoRecommendationReset(store);
    assert.ok(feedbackRevision(store)>beforeUndo);
  }finally{store.close();}
});

test('clearing after a reset leaves a tombstone so restoring that reset cannot resurrect an old vote',()=>{
  const store=new MusicStore();try{
    const a=add(store,'one'),b=add(store,'two',-1);
    resetRecommendationTaste(store,{}, {clearFeedback:true});
    clear(store,a);undoRecommendationReset(store);
    assert.equal(trackFeedback(store,a),0);assert.equal(trackFeedback(store,b),-1);
    assert.equal(listTrackFeedback(store).items[0].key,'netease:two');
  }finally{store.close();}
});

test('invalid queries and clear requests cannot write feedback or advance its version',()=>{
  const store=new MusicStore();try{
    const t=add(store,'one'),before=feedbackRevision(store);
    for(const query of [{query:'x'.repeat(201)},{filter:'zero'},{offset:-1},{limit:0},{limit:101},{offset:Infinity}]){
      assert.throws(()=>listTrackFeedback(store,query),{code:'invalid_command'});
    }
    for(const input of [{track:t,commandId:'',expectedRevision:before},{track:t,commandId:'x',expectedRevision:-1}]){
      assert.throws(()=>clearTrackFeedback(store,input),{code:'invalid_command'});
    }
    assert.throws(()=>clear(store,track('not-recorded')),{code:'invalid_track'});
    assert.equal(feedbackRevision(store),before);assert.equal(trackFeedback(store,t),1);
  }finally{store.close();}
});

test('a command persistence failure rolls the neutral vote and feedback revision back together',()=>{
  const store=new MusicStore();try{
    const t=add(store,'one'),revision=feedbackRevision(store);
    store.recordCommand=()=>{throw new Error('synthetic storage failure');};
    assert.throws(()=>clear(store,t),/synthetic storage failure/);
    assert.equal(trackFeedback(store,t),1);assert.equal(feedbackRevision(store),revision);
  }finally{store.close();}
});

test('authenticated feedback routes validate before start and forward only safe identities and query fields',async()=>{
  let starts=0,sent;
  const api=createSettingsHandler({async start(){starts++;},async request(message){sent=message;return{feedbackPage:{version:1},snapshot:{private:'drop'},feedback:{revision:1}};}});
  assert.equal((await api('fishfm/feedback-list',{filter:'bad'})).error.code,'invalid_command');
  assert.equal((await api('fishfm/feedback-clear',{track:track('one'),expectedRevision:0})).error.code,'invalid_command');
  assert.equal(starts,0);
  const result=await api('fishfm/feedback-clear',{track:{...track('one'),cookie:'private'},commandId:'clear',expectedRevision:0,
    view:{query:' Artist ',filter:'liked',offset:0,limit:12,secret:'private'},snapshot:{paused:false}});
  assert.deepEqual(sent,{type:'feedback-clear',track:{provider:'netease',providerTrackId:'one'},commandId:'clear',expectedRevision:0,
    view:{query:'Artist',filter:'liked',offset:0,limit:12}});
  assert.equal(result.ok,true);assert.equal('snapshot' in result.value,false);
});

test('host feedback queries and clears bypass a slow platform import and preserve playback and model ledgers',async()=>{
  const store=new MusicStore(),t=add(store,'one');let release,entered;
  const start=new Promise(resolve=>{entered=resolve;});
  const registry=new ProviderRegistry({providers:{netease:{getAccount:()=>({status:'authorized'}),getCapabilities:()=>({}),
    getSeedTracks:()=>{entered();return new Promise(resolve=>{release=resolve;});}}}});
  const messages=[],host=createCoreHost({store,providerRegistry:registry,platformsFacade:createProviderFacade({store,registry}),
    playbackMode:'fake',output:{write:line=>messages.push(JSON.parse(line))}});
  try{
    await host.start();const pending=host.handle({id:'slow',type:'import-platform',provider:'netease'});await start;
    const before=host.snapshot(),prefs=store.listPreferences();
    await host.handle({id:'list',type:'feedback-list'});
    await host.handle({id:'clear',type:'feedback-clear',track:t,commandId:'host-clear',expectedRevision:feedbackRevision(store)});
    assert.equal(messages.find(m=>m.id==='list').feedbackPage.total,1);
    const result=messages.find(m=>m.id==='clear');assert.equal(result.feedbackPage.total,0);assert.equal('snapshot' in result,false);
    assert.deepEqual(host.snapshot(),before);assert.deepEqual(store.listPreferences(),prefs);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM music_model_calls').get().n,0);
    release({source:'recent',tracks:[],requested:0});await pending;
  }finally{release?.({source:'recent',tracks:[],requested:0});await host.close();store.close();}
});

test('real CoreBridge RPC keeps cleared votes, revision and pause after process restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fm-fbrpc-')),path=join(dir,'db.sqlite');
  const store=new MusicStore(path),t=add(store,'one');store.close();
  const make=()=>new CoreBridge({spawnCore:()=>spawn(process.execPath,[resolve('bin/fishfm-core.mjs'),'--db',path,'--playback','fake','--provider','fake'],
    {stdio:['pipe','pipe','pipe'],windowsHide:true})});
  let bridge=make();try{
    let api=createSettingsHandler(bridge);const page=(await api('fishfm/feedback-list')).value.feedbackPage;
    const before=(await bridge.request({type:'snapshot'})).snapshot;
    const result=await api('fishfm/feedback-clear',{track:t,commandId:'persist',expectedRevision:page.revision});
    assert.equal(result.ok,true);assert.equal(result.value.feedbackPage.total,0);
    assert.equal((await bridge.request({type:'snapshot'})).snapshot.commandVersion,before.commandVersion);
    await bridge.stop();bridge=make();api=createSettingsHandler(bridge);
    const restored=(await api('fishfm/state')).value;
    assert.equal(restored.snapshot.paused,true);assert.equal(restored.insights.feedback.current,0);
    assert.equal(restored.insights.feedback.managementVersion,1);assert.equal(restored.insights.feedback.revision,page.revision+1);
    assert.equal((await api('fishfm/feedback-clear',{track:t,commandId:'persist',expectedRevision:page.revision})).ok,true);
  }finally{await bridge.stop();rmSync(dir,{recursive:true,force:true});}
});
