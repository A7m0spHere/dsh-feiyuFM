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

test('a window whose diagnostics could not be written is not clean evidence',()=>{
 // The reports look perfect; the only signal is the failure note beside them.
 const withFailure=(base,failure)=>({...base,writeFailures:{core:failure,adapter:null}});
 const o=createObservation(withFailure(report(1,[]),null),1000);
 o.accept(withFailure(report(2,[{seq:2}]),null));
 o.accept(withFailure(report(3,[{seq:3}]),{component:'core',lastError:'EPERM',failures:2,at:2000}));
 const r=o.report(withFailure(report(3,[{seq:3}]),{component:'core',lastError:'EPERM',failures:2,at:2000}),3000);
 assert.equal(r.staleCheckpoints,0,'the report itself is fresh');
 assert.equal(r.evidenceWriteFailures,1,'the checkpoint that saw the note is counted');
 assert.deepEqual(r.lastWriteFailure.core,{code:'EPERM',failures:2,at:2000});
 assert.equal(r.uninterruptedEvidence,false,'a window that cannot write its own evidence is not uninterrupted');
});

test('a healthy window reports zero write failures rather than omitting the field',()=>{
 const o=createObservation(report(1,[]),1000);
 o.accept(report(2,[{seq:2}]));
 const r=o.report(report(2,[{seq:2}]),3000);
 assert.equal(r.evidenceWriteFailures,0);
 assert.deepEqual(r.lastWriteFailure,{core:null,adapter:null});
 assert.equal(r.uninterruptedEvidence,true);
});
