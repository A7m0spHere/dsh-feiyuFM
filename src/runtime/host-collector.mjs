// Passive DSH 0.2.0-rc.2 collector. No prompt/message bodies leave this module.
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const usageKeys=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'];
function safeUsage(usage){
 if(!usage||!Number.isFinite(usage.inputTokens)||!Number.isFinite(usage.outputTokens))return null;
 return Object.fromEntries(usageKeys.filter(k=>Number.isFinite(usage[k])&&usage[k]>=0).map(k=>[k,usage[k]]));
}
export function createHostCollector({onLog=()=>{},now=()=>Date.now()}={}){
 const stats={attachedAt:null,calls:0,completed:0,failed:0,inFlight:0,usageReportedCalls:0,missingUsageCalls:0,
  usage:Object.fromEntries(usageKeys.map(k=>[k,0])),settlements:0,headers:0,systemUpdates:0,developerUpdates:0,
  musicTools:{count:0,bytes:0,fingerprint:null},lastSystemFingerprint:null};
 const seen=new Map();
 const emit=e=>{try{onLog(e);}catch{/* Never alter host behavior. */}};
 function observeSession(sessionId,event){
  if(!event||!['assistant/message','assistant/attempt','request/header','system/message','developer/message'].includes(event.type))return;
  if(Number.isFinite(event.seq)&&sessionId){
   const last=seen.get(sessionId);if(last!==undefined&&event.seq<=last)return;
   seen.delete(sessionId);seen.set(sessionId,event.seq);if(seen.size>256)seen.delete(seen.keys().next().value);
  }
  if(event.type.startsWith('assistant/'))stats.settlements++;
  if(event.type==='request/header')stats.headers++;
  if(event.type==='system/message'){stats.systemUpdates++;stats.lastSystemFingerprint=hash(event.data?.message??null);}
  if(event.type==='developer/message')stats.developerUpdates++;
  emit({type:'dsh-session-observed',kind:event.type.replace('/','-')});
 }
 function stream(options,next){
  // Count the actual LLM service entry, never request/header or UI events.
  stats.calls++;stats.inFlight++;
  const tools=(options?.tools??[]).filter(t=>/^fishfm_(status|control|request_track)$/.test(t.name));
  stats.musicTools={count:tools.length,bytes:Buffer.byteLength(JSON.stringify(tools)),fingerprint:hash(tools)};
  emit({type:'dsh-model-call',count:stats.calls});
  let source;
  try{source=next();}catch(error){stats.inFlight--;stats.failed++;stats.missingUsageCalls++;throw error;}
  return (async function*(){
   let usage=null,failed=false;
   try{for await(const chunk of source){if(chunk?.type==='usage')usage=safeUsage(chunk.usage);if(chunk?.type==='finish'&&['error','aborted'].includes(chunk.reason?.kind))failed=true;yield chunk;}}
   catch(error){failed=true;throw error;}
   finally{
    stats.inFlight--;stats.completed++;if(failed)stats.failed++;
    if(usage){stats.usageReportedCalls++;for(const k of usageKeys)stats.usage[k]+=usage[k]??0;}
    else stats.missingUsageCalls++;
    emit({type:'dsh-model-settled',count:stats.completed});
   }
  })();
 }
 return{attach(){stats.attachedAt=now();},observeSession,stream,report:()=>({
  contract:'dsh-0.2.0-rc.2-llm-stream',scope:'host_llm_service_calls_since_plugin_activation',...structuredClone(stats),
  networkRetries:'unobserved',pluginDirectModelRequests:null,attribution:'host_usage_is_not_plugin_usage',
  contextCoverage:'system_and_developer_event_counts_and_fingerprints_only',
 })};
}
