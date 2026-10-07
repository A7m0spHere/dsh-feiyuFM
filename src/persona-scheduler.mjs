// The plugin owns the clock for automatic summaries; the Core owns the policy.
// This scheduler never decides on its own that a run is allowed: it asks the
// Core, and the Core re-checks every gate inside the reservation transaction.
import { setTimeout as delay } from 'node:timers/promises';

export async function prepareRecommendations({bridge,service,route,signal}){
 if(!service?.available)throw Object.assign(new Error('请先在 DSH 配置可用的模型。'),{code:'model_unavailable'});
 if(typeof service.models==='function'&&!(await service.models()).some(item=>item.provider===route?.provider&&item.model===route?.model))
  throw Object.assign(new Error('请选择 DSH 中已配置的模型。'),{code:'invalid_model'});
 await bridge.request({type:'recommendation-route',...route},{signal,abortable:true});
 await bridge.request({type:'discovery'},{signal,abortable:true});
 let status;
 for(let waited=0;waited<=30000;waited+=250){
  if(signal?.aborted)throw Object.assign(new Error('挑歌已取消。'),{code:'cancelled'});
  status=(await bridge.request({type:'discovery-filter-status'},{signal,abortable:true}))?.filter;
  if(!status?.refreshing)break;
  await delay(250,undefined,{signal});
 }
 if(status?.refreshing)throw Object.assign(new Error('网易云还在找歌，稍后可以再试。'),{code:'provider_timeout'});
 if(!status?.count)throw Object.assign(new Error('网易云暂时没有返回合适的歌曲，请先导入参考音乐或稍后重试。'),{code:'no_candidates'});
 return service.summarize(route,{signal,purpose:'discovery-filter'});
}
export function createPersonaScheduler({bridge,service,onLog=()=>{},intervalMs=600000}){
 let timer=null,checking=false,checkingFilter=false,stopped=false,last=null;
 const emit=entry=>{try{onLog(entry);}catch{/* Diagnostics do not decide whether a call succeeded. */}};
 async function check(){
  if(stopped||checking)return last;
  if(!service?.available)return last={skipped:'model_unavailable'};
  checking=true;
  try{
   const answer=await bridge.request({type:'persona'});
   if(stopped||!service?.available)return last={skipped:stopped?'stopped':'model_unavailable'};
   const persona=answer?.persona;
   if(persona?.recommendationPipeline?.pipeline==='platform-filter')return last={skipped:'playlist_pipeline'};
   if(!persona?.policy?.automatic)return last={skipped:'disabled'};
   if(!persona.policy.automaticDue)return last={skipped:persona.policy.automaticBlockedBy??'not_due'};
   // Reuse the route of the last successful summary instead of inventing a
   // default model; a removed model makes the Core refuse before it reserves.
   const purpose=persona.policy.automaticPurpose??'persona-summary';
   const baseline=purpose==='model-recommendations'?persona.recommendations:persona.summary;
   const route={provider:baseline?.provider,model:baseline?.model};
   if(!route.provider||!route.model)return last={skipped:'no_model'};
   const result=await service.summarize(route,{automatic:true,purpose});
   if(result?.cached)return last={skipped:'current',cached:true};
   emit({type:'persona-auto-summary',provider:route.provider,model:route.model});
   return last={ran:true};
  }catch(error){
   const code=error?.code??'failed';
   emit({type:'persona-auto-skipped',code});
   return last={skipped:code};
  }finally{checking=false;}
 }
 // 发现候选筛选：Core 判定 due 后沿用最近一次成功调用的模型路由。
 // 刷新刚触发时缓存仍在拉取，最多等 30 秒让它结束再判定。
 async function checkDiscoveryFilter(){
  if(stopped||checkingFilter)return last;
  if(!service?.available)return last={filterSkipped:'model_unavailable'};
  checkingFilter=true;
  try{
   let status=null;
   for(let waited=0;waited<=30000;waited+=1000){
    const answer=await bridge.request({type:'discovery-filter-status'});
    status=answer?.filter??null;
    if(!status?.refreshing)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
   if(!status?.due)return last={filterSkipped:'not_due'};
   if(stopped)return last={filterSkipped:'stopped'};
   const answer=await bridge.request({type:'persona'});
   let route=answer?.persona?.recommendationRoute??answer?.persona?.lastModelRoute;
   if(status?.pipeline==='platform-filter'){
    const routes=typeof service.models==='function'?await service.models():[];
    if(stopped)return last={filterSkipped:'stopped'};
    if(routes.length&&!routes.some(item=>item.provider===route?.provider&&item.model===route?.model))route=routes[0];
    if(route?.provider&&route?.model)await bridge.request({type:'recommendation-route',provider:route.provider,model:route.model});
   }
   if(!route?.provider||!route?.model)return last={filterSkipped:'no_model'};
   if(stopped)return last={filterSkipped:'stopped'};
   const result=await service.summarize(route,{automatic:true,purpose:'discovery-filter'});
   if(result?.cached)return last={filterSkipped:'current',cached:true};
   emit({type:'discovery-filter-run',provider:route.provider,model:route.model});
   return last={filterRan:true};
  }catch(error){
   const code=error?.code??'failed';
   emit({type:'discovery-filter-skipped',code});
   return last={filterSkipped:code};
  }finally{checkingFilter=false;}
 }
 return{
  check,checkDiscoveryFilter,
  start(){if(timer||stopped)return false;void checkDiscoveryFilter();timer=setInterval(()=>{void check();void checkDiscoveryFilter();},intervalMs);timer.unref?.();return true;},
  stop(){stopped=true;if(timer)clearInterval(timer);timer=null;},
  get last(){return last;},
  get running(){return Boolean(timer);},
 };
}
