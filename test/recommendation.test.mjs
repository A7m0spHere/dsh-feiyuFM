import test from 'node:test';import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';import {importSeedTracks} from '../src/environment.mjs';
import {initializeAgentPreferences} from '../src/taste.mjs';import {selectRecommendationSeeds} from '../src/recommendation.mjs';
import {scoreCandidate,createSelector,recentPlays,SELECTION_PARAMETERS} from '../src/selection.mjs';
const t=(id,a)=>({provider:'netease',providerTrackId:String(id),artist:`A${a}`,artists:[{id:String(a),name:`A${a}`}],durationMs:100000});
test('seed choice is bounded, diverse and sensitive to earned preferences while respecting bans',()=>{
 const s=new MusicStore();try{
 const tracks=[t(1,10),t(2,10),t(3,20),t(4,30)];importSeedTracks({store:s,provider:'netease',source:'recent',tracks,requested:4});initializeAgentPreferences({store:s,seed:1});
 s.setPreference({targetType:'track',targetKey:'netease:2',affinity:0.95,source:'listen',updatedAt:1});
 const seeds=selectRecommendationSeeds({store:s,now:1000});assert.equal(seeds[0].providerTrackId,'2');assert.equal(new Set(seeds.map(t=>t.artists[0].id)).size,3);
 s.addConstraint({id:'ban',kind:'ban_track',track:t(2,10),createdAt:1});assert.equal(selectRecommendationSeeds({store:s,now:1000}).some(t=>t.providerTrackId==='2'),false);
 }finally{s.close();}
});
test('an unfamiliar relationship is ranked from actual seed taste, not a fabricated track affinity',()=>{
 const s=new MusicStore();try{
 s.setPreference({targetType:'track',targetKey:'netease:1',affinity:0.9,source:'listen',updatedAt:1});
 s.setPreference({targetType:'track',targetKey:'netease:2',affinity:0.2,source:'listen',updatedAt:1});
 const candidate=key=>({...t(9,90),discovery:{source:'netease_similar',seedTrackKey:key}});
 const high=scoreCandidate({track:candidate('netease:1'),store:s,now:1000,plays:new Map(),randomValue:0});
 const low=scoreCandidate({track:candidate('netease:2'),store:s,now:1000,plays:new Map(),randomValue:0});
 assert.ok(high.score>low.score);assert.equal(high.affinity,0.5);assert.equal(s.getPreference('track','netease:9'),null);
 }finally{s.close();}
});
test('recent artist concentration reduces repeated-artist rank even when the track itself is unfamiliar',()=>{
 const s=new MusicStore();try{
 s.upsertTrack(t(1,10),0);s.recordHistory({playInstanceId:'recent',track:t(1,10),selectedBy:'agent',progressSource:'audio',effectiveMs:50000,agentListening:true,audible:true,endReason:'ended',endedAt:1000});
 const selector=createSelector({store:s,rng:()=>0,listDiscovery:()=>[t(2,10),t(3,30)],now:()=>2000});
 const decision=selector.decide({discoveryRate:1});assert.equal(decision.track.providerTrackId,'3');assert.equal(decision.detail.algorithm,'local-v3');
 }finally{s.close();}
});
