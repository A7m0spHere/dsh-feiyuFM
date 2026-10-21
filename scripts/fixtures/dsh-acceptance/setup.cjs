// Run through the installed Electron-as-Node runtime to resolve bundled modules.
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const [runtime,home,repo,modelHome]=process.argv.slice(2);
const req=createRequire(path.join(runtime,'package.json'));
const yaml=req('js-yaml');
(async()=>{
 const {initializeProfileFromDefault}=await import(pathToFileURL(path.join(runtime,'node_modules/@deepseek-ai/dsh/lib/profile-boot.js')));
 if(!fs.existsSync(path.join(home,'profiles/fishfm-acceptance/package.json')))
  await initializeProfileFromDefault('fishfm-acceptance','web',home);
 const patch=[{id:'fishfm',config:{database:path.join(home,'fishfm/music.sqlite'),playback:'real',provider:'fake',coreEntry:path.join(repo,'scripts/fixtures/dsh-acceptance/core.mjs')}},
  {id:'session-title-llm',disabled:true},
  {insert:[{id:'fishfm-acceptance-probe',name:pathToFileURL(path.join(repo,'scripts/fixtures/dsh-acceptance/probe.mjs')).href}]}];
 let selected=null;
 if(modelHome){
  const rows=yaml.load(fs.readFileSync(path.join(modelHome,'profiles/desktop/cordis.patch.yml'),'utf8').replace(/!!js/g,''));
  const selection=rows.find(r=>r.id==='agent-default-model')?.config;
  const profiles=rows.find(r=>r.id==='llm-pi-ai')?.config?.providers;
  if(selection&&profiles?.[selection.provider]){
   selected={provider:selection.provider,model:selection.model};
   patch.push({id:'agent-default-model',config:selected},{id:'llm-pi-ai',config:{providers:{[selection.provider]:profiles[selection.provider]}}});
   const credentials=path.join(modelHome,'.credentials.yaml');
   if(fs.existsSync(credentials)){
    const original=yaml.load(fs.readFileSync(credentials,'utf8'));
    const ref=profiles[selection.provider].apiKeyEnv;
    const refs=ref&&Object.hasOwn(original.refs||{},ref)?{[ref]:original.refs[ref]}:{};
    // Copy only the selected route's API-key reference; never copy account,
    // browser-session or unrelated provider credential records.
    fs.writeFileSync(path.join(home,'.credentials.yaml'),yaml.dump({version:original.version,refs,records:{}}));
   }
  }
 }
 fs.writeFileSync(path.join(home,'acceptance.patch.yml'),yaml.dump(patch));
 const pkg=JSON.parse(fs.readFileSync(path.join(runtime,'node_modules/@deepseek-ai/dsh/package.json')));
 console.log(JSON.stringify({initialized:true,selected,runtimeVersion:pkg.version,runtimeNode:process.version,credentialValuesPrinted:false}));
})().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
