import test from 'node:test';import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';
import {reserveSummary,startSummary,finishSummary,recoverSummaryCalls,personaView,setSummaryBudget,setSummaryOutputTokens,setSummaryAutomatic} from '../src/persona.mjs';
import {createPersonaModelService} from '../src/persona-model.mjs';
import {createPersonaScheduler} from '../src/persona-scheduler.mjs';
const snapshot={settings:{discoveryRate:.7,discovery:true,strategy:'normal'},current:null};
const route={provider:'deepseek',model:'configured-model'};

test('recommendation availability follows billed failures, interrupted calls and the local daily boundary',()=>{
 const store=new MusicStore();
 const candidates=[{provider:'netease',providerTrackId:'42',title:'Song',artist:'Artist',discovery:{source:'netease_similar'}}];
 const reserve=now=>reserveSummary({store,snapshot,...route,now,purpose:'discovery-filter',candidates});
 try{
  store.setSetting('summary_daily_tokens',100000);
  let plan=reserve(1000);
  finishSummary({store,callId:plan.callId,status:'failed',usage:{inputTokens:10,outputTokens:0},code:'provider_failure',now:1001});
  assert.equal(personaView(store,snapshot,1002).recommendationAvailability.reason,null,'known usage permits a bounded retry');
  plan=reserve(1002);recoverSummaryCalls(store,1003);
  assert.equal(personaView(store,snapshot,1004).recommendationAvailability.reason,null,'interrupted calls allow an immediate manual retry');
  assert.throws(()=>reserveSummary({store,snapshot,...route,now:1004,purpose:'discovery-filter',automatic:true,candidates}),{code:'summary_cooldown'},'interruption retains the automatic cooldown');
  for(let index=0;index<10;index++){
   plan=reserve(901002+index*900001);
   finishSummary({store,callId:plan.callId,status:'failed',usage:{inputTokens:1,outputTokens:0},now:901003+index*900001});
  }
  const limited=personaView(store,snapshot,10000000).recommendationAvailability;
  assert.equal(limited.reason,'summary_retry_limit');assert.equal(limited.remainingAttempts,0);
  assert.throws(()=>reserve(10000000),error=>error.code==='summary_retry_limit'&&error.details.resetAt===limited.resetAt);
  const tomorrow=personaView(store,snapshot,limited.resetAt).recommendationAvailability;
  assert.equal(tomorrow.reason,null);assert.equal(tomorrow.remainingAttempts,12);
 }finally{store.close();}
});
test('summary cache reuses actual usage and never modifies independent preferences or paused playback',()=>{
 const store=new MusicStore();try{
  store.setPreference({targetType:'artist',targetKey:'Artist',affinity:.8,source:'listen',updatedAt:1});
  const plan=reserveSummary({store,snapshot,...route,now:1000});assert.equal(startSummary(store,plan.callId),true);
  finishSummary({store,callId:plan.callId,status:'completed',text:'事实总结',usage:{inputTokens:50,outputTokens:12,cacheReadTokens:7},now:1100});
  const cached=reserveSummary({store,snapshot,...route,now:1200});assert.equal(cached.cached,true);
  const view=personaView(store,snapshot,1200);assert.equal(view.ledger.total.attempts,1);assert.equal(view.ledger.total.knownTokens,69);assert.equal(view.ledger.total.unknownCalls,0);
  assert.equal(store.getPreference('artist','Artist').affinity,.8);assert.equal(view.summary.text,'事实总结');assert.equal(view.ledger.localDecisionRequests,0);
  assert.equal(finishSummary({store,callId:plan.callId,usage:{inputTokens:999,outputTokens:999}}).duplicate,true);assert.equal(personaView(store,snapshot,1200).ledger.total.knownTokens,69);
 }finally{store.close();}
});
test('concurrent reservations, budget zero and restart recovery cannot bypass conservative unknown usage charges',()=>{
 const store=new MusicStore();try{
  setSummaryBudget(store,0);assert.throws(()=>reserveSummary({store,snapshot,...route,now:1000}),e=>e.code==='budget_exhausted');
  setSummaryBudget(store,4000);const plan=reserveSummary({store,snapshot,...route,now:2000});
  assert.throws(()=>reserveSummary({store,snapshot,...route,now:2001}),e=>e.code==='summary_busy');
  startSummary(store,plan.callId);recoverSummaryCalls(store,3000);
  const view=personaView(store,snapshot,3000);assert.equal(view.ledger.total.unknownCalls,1);assert.ok(view.ledger.today.chargedTokens>1000);assert.equal(view.summary,null);
  assert.throws(()=>reserveSummary({store,snapshot,...route,now:3001}),e=>e.code==='summary_cooldown');
 }finally{store.close();}
});
function modelFixture({chunks,hold}={}){
 const store=new MusicStore();let calls=0,lastMax=null;
 const bridge={async request(m){
  if(m.type==='persona-reserve')return{plan:reserveSummary({store,snapshot,...m})};
  if(m.type==='persona-start')return{started:startSummary(store,m.callId)};
  if(m.type==='persona-finish')return{result:finishSummary({store,...m})};
 }};
 const llm={listProviders:()=>[{id:route.provider,name:'Configured'}],listModels:async()=>[{id:route.model,name:'Existing model'}],
  stream(options){calls++;lastMax=options.maxTokens;assert.deepEqual(options.tools,[]);assert.equal(options.messages.length,2);
   return(async function*(){if(hold)await hold;yield*(chunks??[{type:'text-delta',text:'只总结本地事实。'},{type:'usage',usage:{inputTokens:123,outputTokens:20}},{type:'finish',reason:{kind:'stop'}}]);})();}};
 return{store,service:createPersonaModelService({llm,bridge}),calls:()=>calls,maxTokens:()=>lastMax};
}
test('manual one-generation summaries record reported usage while identical repeated requests use cache',async()=>{
 const f=modelFixture();try{await f.service.summarize(route);await f.service.summarize(route);
  assert.equal(f.calls(),1);assert.equal(f.maxTokens(),256);assert.equal(personaView(f.store,snapshot).ledger.total.knownTokens,143);
 }finally{f.service.dispose();f.store.close();}
});
test('provider failure retains old facts, charges missing usage as unknown and creates no fabricated summary',async()=>{
 const f=modelFixture({chunks:[{type:'finish',reason:{kind:'error',failure:{code:'provider_failure'}}}]});
 try{await assert.rejects(()=>f.service.summarize(route),e=>e.code==='provider_failure');
  const view=personaView(f.store,snapshot);assert.equal(view.summary,null);assert.equal(view.ledger.total.unknownCalls,1);assert.ok(view.ledger.today.chargedTokens>0);
 }finally{f.service.dispose();f.store.close();}
});
test('disposal while model catalog is loading cannot dispatch a generation later',async()=>{
 const ready=Promise.withResolvers();let requested=0,calls=0;
 const service=createPersonaModelService({llm:{listProviders:()=>[{id:'deepseek'}],listModels:()=>ready.promise,stream(){calls++;}},bridge:{request(){requested++;}}});
 const pending=service.summarize(route);service.dispose();ready.resolve([{id:route.model,name:'Existing'}]);
 await assert.rejects(()=>pending,e=>e.code==='cancelled');assert.equal(requested,0);assert.equal(calls,0);
});
test('complete text blocks work without deltas and do not duplicate an earlier delta',async()=>{
 const f=modelFixture({chunks:[{type:'text-delta',index:0,text:'事实'},{type:'block-end',index:0,block:{type:'text',text:'事实总结。'}},{type:'usage',usage:{inputTokens:20,outputTokens:5}}]});
 try{await f.service.summarize(route);assert.equal(personaView(f.store,snapshot).summary.text,'事实总结。');}finally{f.service.dispose();f.store.close();}
});
test('a billed known failure permits bounded manual retries while preserving every charge',()=>{
 const store=new MusicStore();try{
  for(let i=0;i<3;i++){const p=reserveSummary({store,snapshot,...route,now:1000+i});startSummary(store,p.callId);finishSummary({store,callId:p.callId,status:'failed',usage:{inputTokens:20,outputTokens:5},now:1000+i});}
  assert.throws(()=>reserveSummary({store,snapshot,...route,now:1010}),e=>e.code==='summary_retry_limit');
  assert.equal(personaView(store,snapshot,1010).ledger.total.knownTokens,75);
 }finally{store.close();}
});
test('an automatic caller cannot switch itself on, and the switch does not block manual runs',()=>{
 const store=new MusicStore();try{
  store.setPreference({targetType:'artist',targetKey:'A',affinity:.8,source:'listen',updatedAt:1});
  assert.equal(personaView(store,snapshot,1000).policy.automatic,false);
  assert.equal(personaView(store,snapshot,1000).policy.automaticBlockedBy,'disabled');
  assert.throws(()=>reserveSummary({store,snapshot,...route,now:1000,automatic:true}),e=>e.code==='automatic_disabled');
  assert.equal(reserveSummary({store,snapshot,...route,now:1000}).cached,false,'a manual run is still allowed while the switch is off');
 }finally{store.close();}
});
test('an enabled automatic summary still waits for enough new evidence and rechecks the bounds',()=>{
 const store=new MusicStore();try{
  store.setPreference({targetType:'artist',targetKey:'A',affinity:.8,source:'listen',updatedAt:1});
  setSummaryAutomatic(store,true);
  assert.equal(personaView(store,snapshot,1000).policy.automaticBlockedBy,'no_model','automatic mode needs a successful manual baseline and route');
  assert.throws(()=>reserveSummary({store,snapshot,...route,now:1000,automatic:true}),e=>e.code==='automatic_no_model');
  const plan=reserveSummary({store,snapshot,...route,now:1000});assert.equal(plan.cached,false);
  assert.equal(personaView(store,snapshot,1001).policy.automaticBlockedBy,'busy');
  startSummary(store,plan.callId);
  finishSummary({store,callId:plan.callId,status:'completed',text:'事实总结',usage:{inputTokens:10,outputTokens:5},now:1100,validListens:0});
  // Move the profile without adding evidence, so the summary is stale but not due.
  const changed={...snapshot,settings:{...snapshot.settings,discoveryRate:.5}};
  const later=1100+3_600_001; // past the cooldown, so the evidence gate is the one that answers
  const after=personaView(store,changed,later);
  assert.equal(after.summary.trigger,'manual');assert.equal(after.summary.validListens,0);
  assert.equal(after.summaryStale,true,'the profile moved but the summary did not');
  assert.equal(after.policy.automaticBlockedBy,'not_enough_new_listens','fewer than the required new listens must block, not run');
  assert.equal(after.policy.automaticNewListens,0,'the baseline comes from the stored summary, not from the lifetime count');
  assert.throws(()=>reserveSummary({store,snapshot:changed,...route,now:later,automatic:true}),e=>e.code==='not_enough_new_listens','the reservation re-checks the same gate');
  // A manual run is not subject to the evidence gate; it only waits out the cooldown.
  assert.throws(()=>reserveSummary({store,snapshot:changed,...route,now:1300}),e=>e.code==='summary_cooldown');
  assert.equal(personaView(store,changed,1300).policy.automaticBlockedBy,'cooldown','the cooldown is reported before the evidence gate');
 }finally{store.close();}
});
test('a summary stored before baselines existed cannot trigger an automatic run on the next check',()=>{
 const store=new MusicStore();try{
  store.setPreference({targetType:'artist',targetKey:'A',affinity:.8,source:'listen',updatedAt:1});
  store.setSetting('persona_summary_v1',{factHash:'stale',provider:'p',model:'m',text:'旧总结',generatedAt:1,usage:null,source:'llm_summary'});
  setSummaryAutomatic(store,true);
  const view=personaView(store,snapshot,5000);
  assert.equal(view.summaryStale,true);
  assert.equal(view.policy.automaticDue,false);assert.equal(view.policy.automaticBlockedBy,'not_enough_new_listens');
 }finally{store.close();}
});
test('the saved output cap is bounded, reaches the plan and never rewrites the policy default',async()=>{
 const store=new MusicStore();try{
  assert.throws(()=>setSummaryOutputTokens(store,32),e=>e.code==='invalid_output');
  assert.throws(()=>setSummaryOutputTokens(store,512),e=>e.code==='invalid_output');
  assert.throws(()=>setSummaryBudget(store,1.5),e=>e.code==='invalid_budget');
  assert.throws(()=>setSummaryAutomatic(store,'yes'),e=>e.code==='invalid_automatic');
  setSummaryOutputTokens(store,64);
  assert.equal(reserveSummary({store,snapshot,...route,now:1000}).maxTokens,64,'the plan asks for no more than the saved cap');
  assert.equal(personaView(store,snapshot,1000).policy.maxOutputTokens,64);
  assert.equal(personaView(store,snapshot,1000).policy.minOutputTokens,64);
 }finally{store.close();}
});
test('a per-call cap lowers the model request without changing the stored setting',async()=>{
 const f=modelFixture();try{
  await f.service.summarize(route,{maxOutputTokens:64});
  assert.equal(f.maxTokens(),64);assert.equal(personaView(f.store,snapshot).policy.maxOutputTokens,256,'the per-call cap is not a policy rewrite');
  await f.service.summarize(route,{maxOutputTokens:4096});
  assert.equal(f.calls(),1,'the cached profile is reused, so no second request is sent');
 }finally{f.service.dispose();f.store.close();}
});
function schedulerFixture(persona,summarize){
 const logged=[];
 const scheduler=createPersonaScheduler({bridge:{request:async()=>({persona})},service:{available:true,summarize},onLog:entry=>logged.push(entry)});
 return{scheduler,logged};
}
test('the scheduler asks the Core and never calls a model when nothing is due',async()=>{
 let calls=0;
 const {scheduler}=schedulerFixture({policy:{automatic:true,automaticDue:false,automaticBlockedBy:'cooldown'},summary:null},async()=>{calls++;});
 const result=await scheduler.check();
 assert.equal(calls,0);assert.equal(result.skipped,'cooldown');assert.equal(scheduler.running,false,'a check must not start a timer on its own');
});
test('the scheduler stays silent while the switch is off and reuses the last successful route',async()=>{
 let calls=0,seen=null;
 const off=schedulerFixture({policy:{automatic:false,automaticDue:false,automaticBlockedBy:'disabled'},summary:null},async()=>{calls++;});
 assert.equal((await off.scheduler.check()).skipped,'disabled');assert.equal(calls,0);
 const on=schedulerFixture({policy:{automatic:true,automaticDue:true},summary:{provider:'p',model:'m'}},async(route)=>{seen=route;calls++;});
 const result=await on.scheduler.check();
 assert.equal(calls,1);assert.deepEqual(seen,{provider:'p',model:'m'});assert.equal(result.ran,true);
 assert.equal(on.logged.filter(e=>e.type==='persona-auto-summary').length,1);
});
test('a refused automatic run is logged and never escalates inside the same check',async()=>{
 let calls=0;
 const {scheduler,logged}=schedulerFixture({policy:{automatic:true,automaticDue:true},summary:{provider:'p',model:'m'}},
  async()=>{calls++;throw Object.assign(new Error('x'),{code:'summary_busy'});});
 await scheduler.check();await scheduler.check();
 assert.equal(calls,2);assert.equal(logged.filter(e=>e.type==='persona-auto-skipped'&&e.code==='summary_busy').length,2);
});

