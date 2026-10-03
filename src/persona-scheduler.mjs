// The plugin owns the clock for automatic summaries; the Core owns the policy.
// This scheduler never decides on its own that a run is allowed: it asks the
// Core, and the Core re-checks every gate inside the reservation transaction.
export function createPersonaScheduler({bridge,service,onLog=()=>{},intervalMs=600000}){
 let timer=null,checking=false,stopped=false,last=null;
 async function check(){
  if(stopped||checking)return last;
  if(!service?.available)return last={skipped:'model_unavailable'};
  checking=true;
  try{
   const answer=await bridge.request({type:'persona'});
   const persona=answer?.persona;
   if(!persona?.policy?.automatic)return last={skipped:'disabled'};
   if(!persona.policy.automaticDue)return last={skipped:persona.policy.automaticBlockedBy??'not_due'};
   // Reuse the route of the last successful summary instead of inventing a
   // default model; a removed model makes the Core refuse before it reserves.
   const route={provider:persona.summary?.provider,model:persona.summary?.model};
   if(!route.provider||!route.model)return last={skipped:'no_model'};
   await service.summarize(route,{automatic:true});
   onLog({type:'persona-auto-summary',provider:route.provider,model:route.model});
   return last={ran:true};
  }catch(error){
   const code=error?.code??'failed';
   onLog({type:'persona-auto-skipped',code});
   return last={skipped:code};
  }finally{checking=false;}
 }
 return{
  check,
  start(){if(timer||stopped)return false;timer=setInterval(()=>{void check();},intervalMs);timer.unref?.();return true;},
  stop(){stopped=true;if(timer)clearInterval(timer);timer=null;},
  get last(){return last;},
  get running(){return Boolean(timer);},
 };
}
