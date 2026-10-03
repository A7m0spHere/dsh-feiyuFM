// The user's music environment: where their music came from, and how much of it
// actually arrived.
//
// MVP rules this module enforces:
//   - an import records its real source; a favourite or a playlist must never be
//     presented as "recently played";
//   - the requested and imported counts are both kept, so a degraded or short
//     import is visible instead of padded to the target;
//   - deduplication is by (provider, providerTrackId) only, so two platforms are
//     never merged by title;
//   - missing play counts and dates stay unknown (NULL), never zero.
import { randomUUID } from 'node:crypto';
import { normalizeTrack, trackId } from './contracts.mjs';

/** The only sources an import may claim. Ordered by preference for seeding. */
export const SEED_SOURCES = Object.freeze(['recent', 'liked', 'playlist', 'plugin_history']);

/** Human-readable source labels; never claim "recent" for a favourite. */
export const SOURCE_LABELS = Object.freeze({
  recent: '近期播放',
  liked: '我喜欢',
  playlist: '用户歌单',
  plugin_history: '插件历史',
});

/** MVP target: ask for 300 by default, keep working below 200. */
export const DEFAULT_IMPORT_REQUEST = 300;
export const COMFORTABLE_IMPORT_MINIMUM = 200;

export function assertSource(source) {
  if (!SEED_SOURCES.includes(source)) {
    throw new Error(`Unknown import source ${JSON.stringify(source)}; expected one of ${SEED_SOURCES.join(', ')}`);
  }
  return source;
}

/**
 * Records one import attempt. Everything lands in a single transaction so a
 * failure cannot leave tracks without their batch, or a batch without its rows.
 *
 * @returns {{ batchId: string, provider: string, source: string, requested: number,
 *   imported: number, duplicates: number, degraded: boolean, reason: string|null,
 *   total: number, sufficient: boolean }}
 */
export function importSeedTracks({
  store,
  provider,
  tracks,
  source,
  requested = DEFAULT_IMPORT_REQUEST,
  degraded = false,
  reason = null,
  now = Date.now(),
  batchId = randomUUID(),
  sourceRef = '',
}) {
  assertSource(source);
  if (!tracks || typeof tracks[Symbol.iterator] !== 'function') throw new Error('tracks must be iterable');

  return store.transaction(() => {
    let imported = 0;
    let duplicates = 0;
    const seen = new Set();

    for (const raw of tracks) {
      const track = normalizeTrack(raw);
      if (track.provider !== provider) {
        throw new Error(`Import for ${provider} received a ${track.provider} track`);
      }
      const key = trackId(track);
      if (seen.has(key)) { duplicates += 1; continue; }
      seen.add(key);

      const existing = store.getEnvironmentEntry(track);
      store.upsertTrack(track, now);
      store.recordEnvironmentSource({track,source,sourceRef,playCount:raw.playCount,lastPlayedAt:raw.lastPlayedAt},now);
      if (existing) {
        duplicates += 1;
        // Refresh metadata only; the environment row keeps its original source
        // so a later import cannot relabel where a track came from.
        store.addEnvironmentEntry({track,source,batchId,playCount:raw.playCount,lastPlayedAt:raw.lastPlayedAt},now);
        continue;
      }
      store.addEnvironmentEntry({
        track,
        source,
        batchId,
        playCount: raw.playCount,
        lastPlayedAt: raw.lastPlayedAt,
      }, now);
      imported += 1;
    }

    const received=seen.size;
    const incomplete=received<requested;
    const explanation=reason??(incomplete?`请求 ${requested} 首，来源实际返回 ${received} 首；其中新增 ${imported} 首。`:null);
    store.recordImportBatch({
      batchId, provider, source, requested, imported, duplicates,
      degraded: degraded || incomplete,
      reason: explanation,
      createdAt: now,
    });

    const total = store.countEnvironment(provider);
    return {
      batchId,
      provider,
      source,
      requested,
      imported,
      duplicates,
      received,
      degraded: Boolean(degraded || incomplete),
      reason: explanation,
      total,
      sufficient: total >= COMFORTABLE_IMPORT_MINIMUM,
    };
  });
}

