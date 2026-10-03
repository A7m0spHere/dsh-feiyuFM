import test from 'node:test';import assert from 'node:assert/strict';import {createObservation} from '../src/runtime/observation.mjs';
const report=(seq,events,runId='one',stale=false)=>({components:Object.fromEntries(['core','adapter'].map(n=>[n,{sequence:seq,events,runId:n+runId,stale,samples:[{at:seq,rss:1}]}]))});
test('observer retains checkpoint deltas across report rings without counting initial or duplicate events',()=>{
 const o=createObservation(report(1,[{seq:1}]),1000);o.accept(report(2,[{seq:1},{seq:2}]));o.accept(report(3,[{seq:2},{seq:3}]));o.accept(report(3,[{seq:3}]));
 const r=o.report(report(3,[]),3000);assert.equal(r.events.length,4);assert.equal(r.elapsedMs,2000);assert.equal(r.uninterruptedEvidence,true);assert.equal(r.a09Passed,null);
});
test('gaps, stale reports and restarts prevent an uninterrupted-evidence claim',()=>{
 const o=createObservation(report(1,[]));o.accept(report(4,[{seq:4}]));o.accept(report(5,[],'one',true));o.accept(report(1,[],'two'));const r=o.report(report(1,[],'two'));
 assert.equal(r.changedRun,true);assert.equal(r.missingEvents,true);assert.equal(r.uninterruptedEvidence,false);assert.equal(r.sameRun,false);
});
