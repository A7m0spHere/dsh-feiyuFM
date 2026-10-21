// Native, muted playback over generated local media. No platform account is used.
import {dirname,join} from 'node:path';
import {runCoreHost} from '../../../src/core-host.mjs';
import {MusicStore} from '../../../src/storage.mjs';
import {FakeProvider} from '../../../src/fakes.mjs';
import {importSeedTracks} from '../../../src/environment.mjs';
import {initializeAgentPreferences} from '../../../src/taste.mjs';
import {createRuntimeEvidence} from '../../../src/runtime/evidence.mjs';

const db=process.argv[process.argv.indexOf('--db')+1];
if(!db||!process.env.FISHFM_ACCEPTANCE_MEDIA)throw new Error('Explicit isolated database and media are required');
const store=new MusicStore(db),provider=new FakeProvider();
const tracks=Array.from({length:12},(_,i)=>({provider:'netease',providerTrackId:`acceptance-${i+1}`,title:`Acceptance ${i+1}`,artist:`Fixture ${i+1}`,durationMs:16000}));
for(const t of tracks)provider.set(t,process.env.FISHFM_ACCEPTANCE_MEDIA);
provider.set({provider:'netease',providerTrackId:'acceptance-broken'},join(dirname(db),'missing.wav'));
if(store.listEnvironment().length===0){
 importSeedTracks({store,provider:'netease',source:'liked',requested:tracks.length,tracks,now:Date.now()});
 initializeAgentPreferences({store,seed:21});
 store.setSetting('recommendation_mode_v1','legacy');
 store.setSetting('recommendation_pipeline_v1',1);
}
const evidence=createRuntimeEvidence({directory:join(dirname(db),'runtime'),mode:'synthetic',
 metadata:{nativeAudio:'wpf',provider:'local-fixture',generatedSilentMedia:true}});
try{await runCoreHost({store,dbPath:db,playbackMode:'real',provider,onLog:e=>evidence.event(e)});}
finally{evidence.close();store.close();}
