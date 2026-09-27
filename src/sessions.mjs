// Which DSH session is currently "the one being used", and what that may and may
// not do to playback and to long-term preferences.
//
// MVP rules this module implements:
//   - several sessions may be open at once and must not fight over playback
//     (A08). Only the session the user is actually active in may start music,
//     and no session event ever interrupts what is already playing;
//   - a transient session's activity only precipitates a little into long-term
//     preferences, and with a ceiling (A06, MVP section 4), so a short session
//     cannot rewrite a personality.
//
// The registry is deliberately in-memory and bounded: it holds only "who is
// active right now", which is not worth persisting. The part that must survive a
// restart — how much a session has already influenced a track — lives in
// listen_history, keyed by session id.

/** First-pass parameters, recorded in docs/DECISIONS.md section 14. */
export const SESSION_PARAMETERS = Object.freeze({
  /** A session is "active" if it produced an event this recently. */
  activeWindowMs: 5 * 60 * 1000,
  /** Sessions are forgotten after this long, so the registry cannot grow. */
  forgetAfterMs: 30 * 60 * 1000,
  /** Hard cap on tracked sessions. */
  maxSessions: 32,
  /** How much of a full listen a transient session's activity is worth. */
  transientWeight: 0.5,
  /** A session may contribute at most this many qualifying listens to one track. */
  sessionListenCap: 8,
  /** A session shorter than this counts as transient. */
  transientBelowMs: 10 * 60 * 1000,
});

export function createSessionRegistry({
  now = () => Date.now(),
  parameters = SESSION_PARAMETERS,
} = {}) {
  /** id -> { firstSeenAt, lastEventAt, events, seq } */
  const sessions = new Map();
  // A monotonic counter breaks ties: two events in the same millisecond must
  // still have a defined order, and the later one is the active session.
  let sequence = 0;

  const prune = (at) => {
    for (const [id, entry] of sessions) {
      if (at - entry.lastEventAt > parameters.forgetAfterMs) sessions.delete(id);
    }
    // If a pathological number of sessions appear, drop the least recently seen
    // rather than growing without bound.
    if (sessions.size > parameters.maxSessions) {
      const ordered = [...sessions.entries()].sort((a, b) => a[1].lastEventAt - b[1].lastEventAt);
      for (const [id] of ordered.slice(0, sessions.size - parameters.maxSessions)) sessions.delete(id);
    }
  };

  const registry = {
    parameters,

    /** Records that a session produced an event. */
    note(sessionId, { at = now(), kind = 'event' } = {}) {
      if (typeof sessionId !== 'string' || !sessionId) return null;
      prune(at);
      const entry = sessions.get(sessionId) ?? { firstSeenAt: at, lastEventAt: at, events: 0 };
      entry.lastEventAt = at;
      entry.events += 1;
      entry.lastKind = kind;
      entry.seq = sequence += 1;
      sessions.set(sessionId, entry);
      return { ...entry, id: sessionId };
    },

    /** The session the user is active in: the most recently seen, if recent. */
    activeSessionId(at = now()) {
      prune(at);
      let best = null;
      for (const [id, entry] of sessions) {
        if (at - entry.lastEventAt > parameters.activeWindowMs) continue;
        if (!best) { best = id; continue; }
        const incumbent = sessions.get(best);
        // Same millisecond: the one noted later wins.
        if (entry.lastEventAt > incumbent.lastEventAt
          || (entry.lastEventAt === incumbent.lastEventAt && entry.seq > incumbent.seq)) {
          best = id;
        }
      }
      return best;
    },

    /** An unknown session is not active: it has never been seen. */
    isActive(sessionId, at = now()) {
      return Boolean(sessionId) && registry.activeSessionId(at) === sessionId;
    },

    /** A session that has not been around long counts as transient. */
    isTransient(sessionId, at = now()) {
      const entry = sessions.get(sessionId);
      if (!entry) return true;
      return (at - entry.firstSeenAt) < parameters.transientBelowMs;
    },

    describe(at = now()) {
      prune(at);
      const active = registry.activeSessionId(at);
      return {
        tracked: sessions.size,
        activeSessionId: active,
        sessions: [...sessions.entries()]
          .sort((a, b) => b[1].lastEventAt - a[1].lastEventAt)
          .slice(0, 8)
          .map(([id, entry]) => ({
            // Session ids are not secrets, but they are not useful either, so
            // only a prefix is reported.
            id: `${id.slice(0, 8)}…`,
            isActive: id === active,
            msSinceLastEvent: at - entry.lastEventAt,
            events: entry.events,
          })),
      };
    },

    forget(sessionId) {
      return sessions.delete(sessionId);
    },
  };

  return registry;
}

/**
 * May this session start music right now?
 *
 * Three separate reasons to say no, each with its own explanation so the caller
 * can log something true instead of a generic refusal.
 */
export function mayStartPlayback({ registry, sessionId, playing, at }) {
  if (playing) return { allowed: false, reason: 'something is already playing; a session never interrupts it' };
  if (!sessionId) return { allowed: false, reason: 'the event carries no session id' };
  const active = registry.activeSessionId(at);
  if (!active) return { allowed: false, reason: 'no session has been active recently' };
  if (active !== sessionId) return { allowed: false, reason: `another session (${String(active).slice(0, 8)}…) is the active one` };
  return { allowed: true, reason: 'this is the active session' };
}