function evidenceJobs(store,count,endedAt,overrides={}){
 const insert=store.db.prepare('INSERT INTO growth_jobs (play_instance_id,entry_json,processed_at) VALUES (?,?,?)');
 const offset=store.db.prepare('SELECT count(*) count FROM growth_jobs').get().count;
 for(let i=0;i<count;i++)insert.run(`evidence-${offset+i}`,JSON.stringify({selectedBy:'agent',agentListening:true,agentEffectiveMs:30000,durationMs:100000,endReason:'ended',endedAt,...overrides}),endedAt);
}
function successfulBaseline(store,oldCount=0){
 store.setPreference({targetType:'artist',targetKey:'A',affinity:.8,source:'listen',updatedAt:1});
 evidenceJobs(store,oldCount,900);
 const p=reserveSummary({store,snapshot,...route,now:1000});startSummary(store,p.callId);
 finishSummary({store,callId:p.callId,status:'completed',text:'事实总结',usage:{inputTokens:10,outputTokens:5},now:1100});
 setSummaryAutomatic(store,true);return p;
}
const changedSnapshot={...snapshot,settings:{...snapshot.settings,discoveryRate:.5}};
test('automatic fresh evidence is independent of the 200-decision UI window and excludes manual, failed and short plays',()=>{
 const store=new MusicStore();try{
  successfulBaseline(store,220);evidenceJobs(store,49,2000);
  evidenceJobs(store,1,2000,{selectedBy:'user'});evidenceJobs(store,1,2000,{endReason:'error'});evidenceJobs(store,1,2000,{agentEffectiveMs:1000});
  const now=1100+86400001;
  let view=personaView(store,changedSnapshot,now);assert.equal(view.facts.validListens,0,'these jobs are outside the bounded UI decision window');
  assert.equal(view.policy.automaticNewListens,49);assert.equal(view.policy.automaticDue,false);
  evidenceJobs(store,1,2100);view=personaView(store,changedSnapshot,now);assert.equal(view.policy.automaticDue,true);
  const plan=reserveSummary({store,snapshot:changedSnapshot,...route,now,automatic:true});assert.equal(plan.validListens,270);
  assert.equal(store.db.prepare('SELECT baseline_growth_rowid FROM music_model_calls WHERE call_id=?').get(plan.callId).baseline_growth_rowid,273);
 }finally{store.close();}
});
test('the 24-hour interval and actual prompt reservation budget are both rechecked atomically',()=>{
 const store=new MusicStore();try{
  successfulBaseline(store);evidenceJobs(store,50,2000);
  const early=1100+7200000;
  assert.equal(personaView(store,changedSnapshot,early).policy.automaticBlockedBy,'interval');
  assert.throws(()=>reserveSummary({store,snapshot:changedSnapshot,...route,now:early,automatic:true}),e=>e.code==='summary_interval');
  const late=1100+86400001;assert.equal(personaView(store,changedSnapshot,late).policy.automaticDue,true);
  setSummaryBudget(store,0);assert.equal(personaView(store,changedSnapshot,late).policy.automaticBlockedBy,'budget');
  assert.throws(()=>reserveSummary({store,snapshot:changedSnapshot,...route,now:late,automatic:true}),e=>e.code==='budget_exhausted');
  setSummaryBudget(store,4000);setSummaryAutomatic(store,false);
  assert.throws(()=>reserveSummary({store,snapshot:changedSnapshot,...route,now:late,automatic:true}),e=>e.code==='automatic_disabled');
  assert.equal(personaView(store,changedSnapshot,late).ledger.total.attempts,1,'rejected stale checks leave no new reservation');
 }finally{store.close();}
});
test('legacy summaries count only qualified listens ending after their generation time',()=>{
 const store=new MusicStore();try{
  store.setPreference({targetType:'artist',targetKey:'A',affinity:.8,source:'listen',updatedAt:1});
  evidenceJobs(store,120,1000);
  store.setSetting('persona_summary_v1',{factHash:'legacy',...route,generatedAt:2000,validListens:0});setSummaryAutomatic(store,true);
  evidenceJobs(store,49,3000);const now=2000+86400001;
  assert.equal(personaView(store,snapshot,now).policy.automaticNewListens,49);
  evidenceJobs(store,1,3100);assert.equal(personaView(store,snapshot,now).policy.automaticDue,true);
 }finally{store.close();}
});
test('an automatic cache hit is not logged as a generated summary',async()=>{
 const {scheduler,logged}=schedulerFixture({policy:{automatic:true,automaticDue:true},summary:route},async()=>({cached:true}));
 const result=await scheduler.check();assert.equal(result.cached,true);assert.equal(result.skipped,'current');assert.equal(logged.length,0);
});
test('stopping a scheduler during the Core check prevents a late model dispatch',async()=>{
 const ready=Promise.withResolvers();let calls=0;
 const scheduler=createPersonaScheduler({bridge:{request:()=>ready.promise},service:{available:true,summarize:async()=>{calls++;}}});
 const pending=scheduler.check();scheduler.stop();ready.resolve({persona:{policy:{automatic:true,automaticDue:true},summary:route}});
 assert.equal((await pending).skipped,'stopped');assert.equal(calls,0);
});
test('scheduler diagnostic failures cannot turn a completed generation into a failure',async()=>{
 const scheduler=createPersonaScheduler({bridge:{request:async()=>({persona:{policy:{automatic:true,automaticDue:true},summary:route}})},
  service:{available:true,summarize:async()=>({cached:false})},onLog(){throw new Error('diagnostic fault');}});
 assert.equal((await scheduler.check()).ran,true);
});
test('invalid internal output caps fail before a reservation or model request',async()=>{
 const f=modelFixture();try{
  await assert.rejects(()=>f.service.summarize(route,{maxOutputTokens:-1}),e=>e.code==='invalid_output');
  assert.equal(f.calls(),0);assert.equal(personaView(f.store,snapshot).ledger.total.attempts,0);
 }finally{f.service.dispose();f.store.close();}
});
