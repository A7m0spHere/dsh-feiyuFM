// Deterministic explanations and measured local history. No model invocation.
import {qualifiesAsListen} from './growth.mjs';
export function explainSelection(snapshot) {
 const current=snapshot?.current,choice=snapshot?.lastSelection;
 if(!current)return{kind:'idle',text:choice?.reason==='every candidate was filtered out'?'候选暂时都被约束或冷却过滤，等待可用歌曲。':'电台待命，尚未选择歌曲。'};
 if(current.selectedBy==='user')return{kind:'user',text:'这首由你点播，按手动播放处理。'};
 if(choice?.fellBack)return{kind:'fallback',text:'陌生候选暂不可用，这次回到熟悉歌曲。'};
 if(current.origin?.source==='netease_similar')return{kind:'related',text:'这首与已有种子存在平台相似关系，本地偏好和重复限制共同选中了它。'};
 if(current.origin?.source==='netease_daily')return{kind:'account',text:'这次探索网易云每日推荐中的陌生歌，再由本地偏好排序。'};
 if(current.origin?.source==='netease_personal_fm')return{kind:'account',text:'这次使用网易云私人 FM 候选，再由本地规则选择。'};
 if(choice?.detail?.affinitySource==='listen'||choice?.detail?.affinitySource==='listen_silent')return{kind:'earned',text:'它有自主收听形成的偏好记录，这次也通过了重复过滤。'};
 return{kind:'familiar',text:'这次从熟悉歌曲中按已有偏好和有界随机项选择。'};
}
export function describeMusicInsights(store,snapshot,now=Date.now()) {
 const log=store.getSetting('decision_history_v1',[]);
 const names=new Map(),titles=new Map();
 for(const row of store.db.prepare('SELECT track_key,title,provider,artists_json FROM tracks').all()){
  titles.set(row.track_key,row.title||row.track_key);
  let artists=[];try{artists=JSON.parse(row.artists_json);}catch{}
  artists.forEach(a=>names.set(`${row.provider}:${a.id}`,a.name));
 }
 const all=store.listPreferences({limit:100000}),identified=all.filter(p=>p.target_type==='artist_id');
 const artistRows=identified.length?identified:all.filter(p=>p.target_type==='artist');
 const artists=artistRows.sort((a,b)=>b.affinity-a.affinity||(a.target_key<b.target_key?-1:1)).slice(0,10)
  .map(p=>({key:p.target_key,name:p.target_type==='artist_id'?(names.get(p.target_key)||'未命名艺人'):p.target_key,
   affinity:p.affinity,source:p.source,updatedAt:p.updated_at}));
 const tracks=all.filter(p=>p.target_type==='track').sort((a,b)=>b.affinity-a.affinity||(a.target_key<b.target_key?-1:1)).slice(0,5)
  .map(p=>({key:p.target_key,title:titles.get(p.target_key)||p.target_key,affinity:p.affinity,source:p.source,updatedAt:p.updated_at}));
 const ids=new Set(log.map(d=>d.playInstanceId).filter(Boolean));
 const recorded=store.db.prepare('SELECT play_instance_id,entry_json,result_json,processed_at FROM growth_jobs ORDER BY rowid DESC LIMIT 2000').all()
  .filter(row=>ids.has(row.play_instance_id)).map(row=>({entry:JSON.parse(row.entry_json),growth:row.result_json?JSON.parse(row.result_json):null,processedAt:row.processed_at}));
 const valid=recorded.filter(r=>qualifiesAsListen({entry:r.entry,durationMs:r.entry.durationMs}).qualifies);
 const startedIds=new Set(recorded.filter(r=>Number.isFinite(r.entry.startedAt)).map(r=>r.entry.playInstanceId));
 if(Number.isFinite(snapshot?.current?.startedAt)&&ids.has(snapshot.current.playInstanceId))startedIds.add(snapshot.current.playInstanceId);
 const started=startedIds.size;
 const current=snapshot?.current,seed=current?.origin?.seedTrackKey;
 const reply=current?{decisionId:current.decisionId,kind:current.selectedBy==='user'?'user':'agent',
  text:current.selectedBy==='user'?'这是你点的，我按你的选择播放。':current.origin?.source==='netease_similar'
   ?`这次想试一首相近的新歌。网易云把它与《${titles.get(seed)||'已有歌曲'}》关联，我再按本地偏好与重复限制选中了它。`
   :explainSelection(snapshot).text}:null;
 return {version:1,generatedAt:now,explanation:explainSelection(snapshot),
  reply,
  profile:{kind:'agent_preferences',artists,tracks,coverage:{genres:0,moods:0},modelSummary:false},
  decisions:log.slice(-10).reverse().map(d=>({...d,trackTitle:titles.get(d.trackKey)||d.trackKey||'未选中歌曲'})),
  recentChanges:recorded.filter(r=>r.growth?.updated&&Number.isFinite(r.growth.before)&&Number.isFinite(r.growth.after)).slice(0,5)
   .map(r=>({playInstanceId:r.entry.playInstanceId,title:r.entry.track.title||r.entry.track.providerTrackId,
    before:r.growth.before,after:r.growth.after,at:r.processedAt,audible:r.growth.audible===true})),
  statistics:{windowStart:log[0]?.at??null,retainedDecisions:log.length,autonomousDecisions:log.length,
   explorationAttempts:log.filter(d=>d.attemptedDiscovery).length,unfamiliarSelections:log.filter(d=>d.pool==='discovery'&&d.trackKey).length,
   observedStarts:started,validAgentListens:valid.length,validUnfamiliarListens:valid.filter(r=>r.entry.selectionPool==='discovery').length,
   repeatedSelections:log.filter(d=>(d.detail?.repeatPlays??0)>0).length,
   historyCoverage:'tracked_decision_instances',completeLifetime:false},
  limitations:['no_genre_or_mood_features','local_rules_not_llm_summary']};
}
