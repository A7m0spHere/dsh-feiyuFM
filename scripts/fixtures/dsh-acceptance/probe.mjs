// Mounted ONLY by the isolated acceptance profile. Never included in npm files.
import {createHash,randomUUID} from 'node:crypto';
export const name='fishfm-acceptance-probe';
export const inject=['connection','sessions','sessionController','llm'];
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const musicNames=new Set(['fishfm_status','fishfm_control','fishfm_request_track']);
export function apply(ctx){
 const calls=[],sessions=new Map(),observed=new Map();
 ctx.on('session/event',(session,event)=>{
  const events=observed.get(session.id)||[];
  events.push({type:event.type,seq:event.seq,at:event.time,
   dynamicMusicMarkers:['system/message','developer/message'].includes(event.type)&&/playInstanceId|effectiveMs|agentEffectiveMs|currentTrack|selectionPool/.test(JSON.stringify(event.data))});
  observed.set(session.id,events);
 });
 const describeSession=s=>{
  const events=observed.get(s.id)||[];
  return{id:s.id,identityField:'id',eventTypes:events.map(e=>e.type),turnsStarted:events.filter(e=>e.type==='turn/start').length,
   turnsEnded:events.filter(e=>e.type==='turn/end').length,
   dynamicMusicMarkers:events.filter(e=>e.dynamicMusicMarkers).length};
 };
 ctx.on('llm/stream',(options,next)=>{
  const tools=(options.tools||[]).filter(t=>musicNames.has(t.name));
  const messages=(options.messages||[]).filter(m=>['system','developer'].includes(m.role));
  const entry={startedAt:Date.now(),musicToolCount:tools.length,musicToolBytes:Buffer.byteLength(JSON.stringify(tools)),musicToolFingerprint:hash(tools),
   context:messages.map(m=>({role:m.role,bytes:Buffer.byteLength(JSON.stringify(m)),fingerprint:hash(m),
    dynamicMusicMarkers:/playInstanceId|effectiveMs|agentEffectiveMs|currentTrack|selectionPool/.test(JSON.stringify(m))})),
   completed:false,finalText:false,usage:null,finish:null};
  calls.push(entry);
  const source=next();
  return(async function*(){try{for await(const chunk of source){
   if(chunk.type==='text-delta'&&typeof chunk.text==='string'&&chunk.text.trim())entry.finalText=true;
   if(chunk.type==='block-end'&&chunk.block?.type==='text'&&chunk.block.text?.trim())entry.finalText=true;
   if(chunk.type==='usage')entry.usage=chunk.usage;
   if(chunk.type==='finish')entry.finish=chunk.reason;
   yield chunk;
  }}finally{entry.completed=true;entry.finishedAt=Date.now();}})();
 });
 async function dispatch(m){
  if(m.op==='status')return{calls,sessions:[...sessions.values()].map(describeSession),
   entries:[...ctx.loader.entries()].filter(e=>e.options.id==='fishfm').map(e=>({id:e.id,disabled:e.options.disabled===true,state:e.fiber?.state})),
   defaultModel:ctx.get('agentDefaultModel')?.currentSelection(),providers:ctx.llm.listProviders().map(p=>({id:p.id,name:p.name}))};
  if(m.op==='create'){
   const result=await ctx.sessionController.commands.create({cwd:process.env.FISHFM_ACCEPTANCE_WORKSPACE,agentPreset:'standard'});
   const s=ctx.sessions.get(result.sessionId);sessions.set(s.id,s);return describeSession(s);
  }
  if(m.op==='prompt'){
   if(!sessions.has(m.sessionId))throw new Error('Only acceptance sessions may be prompted');
   return ctx.sessionController.commands.prompt({sessionId:m.sessionId,requestId:randomUUID(),content:[{type:'text',text:'Reply with exactly OK. Do not call tools.'}],mode:'followup'},{kind:'user'});
  }
  if(m.op==='toggle'){
   const e=[...ctx.loader.entries()].find(e=>e.options.id==='fishfm');
   if(!e)throw new Error('Acceptance FishFM entry missing');
   await e.update({...e.options,disabled:m.disabled===true});
   return{disabled:e.options.disabled};
  }
  if(m.op==='shutdown'){
   setTimeout(()=>process.exit(0),100).unref();return{accepted:true,kind:'process-exit-after-plugin-disable'};
  }
  throw new Error('Unknown acceptance operation');
 }
 ctx.effect(()=>ctx.connection.fetch.register({path:'/api/fishfm-acceptance',methods:['POST'],requestBody:'buffered',
  async fetch(request){try{return Response.json({ok:true,value:await dispatch(await request.json())});}
   catch(e){return Response.json({ok:false,error:{code:e.code||e.name,message:e.message}});}}}), 'isolated acceptance control');
}
