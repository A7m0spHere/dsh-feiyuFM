// Interpret real observation deltas. No final counter is treated as window data.
export function auditObservation(report,history=[]){
 const components=report?.final?.components??{},initial=report?.initial?.components??{};
 const real=report?.mode==='real-observation'&&['core','adapter'].every(n=>components[n]?.mode==='real'&&initial[n]?.mode==='real'&&initial[n]?.runId===components[n]?.runId&&!components[n]?.stale);
 const events=Array.isArray(report?.events)?report.events.filter(e=>e.component==='core'):[];
 const histories=events.filter(e=>e.type==='history'),autonomous=histories.filter(e=>e.selectedBy==='agent');
 const natural=autonomous.filter(e=>e.endReason==='ended');
 const distinct=rows=>new Set(rows.map(e=>e.playInstanceId)).size;
 const ids=new Set(autonomous.map(e=>e.playInstanceId));
 const matched=history.filter(row=>ids.has(row.playInstanceId));
 const valid=matched.filter(row=>row.qualifies);
 const growth=events.filter(e=>e.type==='growth'&&e.updated&&ids.has(e.playInstanceId));
 const controls=events.filter(e=>e.type==='command');
 const starts=events.filter(e=>e.type==='playback'&&e.event==='started'&&e.accepted);
 const errors=events.filter(e=>e.type==='playback-error'||e.type==='playback'&&e.event==='error'&&e.accepted);
 const duplicateHistory=histories.length-distinct(histories),duplicateGrowth=growth.length-distinct(growth);
 const from=initial.adapter?.host,to=components.adapter?.host;
 const hostCalls=real&&Number.isFinite(from?.attachedAt)&&Number.isFinite(from?.calls)&&Number.isFinite(to?.calls)&&to.calls>=from.calls?to.calls-from.calls:null;
 const resources=Object.fromEntries(['core','adapter'].map(name=>{
  const rows=(report?.samples??[]).filter(s=>s.component===name&&Number.isFinite(s.at)).sort((a,b)=>a.at-b.at);
  const average=items=>items.length?items.reduce((sum,r)=>sum+r.rss,0)/items.length:null;
  const maxSampleGapMs=rows.length?Math.max(0,rows[0].at-report.startedAt,report.finishedAt-rows.at(-1).at,
    ...rows.slice(1).map((r,i)=>r.at-rows[i].at)):null;
  return[name,{samples:rows.length,firstRss:rows[0]?.rss??null,lastRss:rows.at(-1)?.rss??null,
   maxSampleGapMs,
   firstTenMinuteMean:average(rows.filter(r=>r.at<report.startedAt+600000)),lastTenMinuteMean:average(rows.filter(r=>r.at>report.finishedAt-600000))}];
 }));
 const samplingComplete=['core','adapter'].every(n=>resources[n].maxSampleGapMs!==null&&resources[n].maxSampleGapMs<=20000);
 const missingHistory=distinct(autonomous)-new Set(matched.map(r=>r.playInstanceId)).size;
 const passed=real&&report.status==='completed'&&report.elapsedMs>=7200000&&report.sameRun&&report.uninterruptedEvidence&&samplingComplete&&distinct(natural)>=5&&valid.length>=5&&controls.length===0&&missingHistory===0&&duplicateHistory===0&&duplicateGrowth===0;
 return{scope:'unattended_real_music_window',status:report?.status??'unknown',elapsedMs:report?.elapsedMs??null,real,sameRun:report?.sameRun??false,
  uninterruptedEvidence:report?.uninterruptedEvidence??false,samplingComplete,unattendedRunPassed:Boolean(passed),
  naturalAutonomousEnds:distinct(natural),autonomousHistory:distinct(autonomous),observedPlaybackStarts:distinct(starts),
  validAgentListens:valid.length,validUnfamiliarListens:valid.filter(r=>r.selectionPool==='discovery').length,
  appliedGrowth:distinct(growth),missingHistory,duplicateHistory,duplicateGrowth,controlInterventions:controls.length,playbackErrors:errors.length,
  effectiveAgentMs:matched.reduce((sum,r)=>sum+(r.agentEffectiveMs??0),0),
  totalCaveat:'full_instances_ending_in_window_may_include_progress_before_window_start',
  observedHostServiceCalls:hostCalls,musicModelRequests:null,normalDshComparison:'unverified',a09Passed:null,resources};
}
