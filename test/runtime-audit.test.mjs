import test from 'node:test';import assert from 'node:assert/strict';import {auditObservation} from '../src/runtime/audit.mjs';
const empty=()=>({mode:'real-observation',status:'completed',elapsedMs:7200000,sameRun:true,uninterruptedEvidence:true,startedAt:1,finishedAt:7200001,samples:[],events:[],
 initial:{components:{core:{runId:'c',mode:'real'},adapter:{runId:'a',mode:'real',host:{attachedAt:1,calls:10}}}},
 final:{components:{core:{runId:'c',mode:'real',counts:{'history:':10000}},adapter:{runId:'a',mode:'real',host:{calls:10}}}}});
test('two hours and large final counters cannot pass a window with no real milestone deltas',()=>{
 const r=auditObservation(empty());assert.equal(r.naturalAutonomousEnds,0);assert.equal(r.unattendedRunPassed,false);assert.equal(r.observedHostServiceCalls,0);assert.equal(r.a09Passed,null);assert.equal(r.musicModelRequests,null);
});
test('a saved running or interrupted checkpoint cannot pass as a completed soak',()=>{
 const p=empty(),history=[];
 for(let i=0;i<5;i++){const id=String(i);p.events.push({component:'core',type:'history',selectedBy:'agent',endReason:'ended',playInstanceId:id});history.push({playInstanceId:id,qualifies:true,agentEffectiveMs:30000});}
 for(const component of ['core','adapter'])for(let at=1;at<=7200001;at+=10000)p.samples.push({component,at,rss:1});
 assert.equal(auditObservation(p,history).unattendedRunPassed,true);
 p.status='running';assert.equal(auditObservation(p,history).unattendedRunPassed,false);
 p.status='interrupted';assert.equal(auditObservation(p,history).unattendedRunPassed,false);
});
test('simulation, instance changes, missing DB histories and duplicate growth prevent a pass',()=>{
 const p=empty();p.final.components.core.mode='synthetic';assert.equal(auditObservation(p).real,false);
 p.final.components.core.mode='real';p.final.components.core.runId='new';assert.equal(auditObservation(p).real,false);
 p.final.components.core.runId='c';p.events=[{component:'core',type:'history',selectedBy:'agent',endReason:'ended',playInstanceId:'one'},
 {component:'core',type:'growth',updated:true,playInstanceId:'one'},{component:'core',type:'growth',updated:true,playInstanceId:'one'}];
 const r=auditObservation(p);assert.equal(r.missingHistory,1);assert.equal(r.duplicateGrowth,1);assert.equal(r.unattendedRunPassed,false);
});
test('a wall-clock jump or sleeping machine cannot pass even with valid milestones and a claimed uninterrupted flag',()=>{
 const p=empty(),history=[];
 for(let i=0;i<5;i++){const id=String(i);p.events.push({component:'core',type:'history',selectedBy:'agent',endReason:'ended',playInstanceId:id});history.push({playInstanceId:id,qualifies:true,agentEffectiveMs:30000});}
 for(const component of ['core','adapter'])p.samples.push({component,at:1,rss:1},{component,at:7200001,rss:1});
 const result=auditObservation(p,history);assert.equal(result.validAgentListens,5);assert.equal(result.samplingComplete,false);assert.equal(result.resources.core.maxSampleGapMs,7200000);assert.equal(result.unattendedRunPassed,false);
});
