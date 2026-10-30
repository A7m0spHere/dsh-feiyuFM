// Autonomous track selection: which of the available tracks the agent plays
// next, using only local information and a seeded random stream.
//
// MVP rules this module enforces:
//   - filter first: banned tracks and tracks known to be unplayable never enter
//     selection, before any scoring;
//   - then choose the familiar or the discovery pool according to the discovery
//     rate; 100% is an attempt target, not a promise that new music exists;
//   - when the discovery pool has nothing usable, fall back to the familiar pool
//     and record that no exploration happened, keeping the user's setting;
//   - score by agent preference, freshness, repeat penalty and a small random
//     term;
//   - with no candidates, select nothing and wait; a caller must not spin.
import { trackId } from './contracts.mjs';
import { createRng, getArtistAffinity } from './taste.mjs';
import {describeEnvironmentProfile} from './environment.mjs';
import {artistKeys} from './recommendation.mjs';
import {feedbackScore,trackFeedback} from './feedback.mjs';
import {repeatContext,repeatTier,RECENT_PLAYBACK_LIMIT} from './recent-playback.mjs';

/**
 * First-pass parameters, recorded here and in docs/DECISIONS.md section 12.
 * They are intentionally conservative and meant to be tuned with real data.
 */
export const SELECTION_PARAMETERS = Object.freeze({
  /** Affinity used when the agent has no opinion about a track yet. */
  neutralAffinity: 0.5,
  /** Weight of agent preference in the score. */
  affinityWeight: 1,
  /** Small bonus for a track the agent has never played. */
  freshnessBonus: 0.08,
  /** Multiplier applied per recent play inside the repeat window. */
  repeatPenalty: 0.45,
  /** How far back a play still counts as a repeat. */
  repeatWindowMs: 6 * 60 * 60 * 1000,
  /** Preferred time cooldown; relaxed only when no normal candidate remains. */
  cooldownMs: 30 * 60 * 1000,
  /** Size of the random tie-breaking term. */
  randomWeight: 0.1,
  /** How many recent history rows to consider. */
  historyWindow: 50,
});

export const DEFAULT_DISCOVERY_RATE = 0.2;

function clampRate(value) {
  if (!Number.isFinite(value)) return DEFAULT_DISCOVERY_RATE;
  return Math.min(1, Math.max(0, value));
}

/** Banned tracks come from the user's own constraints, never from a guess. */
export function bannedTrackKeys(store, now) {
  const banned = new Set();
  for (const row of store.activeConstraints(now)) {
    if (row.kind === 'ban_track' && row.track_key) banned.add(row.track_key);
  }
  return banned;
}

/**
 * Recent plays, used for cooldown and repeat penalty.
 * @returns {Map<string, { lastPlayedAt: number, plays: number }>}
 */
export function recentPlays(store, { now, windowMs, limit }) {
  const rows = store.db.prepare(
    'SELECT track_key, ended_at FROM listen_history WHERE ended_at > ? AND effective_ms>0 ORDER BY ended_at DESC,rowid DESC LIMIT ?',
  ).all(now - windowMs, limit);
  const plays = new Map();
  for (const row of rows) {
    // Seed with the row's own value, never with 0: clamping to zero would
    // rewrite any timestamp before the epoch and silently shorten cooldowns.
    const entry = plays.get(row.track_key) ?? { lastPlayedAt: Number.NEGATIVE_INFINITY, plays: 0 };
    entry.plays += 1;
    entry.lastPlayedAt = Math.max(entry.lastPlayedAt, row.ended_at);
    plays.set(row.track_key, entry);
  }
  return plays;
}

/**
 * Scores one candidate. Pure: given the same inputs it returns the same score,
 * which is what makes a seeded selection reproducible.
 */
