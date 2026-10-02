// Growth: how a finished listen changes the agent's own preferences.
//
// MVP rules this module enforces:
//   - only a listen that reached a real effective-progress threshold counts;
//     a pause, a failure or an instant switch is not "listening";
//   - silent experience and audible playback are counted separately;
//   - a user's own playback does not update agent preferences at all;
//   - a skip is not dislike and a platform failure is not negative preference,
//     so nothing here ever lowers an affinity;
//   - updates are bounded and diminish as they approach the ceiling, and
//     affinities decay toward neutral over time, so repeatedly selecting the
//     same track cannot ratchet a preference to certainty. That self-selection
//     loop is exactly what "选中就加分" would otherwise produce.
import { trackId } from './contracts.mjs';
import { AGENT_SEED_KEY } from './taste.mjs';
import { SESSION_PARAMETERS as SESSION_DEFAULTS } from './sessions.mjs';

/**
 * First-pass parameters, recorded here and in docs/DECISIONS.md section 13.
 * Every number is a deliberate ceiling, not an estimate.
 */
export const GROWTH_PARAMETERS = Object.freeze({
  /** A listen must reach this many milliseconds of real progress... */
  minEffectiveMs: 30_000,
  /** ...or this fraction of the track, whichever is smaller. */
  minEffectiveRatio: 0.5,
  /** Hard cap on one update, before weighting. */
  maxStep: 0.03,
  /** A skip that still met the threshold counts less than a completed play. */
  skippedWeight: 0.5,
  /** Silent experience is real experience, but it is not audible playback. */
  silentWeight: 0.6,
  /** Affinities drift back toward neutral at this rate per day. */
  decayPerDay: 0.02,
  /** The neutral point decay pulls toward, shared with initialization. */
  neutral: 0.5,
  min: 0.05,
  max: 0.95,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Whether a finished listen may update anything.
 * @returns {{ qualifies: boolean, reason: string, effectiveMs: number, ratio: number|null, thresholdMs: number }}
 */
export function qualifiesAsListen({ entry, durationMs = null, parameters = GROWTH_PARAMETERS }) {
  const progress = entry?.agentEffectiveMs ?? entry?.effectiveMs;
  const effectiveMs = Number.isFinite(progress) ? Math.max(0, progress) : 0;
  const knownDuration = Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : null;
  const ratio = knownDuration ? effectiveMs / knownDuration : null;
  const thresholdMs = knownDuration
    ? Math.min(parameters.minEffectiveMs, knownDuration * parameters.minEffectiveRatio)
    : parameters.minEffectiveMs;

  if (entry?.endReason === 'error') {
    return { qualifies: false, reason: 'the playback failed; that is not a preference signal', effectiveMs, ratio, thresholdMs };
  }
  if (entry?.selectedBy !== 'agent' || entry?.agentListening === false) {
    return { qualifies: false, reason: 'the user chose this track, so it is not an agent experience', effectiveMs, ratio, thresholdMs };
  }
  if (effectiveMs < thresholdMs) {
    return { qualifies: false, reason: `only ${effectiveMs} ms of progress, below the ${Math.round(thresholdMs)} ms threshold`, effectiveMs, ratio, thresholdMs };
  }
  return { qualifies: true, reason: 'reached the effective-progress threshold', effectiveMs, ratio, thresholdMs };
}

/** The weight a qualifying listen carries, by how it was heard and how it ended. */
export function listenWeight(entry, parameters = GROWTH_PARAMETERS, { sessionWeight = 1 } = {}) {
  const audible = entry?.audible === true;
  const base = audible ? 1 : parameters.silentWeight;
  const ended = entry?.endReason === 'ended';
  // A transient session's activity only precipitates a little into long-term
  // preferences (MVP section 4).
  return (ended ? base : base * parameters.skippedWeight) * sessionWeight;
}

/**
 * Applies one finished listen to the agent's preferences.
 *
 * Returns a report either way: a refusal is information too, and the caller
 * (or a test) must be able to see why nothing changed.
 */
export function applyListenGrowth(options) {
  const { store, entry } = options;
  if (!entry?.playInstanceId) throw new Error('Growth requires playInstanceId');
  return store.transaction(() => {
    if (store.getGrowthResult(entry.playInstanceId)) return { updated: false, delta: 0, reason: 'already-applied' };
    const result = applyGrowthOnce(options);
    store.completeGrowth(entry, result, options.now ?? Date.now());
    return result;
  });
}

function applyGrowthOnce({
  store,
  entry,
  durationMs = null,
  now = Date.now(),
  parameters = GROWTH_PARAMETERS,
  /**
   * Session context. `sessionId` records where the listen came from;
   * `transient` marks a short-lived session, whose influence is reduced. The
   * ceiling is enforced from history, so it survives a restart.
   */
  session = null,
} = {}) {
  const verdict = qualifiesAsListen({ entry, durationMs, parameters });
  if (!verdict.qualifies) {
    // The qualification reason is the explanation here, so it stays.
    return { ...verdict, updated: false, reason: verdict.reason, delta: 0 };
  }

  const key = trackId(entry.track);
  const sessionId = session?.sessionId ?? null;
  const sessionWeight = session?.transient ? SESSION_DEFAULTS.transientWeight : 1;

  // A session may only precipitate so much into one track. Growth counts its own
  // applications, so the ceiling does not depend on who recorded the listen and
  // it survives a restart.
  let sessionApplied = 0;
  if (sessionId) {
    sessionApplied = store.getSessionInfluence ? store.getSessionInfluence(sessionId, entry.track) : 0;
    const cap = session.cap ?? SESSION_DEFAULTS.sessionListenCap;
    if (sessionApplied >= cap) {
      return {
        // `verdict` is spread first so its fields are available, then the
        // refusal's own reason and flag win: otherwise the qualification message
        // would overwrite the real explanation for doing nothing.
        ...verdict,
        updated: false,
        reason: `this session has already contributed ${cap} updates to this track`,
        delta: 0,
        sessionId,
        sessionApplied,
        sessionCapped: true,
      };
    }
  }

  const existing = store.getPreference('track', key);
  const before = existing ? existing.affinity : parameters.neutral;
  const weight = listenWeight(entry, parameters, { sessionWeight });

  // Diminishing returns: the closer an affinity already is to the ceiling, the
  // smaller the next step. Without this, repeated auto-selection would walk a
  // preference to certainty by itself.
  const headroom = Math.max(0, parameters.max - before);
  const delta = Math.min(parameters.maxStep * weight, headroom * 0.25);
  const after = clamp(before + delta, parameters.min, parameters.max);

  store.transaction(() => {
    // Record that this session spent one of its allowances, in the same
    // transaction as the preference change so the two cannot disagree.
    if (sessionId && store.bumpSessionInfluence) store.bumpSessionInfluence(sessionId, entry.track, now);
    store.setPreference({
      targetType: 'track',
      targetKey: key,
      affinity: after,
      // Provenance stays honest: a silent listen and an audible one are
      // recorded as different sources.
      source: entry.audible === true ? 'listen' : 'listen_silent',
      updatedAt: now,
    });
    const artist = typeof entry.track?.artist === 'string' ? entry.track.artist.trim() : '';
    if (artist) {
      const current = store.getPreference('artist', artist);
      const artistBefore = current ? current.affinity : parameters.neutral;
      const artistHeadroom = Math.max(0, parameters.max - artistBefore);
      // An artist moves a fraction of what the track moved: one play is weak
      // evidence about an artist.
      const artistDelta = Math.min(delta * 0.3, artistHeadroom * 0.25);
      store.setPreference({
        targetType: 'artist',
        targetKey: artist,
        affinity: clamp(artistBefore + artistDelta, parameters.min, parameters.max),
        source: 'listen',
        updatedAt: now,
      });
    }
  });

  return {
    updated: after !== before,
    reason: verdict.reason,
    key,
    sessionId,
    before,
    after,
    delta: after - before,
    weight,
    audible: entry.audible === true,
    effectiveMs: verdict.effectiveMs,
    ratio: verdict.ratio,
    thresholdMs: verdict.thresholdMs,
  };
}

/**
 * Time-based decay toward neutral. Called on maintenance, not on every listen,
 * so a long idle period cannot silently rewrite a personality either.
 */
export function decayPreferences({ store, now = Date.now(), parameters = GROWTH_PARAMETERS }) {
  const rows = store.listPreferences({ limit: 100000 });
  let changed = 0;
  store.transaction(() => {
    for (const row of rows) {
      const days = Math.max(0, (now - row.updated_at) / (24 * 60 * 60 * 1000));
      if (days <= 0) continue;
      const retained = Math.pow(1 - parameters.decayPerDay, days);
      const decayed = parameters.neutral + (row.affinity - parameters.neutral) * retained;
      if (Math.abs(decayed - row.affinity) < 1e-6) continue;
      store.setPreference({
        targetType: row.target_type,
        targetKey: row.target_key,
        affinity: clamp(decayed, parameters.min, parameters.max),
        source: row.source,
        // The decay is time passing, not new evidence, so the anchor moves
        // forward without pretending the affinity was re-earned.
        updatedAt: now,
      });
      changed += 1;
    }
  });
  return { considered: rows.length, changed };
}

/** Compact view for evidence and diagnostics. */
export function describeGrowth(store) {
  const rows = store.listPreferences({ limit: 100000 });
  const listened = rows.filter((row) => row.source === 'listen' || row.source === 'listen_silent');
  const silent = rows.filter((row) => row.source === 'listen_silent');
  const tracks = rows.filter((row) => row.target_type === 'track');
  return {
    parameters: GROWTH_PARAMETERS,
    seed: store.getSetting(AGENT_SEED_KEY, null),
    total: rows.length,
    tracks: tracks.length,
    artists: rows.length - tracks.length,
    // A listen can move both a track and its artist, so these are counted per
    // kind rather than as one number.
    listenedTracks: listened.filter((row) => row.target_type === 'track').length,
    listenedArtists: listened.filter((row) => row.target_type === 'artist').length,
    silentTracks: silent.length,
    ceiling: GROWTH_PARAMETERS.max,
    highest: rows.length ? Math.max(...rows.map((row) => row.affinity)) : null,
  };
}
