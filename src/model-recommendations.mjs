// Model-proposed songs are data. Only matching platform metadata becomes playable.
import {MusicError,trackId,normalizeTrack} from './contracts.mjs';
export const STRATEGY_KEY='model_recommendations_v1';
export const STRATEGY_PURPOSE='model-recommendations';
export const normalizeSongText=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>{throw new MusicError('invalid_recommendations','模型歌单格式无效，保留原歌单；用量仍会记账。');};
export function parseModelRecommendations(text,facts){
 let value;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1'));}catch{invalid();}
 if(!object(value)||Object.keys(value).some(k=>!['summary','songs'].includes(k))||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>240||!Array.isArray(value.songs)||!value.songs.length||value.songs.length>6)invalid();
 const seen=new Set(),songs=value.songs.map(pair=>{
  if(!Array.isArray(pair)||pair.length!==2||pair.some(s=>typeof s!=='string'||!s.trim()||s.length>80||/https?:\/\//i.test(s)))invalid();
  const [title,artist]=pair.map(s=>s.trim()),key=normalizeSongText(title)+'|'+normalizeSongText(artist);
  if(seen.has(key))invalid();seen.add(key);
  return{title,artist};
 });
 return{version:1,text:value.summary.trim(),songs,verified:[],attempts:[],verification:'pending',inputCoverage:facts?.inputCoverage??null};
}
export function modelRecommendations(store){
 const value=store?.getSetting(STRATEGY_KEY,null);
 return value?.version===1&&value.source==='llm-recommendations'&&value.callId&&Array.isArray(value.songs)&&value.songs.length<=6&&Array.isArray(value.verified)?value:null;
}
export function modelRecommendationTracks(store){
 const value=modelRecommendations(store);if(!value)return[];
 return value.verified.map(row=>({...normalizeTrack(row.track),discovery:{source:'llm_recommendation',modelCallId:value.callId,reason:value.text}}));
}
export function recommendationMode(store){return store?.getSetting('recommendation_mode_v1','platform')==='llm'?'llm':'platform';}
// 自动核对必须有界：无法核对的歌单（歌曲确实不存在/持续失败）不能按 60 秒预算
// 永久重搜平台。每个歌单在一个 Core 进程内最多自动尝试这么多次；手动
// 「重新核对歌单」不受此限。新歌单（新 callId）重新计数。
export const MAX_AUTO_VERIFICATION_ATTEMPTS=10;
const workTitle=value=>normalizeSongText(value).replace(/\([^)]*\)/g,'');
// Explicit catalogue aliases only; arbitrary "Official" suffixes are not proof of identity.
const artistAliases=new Map([['洛天依official','洛天依']]);
const artistName=value=>{const name=normalizeSongText(value);return artistAliases.get(name)??name;};
const splitArtists=value=>String(value??'').split(/\s*\/\s*/).filter(s=>s.trim());
function artistMatches(query,candidate){
 const a=artistName(query),b=artistName(candidate);
 if(a===b)return true;
 // Public catalogues sometimes prefix a Chinese stage name with its Latin alias.
 return /^[\p{Script=Han}·]{2,30}$/u.test(a)&&b.endsWith(a)&&/^[a-z0-9._()\-]+$/i.test(b.slice(0,-a.length));
}
function matchedArtists(song,track){
 if(!track.artists?.length&&artistMatches(song.artist,track.artist))return[{name:track.artist}];
 const artists=track.artists?.length?track.artists:splitArtists(track.artist).map(name=>({name}));
 // Try a literal artist first, so names containing '/' (e.g. AC/DC) stay intact.
 const literal=artists.filter(a=>artistMatches(song.artist,a.name));
 if(literal.length)return literal;
 const requested=[...new Set(splitArtists(song.artist).map(artistName))];
 if(!requested.length||!requested.every(name=>artists.some(a=>artistMatches(name,a.name))))return[];
 return artists.filter(a=>requested.some(name=>artistMatches(name,a.name)));
}
function matches(song,track){
 const exact=normalizeSongText(song.title)===normalizeSongText(track.title);
 return (exact||(!/\([^)]*\)/.test(normalizeSongText(song.title))&&workTitle(song.title)===workTitle(track.title)))&&
  matchedArtists(song,track).length>0;
}
function selectMatchedVersion(song,found){
 if(found.length===1)return found[0];
 const identities=found.map(t=>{
  const artists=matchedArtists(song,t);
  return artists?.length&&artists.every(a=>/^[\w-]{1,80}$/.test(String(a.id??''))&&String(a.id)!=='0')?artists.map(a=>String(a.id)).sort().join('|'):null;
 });
 if(!identities.length||!identities[0]||!identities.every(id=>id===identities[0]))return null;
 // The model chose a work/performer, not a recording ID. Prefer the full title,
 // then the catalogue's first matching recording, and expose the version choice.
 return found.find(t=>normalizeSongText(t.title)===normalizeSongText(song.title))??found[0];
}
export function createModelRecommendationResolver({store,registry,now=()=>Date.now(),onChange=()=>{}}){
 let stopped=false,pending=null,controller=null,lastAttempt=null,autoCallId=null,autoAttempts=0;
 const notify=()=>{try{onChange();}catch{/* UI does not control matching. */}};
 async function refresh({manual=false}={}){
  const record=modelRecommendations(store);if(stopped||!record)return{reason:'no-model-playlist'};
  if(pending)return pending;
  if(record.verification==='ready')return record;
  if(manual){
   if(lastAttempt!==null&&now()-lastAttempt<60000)return{reason:'lookup-budget'};
  }else{
   if(record.callId!==autoCallId){autoCallId=record.callId;autoAttempts=0;}
   if(autoAttempts>=MAX_AUTO_VERIFICATION_ATTEMPTS)return record;
   if(lastAttempt!==null&&now()-lastAttempt<60000)return record;
  }
  lastAttempt=now();controller=new AbortController();const signal=controller.signal,id=record.callId;
  const work=(async()=>{
   const verified=[],attempts=[];let loginUnavailable=false;
   const local=store.db.prepare("SELECT provider_track_id FROM tracks WHERE provider='netease'").all().map(r=>store.getNormalizedTrack({provider:'netease',providerTrackId:r.provider_track_id}));
   for(const [index,song] of record.songs.entries()){
    if(signal.aborted||stopped||modelRecommendations(store)?.callId!==id)return{reason:'cancelled'};
    try{
     let found=local.filter(t=>matches(song,t));
     if(found.length!==1){
      if(loginUnavailable){attempts.push({index,status:'login-required'});continue;}
      const result=await registry.search('netease',`${song.title} ${song.artist}`,{limit:10,signal});
      found=[...new Map((result.tracks??[]).filter(t=>t.provider==='netease'&&matches(song,t)).map(t=>[trackId(t),t])).values()];
     }
     const selected=selectMatchedVersion(song,found);
     if(!selected){attempts.push({index,status:found.length?'ambiguous':'not-found'});continue;}
     const track=normalizeTrack(selected);verified.push({index,track,versions:found.length});attempts.push({index,status:'matched',versions:found.length});
    }catch(error){attempts.push({index,status:error.code==='login_required'?'login-required':'lookup-failed',...(Number.isInteger(error.details?.platformCode)?{platformCode:error.details.platformCode}:{})});if(error.code==='login_required')loginUnavailable=true;}
   }
   if(signal.aborted||stopped||modelRecommendations(store)?.callId!==id)return{reason:'cancelled'};
   // 登录缺失的尝试没有真正搜索平台，不消耗自动预算。
   if(!manual&&!loginUnavailable)autoAttempts++;
   store.transaction(()=>{
    for(const row of verified)store.upsertTrack(row.track,now());
    store.setSetting(STRATEGY_KEY,{...record,verified,attempts,verification:verified.length===record.songs.length?'ready':verified.length?'partial':attempts.some(a=>a.status==='login-required')?'login-required':'empty',verifiedAt:now()});
   });notify();return modelRecommendations(store);
  })().finally(()=>{if(pending===work){pending=null;controller=null;}});
  pending=work;return work;
 }
 return{refresh,tick(){void refresh().catch(()=>{});},close(){stopped=true;controller?.abort();},cancel(){controller?.abort();lastAttempt=null;},get busy(){return Boolean(pending);}};
}
