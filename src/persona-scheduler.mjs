// The plugin owns the clock for automatic summaries; the Core owns the policy.
// This scheduler never decides on its own that a run is allowed: it asks the
// Core, and the Core re-checks every gate inside the reservation transaction.
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
   const answer=await bridge.request({type:'persona'});
   const route=answer?.persona?.lastModelRoute;
   if(!route?.provider||!route?.model)return last={filterSkipped:'no_model'};
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
  start(){if(timer||stopped)return false;timer=setInterval(()=>{void check();void checkDiscoveryFilter();},intervalMs);timer.unref?.();return true;},
  stop(){stopped=true;if(timer)clearInterval(timer);timer=null;},
  get last(){return last;},
  get running(){return Boolean(timer);},
 };
}
