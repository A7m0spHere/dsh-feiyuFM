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
import { createRng } from './taste.mjs';

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
  /** Tracks played inside this window are excluded outright. */
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
    'SELECT track_key, ended_at FROM listen_history WHERE ended_at > ? ORDER BY ended_at DESC LIMIT ?',
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
  track, store, now, plays, randomValue, parameters = SELECTION_PARAMETERS,
}) {
  const key = trackId(track);
  const preference = store.getPreference('track', key);
  const affinity = preference ? preference.affinity : parameters.neutralAffinity;
  const artist = typeof track.artist === 'string' ? track.artist.trim() : '';
  const artistAffinity = artist && store.getPreference('artist', artist) ? store.getPreference('artist', artist).affinity : null;

  const play = plays.get(key);
  const repeatPenalty = play ? Math.pow(parameters.repeatPenalty, play.plays) : 1;
  const freshness = play ? 0 : parameters.freshnessBonus;

  // The agent's own taste leads; the artist preference only nudges it.
  const taste = artistAffinity === null ? affinity : affinity * 0.75 + artistAffinity * 0.25;
  const score = taste * parameters.affinityWeight * repeatPenalty + freshness + randomValue * parameters.randomWeight;

  return {
    score,
    affinity,
    artistAffinity,
    repeatPlays: play ? play.plays : 0,
    repeatPenalty,
    freshness,
    randomValue,
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
} = {}) {
  if (!store) throw new Error('store is required');

  const decide = ({ discoveryRate, at = now() } = {}) => {
    const rate = clampRate(discoveryRate);
    const banned = bannedTrackKeys(store, at);
    const plays = recentPlays(store, { now: at, windowMs: parameters.repeatWindowMs, limit: parameters.historyWindow });

    const prepare = (tracks) => {
      const all = tracks.map((track) => ({ track, key: trackId(track) }));
      const usable = all
        .filter(({ track, key }) => !banned.has(key) && isPlayable(track))
        // A track inside its cooldown is deliberately not a candidate at all.
        .filter(({ key }) => {
          const play = plays.get(key);
          return !play || at - play.lastPlayedAt >= parameters.cooldownMs;
        });
      return { all, usable };
    };

    const familiarPool = prepare(listFamiliar());
    const discoveryPool = prepare(listDiscovery());
    const familiar = familiarPool.usable;
    const discovery = discoveryPool.usable;
    const offered = familiarPool.all.length + discoveryPool.all.length;
    const wantsDiscovery = rate > 0 && (rate >= 1 || rng() < rate);

    const pick = (pool) => {
      let best = null;
      for (const candidate of pool) {
        const detail = scoreCandidate({
          track: candidate.track, store, now: at, plays,
          randomValue: rng(), parameters,
        });
        if (!best || detail.score > best.detail.score) best = { ...candidate, detail };
      }
      return best;
    };

    const considered = { familiar: familiar.length, discovery: discovery.length, offered };

    if (wantsDiscovery && discovery.length) {
      const best = pick(discovery);
      return {
        track: best.track, pool: 'discovery', fellBack: false,
        score: best.detail.score, detail: best.detail,
        considered,
        discoveryRate: rate,
      };
    }

    if (familiar.length) {
      const best = pick(familiar);
      return {
        track: best.track, pool: 'familiar', fellBack: wantsDiscovery,
        fallbackReason: wantsDiscovery ? 'discovery pool had no usable track' : null,
        score: best.detail.score, detail: best.detail,
        considered,
        discoveryRate: rate,
      };
    }

    // Nothing usable: the caller waits instead of retrying in a loop. The reason
// distinguishes "there is no music yet" from "everything was filtered out",
// because those need different things from the user.
    return {
      track: null, pool: null, fellBack: wantsDiscovery,
      fallbackReason: wantsDiscovery && !discoveryPool.all.length ? 'discovery pool had no usable track' : null,
      reason: offered > 0 ? 'every candidate was filtered out' : 'no candidates',
      considered,
      discoveryRate: rate,
    };
  };

  return {
    parameters,
    decide,
    next(options = {}) {
      const decision = decide(options);
      onDecision(decision);
      return decision;
    },
  };
}