import {normalizeTrack,trackId} from './contracts.mjs';

export const APPROVED_POOL_KEY='filtered_playback_pool_v1';
export const APPROVED_POOL_LIMIT=100;
const sources=new Set(['netease_daily','netease_similar','netease_personal_fm','platform_recommendation']);
function sanitize(record,now){
 try{
  const track=normalizeTrack(record.track),origin=record.track.discovery;
  if(track.provider!=='netease'||!sources.has(origin?.source)||!Number.isSafeInteger(origin?.llmRank)||origin.llmRank<1
   ||typeof origin.modelCallId!=='string'||!Number.isFinite(origin.expiresAt)||origin.expiresAt<=now||!Number.isFinite(record.approvedAt))return null;
  return{approvedAt:record.approvedAt,track:{...track,discovery:{...origin}}};
 }catch{return null;}
}
function fromFilter(filter,owner,now){
 if(filter?.source!=='llm-discovery-filter'||filter.candidateOwner!==owner||!Array.isArray(filter.tracks)||!Array.isArray(filter.picks))return[];
 const picks=new Map(filter.picks.filter(p=>p&&typeof p.trackKey==='string').map(p=>[p.trackKey,p]));
 return filter.tracks.map(track=>{try{
  const pick=picks.get(trackId(track));
  return pick?sanitize({approvedAt:filter.generatedAt,track:{...track,discovery:{...track.discovery,llmRank:pick.rank,llmReason:pick.reason,modelCallId:filter.callId}}},now):null;
 }catch{return null;}
 }).filter(Boolean);
}
function records(store,owner,now){
 const saved=store?.getSetting(APPROVED_POOL_KEY,null);
 if(saved?.version===1&&saved.owner===owner&&Array.isArray(saved.entries))return saved.entries.map(e=>sanitize(e,now)).filter(Boolean);
 // Only the current verifiable approved batch can bootstrap an old database.
 return store?fromFilter(store.getSetting('discovery_filter_v1',null),owner,now):[];
}
export function approvedPlaybackTracks(store,owner,now){
 const banned=new Set(store?.activeConstraints(now).filter(r=>r.kind==='ban_track').map(r=>r.track_key)??[]);
 return records(store,owner,now).slice(-APPROVED_POOL_LIMIT).map(r=>r.track)
  .filter(track=>!banned.has(trackId(track))&&store.isTrackAvailable(track,now));
}
/** Called only inside the successful, current-owner filter completion transaction. */
export function mergeApprovedFilter(store,filter,now){
 const owner=filter.candidateOwner;
 if(typeof owner!=='string'||!owner)return;
 const merged=new Map(records(store,owner,now).map(r=>[trackId(r.track),r]));
 for(const record of fromFilter(filter,owner,now))merged.set(trackId(record.track),record);
 const entries=[...merged.values()].sort((a,b)=>a.approvedAt-b.approvedAt||trackId(a.track).localeCompare(trackId(b.track))).slice(-APPROVED_POOL_LIMIT);
 store.setSetting(APPROVED_POOL_KEY,{version:1,owner,entries});
}
