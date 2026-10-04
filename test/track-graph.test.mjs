// 个人相似图：歌单共现/艺人重合/播放序列三类边权，以及它在种子选择与选歌评分里的作用。
import test from 'node:test';import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';
import {importSeedTracks} from '../src/environment.mjs';
import {buildTrackGraph,createTrackGraphCache} from '../src/track-graph.mjs';
import {selectRecommendationSeeds} from '../src/recommendation.mjs';
import {createSelector} from '../src/selection.mjs';
import {factBundle} from '../src/persona.mjs';
import {STRATEGY_PURPOSE} from '../src/model-recommendations.mjs';

const t=(id,title='Song '+id,artist='Artist '+id)=>({provider:'netease',providerTrackId:String(id),title,artist,durationMs:100000});

function graphStore(){
  const store=new MusicStore();
  // 曲 1 与曲 5 同艺人；三首进近期来源，1/2/3 同歌单 A，2/3/4 同歌单 B。
  importSeedTracks({store,provider:'netease',source:'recent',
    tracks:[t(1,'Song 1','SameArtist'),t(2),t(3),t(4),t(5,'Song 5','SameArtist')],requested:5,now:1000});
  for(const [ref,ids] of [['pl-A',[1,2,3]],['pl-B',[2,3,4]]]){
    for(const id of ids)store.recordEnvironmentSource({track:t(id),source:'playlist',sourceRef:ref},1000);
  }
  return store;
}

test('playlist co-membership, artist overlap and play sequence create weighted edges',()=>{
  const store=graphStore();try{
    const graph=buildTrackGraph(store,{});
    assert.equal(graph.size,5);
    assert.equal(graph.similarity('netease:2','netease:3'),1,'两张共享歌单的边权封顶为 1');
    assert.ok(graph.similarity('netease:1','netease:2')>=1,'同歌单直接成边');
    assert.ok(graph.similarity('netease:1','netease:5')>0&&graph.similarity('netease:1','netease:5')<1,'同艺人只有部分边权');
    assert.equal(graph.similarity('netease:1','netease:4'),0,'无共享信号的曲目对无边');
    assert.ok(graph.degree('netease:2')>graph.degree('netease:1'),'枢纽曲目的度数更高');
    // 相邻播放（间隔 <30 分钟）累计序列边权。
    store.recordHistory({playInstanceId:'p1',track:t(1,'Song 1','SameArtist'),selectedBy:'agent',progressSource:'audio',effectiveMs:40000,agentListening:true,audible:true,endReason:'ended',endedAt:10000});
    store.recordHistory({playInstanceId:'p2',track:t(6,'Song 6','OtherArtist'),selectedBy:'agent',progressSource:'audio',effectiveMs:40000,agentListening:true,audible:true,endReason:'ended',endedAt:1_000_000});
    const rebuilt=buildTrackGraph(store,{});
    assert.ok(rebuilt.similarity('netease:1','netease:6')>0,'相邻播放产生序列边');
  }finally{store.close();}
});

test('seed selection prefers graph hubs when preference is close',()=>{
  const store=new MusicStore();try{
    // 枢纽曲目 9 与两首歌同歌单；对手曲目 8 偏好相同但无任何图边。
    importSeedTracks({store,provider:'netease',source:'recent',tracks:[t(8,'Solo','SoloArtist'),t(9,'Hub','HubArtist'),t(10,'N1','N1'),t(11,'N2','N2')],requested:4,now:1000});
    for(const [ref,ids] of [['pl-H1',[9,10]],['pl-H2',[9,11]]]){
      for(const id of ids)store.recordEnvironmentSource({track:t(id),source:'playlist',sourceRef:ref},1000);
    }
    const seeds=selectRecommendationSeeds({store,limit:2,now:2000});
    assert.equal(seeds[0].providerTrackId,'9','图中心度让枢纽曲目优先成为种子');
  }finally{store.close();}
});

test('selection scores a graph-affinity bonus toward recently finished tracks',()=>{
  const store=graphStore();try{
    // 最近自然听完曲目 1；候选 2 与它同歌单（有边），候选 4 与它无边且权重相同。
    store.recordHistory({playInstanceId:'p1',track:t(1,'Song 1','SameArtist'),selectedBy:'agent',progressSource:'audio',effectiveMs:40000,agentListening:true,audible:true,endReason:'ended',endedAt:10000});
    const graphCache=createTrackGraphCache({store});
    const selector=createSelector({store,rng:()=>0,now:()=>2000,graphCache,
      listDiscovery:()=>[t(2),t(4,'Song 4','Unrelated')]});
    const decision=selector.decide({discoveryRate:1});
    assert.equal(decision.track.providerTrackId,'2','与最近常听歌曲相近的候选胜出');
    assert.ok(decision.detail.graphAffinity>0&&decision.detail.graphAffinity<=0.06,'加成有界且如实暴露');
  }finally{store.close();}
});

test('graph cache rebuilds only after invalidation',()=>{
  const store=graphStore();try{
    const cache=createTrackGraphCache({store});
    const first=cache.get();
    assert.equal(cache.get(),first,'未失效时复用同一张图');
    cache.invalidate();
    assert.notEqual(cache.get(),first,'失效后惰性重建');
  }finally{store.close();}
});

test('the playlist-generation facts carry structural relations, not just song names', () => {
  const store = graphStore();
  try {
    const graph = buildTrackGraph(store, {});
    const snapshot = { settings: { listening: true, humanPlayback: true, discovery: true, discoveryRate: 0.2, strategy: 'normal' }, current: null, paused: true };
    const withGraph = factBundle(store, snapshot, STRATEGY_PURPOSE, null, graph);
    assert.ok(Array.isArray(withGraph.facts.relations) && withGraph.facts.relations.length > 0, '关系事实随图进入事实包');
    const [seed, ...neighbors] = withGraph.facts.relations[0];
    assert.match(seed, / - /, '关系事实是「歌 - 艺人」形式');
    assert.ok(neighbors.length >= 1, '每首种子至少带一首相关歌曲');
    // 只发歌名/艺人，绝不泄露平台 ID。
    assert.equal(JSON.stringify(withGraph.facts).includes('netease:'), false);
    // 超出字节上限时先丢最近播放与关系，最后才减参考歌曲。
    const withoutGraph = factBundle(store, snapshot, STRATEGY_PURPOSE, null, null);
    assert.equal(withoutGraph.facts.relations, undefined, '没有图时不编造关系事实');
  } finally { store.close(); }
});
