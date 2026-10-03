import test from 'node:test';import assert from 'node:assert/strict';
import {createHostCollector} from '../src/runtime/host-collector.mjs';
test('actual service calls, usage and static tools are observed without retaining prompts or modifying chunks',async()=>{
 const c=createHostCollector();c.attach();const chunks=[{type:'text',text:'private answer'},{type:'usage',usage:{inputTokens:5,outputTokens:2,cacheReadTokens:7}}];
 const options={messages:[{role:'user',content:'secret-cookie'}],tools:[{name:'fishfm_status',description:'static'}]};
 const out=[];for await(const chunk of c.stream(options,()=> (async function*(){yield*chunks;})()))out.push(chunk);
 assert.equal(out[0],chunks[0]);const r=c.report();assert.equal(r.calls,1);assert.equal(r.usage.inputTokens,5);assert.equal(r.usage.cacheReadTokens,7);assert.equal(r.musicTools.count,1);
 assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(r.pluginDirectModelRequests,null);
});
test('header changes are not calls, repeated events do not inflate counts and missing usage remains missing',async()=>{
 const c=createHostCollector();for(let i=0;i<2;i++)c.observeSession('s',{type:'request/header',seq:1});
 c.observeSession('s',{type:'system/message',seq:2,data:{message:{content:'private system'}}});
 assert.equal(c.report().calls,0);assert.equal(c.report().headers,1);
 for await(const _ of c.stream({},()=> (async function*(){yield {type:'finish'};})())){}
 const r=c.report();assert.equal(r.missingUsageCalls,1);assert.equal(r.usageReportedCalls,0);assert.equal(r.inFlight,0);assert.equal(JSON.stringify(r).includes('private system'),false);
});
test('synchronous throws and stream throws propagate unchanged and clear the live gauge',async()=>{
 const c=createHostCollector(),error=new Error('sentinel');assert.throws(()=>c.stream({},()=>{throw error;}),e=>e===error);
 await assert.rejects(async()=>{for await(const _ of c.stream({},()=> (async function*(){throw error;})())){}},e=>e===error);
 assert.equal(c.report().calls,2);assert.equal(c.report().failed,2);assert.equal(c.report().inFlight,0);
});
test('an unserializable diagnostic tool and invalid usage cannot break a valid host stream or invent reported usage',async()=>{
 const c=createHostCollector(),tool={name:'fishfm_status'};tool.self=tool;
 const chunk={type:'usage',usage:{inputTokens:-1,outputTokens:2}};const out=[];
 for await(const x of c.stream({tools:[null,tool]},()=> (async function*(){yield chunk;})()))out.push(x);
 assert.equal(out[0],chunk);assert.equal(c.report().musicTools.bytes,null);assert.equal(c.report().usageReportedCalls,0);assert.equal(c.report().missingUsageCalls,1);
});
