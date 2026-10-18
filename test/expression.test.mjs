import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicStore} from '../src/storage.mjs';
import {EXPRESSION_KEY,EXPRESSION_STYLES,expressionView,setExpressionStyle,formatExpression} from '../src/expression.mjs';
import {describeMusicInsights,explainSelection} from '../src/insights.mjs';
import {factBundle} from '../src/persona.mjs';
import {importSeedTracks} from '../src/environment.mjs';
import {initializeAgentPreferences} from '../src/taste.mjs';
import {setTrackFeedback,resetRecommendationTaste,undoRecommendationReset} from '../src/feedback.mjs';
import {createCoreHost} from '../src/core-host.mjs';
import {createSettingsHandler} from '../src/ui/dsh-settings.mjs';

const track={provider:'netease',providerTrackId:'1',title:'Synthetic',artist:'Synthetic artist',durationMs:100000};
const snapshot={paused:false,status:'playing',settings:{listening:true,humanPlayback:true,discovery:true,discoveryRate:.2,strategy:'normal'},
  current:{track,selectedBy:'agent',decisionId:'fixed',origin:{source:'netease_similar'}}};
const tables=['tracks','user_environment','environment_sources','agent_preferences','user_track_feedback','listen_history','session_influence','music_model_calls','core_state','constraints'];
const data=store=>Object.fromEntries(tables.map(name=>[name,store.db.prepare(`SELECT * FROM ${name}`).all()]));
function seed(store){
  importSeedTracks({store,provider:'netease',source:'playlist',tracks:[track],requested:1,now:1000});
  initializeAgentPreferences({store,seed:1,now:1000});setTrackFeedback(store,track,1,1000);
  store.setCoreState({settings:snapshot.settings,paused:true,current:null});
}

test('an old database defaults to exactly the existing wording without writing a new setting',()=>{
  const store=new MusicStore();try{
    const before=store.db.prepare('SELECT total_changes() n').get().n;
    const view=expressionView(store),insights=describeMusicInsights(store,snapshot,1000);
    assert.equal(view.style,'current');assert.equal(view.revision,0);assert.equal(view.available,true);
    assert.equal(insights.explanation.text,explainSelection(snapshot).text);
    assert.equal(insights.reply.text,'这次想试一首相近的新歌。网易云把它与《已有歌曲》关联，我再按本地偏好与重复限制选中了它。');
    assert.equal(store.getSetting(EXPRESSION_KEY),null);
    assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
  }finally{store.close();}
});

test('style changes affect wording only, not preferences, playback, feedback or any model facts',()=>{
  const store=new MusicStore();try{
    seed(store);const before=data(store),settings=store.db.prepare('SELECT * FROM settings ORDER BY key').all();
    const purposes=['persona-summary','model-recommendations','discovery-filter'];
    const bundles=purposes.map(p=>factBundle(store,snapshot,p,[track]));
    setExpressionStyle(store,'concise',0);
    assert.deepEqual(data(store),before);
    assert.deepEqual(store.db.prepare('SELECT * FROM settings WHERE key!=? ORDER BY key').all(EXPRESSION_KEY),settings);
    assert.deepEqual(purposes.map(p=>factBundle(store,snapshot,p,[track])),bundles);
    const insights=describeMusicInsights(store,snapshot,1000);
    assert.equal(insights.reply.text,'平台相似推荐，本地规则选曲。');
    assert.equal(insights.reply.variants.current.includes('网易云把它'),true);
  }finally{store.close();}
});

test('optimistic revisions protect other windows and restoring defaults cannot reset the revision',()=>{
  const store=new MusicStore();try{
    assert.equal(setExpressionStyle(store,'lively',0).revision,1);
    assert.throws(()=>setExpressionStyle(store,'concise',0),{code:'expression_conflict'});
    assert.equal(expressionView(store).style,'lively');
    assert.equal(setExpressionStyle(store,'current',1).revision,2);
    assert.equal(setExpressionStyle(store,'current',2).revision,2);
    assert.throws(()=>setExpressionStyle(store,'lively',0),{code:'expression_conflict'});
  }finally{store.close();}
});

