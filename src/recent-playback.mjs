import {trackId} from './contracts.mjs';

export const RECENT_PLAYBACK_KEY='recent_playback_v1';
export const RECENT_PLAYBACK_LIMIT=50;
const valid=e=>e&&typeof e.playInstanceId==='string'&&typeof e.trackKey==='string'&&Number.isFinite(e.startedAt);

/** Oldest first. Reading an old database does not write a synthetic history. */
export function recentPlayback(store){
 if(!store)return[];
 const saved=store.getSetting(RECENT_PLAYBACK_KEY,null);
 if(saved?.version===1&&Array.isArray(saved.entries))return saved.entries.filter(valid).slice(-RECENT_PLAYBACK_LIMIT);
 const rows=store.db.prepare(`SELECT h.play_instance_id,h.track_key,h.ended_at,h.effective_ms,g.entry_json
  FROM listen_history h LEFT JOIN growth_jobs g ON g.play_instance_id=h.play_instance_id
  WHERE h.effective_ms>0 ORDER BY h.ended_at DESC,h.rowid DESC LIMIT ?`).all(RECENT_PLAYBACK_LIMIT).reverse();
 const entries=rows.map(row=>{
  let entry;try{entry=JSON.parse(row.entry_json??'null');}catch{}
  return{playInstanceId:row.play_instance_id,trackKey:row.track_key,
   startedAt:Number.isFinite(entry?.startedAt)?entry.startedAt:row.ended_at-row.effective_ms};
 });
 const current=store.getCoreState()?.current;
 if(current&&(Number.isFinite(current.startedAt)||current.effectiveMs>0)&&!entries.some(e=>e.playInstanceId===current.playInstanceId))
  entries.push({playInstanceId:current.playInstanceId,trackKey:trackId(current.track),startedAt:current.startedAt??0});
 return entries.slice(-RECENT_PLAYBACK_LIMIT);
}

export function initializeRecentPlayback(store){
 const saved=store.getSetting(RECENT_PLAYBACK_KEY,null);
 if(saved?.version===1&&Array.isArray(saved.entries))return;
 store.setSetting(RECENT_PLAYBACK_KEY,{version:1,entries:recentPlayback(store)});
}

/** A resumed/recovered instance keeps its original place in the window. */
export function recordPlaybackStart(store,current,at){
 const entries=recentPlayback(store);
 if(entries.some(e=>e.playInstanceId===current.playInstanceId))return false;
 entries.push({playInstanceId:current.playInstanceId,trackKey:trackId(current.track),startedAt:at});
 store.setSetting(RECENT_PLAYBACK_KEY,{version:1,entries:entries.slice(-RECENT_PLAYBACK_LIMIT)});
 return true;
}

export function repeatContext(store){
 const entries=recentPlayback(store),positions=new Map();
 entries.forEach((entry,index)=>positions.set(entry.trackKey,{index,startedAt:entry.startedAt}));
 return{entries,positions,keys:new Set(positions.keys()),lastTrackKey:entries.at(-1)?.trackKey??null};
}

/** Normal, time-cooldown relaxation, then least-recently-played relaxation. */
export function repeatTier(key,{recent,plays,at,cooldownMs}){
 if(recent.keys.has(key))return 2;
 const last=plays.get(key)?.lastPlayedAt??-Infinity;
 return at-last>=cooldownMs?0:1;
}
