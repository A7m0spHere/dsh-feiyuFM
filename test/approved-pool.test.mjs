import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MusicStore} from '../src/storage.mjs';
import {APPROVED_POOL_KEY,mergeApprovedFilter,approvedPlaybackTracks} from '../src/approved-pool.mjs';
import {createDiscoveryCache} from '../src/discovery.mjs';
const owner='owner-a',at=100000;
function filter(ids,callId='call-a',generatedAt=at,candidateOwner=owner){
 return{source:'llm-discovery-filter',candidateOwner,callId,generatedAt,
  picks:ids.map((id,i)=>({trackKey:`netease:${id}`,rank:i+1,reason:`Reason ${callId}`})),
  tracks:ids.map(id=>({provider:'netease',providerTrackId:String(id),title:`Song ${id}`,discovery:{source:'netease_similar',seedTrackKey:'netease:seed',expiresAt:generatedAt+21600000}}))};
}
const save=(store,value)=>{mergeApprovedFilter(store,value,value.generatedAt);store.setSetting('discovery_filter_v1',value);};

test('approved batches accumulate without replacing the current-batch projection or origin',()=>{
 const store=new MusicStore();
 try{
  save(store,filter([1,2]));save(store,filter([3,4],'call-b',at+100));
  const tracks=approvedPlaybackTracks(store,owner,at+200);
  assert.equal(tracks.length,4);
  assert.equal(tracks.find(t=>t.providerTrackId==='1').discovery.modelCallId,'call-a');
  assert.equal(tracks.find(t=>t.providerTrackId==='3').discovery.llmReason,'Reason call-b');
  assert.equal(store.getSetting('discovery_filter_v1').picks.length,2);
  assert.equal(approvedPlaybackTracks(store,'other-account',at+200).length,0);
 }finally{store.close();}
});
test('the newest approval replaces duplicate IDs without extending unrelated expiry',()=>{
 const store=new MusicStore();
 try{
  save(store,filter([1,2]));save(store,filter([1],'call-b',at+1000));
  const tracks=approvedPlaybackTracks(store,owner,at+2000);
  assert.equal(tracks.length,2);
  assert.equal(tracks.find(t=>t.providerTrackId==='1').discovery.modelCallId,'call-b');
  assert.equal(tracks.find(t=>t.providerTrackId==='2').discovery.expiresAt,at+21600000);
  assert.deepEqual(approvedPlaybackTracks(store,owner,at+21600500).map(t=>t.providerTrackId),['1']);
 }finally{store.close();}
});
test('only 100 valid approvals are retained and oldest approvals are evicted',()=>{
 const store=new MusicStore();
 try{
  for(let batch=0;batch<10;batch++)save(store,filter(Array.from({length:12},(_,i)=>batch*12+i),`batch-${batch}`,at+batch));
  const records=store.getSetting(APPROVED_POOL_KEY).entries;
  assert.equal(records.length,100);
  assert.ok(records.every(r=>r.approvedAt>=at+1));
  assert.ok(approvedPlaybackTracks(store,owner,at+100).some(t=>t.providerTrackId==='119'));
 }finally{store.close();}
});
test('old databases bootstrap only their current valid selected tracks, never raw candidates',()=>{
 const store=new MusicStore();
 try{
  const current=filter([1,2]);current.tracks.push({...current.tracks[0],providerTrackId:'unselected'});
  store.setSetting('discovery_filter_v1',current);
  const tracks=approvedPlaybackTracks(store,owner,at);
  assert.deepEqual(tracks.map(t=>t.providerTrackId),['1','2']);
  assert.equal(store.getSetting(APPROVED_POOL_KEY,null),null);
  save(store,filter([3],'call-b',at+1));
  assert.equal(approvedPlaybackTracks(store,owner,at+2).length,3);
 }finally{store.close();}
});
test('bans and temporary media failures stay hard filters even for retained approvals',()=>{
 const store=new MusicStore();
 try{
  save(store,filter([1,2,3]));
  store.addConstraint({id:'ban',kind:'ban_track',track:{provider:'netease',providerTrackId:'1'},createdAt:at});
  store.markUnavailable({provider:'netease',providerTrackId:'2'},'media_failed',at+500);
  assert.deepEqual(approvedPlaybackTracks(store,owner,at+1).map(t=>t.providerTrackId),['3']);
  assert.equal(approvedPlaybackTracks(store,owner,at+1000).length,2);
 }finally{store.close();}
});
test('account changes and explicit cache clearing discard approvals as well as the current filter',()=>{
 const store=new MusicStore();let account='a';
 const registry={providers:{netease:{getAccount:()=>({status:'authorized',accountId:account})}}};
 const hash=createHash('sha256').update('netease:authorized:a').digest('hex');
 const cache=createDiscoveryCache({store,registry,now:()=>at});
 try{
  cache.setEnabled(true);save(store,filter([1],'call',at,hash));
  assert.equal(cache.playbackRecommendations().length,1);
  account='b';assert.equal(cache.playbackRecommendations().length,0);
  assert.equal(store.getSetting(APPROVED_POOL_KEY,null),null);
  const hashB=createHash('sha256').update('netease:authorized:b').digest('hex');
  save(store,filter([2],'call-b',at,hashB));cache.clear();
  assert.equal(store.getSetting(APPROVED_POOL_KEY,null),null);
  assert.equal(store.getSetting('discovery_filter_v1',null),null);
 }finally{cache.close();store.close();}
});

test('an expired delayed approval cannot enter or extend the playback pool',()=>{
 const store=new MusicStore();
 try{
  const old=filter([1]);mergeApprovedFilter(store,old,at+21600001);
  assert.deepEqual(approvedPlaybackTracks(store,owner,at+21600001),[]);
 }finally{store.close();}
});
