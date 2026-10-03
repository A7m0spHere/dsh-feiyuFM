#!/usr/bin/env node
// Read-only reconciliation against the existing database; never instantiate Core.
import {readFileSync,writeFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {homedir} from 'node:os';import {join,resolve} from 'node:path';
import {auditObservation} from '../src/runtime/audit.mjs';import {qualifiesAsListen} from '../src/growth.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const path=value('--report',null);if(!path)throw new Error('Pass --report <real observation JSON>');
const report=JSON.parse(readFileSync(resolve(path),'utf8'));
const db=new DatabaseSync(resolve(value('--database',join(homedir(),'.dsh','fishfm','music.sqlite'))),{readOnly:true,timeout:2000});
let history=[];
try{history=db.prepare('SELECT entry_json,result_json FROM growth_jobs').all().map(row=>{
 const entry=JSON.parse(row.entry_json),growth=row.result_json?JSON.parse(row.result_json):null;
 return{playInstanceId:entry.playInstanceId,agentEffectiveMs:entry.agentEffectiveMs??0,selectionPool:entry.selectionPool,
  qualifies:qualifiesAsListen({entry,durationMs:entry.durationMs}).qualifies,growth};
});}finally{db.close();}
const result=auditObservation(report,history),out=value('--out',null);
if(out)writeFileSync(resolve(out),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
