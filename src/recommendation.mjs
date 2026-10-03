// Bounded, local seed choice. Platform relationships remain evidence, not genre guesses.
import {trackId} from './contracts.mjs';
import {environmentWeight} from './environment.mjs';
export function artistKeys(track) {
  return track.artists?.length ? track.artists.map(a=>`${track.provider}:${a.id}`)
    : track.artist ? [`${track.provider}:name:${track.artist}`] : [];
}
export function selectRecommendationSeeds({store,provider='netease',limit=3,now=Date.now()}={}) {
  if(!store)return[];
  const banned=new Set(store.activeConstraints(now).filter(r=>r.kind==='ban_track').map(r=>r.track_key));
  const rows=[...new Map([...store.listEnvironment({provider,limit:100000}),...store.listAgentKnownTracks().filter(t=>t.provider===provider)].map(r=>[r.track_key,r])).values()];
  const ranked=rows.map(row=>{
    const track=store.getNormalizedTrack({provider,providerTrackId:row.track_key.slice(provider.length+1)});
    const preference=store.getPreference('track',row.track_key)?.affinity??0.5;
    return{track,key:row.track_key,score:preference*0.8+Math.min(1,environmentWeight(store.listEnvironmentSources(track),now)/1.65)*0.2};
  }).filter(r=>!banned.has(r.key)&&store.isTrackAvailable(r.track,now)).sort((a,b)=>b.score-a.score||(a.key<b.key?-1:1));
  const chosen=[],used=new Set();
  for(const item of ranked) {
    const keys=artistKeys(item.track);if(keys.some(k=>used.has(k)))continue;
    chosen.push(item.track);keys.forEach(k=>used.add(k));if(chosen.length>=Math.min(3,limit))return chosen;
  }
  for(const item of ranked) {
    if(chosen.some(t=>trackId(t)===item.key))continue;
    if(chosen.filter(t=>artistKeys(t).some(k=>artistKeys(item.track).includes(k))).length>=2)continue;
    chosen.push(item.track);if(chosen.length>=Math.min(3,limit))break;
  }
  return chosen;
}