export function environmentWeight(facts, now = Date.now()) {
  return Math.max(0.5,...facts.map(fact => {
    const base={recent:1,liked:1.15,playlist:0.8,plugin_history:0.6}[fact.source] ?? 0.5;
    const count=fact.play_count;
    const frequency=count===null||!Number.isFinite(count)?0:Math.min(0.35,Math.log1p(Math.max(0,count))/Math.log(101)*0.35);
    const age=fact.last_played_at===null||!Number.isFinite(fact.last_played_at)?null:Math.max(0,now-fact.last_played_at);
    const recency=age===null?0:Math.max(0,1-age/(30*86400_000))*0.15;
    return base+frequency+recency;
  }));
}

export function describeEnvironmentProfile(store, now=Date.now()) {
  const entries=store.listEnvironment({limit:100000}), artists=new Map(), sources={};
  let withIds=0, knownCounts=0, knownDates=0, totalWeight=0;
  for (const row of entries) {
    const key={provider:row.provider,providerTrackId:row.track_key.split(':').slice(1).join(':')};
    const track=store.getNormalizedTrack(key), facts=store.listEnvironmentSources(key);
    const weight=environmentWeight(facts,now); totalWeight+=weight;
    knownCounts+=Number(facts.some(f=>f.play_count!==null)); knownDates+=Number(facts.some(f=>f.last_played_at!==null));
    for(const source of new Set(facts.map(f=>f.source))) sources[source]=(sources[source]??0)+1;
    const members=track.artists?.length?track.artists:[{id:null,name:track.artist||'未知艺人'}];
    if(track.artists?.length)withIds++;
    for(const member of members) {
      const artistKey=member.id?`${row.provider}:${member.id}`:`${row.provider}:name:${member.name}`;
      const current=artists.get(artistKey)??{key:artistKey,name:member.name,identified:Boolean(member.id),weight:0,tracks:0};
      current.weight+=weight/members.length;current.tracks++;artists.set(artistKey,current);
    }
  }
  return {version:1,kind:'user_environment',total:entries.length,sources,coverage:{artistIds:entries.length?withIds/entries.length:0,
    playCounts:entries.length?knownCounts/entries.length:0,dates:entries.length?knownDates/entries.length:0,genres:0,moods:0},
    artists:[...artists.values()].map(a=>({...a,share:totalWeight?a.weight/totalWeight:0})).sort((a,b)=>b.share-a.share||a.key.localeCompare(b.key)),
    featureLimits:['genre_unknown','mood_unknown','no_audio_analysis']};
}

/**
 * What the user's environment currently holds, split by source and platform, so
 * the UI and the agent can state the real numbers instead of a target.
 */
export function describeEnvironment(store) {
  const entries = store.listEnvironment({ limit: 100000 });
  const bySource = {};
  const byProvider = {};
  let knownPlayCounts = 0;
  let knownDates = 0;
  for (const entry of entries) {
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
    byProvider[entry.provider] = (byProvider[entry.provider] ?? 0) + 1;
    if (entry.play_count !== null) knownPlayCounts += 1;
    if (entry.last_played_at !== null) knownDates += 1;
  }
  const total = entries.length;
  return {
    total,
    bySource: Object.fromEntries(Object.entries(bySource).map(([key, value]) => [key, { count: value, label: SOURCE_LABELS[key] ?? key }])),
    byProvider,
    knownPlayCounts,
    knownDates,
    sufficient: total >= COMFORTABLE_IMPORT_MINIMUM,
    batches: store.listImportBatches({ limit: 20 }).map((row) => ({
      batchId: row.batch_id,
      provider: row.provider,
      source: row.source,
      requested: row.requested,
      imported: row.imported,
      duplicates: row.duplicates,
      degraded: row.degraded === 1,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  };
}
