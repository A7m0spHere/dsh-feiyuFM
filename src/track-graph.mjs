// 个人相似图：从"用户亲手组织过的数据"里推导歌与歌的相近程度。
// 边权来源（全部本地、零外部依赖）：
//   - 歌单共现：同一张用户歌单（environment_sources 的 playlist source_ref）里的歌，
//     是"用户亲自判定风格相近"的免费标注（ItemKNN / MPD 歌单续写方案的思路）；
//   - 艺人重合：结构化艺人 ID 集合的 Jaccard，缺 ID 时退回艺人名；
//   - 播放序列：最近播放里相邻两首（间隔 <30 分钟）反复共现，说明听感衔接。
// 图是惰性构建的小型邻接表（单用户曲库几百首的量级），随失效事件整体重建。

export const TRACK_GRAPH_PARAMETERS = Object.freeze({
  /** 每共享一张歌单的边权。 */
  playlistWeight: 1,
  /** 艺人集合 Jaccard 的系数。 */
  artistWeight: 0.6,
  /** 每次序列共现的边权（单对上限 3 次）。 */
  sequenceWeight: 0.15,
  sequenceCap: 3,
  /** 相邻播放计入序列共现的最大间隔。 */
  sequenceGapMs: 30 * 60_000,
  /** 参与序列共现的最近播放条数。 */
  sequenceWindow: 400,
  /** 相似度封顶。 */
  maxSimilarity: 1,
});

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 艺人键：结构化 ID 优先，缺 ID 退回艺人名（与选歌/画像共用同一约定）。 */
export function artistKeys(track) {
  return track.artists?.length ? track.artists.map(a=>`${track.provider}:${a.id}`)
    : track.artist ? [`${track.provider}:name:${track.artist}`] : [];
}

/** 由库内容构建一张只读相似图。纯函数：同一库状态返回同一张图。 */
export function buildTrackGraph(store, {parameters = TRACK_GRAPH_PARAMETERS} = {}) {
  if (!store) return {similarity: () => 0, degree: () => 0, neighbors: () => new Map(), maxDegree: 0, size: 0};
  // 倒排索引：歌单引用 → 曲目；艺人键 → 曲目。
  const byPlaylist = new Map(), byArtist = new Map(), trackArtists = new Map();
  const seenTracks = new Set();
  for (const row of store.listEnvironmentSources()) {
    const key = row.track_key;
    seenTracks.add(key);
    if (row.source === 'playlist' && row.source_ref) {
      const bucket = byPlaylist.get(row.source_ref) ?? new Set();
      bucket.add(key);
      byPlaylist.set(row.source_ref, bucket);
    }
  }
  for (const row of store.listEnvironment({limit: 100000})) {
    const key = row.track_key;
    seenTracks.add(key);
    let track;
    try { track = store.getNormalizedTrack({provider: row.provider, providerTrackId: key.split(':').slice(1).join(':')}); } catch { continue; }
    const keys = artistKeys(track);
    trackArtists.set(key, keys);
    for (const artist of keys) {
      const bucket = byArtist.get(artist) ?? new Set();
      bucket.add(key);
      byArtist.set(artist, bucket);
    }
  }
  // 播放序列：按结束时间排序的最近播放，相邻且间隔足够近则累计共现。
  const sequence = new Map();
  const history = store.db.prepare('SELECT track_key,ended_at FROM listen_history ORDER BY ended_at DESC LIMIT ?')
    .all(parameters.sequenceWindow).reverse();
  for (let index = 1; index < history.length; index += 1) {
    const gap = history[index].ended_at - history[index - 1].ended_at;
    if (gap < 0 || gap > parameters.sequenceGapMs) continue;
    const key = pairKey(history[index - 1].track_key, history[index].track_key);
    sequence.set(key, Math.min(parameters.sequenceCap, (sequence.get(key) ?? 0) + 1));
  }
  // 只在真正共享信号的曲目对上累计边权。
  const edges = new Map(), degree = new Map();
  const accumulate = (a, b, weight) => {
    if (!a || !b || a === b || weight <= 0) return;
    const key = pairKey(a, b);
    const next = Math.min(parameters.maxSimilarity, (edges.get(key) ?? 0) + weight);
    edges.set(key, next);
    degree.set(a, (degree.get(a) ?? 0) + weight);
    degree.set(b, (degree.get(b) ?? 0) + weight);
  };
  for (const bucket of byPlaylist.values()) {
    const tracks = [...bucket];
    for (let i = 0; i < tracks.length; i += 1) {
      for (let j = i + 1; j < tracks.length; j += 1) {
        accumulate(tracks[i], tracks[j], parameters.playlistWeight);
      }
    }
  }
  const jaccardCache = new Map();
  for (const bucket of byArtist.values()) {
    const tracks = [...bucket];
    for (let i = 0; i < tracks.length; i += 1) {
      for (let j = i + 1; j < tracks.length; j += 1) {
        const a = trackArtists.get(tracks[i]) ?? [], b = trackArtists.get(tracks[j]) ?? [];
        if (!a.length || !b.length) continue;
        const cacheKey = pairKey(tracks[i], tracks[j]);
        let overlap = jaccardCache.get(cacheKey);
        if (overlap === undefined) {
          const shared = a.filter(artist => b.includes(artist)).length;
          overlap = shared / (a.length + b.length - shared);
          jaccardCache.set(cacheKey, overlap);
        }
        accumulate(tracks[i], tracks[j], parameters.artistWeight * overlap);
      }
    }
  }
  for (const [key, count] of sequence) accumulate(key.split('|')[0], key.split('|')[1], parameters.sequenceWeight * count);
  const neighborsOf = key => {
    const result = new Map();
    for (const [edge, weight] of edges) {
      const split = edge.indexOf('|');
      if (edge.slice(0, split) === key) result.set(edge.slice(split + 1), weight);
      else if (edge.slice(split + 1) === key) result.set(edge.slice(0, split), weight);
    }
    return result;
  };
  return {
    similarity: (a, b) => edges.get(pairKey(a, b)) ?? 0,
    degree: key => degree.get(key) ?? 0,
    neighbors: neighborsOf,
    maxDegree: degree.size ? Math.max(...degree.values()) : 0,
    size: seenTracks.size,
  };
}

/** 惰性构建 + 显式失效的图缓存；宿主在成长/导入等失效事件后调用 invalidate。 */
export function createTrackGraphCache({store, parameters = TRACK_GRAPH_PARAMETERS} = {}) {
  let graph = null;
  return {
    get() { graph ??= buildTrackGraph(store, {parameters}); return graph; },
    invalidate() { graph = null; },
    get built() { return graph !== null; },
  };
}
