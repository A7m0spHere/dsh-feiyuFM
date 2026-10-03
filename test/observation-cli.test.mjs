import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
test('forced observer termination retains a readable checkpoint and its running status',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'fm-observe-')),out=join(directory,'saved.json');
 // Fixture reports exercise file retention only; this is not playback evidence.
 for(const name of ['core','adapter'])writeFileSync(join(directory,`${name}.json`),JSON.stringify({runId:name,mode:'real',updatedAt:Date.now(),sequence:0,events:[],samples:[],counts:{}}));
 const child=spawn(process.execPath,['scripts/observe-runtime.mjs','--directory',directory,'--seconds','60','--out',out],{stdio:'ignore',windowsHide:true});
 const exit=new Promise(resolve=>child.once('exit',resolve));
 try{
  const deadline=Date.now()+5000;while(!existsSync(out)&&Date.now()<deadline)await delay(50);
  assert.equal(existsSync(out),true);child.kill('SIGKILL');await exit;
  const report=JSON.parse(readFileSync(out,'utf8'));assert.equal(report.status,'running');assert.equal(report.initial.components.core.runId,'core');assert.equal(report.a09Passed,null);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}rmSync(directory,{recursive:true,force:true});}
});
