import {createHash} from 'node:crypto';
import {trackId} from './contracts.mjs';

export const SUPPLY_POLICY=Object.freeze({lowWater:12,target:24,refreshMs:60_000,retryMs:60_000,reviewTtlMs:6*60*60_000,reviewCapacity:400});
export const REVIEW_KEY='discovery_reviews_v1';

// Refresh timestamps and batch IDs do not change a song's review. Explicit
// feedback, references, exploration preferences and model changes do.
export function reviewContext(store,snapshot=store?.getCoreState()){
 return createHash('sha256').update(JSON.stringify({
  feedback:store?.getSetting('feedback_revision_v1',0),reset:store?.getSetting('preference_reset_v1',null)?.id,
  references:store?.listEnvironment({limit:100000}).map(row=>row.track_key),route:store?.getSetting('recommendation_route_v1',null),
  discovery:snapshot?.settings?.discovery,rate:snapshot?.settings?.discoveryRate,
 })).digest('hex');
}
export function reviewedKeys(store,owner,now,context=reviewContext(store)){
 const saved=store?.getSetting(REVIEW_KEY,null);
 return new Set(saved?.owner===owner&&saved.context===context&&Array.isArray(saved.entries)
  ?saved.entries.filter(e=>typeof e.key==='string'&&e.expiresAt>now).map(e=>e.key):[]);
}
// Called inside the successful completion transaction, including an empty pick.
// Failed, cancelled, stale and rolled-back calls never mark candidates reviewed.
export function recordCandidateReviews(store,facts,now){
 if(!facts?.candidateOwner||!facts.reviewContext)return;
 const saved=store.getSetting(REVIEW_KEY,null);
 const entries=new Map(saved?.owner===facts.candidateOwner&&saved.context===facts.reviewContext&&Array.isArray(saved.entries)
  ?saved.entries.filter(e=>e.expiresAt>now).map(e=>[e.key,e]):[]);
 for(const track of facts.localCandidates??[]){
  const expiresAt=Math.min(track.discovery?.expiresAt??now+SUPPLY_POLICY.reviewTtlMs,now+SUPPLY_POLICY.reviewTtlMs);
  if(expiresAt>now)entries.set(trackId(track),{key:trackId(track),reviewedAt:now,expiresAt});
 }
 store.setSetting(REVIEW_KEY,{version:1,owner:facts.candidateOwner,context:facts.reviewContext,
  entries:[...entries.values()].sort((a,b)=>a.reviewedAt-b.reviewedAt).slice(-SUPPLY_POLICY.reviewCapacity)});
}
