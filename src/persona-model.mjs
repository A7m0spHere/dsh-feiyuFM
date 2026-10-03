// Optional one-generation summaries through the existing configured DSH service.
// No main Session messages, no tools and no automatic invocation.
import {randomUUID} from 'node:crypto';
import {measuredUsage} from './persona.mjs';
const safeId=v=>typeof v==='string'&&/^[\w./:-]{1,120}$/.test(v);
export function createPersonaModelService({llm,bridge,onLog=()=>{}}){
 let disposed=false,catalog=null,catalogAt=0,catalogPending=null,observed=null;
 const ownRequests=new WeakSet(),active=new Set();
 async function models(){
  if(catalog&&Date.now()-catalogAt<60000)return catalog;
  if(catalogPending)return catalogPending;
  catalogPending=(async()=>{
   const routes=[];
   try{for(const p of await llm.listProviders()){
    if(!safeId(p.id))continue;
    for(const m of (await llm.listModels(p.id)).slice(0,40))if(safeId(m.id))routes.push({provider:p.id,model:m.id,label:`${p.name||p.id} · ${m.name||m.id}`});
   }}catch{/* No fallback provider or credentials. */}
   if(observed&&!routes.some(r=>r.provider===observed.provider&&r.model===observed.model))routes.unshift({...observed,label:`${observed.provider} · ${observed.model}`});
   catalog=routes;catalogAt=Date.now();return routes;
  })().finally(()=>{catalogPending=null;});return catalogPending;
 }
 async function summarize(route,{signal,maxOutputTokens=null,automatic=false}={}){
  if(maxOutputTokens!==null&&(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<64))throw Object.assign(new Error('单次输出上限至少为 64 tokens。'),{code:'invalid_output'});
  if(disposed||signal?.aborted)throw Object.assign(new Error('总结已取消。'),{code:'cancelled'});
  const available=await models();
  if(disposed||signal?.aborted)throw Object.assign(new Error('总结已取消。'),{code:'cancelled'});
  if(!available.some(r=>r.provider===route?.provider&&r.model===route?.model))throw Object.assign(new Error('请选择 DSH 已配置的模型。'),{code:'invalid_model'});
  const answer=await bridge.request({type:'persona-reserve',provider:route.provider,model:route.model,automatic:automatic===true});
  const plan=answer.plan;if(plan.cached)return{cached:true};
  const abort=new AbortController();active.add(abort);const combined=signal?AbortSignal.any([abort.signal,signal]):abort.signal;
  if(disposed)abort.abort();
  const timer=setTimeout(()=>abort.abort(),45000);
  let usage=null,text='',status='failed',code=null,started=false;
  const blocks=new Map();
  try{
   combined.throwIfAborted();
   const ack=await bridge.request({type:'persona-start',callId:plan.callId});
   if(!ack.started)throw new Error('Summary reservation was lost');started=true;
   const cap=Number.isSafeInteger(maxOutputTokens)?Math.min(maxOutputTokens,plan.maxTokens):plan.maxTokens;
   const options={provider:plan.provider,model:plan.model,maxTokens:cap,reasoningEffort:'off',tools:[],signal:combined,
    messages:[{id:randomUUID(),role:'system',source:{kind:'system-prompt'},content:[{type:'text',text:plan.system}]},
     {id:randomUUID(),role:'user',source:{kind:'user'},content:[{type:'text',text:plan.prompt}]}]};
   ownRequests.add(options);try{onLog({type:'music-model-request',kind:'persona-summary'});}catch{/* Diagnostics never block a call. */}
   for await(const chunk of llm.stream(options)){
    try{onLog({type:'music-model-output',kind:chunk.type});}catch{}
    if(chunk.type==='text-delta'){const b=blocks.get(chunk.index??0)??{delta:''};b.delta+=chunk.text;blocks.set(chunk.index??0,b);}
    if(chunk.type==='block-end'&&chunk.block?.type==='text'){const b=blocks.get(chunk.index??0)??{delta:''};b.complete=chunk.block.text;blocks.set(chunk.index??0,b);}
    text=[...blocks.entries()].sort(([a],[b])=>a-b).map(([,b])=>b.complete??b.delta).join('');
    if(chunk.type==='usage')usage=measuredUsage(chunk.usage);
    if(chunk.type==='finish'&&['error','aborted'].includes(chunk.reason?.kind))throw Object.assign(new Error('模型未完成总结。'),{code:chunk.reason?.failure?.code||'model_failed'});
    if(text.length>2400)throw Object.assign(new Error('总结超出长度限制。'),{code:'summary_too_long'});
    combined.throwIfAborted();
   }
   status=text.trim()?'completed':'failed';if(status==='failed')code='empty_summary';
  }catch(error){status=combined.aborted?'cancelled':'failed';code=combined.aborted?'cancelled':/^[\w-]{1,60}$/.test(error.code??'')?error.code:'model_failed';}
  finally{
   clearTimeout(timer);active.delete(abort);
   await bridge.request({type:'persona-finish',callId:plan.callId,status,text,usage:started?usage:{inputTokens:0,outputTokens:0},code,validListens:plan.validListens??null});
  }
  if(status!=='completed')throw Object.assign(new Error('总结未成功，旧总结和本地推荐仍保留；用量已记录。'),{code:code||'model_failed'});
  return{cached:false};
 }
 return{models,summarize,peekModels:()=>catalog??(observed?[{...observed,label:`${observed.provider} · ${observed.model}`}]:[]),
  warm(){if(!catalogPending&&(!catalog||Date.now()-catalogAt>=60000))void models();},
  observe(options){if(!ownRequests.has(options)&&safeId(options?.provider)&&safeId(options?.model)){
   const changed=observed?.provider!==options.provider||observed?.model!==options.model;
   observed={provider:options.provider,model:options.model};if(changed)catalogAt=0;
  }},
  dispose(){disposed=true;for(const c of active)c.abort();},get available(){return !disposed;}};
}
