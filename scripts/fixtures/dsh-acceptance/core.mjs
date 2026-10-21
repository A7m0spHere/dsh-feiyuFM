// Native, muted playback over generated local media. No platform account is used.
import {dirname,join} from 'node:path';
import {runCoreHost,createProviderFacade,ProviderRegistry} from '../../../src/core-host.mjs';
import {mergeApprovedFilter} from '../../../src/approved-pool.mjs';
import {createHash} from 'node:crypto';
import {MusicStore} from '../../../src/storage.mjs';
import {FakeProvider} from '../../../src/fakes.mjs';
import {importSeedTracks} from '../../../src/environment.mjs';
import {initializeAgentPreferences} from '../../../src/taste.mjs';
import {createRuntimeEvidence} from '../../../src/runtime/evidence.mjs';

const db=process.argv[process.argv.indexOf('--db')+1];
if(!db||!process.env.FISHFM_ACCEPTANCE_MEDIA)throw new Error('Explicit isolated database and media are required');
const store=new MusicStore(db),provider=new FakeProvider();
const repeatPolicy=process.env.FISHFM_ACCEPTANCE_REPEAT_POLICY==='1';
const tracks=Array.from({length:12},(_,i)=>({provider:'netease',providerTrackId:`acceptance-${i+1}`,title:`Acceptance ${i+1}`,artist:`Fixture ${i+1}`,durationMs:16000}));
for(const t of tracks)provider.set(t,process.env.FISHFM_ACCEPTANCE_MEDIA);
provider.set({provider:'netease',providerTrackId:'acceptance-broken'},join(dirname(db),'missing.wav'));
if(store.listEnvironment().length===0){
 importSeedTracks({store,provider:'netease',source:'liked',requested:tracks.length,tracks,now:Date.now()});
 initializeAgentPreferences({store,seed:21});
 store.setSetting('recommendation_mode_v1','legacy');
 store.setSetting('recommendation_pipeline_v1',1);
}
let facade,registry;
if(repeatPolicy){
 const owner='netease:authorized:acceptance-fixture',hash=createHash('sha256').update(owner).digest('hex'),at=Date.now();
 store.setSetting('recommendation_mode_v1','filtered');
 store.setSetting('summary_daily_tokens',0);
 const cached=tracks.map(t=>({...t,discovery:{source:'netease_similar',seedTrackKey:'netease:acceptance-1',fetchedAt:at,expiresAt:at+21600000}}));
 if(!store.getSetting('filtered_playback_pool_v1',null)){
  store.setSetting('discovery_cache_v1',{owner,candidateRevision:'acceptance-candidates',entries:cached,lastAttemptAt:at,lastSuccessAt:at,nextAttemptAt:at+1800000});
  for(let batch=0;batch<2;batch++){
   const selected=cached.slice(batch*6,batch*6+6);
   const filter={source:'llm-discovery-filter',candidateOwner:hash,candidateRevision:'acceptance-candidates',callId:`acceptance-batch-${batch}`,generatedAt:at,
    tracks:selected,picks:selected.map((t,i)=>({trackKey:`netease:${t.providerTrackId}`,rank:i+1,reason:'Synthetic acceptance approval'}))};
   mergeApprovedFilter(store,filter,at);store.setSetting('discovery_filter_v1',filter);
  }
 }
 registry=new ProviderRegistry({providers:{netease:{getAccount:()=>({status:'authorized',accountId:'acceptance-fixture'}),getCapabilities:()=>({}),getDiscoveryTracks:async()=>cached}}});
 facade=createProviderFacade({store,registry});
}
const evidence=createRuntimeEvidence({directory:join(dirname(db),'runtime'),mode:'synthetic',
 metadata:{nativeAudio:'wpf',provider:'local-fixture',generatedSilentMedia:true}});
try{await runCoreHost({store,dbPath:db,playbackMode:'real',provider,...(facade?{platformsFacade:facade,providerRegistry:registry}:{}),onLog:e=>evidence.event(e)});}
finally{evidence.close();store.close();}