export function scoreCandidate({
  track, store, now, plays, randomValue, parameters = SELECTION_PARAMETERS,context=null,
}) {
  const key = trackId(track);
  const preference = store.getPreference('track', key);
  const affinity = preference ? preference.affinity : parameters.neutralAffinity;
  const artistAffinity = getArtistAffinity(store,track);

  const play = plays.get(key);
  const repeatPenalty = play ? Math.pow(parameters.repeatPenalty, play.plays) : 1;
  const freshness = play ? 0 : parameters.freshnessBonus;

  // The agent's own taste leads; the artist preference only nudges it.
  const taste = artistAffinity === null ? affinity : affinity * 0.75 + artistAffinity * 0.25;
  const links=track.discovery?.seedTrackKeys?.length?track.discovery.seedTrackKeys:track.discovery?.seedTrackKey?[track.discovery.seedTrackKey]:[];
  const seedAffinity=links.length?links.reduce((sum,k)=>sum+(store.getPreference('track',k)?.affinity??0.5),0)/links.length:0;
  const relationship=links.length?seedAffinity*0.08:0;
  const environment=artistKeys(track).reduce((sum,k)=>sum+(context?.environment.get(k)??0),0)*0.04;
  const concentration=Math.max(0,...artistKeys(track).map(k=>context?.recentArtists.get(k)??0));
  const diversityPenalty=Math.min(0.12,concentration*0.03);
  const userFeedback = trackFeedback(store, track), feedback = feedbackScore(store, track);
  // 与最近自然听完歌曲的相似图关联：同歌单/同艺人/相邻播放的弱牵引，
  // 与多样性惩罚（防同艺人连续）方向互补；权重有界，缺图时为 0。
  const graph=context?.graph??null,recentPositive=context?.recentPositive??[];
  const graphAffinity=graph&&recentPositive.length
    ?recentPositive.reduce((sum,recentKey)=>sum+graph.similarity(key,recentKey),0)/recentPositive.length*0.06
    :0;
  const llmRank = Number.isSafeInteger(track.discovery?.llmRank) && track.discovery.llmRank > 0 ? track.discovery.llmRank : null;
  const llmBoost = llmRank ? Math.max(0, 0.24 * (1 - (llmRank - 1) / 12)) : 0;
  const score = taste * parameters.affinityWeight * repeatPenalty + freshness + randomValue * parameters.randomWeight + relationship + environment - diversityPenalty + feedback + llmBoost + graphAffinity;

  return {
    score,
    affinity,
    affinitySource:preference?.source??'neutral',
    artistAffinity,
    repeatPlays: play ? play.plays : 0,
    repeatPenalty,
    freshness,
    randomValue,
    relationship,seedAffinity,environment,diversityPenalty,userFeedback,feedback,llmRank,llmBoost,graphAffinity,algorithm:'local-v7',
  };
}

/**
 * Builds the selector the core consults for autonomous playback.
 *
 * `listFamiliar` returns tracks the user brought in; `listDiscovery` returns
 * tracks from platform recommendations. Both may return nothing, and that is a
 * normal state rather than an error.
 */
