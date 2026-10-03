import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';
import {importSeedTracks,describeEnvironmentProfile,environmentWeight} from '../src/environment.mjs';
import {initializeAgentPreferences,getArtistAffinity} from '../src/taste.mjs';
import {applyListenGrowth} from '../src/growth.mjs';
const t=(id,artistId,name)=>({provider:'netease',providerTrackId:String(id),title:`T${id}`,artist:name,artists:[{id:String(artistId),name}],metadataSource:'netease_track',durationMs:100_000});
test('a complete repeated source import is not misreported as a short platform response',()=>{
 const store=new MusicStore();try{
  const tracks=[t(1,10,'A'),t(2,10,'A')];importSeedTracks({store,provider:'netease',source:'liked',tracks,requested:2});
  const repeated=importSeedTracks({store,provider:'netease',source:'liked',tracks,requested:2});
  assert.equal(repeated.imported,0);assert.equal(repeated.duplicates,2);assert.equal(repeated.received,2);assert.equal(repeated.degraded,false);assert.equal(repeated.reason,null);
 }finally{store.close();}
});
test('repeated imports preserve multiple source facts without relabelling first source or overwriting earned taste',()=>{
 const s=new MusicStore();try{
 const track=t(1,10,'Artist');importSeedTracks({store:s,provider:'netease',source:'recent',tracks:[{...track,playCount:12}],requested:1,now:1000});
 initializeAgentPreferences({store:s,seed:5,now:1000});s.setPreference({targetType:'track',targetKey:'netease:1',affinity:0.9,source:'listen',updatedAt:1100});
 importSeedTracks({store:s,provider:'netease',source:'playlist',sourceRef:'55',tracks:[track],requested:1,now:1200});initializeAgentPreferences({store:s,seed:5,now:1200});
 assert.equal(s.getPreference('track','netease:1').affinity,0.9);assert.equal(s.getEnvironmentEntry(track).source,'recent');
 assert.equal(s.listEnvironmentSources(track).length,2);assert.equal(s.listEnvironmentSources(track).find(f=>f.source==='playlist').source_ref,'55');
 assert.equal(s.getNormalizedTrack(track).artists[0].id,'10');
 const p=describeEnvironmentProfile(s,1300);assert.equal(p.coverage.artistIds,1);assert.equal(p.coverage.genres,0);assert.equal(p.sources.playlist,1);assert.equal(p.coverage.dates,0);
 }finally{s.close();}
});
test('different input distributions form different bounded profiles; duplicate playlist facts do not multiply weight',()=>{
 const a=new MusicStore(),b=new MusicStore();try{
 importSeedTracks({store:a,provider:'netease',source:'recent',tracks:[t(1,10,'A'),t(2,10,'A')],requested:2});
 importSeedTracks({store:b,provider:'netease',source:'recent',tracks:[t(1,20,'B'),t(2,20,'B')],requested:2});
 assert.notEqual(describeEnvironmentProfile(a).artists[0].key,describeEnvironmentProfile(b).artists[0].key);
 const fact={source:'liked',play_count:999999,last_played_at:null};assert.ok(environmentWeight([fact])<=1.65);assert.equal(environmentWeight([fact,fact]),environmentWeight([fact]));
 }finally{a.close();b.close();}
});
test('homonymous artists keep independent ids and growth while legacy name preferences remain untouched',()=>{
 const s=new MusicStore();try{
 const one=t(1,10,'Same'),two=t(2,20,'Same');importSeedTracks({store:s,provider:'netease',source:'recent',tracks:[one,two],requested:2});
 s.setPreference({targetType:'artist',targetKey:'Same',affinity:0.95,source:'listen',updatedAt:1});initializeAgentPreferences({store:s,seed:5});
 assert.ok(getArtistAffinity(s,one)<0.95);const before=getArtistAffinity(s,two);
 applyListenGrowth({store:s,entry:{playInstanceId:'id-growth',track:one,selectedBy:'agent',effectiveMs:50_000,agentListening:true,audible:true,endReason:'ended'},durationMs:100_000});
 assert.equal(getArtistAffinity(s,two),before);assert.equal(s.getPreference('artist','Same').affinity,0.95);
 }finally{s.close();}
});
