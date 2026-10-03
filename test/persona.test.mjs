import test from 'node:test';import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';import {reserveSummary,startSummary,finishSummary,recoverSummaryCalls,personaView,setSummaryBudget} from '../src/persona.mjs';
import {createPersonaModelService} from '../src/persona-model.mjs';
const snapshot={settings:{discoveryRate:.7,discovery:true,strategy:'normal'},current:null};
const route={provider:'deepseek',model:'configured-model'};
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
 const store=new MusicStore();let calls=0;
 const bridge={async request(m){
  if(m.type==='persona-reserve')return{plan:reserveSummary({store,snapshot,...m})};
  if(m.type==='persona-start')return{started:startSummary(store,m.callId)};
  if(m.type==='persona-finish')return{result:finishSummary({store,...m})};
 }};
 const llm={listProviders:()=>[{id:route.provider,name:'Configured'}],listModels:async()=>[{id:route.model,name:'Existing model'}],
  stream(options){calls++;assert.equal(options.maxTokens,256);assert.deepEqual(options.tools,[]);assert.equal(options.messages.length,2);
   return(async function*(){if(hold)await hold;yield*(chunks??[{type:'text-delta',text:'只总结本地事实。'},{type:'usage',usage:{inputTokens:123,outputTokens:20}},{type:'finish',reason:{kind:'stop'}}]);})();}};
 return{store,service:createPersonaModelService({llm,bridge}),calls:()=>calls};
}
test('manual one-generation summaries record reported usage while identical repeated requests use cache',async()=>{
 const f=modelFixture();try{await f.service.summarize(route);await f.service.summarize(route);
  assert.equal(f.calls(),1);assert.equal(personaView(f.store,snapshot).ledger.total.knownTokens,143);
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
