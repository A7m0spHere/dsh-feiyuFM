#!/usr/bin/env node
// Explicit opt-in host acceptance. Hidden isolated Web profile, generated silent
// media, and only the caller-selected model configuration. Never runs at npm test.
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {writeTone} from './make-tone.mjs';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const runtimeNode=arg('--runtime-node',null),runtime=arg('--runtime-root',null),output=arg('--out',null);
if(process.platform!=='win32')throw new Error('This acceptance runner requires Windows native WPF playback');
if(!runtimeNode||!runtime||!output)throw new Error('Pass --runtime-node <Electron executable> --runtime-root <bundled dsh directory> --out <new isolated directory> [--model-home <existing DSH home>]');
const root=resolve(import.meta.dirname,'..'),out=resolve(output),home=join(out,'home'),workspace=join(out,'workspace');
if(existsSync(out))throw new Error('Acceptance output must be a new directory');
const modelHome=arg('--model-home',null),fixture=join(root,'scripts/fixtures/dsh-acceptance');
mkdirSync(workspace,{recursive:true});
const report={schema:1,startedAt:new Date().toISOString(),scope:'isolated-real-dsh-web-native-muted-local-media',
 realPlatformAudio:'not_executed',nativeDesktop:'not_executed',checks:[],phases:[],modelHomeUnchanged:null};
const digest=p=>existsSync(p)?createHash('sha256').update(readFileSync(p)).digest('hex'):null;
const protectedPaths=modelHome?[join(modelHome,'profiles/desktop/cordis.patch.yml'),join(modelHome,'.credentials.yaml')]:[];
const before=protectedPaths.map(digest);
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const check=(name,ok,detail)=>{report.checks.push({name,status:ok?'passed':'failed',detail});save();if(!ok)process.exitCode=1;console.log(`${ok?'PASS':'FAIL'} ${name}`);};
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_DESKTOP_NODE_EXECUTABLE:runtimeNode,
 FISHFM_ACCEPTANCE_MEDIA:join(out,'silent.wav'),FISHFM_ACCEPTANCE_WORKSPACE:workspace,FISHFM_PLAYBACK_WARM_HOLDERS:'0'};