export function createSelector({
  store,
  rng = createRng(1),
  listFamiliar = () => [],
  listDiscovery = () => [],
  isPlayable = () => true,
  parameters = SELECTION_PARAMETERS,
  onDecision = () => {},
  now = () => Date.now(),
  graphCache = null,
} = {}) {
  if (!store) throw new Error('store is required');

  const decide = (options = {}) => {
    const { discoveryRate, excludeTrackKeys = [] } = options;
    const at = options.at ?? now();
    const rate = clampRate(discoveryRate);
    const banned = bannedTrackKeys(store, at);
    const excluded = new Set(excludeTrackKeys);
    const recent=repeatContext(store);
    const current=store.getCoreState()?.current?.track;
    const currentKey=current?trackId(current):recent.lastTrackKey;
    if(currentKey)excluded.add(currentKey);
    const plays = recentPlays(store, { now: at, windowMs: parameters.repeatWindowMs, limit: parameters.historyWindow });
    // 最近自然听完的歌驱动相似图关联项；与 plays（含跳过）不同源。
    const recentPositive=store.db.prepare("SELECT track_key FROM listen_history WHERE end_reason='ended' ORDER BY ended_at DESC LIMIT 5").all().map(r=>r.track_key);
    const context={environment:new Map(describeEnvironmentProfile(store,at).artists.map(a=>[a.key,a.share])),recentArtists:new Map(),
      graph:graphCache?.get?.()??null,recentPositive};
    for(const key of plays.keys()){
      const split=key.indexOf(':');const played=store.getNormalizedTrack({provider:key.slice(0,split),providerTrackId:key.slice(split+1)});
      for(const artist of artistKeys(played))context.recentArtists.set(artist,(context.recentArtists.get(artist)??0)+(plays.get(key)?.plays??0));
    }

    const prepare = (tracks) => {
      const all = [...new Map(tracks.map(track=>[trackId(track),{track,key:trackId(track)}])).values()];
      const eligible = all.filter(({track,key})=>!banned.has(key)&&store.isTrackAvailable(track,at)&&isPlayable(track));
      const usable = eligible.filter(({key})=>!excluded.has(key));
      return { all, usable, recentBlocked:eligible.some(({key})=>recent.keys.has(key)) };
    };

    const familiarPool = prepare(listFamiliar(options));
    const discoveryPool = prepare(listDiscovery(options));
    const queuePool=prepare(options.queuedTracks??[]);
    const offered = familiarPool.all.length + discoveryPool.all.length+queuePool.all.length;
    const wantsDiscovery = rate > 0 && (rate >= 1 || rng() < rate);
    const tierOf=key=>repeatTier(key,{recent,plays,at,cooldownMs:parameters.cooldownMs});
    let tier=0,familiar=[],discovery=[],queue=[];
    // The 50-start window is a hard filter. Only elapsed-time cooldown may relax.
    for(;tier<=1;tier++){
      familiar=familiarPool.usable.filter(c=>tierOf(c.key)===tier);
      discovery=rate>0?discoveryPool.usable.filter(c=>tierOf(c.key)===tier):[];
      queue=queuePool.usable.filter(c=>tierOf(c.key)===tier);
      if(familiar.length||discovery.length||queue.length)break;
    }

    const pick = (pool) => {
      let best = null;
      for (const candidate of pool) {
        const detail = scoreCandidate({
          track: candidate.track, store, now: at, plays,context,
          randomValue: rng(), parameters,
        });
        if (!best || detail.score > best.detail.score) best = { ...candidate, detail };
      }
      return best;
    };

    const considered = { familiar: familiar.length, discovery: discovery.length, offered,...(queuePool.all.length?{queue:queue.length}:{}) };
    const finish=(best,pool)=>({track:best.track,pool,fellBack:pool!=='discovery'&&wantsDiscovery,
      fallbackReason:pool!=='discovery'&&wantsDiscovery?'discovery pool had no usable track':null,
      score:best.detail.score,detail:{...best.detail,repeat:{window:RECENT_PLAYBACK_LIMIT,
        relaxed:tier>0,reason:tier===1?'cooldown-exhausted':null,
        distance:recent.positions.has(best.key)?recent.entries.length-recent.positions.get(best.key).index:null}},
      considered,discoveryRate:rate,attemptedDiscovery:wantsDiscovery});

    if(queue.length){const best=queue[0];return finish({...best,detail:scoreCandidate({track:best.track,store,now:at,plays,context,randomValue:0,parameters})},'queue');}

    if (wantsDiscovery && discovery.length) {
      const best = pick(discovery);
      return finish(best,'discovery');
    }

    if (familiar.length) {
      const best = pick(familiar);
      return finish(best,'familiar');
    }

    // Nothing usable: the caller waits instead of retrying in a loop. The reason
// distinguishes "there is no music yet" from "everything was filtered out",
// because those need different things from the user.
    const recentBlocked=familiarPool.recentBlocked||queuePool.recentBlocked||(rate>0&&discoveryPool.recentBlocked);
    return {
      track: null, pool: null, fellBack: wantsDiscovery,
      fallbackReason: wantsDiscovery && !discoveryPool.all.length ? 'discovery pool had no usable track' : null,
      reason: recentBlocked?'recent-window-exhausted':offered > 0 ? 'every candidate was filtered out' : 'no candidates',
      ...(recentBlocked?{detail:{algorithm:'local-v7',repeat:{window:RECENT_PLAYBACK_LIMIT,relaxed:false,reason:'recent-window-exhausted',distance:null}}}:{}),
      considered,
      discoveryRate: rate,
      attemptedDiscovery:wantsDiscovery,
    };
  };

  return {
    parameters,
    randomState: () => rng.getState?.(),
    decide,
    next(options = {}) {
      const decision = decide(options);
      onDecision(decision);
      return decision;
    },
  };
}
