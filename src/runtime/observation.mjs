// Accumulate real report checkpoints across bounded production report rings.
export function createObservation(initial,startedAt=Date.now()){
 const runs={core:initial.components.core?.runId,adapter:initial.components.adapter?.runId};
 const events=[],samples=[],sequences={core:initial.components.core?.sequence??0,adapter:initial.components.adapter?.sequence??0};
 let checkpoints=0,staleCheckpoints=0,changedRun=false,missingEvents=false;
 return{accept(report){
  checkpoints++;
  for(const name of ['core','adapter']){
   const component=report.components[name];
   if(!component||component.stale){staleCheckpoints++;continue;}
   if(component.runId!==runs[name]){changedRun=true;continue;}
   const next=component.events.filter(e=>e.seq>sequences[name]);
   if(next.length&&next[0].seq>sequences[name]+1)missingEvents=true;
   events.push(...next.map(e=>({...e,component:name})));sequences[name]=component.sequence;
   const last=component.samples.at(-1);if(last)samples.push({...last,component:name});
  }
 },report(final,finishedAt=Date.now()){
  return{mode:'real-observation',startedAt,finishedAt,elapsedMs:finishedAt-startedAt,checkpoints,staleCheckpoints,changedRun,missingEvents,
   sameRun:!changedRun&&Object.entries(runs).every(([n,id])=>id&&final.components[n]?.runId===id),
   uninterruptedEvidence:!changedRun&&!missingEvents&&!staleCheckpoints,
   events,samples,initial,final,a09Passed:null};
 }};
}
