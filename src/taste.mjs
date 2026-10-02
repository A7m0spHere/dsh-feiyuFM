// The agent's own music preferences, separate from the user's environment.
//
// MVP rules this module enforces:
//   - the user's favourites, imports and ratings never overwrite agent
//     preferences: they shape the starting environment only;
//   - initialization uses that environment plus a small bounded perturbation
//     and a slight initial bias, and the seed is stored, so a restart never
//     reshapes the personality;
//   - the same seed over the same environment produces the same preferences.
import { randomUUID } from 'node:crypto';
import { trackId } from './contracts.mjs';

/** Stored key for the initialization seed. */
export const AGENT_SEED_KEY = 'agent_seed';

/**
 * First-pass parameters. They are deliberately small and bounded; the plan
 * says to record the numbers and reasons on first implementation and tune them
 * with data later (see docs/DECISIONS.md section 11).
 */
export const SEED_PARAMETERS = Object.freeze({
  /** Starting affinity for anything the user brought in. */
  base: 0.5,
  /** Maximum random perturbation either way. */
  jitter: 0.15,
  /** Slight bias by where the track came from. */
  sourceBias: Object.freeze({ recent: 0.04, liked: 0.08, playlist: 0, plugin_history: 0 }),
  /** Affinity floor/ceiling so preferences stay comparable. */
  min: 0.05,
  max: 0.95,
});

/**
 * Deterministic PRNG (mulberry32). A seeded generator is the whole point: the
 * same seed must reproduce the same personality on any machine.
 */
export function createRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  next.getState = () => state >>> 0;
  return next;
}

export function normalizeSeed(seed) {
  if (Number.isSafeInteger(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.trim()) {
    // Stable string hash so a human-chosen seed works too.
    let hash = 2166136261;
    for (const char of seed.trim()) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  throw new Error('seed must be an integer or a non-empty string');
}

export function readAgentSeed(store) {
  return store.getSetting(AGENT_SEED_KEY, null);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Creates the agent's initial preferences from the user's environment, and tops
 * up rows for tracks that arrived in a later import.
 *
 * Stable by construction: entries are processed in sorted key order, so the
 * random stream does not depend on insertion order, the seed is persisted, and
 * an existing preference is never rewritten. A restart therefore changes
 * nothing, while a new import still participates in the personality instead of
 * being stuck at a flat neutral score.
 */
export function initializeAgentPreferences({
  store,
  seed = null,
  now = Date.now(),
  force = false,
  parameters = SEED_PARAMETERS,
} = {}) {
  const storedSeed = readAgentSeed(store);
  const effectiveSeed = normalizeSeed(seed ?? storedSeed ?? randomUUID());
  const rng = createRng(effectiveSeed);
  const entries = store.listEnvironment({ limit: 100000 });
  const tracks = [...entries].sort((a, b) => (a.track_key < b.track_key ? -1 : a.track_key > b.track_key ? 1 : 0));

  const preferences = [];
  const artistTotals = new Map();

  for (const entry of tracks) {
    const bias = parameters.sourceBias[entry.source] ?? 0;
    const jitter = (rng() * 2 - 1) * parameters.jitter;
    const affinity = clamp(parameters.base + bias + jitter, parameters.min, parameters.max);
    preferences.push({ targetType: 'track', targetKey: entry.track_key, affinity, source: 'seed' });

    const track = store.getTrack({ provider: entry.provider, providerTrackId: entry.track_key.split(':').slice(1).join(':') });
    const artist = track?.artist?.trim();
    if (artist) {
      const current = artistTotals.get(artist) ?? { sum: 0, count: 0 };
      current.sum += affinity;
      current.count += 1;
      artistTotals.set(artist, current);
    }
  }

  // An artist starts at the bounded mean of its known tracks, not a fresh draw,
  // so an artist preference cannot drift away from the evidence behind it.
  for (const [artist, totals] of [...artistTotals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const mean = clamp(totals.sum / totals.count, parameters.min, parameters.max);
    preferences.push({ targetType: 'artist', targetKey: artist, affinity: mean, source: 'seed' });
  }

  // Only rows that do not exist yet are written: an affinity that is already
  // there was either seeded earlier or earned by listening, and neither may be
  // overwritten by a later import. This is what keeps a restart stable while
  // still letting a new import participate in the personality.
  const missing = force
    ? preferences
    : preferences.filter((preference) => !store.getPreference(preference.targetType, preference.targetKey));

  if (missing.length || readAgentSeed(store) === null) {
    store.transaction(() => {
      store.setSetting(AGENT_SEED_KEY, effectiveSeed);
      for (const preference of missing) store.setPreference({ ...preference, updatedAt: now });
    });
  }

  return {
    initialized: missing.length > 0,
    seed: readAgentSeed(store) ?? effectiveSeed,
    created: missing.length,
    tracks: tracks.length,
    artists: artistTotals.size,
  };
}

export function getAffinity(store, { targetType, targetKey }) {
  const row = store.getPreference(targetType, targetKey);
  return row ? row.affinity : null;
}

export function getTrackAffinity(store, track) {
  return getAffinity(store, { targetType: 'track', targetKey: trackId(track) });
}

/** Compact view for diagnostics and the future decision layer. */
export function describeTaste(store) {
  const preferences = store.listPreferences({ limit: 100000 });
  const tracks = preferences.filter((row) => row.target_type === 'track');
  const artists = preferences.filter((row) => row.target_type === 'artist');
  const affinities = preferences.map((row) => row.affinity);
  return {
    seed: readAgentSeed(store),
    total: preferences.length,
    tracks: tracks.length,
    artists: artists.length,
    minimum: affinities.length ? Math.min(...affinities) : null,
    maximum: affinities.length ? Math.max(...affinities) : null,
    mean: affinities.length ? affinities.reduce((sum, value) => sum + value, 0) / affinities.length : null,
  };
}
