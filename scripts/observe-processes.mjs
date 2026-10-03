#!/usr/bin/env node
// Windows process metrics only. No UI actions, arguments, URLs or credentials.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {writeFileSync} from 'node:fs';import {homedir} from 'node:os';import {join,resolve} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {readRuntimeEvidence} from '../src/runtime/evidence.mjs';
const run=promisify(execFile),value=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
if(process.platform!=='win32')throw new Error('Windows process metrics require Windows');
const seconds=Number(value('--seconds','0'));if(!Number.isFinite(seconds)||seconds<0||seconds>43200)throw new Error('Invalid observation duration');
const directory=resolve(value('--directory',join(homedir(),'.dsh','fishfm','runtime'))),out=value('--out',null);
const first=readRuntimeEvidence(directory),core=first.components.core,adapter=first.components.adapter;
if(!core||core.stale||!adapter||adapter.stale)throw new Error('No fresh production runtime');
const roots=[core.pid,adapter.pid,adapter.parentPid];if(!roots.every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Invalid production process ids');
const command=`$fishRows=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize); $fishIds=[System.Collections.Generic.HashSet[int]]::new(); @(${roots.join(',')}) | ForEach-Object {[void]$fishIds.Add($_)}; for($fishLevel=0;$fishLevel -lt 20;$fishLevel++){ $fishAdded=0; foreach($fishRow in $fishRows){if($fishIds.Contains([int]$fishRow.ParentProcessId) -and $fishIds.Add([int]$fishRow.ProcessId)){$fishAdded++}}; if($fishAdded -eq 0){break} }; @($fishRows | Where-Object {$fishIds.Contains([int]$_.ProcessId)} | ForEach-Object { $fishCpu=$null; try {$fishCpu=(Get-Process -Id $_.ProcessId -ErrorAction Stop).CPU} catch {}; [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;rss=[long]$_.WorkingSetSize;cpuSeconds=$fishCpu} }) | ConvertTo-Json -Compress`;
const startedAt=Date.now(),deadline=startedAt+seconds*1000,samples=[];let failures=0;
do{
 try{const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});const parsed=JSON.parse(result.stdout);samples.push({at:Date.now(),processes:Array.isArray(parsed)?parsed:[parsed]});}
 catch{failures++;}
 const result={scope:'production_core_adapter_and_host_process_tree',startedAt,updatedAt:Date.now(),elapsedMs:Date.now()-startedAt,roots,coreRunId:core.runId,adapterRunId:adapter.runId,failures,samples};
 if(out)writeFileSync(resolve(out),JSON.stringify(result)+'\n');
 if(Date.now()>=deadline){console.log(JSON.stringify({...result,samples:undefined,checkpoints:samples.length,last:samples.at(-1)},null,2));break;}
 await delay(Math.min(30000,deadline-Date.now()));
}while(true);