function command(args,{timeout=60000}={}){
 const r=spawnSync(runtimeNode,args,{env,windowsHide:true,encoding:'utf8',timeout,maxBuffer:4*1024*1024});
 if(r.status!==0)throw new Error(`Acceptance subprocess failed (${r.status??r.error?.code}); inspect private logs`);
 return r.stdout;
}
let host,log='',baseUrl,auth,cookie;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,{timeout=30000,interval=250}={}){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await pause(interval);}throw new Error('Acceptance condition timed out');}
async function rpc(method,payload={}){
 const u=new URL(`/api/${method}`,baseUrl);
 const response=await fetch(u,{method:'POST',headers:{'content-type':'application/json',cookie},
  body:JSON.stringify(method==='fishfm-acceptance'?payload:{type:'client-request',rpcId:crypto.randomUUID(),method,payload}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`RPC ${method}: HTTP ${response.status}`);
 const json=await response.json(),result=json.result??json;if(!result.ok)throw new Error(`RPC ${method}: ${result.error?.code}: ${result.error?.message}`);return result.value;
}
const probe=payload=>rpc('fishfm-acceptance',payload),state=()=>rpc('fishfm/state');
const control=(type,value)=>rpc('fishfm/command',{type,...(value===undefined?{}:{value})});
function dbSummary(){
 const code=`const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(join(home,'fishfm/music.sqlite'))},{readOnly:true});console.log(JSON.stringify({history:db.prepare('SELECT * FROM listen_history').all(),jobs:db.prepare('SELECT entry_json,result_json FROM growth_jobs').all().map(r=>({entry:JSON.parse(r.entry_json),result:r.result_json?JSON.parse(r.result_json):null})),sessionInfluence:db.prepare('SELECT * FROM session_influence').all(),calls:db.prepare('SELECT * FROM music_model_calls').all()}));db.close();`;
 return JSON.parse(command(['-e',code]));
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
function processTree(parent){
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'],{windowsHide:true,encoding:'utf8',timeout:15000});
 if(r.status!==0)throw new Error('Process tree query failed');
 const rows=JSON.parse(r.stdout),ids=new Set([parent]);
 for(let n=0;n<8;n++)for(const p of rows)if(ids.has(p.ParentProcessId))ids.add(p.ProcessId);
 return rows.filter(p=>ids.has(p.ProcessId)).map(p=>({pid:p.ProcessId,parentPid:p.ParentProcessId,name:p.Name}));
}
try{
 const setup=command([join(fixture,'setup.cjs'),runtime,home,root,...(modelHome?[modelHome]:[])]);
 report.setup=JSON.parse(setup.trim().split('\n').at(-1));
 const install=command([join(runtime,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'plugin','--profile','fishfm-acceptance','add',root,'--offline']);
 writeFileSync(join(out,'install.log'),install);
 writeTone({path:env.FISHFM_ACCEPTANCE_MEDIA,seconds:16,amplitude:0});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 host=spawn(runtimeNode,[join(runtime,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','fishfm-acceptance','--patch',join(home,'acceptance.patch.yml'),'--no-open','--port',String(port)],{env,cwd:workspace,windowsHide:true,stdio:['pipe','pipe','pipe']});
 for(const stream of[host.stdout,host.stderr])stream.on('data',b=>{log+=b.toString();writeFileSync(join(out,'host.log'),log);});
 await until(()=>{const match=log.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s\u001b]*/);if(!match)return false;const url=new URL(match[0]);baseUrl=url.origin;auth=url.searchParams.get('token')??url.searchParams.get('auth');return auth;});
 check('isolated host started without opening a browser',true,{pid:host.pid});
 const exchange=await fetch(`${baseUrl}/?token=${encodeURIComponent(auth)}`,{redirect:'manual'});
 cookie=exchange.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 if(!cookie)throw new Error('DSH launch-token exchange returned no authenticated cookie');
 const ready=await until(async()=>{try{return await state();}catch(e){report.lastRpcError=e.message;save();return null;}},{timeout:45000});
 check('authenticated FishFM RPC and Core ready',Boolean(ready.snapshot));
 report.initialProbe=await probe({op:'status'});save();
 console.log('READY_FOR_ACCEPTANCE');
 // The remainder is deliberately driven by real RPCs and Session objects.
 await control('setHumanPlayback',false);await control('setDiscovery',false);await control('setDiscoveryRate',0);
 const a=await probe({op:'create'}),b=await probe({op:'create'});
 report.sessionIds=[a.id,b.id];save();
 check('two real host Sessions expose distinct stable id fields',a.id!==b.id&&a.identityField==='id'&&b.identityField==='id');
 await control('chooseSelf');
 const playing=await until(async()=>{const s=(await state()).snapshot;return s.current&&s.status==='playing'?s:null;},{timeout:45000});
 check('native muted playback starts',playing.current&&playing.settings.humanPlayback===false,{status:playing.status});
 const quietBefore=(await probe({op:'status'})).calls.length;
 await control('next');await until(async()=>(await state()).snapshot.status==='playing',{timeout:45000});
 await control('pause');await control('resume');await until(async()=>(await state()).snapshot.status==='playing',{timeout:15000});
 check('local next pause resume add zero LLM service calls',(await probe({op:'status'})).calls.length===quietBefore);
 const beforeHidden=(await state()).snapshot.current.playInstanceId;await pause(1500);
 check('playback continues with no browser client connected',(await state()).snapshot.current.playInstanceId===beforeHidden);
 if(modelHome){
  // Sessions run concurrently while native playback is active.
  const current=(await state()).snapshot.current.playInstanceId;
  await Promise.all([probe({op:'prompt',sessionId:a.id}),probe({op:'prompt',sessionId:b.id})]);
  const ended=await until(async()=>{const p=await probe({op:'status'});return p.sessions.every(s=>s.turnsEnded>0)?p:null;},{timeout:120000});
  report.concurrent=ended;save();
  check('two real Agent turns overlap and finish with final text',ended.calls.length===2&&ended.calls.every(c=>c.completed&&c.finalText&&c.finish?.kind==='stop')&&ended.calls[1].startedAt<ended.calls[0].finishedAt);
  check('real concurrent Sessions do not replace current playback',(await state()).snapshot.current.playInstanceId===current);
  await control('pause');
  await probe({op:'prompt',sessionId:b.id});
  await until(async()=>(await probe({op:'status'})).sessions.find(s=>s.id===b.id).turnsEnded>=2,{timeout:120000});
  check('pause remains after real Session turn',(await state()).snapshot.paused===true);
  report.enabledProbe=await probe({op:'status'});save();
 }else report.modelComparison='not_executed_no_model_home';
 // A real native progress interval, followed by an ordinary user next command.
 const growthBefore=dbSummary();
 await control('next');await control('resume');
 await until(async()=>(await state()).snapshot.status==='playing',{timeout:20000});
 const nativeStart=Date.now();
 await pause(9500);
 await control('next');
 await until(async()=>dbSummary().jobs.some(j=>!growthBefore.jobs.some(old=>old.entry.playInstanceId===j.entry.playInstanceId)&&j.result?.updated),{timeout:20000});
 await control('pause');
 const grown=dbSummary();report.growth={realElapsedMs:Date.now()-nativeStart,before: growthBefore,after:grown};save();
 const newGrowth=grown.jobs.filter(j=>!growthBefore.jobs.some(old=>old.entry.playInstanceId===j.entry.playInstanceId)&&j.result?.updated);
 check('native measured progress produces one bounded silent growth application',newGrowth.length===1&&newGrowth[0].entry.audible===false&&newGrowth[0].entry.agentEffectiveMs>=8000&&newGrowth[0].result.delta<=0.03);
 check('instant switch does not create qualifying growth',grown.jobs.some(j=>j.entry.agentEffectiveMs<1000&&j.result?.updated===false));
 if(modelHome)check('native growth keeps the real transient Session attribution and reduced weight',grown.jobs.some(j=>j.result?.updated&&report.sessionIds.includes(j.entry.sessionId)&&j.entry.sessionTransient===true&&j.result.delta>0&&j.result.delta<=0.004501)&&grown.sessionInfluence.length>0);
 if(modelHome){
  const beforeCalls=(await probe({op:'status'})).calls.length;
  const selection=report.initialProbe.defaultModel;
  await rpc('fishfm/persona-output',{value:2048});
  let summary,errorCode=null;
  try{summary=await rpc('fishfm/persona-summary',selection);}
  catch(e){errorCode=e.message.match(/RPC fishfm\/persona-summary: ([\w-]+)/)?.[1]||'unknown';}
  const ledger=dbSummary().calls;
  report.manualSummary={returned:!!summary,errorCode,ledger,serviceCallsAdded:(await probe({op:'status'})).calls.length-beforeCalls};
  check('explicit summary success or failure is attributed to exactly one ledger entry and model call',ledger.length===1&&['completed','failed'].includes(ledger[0].status)&&ledger[0].usage_json!==null&&report.manualSummary.serviceCallsAdded===1);
 }
 // A missing native media file must not create a positive listening signal.
 const failureBefore=dbSummary();
 await rpc('fishfm/command',{type:'requestTrack',track:{provider:'netease',providerTrackId:'acceptance-broken',title:'Missing fixture',artist:'Fixture',durationMs:16000}});
 await control('resume');
 await until(async()=>{const s=(await state()).snapshot;return s.lastError||s.status==='error';},{timeout:20000});
 await control('pause');
 const failureAfter=dbSummary();report.nativeFailure={beforeJobs:failureBefore.jobs.length,afterJobs:failureAfter.jobs.length,error:(await state()).snapshot.lastError};save();
 check('native media failure creates no positive growth',failureAfter.jobs.filter(j=>j.result?.updated).length===failureBefore.jobs.filter(j=>j.result?.updated).length);
 // Disable through the real Loader, then inspect processes and on-disk evidence.
 await until(()=>{const p=join(home,'fishfm/runtime/core.json');return existsSync(p);});
 const corePid=JSON.parse(readFileSync(join(home,'fishfm/runtime/core.json'))).pid;
 const ownedProcesses=processTree(corePid);report.ownedProcesses=ownedProcesses;save();
 const beforeDisable=dbSummary();
 await probe({op:'toggle',disabled:true});
 await until(()=>ownedProcesses.every(p=>!alive(p.pid)),{timeout:20000});
 check('disabling the real plugin stops Core and all native audio children',ownedProcesses.length>=2&&ownedProcesses.every(p=>!alive(p.pid)));
 check('normal plugin teardown persists closed runtime evidence',['core','adapter'].every(n=>JSON.parse(readFileSync(join(home,`fishfm/runtime/${n}.json`))).closed===true));
 report.disabledProbe=await probe({op:'status'});save();
 if(modelHome){
  const c=await probe({op:'create'}),beforeOff=(await probe({op:'status'})).calls.length;
  await probe({op:'prompt',sessionId:c.id});
  await until(async()=>(await probe({op:'status'})).sessions.find(s=>s.id===c.id).turnsEnded>=1,{timeout:120000});
  const afterOff=await probe({op:'status'}),offCalls=afterOff.calls.slice(beforeOff);
  report.disabledComparison={calls:offCalls};
  check('disabled plugin contributes no music tools to an equivalent real task',offCalls.length===1&&offCalls[0].musicToolCount===0&&offCalls[0].finalText);
  check('enabled tools remain static and dynamic music state is absent',report.enabledProbe.calls.every(c=>c.musicToolCount===3&&c.musicToolFingerprint===report.enabledProbe.calls[0].musicToolFingerprint&&c.context.every(m=>!m.dynamicMusicMarkers))&&report.enabledProbe.sessions.every(s=>s.dynamicMusicMarkers===0));
 }
 await probe({op:'toggle',disabled:false});
 const reopened=await until(async()=>{try{return await state();}catch{return null;}},{timeout:30000});
 check('reenabling retains user pause and persisted growth',reopened.snapshot.paused===true&&dbSummary().jobs.length===beforeDisable.jobs.length);
 const newCorePid=JSON.parse(readFileSync(join(home,'fishfm/runtime/core.json'))).pid;
 check('reenabling creates one fresh Core',newCorePid!==corePid&&alive(newCorePid));
 report.beforeShutdown=dbSummary();save();
 await probe({op:'toggle',disabled:true});
 await until(()=>!alive(newCorePid),{timeout:15000});
 await probe({op:'shutdown'});
 await until(()=>host.exitCode!==null,{timeout:15000});
 check('isolated host shuts down',host.exitCode===0,{exitCode:host.exitCode});
}catch(error){report.error={name:error.name,message:error.message};save();console.error(error.message);process.exitCode=1;}
finally{
 if(host&&host.exitCode===null){
  try{if(cookie){await probe({op:'toggle',disabled:true});await probe({op:'shutdown'});await until(()=>host.exitCode!==null,{timeout:10000});}}
  catch{/* Only the isolated process started above may be stopped here. */}
  if(host.exitCode===null){host.kill();await pause(1000);}
 }
 report.modelHomeUnchanged=protectedPaths.every((p,i)=>digest(p)===before[i]);
 report.finishedAt=new Date().toISOString();
 // Credentials copied for this explicit run are disposable; retain no keys.
 rmSync(join(home,'.credentials.yaml'),{force:true});
 rmSync(join(home,'acceptance.patch.yml'),{force:true});
 rmSync(join(out,'silent.wav'),{force:true});
 save();
 console.log(JSON.stringify({checks:report.checks.map(c=>({name:c.name,status:c.status})),error:report.error??null,modelHomeUnchanged:report.modelHomeUnchanged}));
}