test('closed presets reject arbitrary prompts, paths and invalid revision values before writes',()=>{
  const store=new MusicStore();try{
    for(const style of ['../../AGENTS.md','https://example.invalid','x'.repeat(5000),null,{},'neutral'])assert.throws(()=>setExpressionStyle(store,style,0),{code:'invalid_expression'});
    for(const rev of [-1,NaN,Infinity,'0',null])assert.throws(()=>setExpressionStyle(store,'current',rev),{code:'invalid_expression'});
    assert.equal(store.getSetting(EXPRESSION_KEY),null);
  }finally{store.close();}
});

test('file reopen and music preference reset preserve the independent expression setting',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fishfm-expression-')),path=join(dir,'music.sqlite');
  let store=new MusicStore(path);try{
    seed(store);setExpressionStyle(store,'concise',0);store.close();store=new MusicStore(path);
    assert.equal(expressionView(store).style,'concise');
    resetRecommendationTaste(store,snapshot,{clearFeedback:true,now:2000});undoRecommendationReset(store);
    assert.equal(expressionView(store).style,'concise');assert.equal(expressionView(store).revision,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('unsupported saved versions fall back safely for display without overwriting future data',()=>{
  const store=new MusicStore();try{
    const saved={version:99,style:'custom',privateField:'preserve'};store.setSetting(EXPRESSION_KEY,saved);
    assert.equal(expressionView(store).available,false);assert.equal(expressionView(store).style,'current');
    assert.throws(()=>setExpressionStyle(store,'concise',0),{code:'unsupported_expression'});
    assert.deepEqual(store.getSetting(EXPRESSION_KEY),saved);
  }finally{store.close();}
});

test('preset wording respects pause, listening-off, mute and uncertainty instead of inventing experience',()=>{
  for(const style of EXPRESSION_STYLES.filter(s=>s!=='current')){
    assert.match(formatExpression(style,'related','original',{...snapshot,paused:true}),/停|暂停/);
    assert.match(formatExpression(style,'related','original',{...snapshot,settings:{...snapshot.settings,listening:false}}),/自主听歌已关闭/);
    assert.match(formatExpression(style,'related','original',{...snapshot,settings:{...snapshot.settings,humanPlayback:false}}),/^静音播放/);
    assert.match(formatExpression(style,'related','original',{...snapshot,lastError:{code:'failed'}}),/没完成|未成功/);
    assert.equal(formatExpression(style,'llm-picked','UNVERIFIED_AUDIO_CLAIM',snapshot).includes('UNVERIFIED'),false);
    assert.equal(formatExpression(style,'legacy','original',snapshot).includes('旧版'),true);
  }
});

test('authenticated expression endpoint strips unrelated fields and rejects malformed input before Core starts',async()=>{
  let starts=0,sent=null;
  const api=createSettingsHandler({async start(){starts++;},async request(m){sent=m;return{expression:{version:1,style:m.style,revision:1}};}});
  assert.equal((await api('fishfm/expression-style',{style:'custom-prompt',expectedRevision:0})).error.code,'invalid_expression');
  assert.equal(starts,0);
  assert.equal((await api('fishfm/expression-style',{style:'lively',expectedRevision:0,cookie:'must-drop',prompt:'must-drop'})).ok,true);
  assert.deepEqual(sent,{type:'expression-style',style:'lively',expectedRevision:0});
});

test('the real Core host style route writes no playback state or model ledger entries',async()=>{
  const store=new MusicStore(),messages=[],host=createCoreHost({store,playbackMode:'fake',output:{write:line=>messages.push(JSON.parse(line))}});
  try{
    await host.start();const before=data(store),state=host.snapshot();
    await host.handle({type:'expression-style',id:'style',style:'lively',expectedRevision:0});
    const result=messages.find(m=>m.id==='style');assert.equal(result.expression.style,'lively');
    assert.deepEqual(data(store),before);assert.equal(host.snapshot().paused,state.paused);
    assert.equal(host.snapshot().commandVersion,state.commandVersion);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM music_model_calls').get().n,0);
  }finally{await host.close();store.close();}
});
