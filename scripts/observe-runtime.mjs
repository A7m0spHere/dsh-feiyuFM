#!/usr/bin/env node
// Observe the existing plugin; never open its database or launch a second Core.
import { writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readRuntimeEvidence } from '../src/runtime/evidence.mjs';
import {createObservation} from '../src/runtime/observation.mjs';
const value = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const directory = resolve(value('--directory', join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'fishfm', 'runtime')));
const seconds = Number(value('--seconds', '0'));
if (!Number.isFinite(seconds) || seconds < 0) throw new Error('--seconds must be nonnegative');
const startedAt = Date.now(), initial = readRuntimeEvidence(directory);
if (!initial.components.core || initial.components.core.stale || initial.components.core.mode !== 'real') throw new Error('No fresh real Core evidence; restart/enable the production plugin first');
const deadline = startedAt + seconds * 1000;
const observation=createObservation(initial,startedAt);
const out = value('--out', null),stop=new AbortController();
let interrupted=false;
const interrupt=()=>{interrupted=true;stop.abort();};
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
const save=result=>{if(!out)return;const target=resolve(out),temporary=`${target}.${process.pid}.tmp`;writeFileSync(temporary,`${JSON.stringify(result)}\n`);renameSync(temporary,target);};
// Save immediately and at every checkpoint: forced Windows termination may
// bypass signal handlers, but must not discard an hour of collected deltas.
save({...observation.report(initial),status:'running'});
while (Date.now() < deadline&&!interrupted){
 try{await delay(Math.min(5000, deadline - Date.now()),undefined,{signal:stop.signal});}catch(error){if(error.name!=='AbortError')throw error;}
 const checkpoint=readRuntimeEvidence(directory);observation.accept(checkpoint);
 save({...observation.report(checkpoint),status:'running'});
}
const final = readRuntimeEvidence(directory);
observation.accept(final);
const result={...observation.report(final),status:interrupted?'interrupted':'completed'};
save(result);
console.log(JSON.stringify({ mode: result.mode,status:result.status, elapsedMs: result.elapsedMs, sameRun: result.sameRun, uninterruptedEvidence:result.uninterruptedEvidence,coreFresh: Boolean(final.components.core && !final.components.core.stale), counts: final.components.core?.counts, hostCalls:final.components.adapter?.host?.calls??null,a09Passed: null, ...(out ? { report: resolve(out) } : {}) }, null, 2));
