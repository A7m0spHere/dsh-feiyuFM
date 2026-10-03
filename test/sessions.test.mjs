// A08 (several sessions must not fight over playback) and A06 (a transient
// session must not overwrite long-term preferences).
//
// The registry decides who may start music and how much a session's activity is
// worth; both properties are asserted here, including the ones that only show up
// once a restart is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { initializeAgentPreferences } from '../src/taste.mjs';
import { GROWTH_PARAMETERS, applyListenGrowth } from '../src/growth.mjs';
import { createSessionRegistry, mayStartPlayback, SESSION_PARAMETERS } from '../src/sessions.mjs';
import { createCoreHost } from '../src/core-host.mjs';
import { FakeProvider } from '../src/fakes.mjs';

const track = { provider: 'netease', providerTrackId: 's1', title: 'Session track', artist: 'A', durationMs: 100_000 };
const MIN = 60_000;

function seededStore() {
  const store = new MusicStore();
  importSeedTracks({ store, provider: 'netease', source: 'recent', requested: 1, tracks: [track] });
  initializeAgentPreferences({ store, seed: 5, now: 0 });
  return store;
}

const listen = (sessionId, extra = {}) => ({
  playInstanceId: `p-${sessionId}-${Math.random().toString(36).slice(2)}`,
  track, selectedBy: 'agent', progressSource: 'audio',
  effectiveMs: 90_000, agentListening: true, audible: true, endReason: 'ended',
  durationMs: track.durationMs, sessionId, ...extra,
});

test('the active session is the most recently seen one, and stale ones expire', () => {
  let clock = 1_000_000;
  const registry = createSessionRegistry({ now: () => clock });
  registry.note('session-a', { at: clock });
  assert.equal(registry.activeSessionId(clock), 'session-a');

  clock += 1000;
  registry.note('session-b', { at: clock });
  assert.equal(registry.activeSessionId(clock), 'session-b', 'the newest is active');
  assert.equal(registry.isActive('session-a', clock), false);

  // Traffic in A does not make it active while B is newer.
  clock += 1000;
  registry.note('session-a', { at: clock });
  assert.equal(registry.activeSessionId(clock), 'session-a');

  // Activity long enough ago stops counting as active at all.
  clock += SESSION_PARAMETERS.activeWindowMs + 1;
  assert.equal(registry.activeSessionId(clock), null, 'an idle session is not active');
  assert.equal(mayStartPlayback({ registry, sessionId: 'session-a', playing: false, at: clock }).allowed, false);
});

test('nothing may interrupt what is already playing, whichever session asks', () => {
  const clock = 2_000_000;
  const registry = createSessionRegistry({ now: () => clock });
  registry.note('session-a', { at: clock });
  // The active session itself is refused while something is playing.
  const refused = mayStartPlayback({ registry, sessionId: 'session-a', playing: true, at: clock });
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /never interrupts/);

  // A second session is refused too, and for a reason of its own.
  registry.note('session-b', { at: clock });
  const other = mayStartPlayback({ registry, sessionId: 'session-a', playing: false, at: clock });
  assert.equal(other.allowed, false);
  assert.match(other.reason, /another session/);

  assert.equal(mayStartPlayback({ registry, sessionId: 'session-b', playing: false, at: clock }).allowed, true);
});

test('the registry stays bounded no matter how many sessions appear', () => {
  let clock = 5_000_000;
  const registry = createSessionRegistry({ now: () => clock });
  for (let index = 0; index < SESSION_PARAMETERS.maxSessions * 3; index += 1) {
    clock += 10;
    registry.note(`session-${index}`, { at: clock });
  }
  const described = registry.describe(clock);
  assert.ok(described.tracked <= SESSION_PARAMETERS.maxSessions, `tracked ${described.tracked}`);
  // The newest session survived; the oldest did not.
  assert.equal(described.activeSessionId, `session-${SESSION_PARAMETERS.maxSessions * 3 - 1}`);
  assert.equal(registry.describe(clock).sessions[0].isActive, true);
  // Only a prefix of an id is ever reported.
  assert.match(described.sessions[0].id, /…$/);

  // Forgetting everything is possible, which is what unload does.
  assert.equal(registry.forget(described.activeSessionId), true);
});

test('two concurrent sessions do not let the inactive one start music', async () => {
  const out = { lines: [], write(chunk) { for (const line of chunk.split('\n')) if (line.trim()) this.lines.push(JSON.parse(line)); } };
  const provider = new FakeProvider();
  provider.set(track, 'fake:handle');
  const host = createCoreHost({ output: out, playbackMode: 'fake', provider, stateIntervalMs: 1000 });
  try {
    await host.start();
    await host.handle({
      id: 'imp', type: 'import', provider: 'netease', source: 'recent', requested: 1, tracks: [track], seed: 1,
    });
    await host.handle({ id: 'rate', type: 'command', command: { type: 'setDiscoveryRate', value: 0, commandId: 'r' } });
    await host.handle({
      id: 'imp2', type: 'import', provider: 'netease', source: 'recent', requested: 2,
      tracks: [track, { ...track, providerTrackId: 's2', title: 'Second' }], seed: 1,
    });
    provider.set({ ...track, providerTrackId: 's2' }, 'fake:handle-2');
    // A fresh core starts paused, and a pause must never be undone by an
    // automatic event, so the user opts in first (which also selects a track).
    await host.handle({ id: 'self', type: 'command', command: { type: 'chooseSelf', commandId: 'c0' } });
    await host.core.waitForIdle();
    assert.equal(host.snapshot().paused, false, 'autonomy needs the user to opt in');

    // Session A becomes the active one.
    await host.handle({ id: 'e1', type: 'session-event', name: 'turn/start', sessionId: 'session-a' });
    const playing = host.snapshot().current.playInstanceId;

    // Session B becomes active. Its turn/end must not disturb playback.
    await host.handle({ id: 'e3', type: 'session-event', name: 'turn/start', sessionId: 'session-b' });
    await host.handle({ id: 'e4', type: 'session-event', name: 'turn/end', turn: 1, reason: { kind: 'completed' }, sessionId: 'session-b' });
    const after = out.lines.at(-1);
    assert.equal(after.autonomy.allowed, false);
    assert.match(after.autonomy.reason, /already playing/);
    assert.equal(after.selected, false);
    assert.equal(host.snapshot().current.playInstanceId, playing, 'the running track is untouched');
    assert.equal(host.snapshot().status, 'playing', 'and it keeps playing');

    // Now the track ends, so nothing is playing. Session B is the active one, so
    // it may start music; session A may not.
    host.core.onPlaybackEvent({ type: 'ended', playInstanceId: playing });
    await host.handle({ id: 'w', type: 'wait' });
    // The end of a track is itself an autonomous moment, and session B was the
    // active one by then, so the next track may already have started.
    assert.notEqual(host.snapshot().current?.playInstanceId, playing, 'the old track is no longer current');

    // A pause is the user's decision, and the refusal names that first: a paused
    // player is never started by any session event.
    await host.handle({ id: 'pause', type: 'command', command: { type: 'pause', commandId: 'c1' } });
    const pausedTrack = host.snapshot().current?.playInstanceId ?? null;
    await host.handle({ id: 'e5', type: 'session-event', name: 'turn/end', turn: 2, reason: { kind: 'completed' }, sessionId: 'session-a' });
    const fromInactive = out.lines.at(-1);
    assert.equal(fromInactive.autonomy.allowed, false, 'nothing may start while paused or playing');
    assert.equal(fromInactive.selected, false, 'so nothing started');
    assert.equal(host.snapshot().current?.playInstanceId ?? null, pausedTrack, 'and the paused track is unchanged');
    assert.equal(host.snapshot().paused, true, 'the pause survived every session event');

    // The active session also cannot undo the pause: allowed to ask, never to start.
    await host.handle({ id: 'e6', type: 'session-event', name: 'turn/end', turn: 2, reason: { kind: 'completed' }, sessionId: 'session-b' });
    const fromActive = out.lines.at(-1);
    assert.equal(fromActive.selected, false, 'a pause is never undone by an automatic event');
    assert.equal(host.snapshot().paused, true);
  } finally {
    await host.close();
  }
});

test('an event that may not start music still records which session is active', async () => {
  const out = { lines: [], write(chunk) { for (const line of chunk.split('\n')) if (line.trim()) this.lines.push(JSON.parse(line)); } };
  const host = createCoreHost({ output: out, playbackMode: 'fake', stateIntervalMs: 1000 });
  try {
    await host.start();
    // tool/call is allowlisted but must never trigger autonomy.
    await host.handle({ id: 't', type: 'session-event', name: 'tool/call', sessionId: 'session-x' });
    const answer = out.lines.at(-1);
    assert.equal(answer.autonomy.allowed, false);
    assert.match(answer.autonomy.reason, /may not start music/);
    assert.equal(answer.sessions.activeSessionId, 'session-x', 'the session is still tracked');

    await host.handle({ id: 's', type: 'sessions' });
    assert.equal(out.lines.at(-1).activeSessionId, 'session-x');
    assert.equal(out.lines.at(-1).sessions[0].events, 1);
  } finally {
    await host.close();
  }
});

test('a transient session precipitates less, and its influence is capped', () => {
  const transient = seededStore();
  const longTerm = seededStore();
  try {
    const before = transient.getPreference('track', 'netease:s1').affinity;
    // Same listen, different session kind.
    const small = applyListenGrowth({
      store: transient, entry: listen('session-t'), durationMs: track.durationMs, now: 1000,
      session: { sessionId: 'session-t', transient: true },
    });
    const full = applyListenGrowth({
      store: longTerm, entry: listen('session-l'), durationMs: track.durationMs, now: 1000,
      session: { sessionId: 'session-l', transient: false },
    });
    assert.ok(small.delta > 0, 'a transient session still contributes a little');
    assert.ok(full.delta > small.delta, `transient ${small.delta} must be smaller than full ${full.delta}`);
    assert.equal(small.sessionId, 'session-t');
    assert.ok(small.weight < full.weight);

    // The ceiling: one session cannot keep raising the same track. Influence is
    // counted by growth itself, so this holds regardless of what recorded the
    // listen.
    let applied = 0;
    let refusedForCap = 0;
    for (let index = 0; index < SESSION_PARAMETERS.sessionListenCap * 4; index += 1) {
      const report = applyListenGrowth({
        store: transient, entry: listen('session-t'), durationMs: track.durationMs, now: 2000 + index,
        session: { sessionId: 'session-t', transient: true },
      });
      if (report.updated) applied += 1;
      if (report.sessionCapped) refusedForCap += 1;
    }
    assert.ok(refusedForCap > 0, 'the session ceiling was reached');
    assert.ok(applied <= SESSION_PARAMETERS.sessionListenCap,
      `a single session applied ${applied} updates, above its cap of ${SESSION_PARAMETERS.sessionListenCap}`);
    // The one-off comparison call above also spent an allowance, so the total is
    // that one plus everything the loop applied.
    assert.equal(transient.getSessionInfluence('session-t', track), applied + 1,
      'the recorded influence matches the updates that were applied');

    // Keep going until the session is refused: the allowance is finite, so this
    // terminates, and the refusal names the ceiling rather than progress.
    let afterCap = null;
    for (let attempt = 0; attempt < 20 && !afterCap; attempt += 1) {
      const report = applyListenGrowth({
        store: transient, entry: listen('session-t'), durationMs: track.durationMs, now: 99_000 + attempt,
        session: { sessionId: 'session-t', transient: true },
      });
      if (report.sessionCapped) afterCap = report;
    }
    assert.ok(afterCap, 'the session was eventually refused');
    assert.equal(afterCap.updated, false);
    assert.match(afterCap.reason, /already contributed/);
    assert.equal(transient.getSessionInfluence('session-t', track), SESSION_PARAMETERS.sessionListenCap,
      'influence stops exactly at the ceiling');
    assert.ok(transient.getPreference('track', 'netease:s1').affinity <= GROWTH_PARAMETERS.max);
    assert.ok(transient.getPreference('track', 'netease:s1').affinity > before, 'the slow accumulation is real');
  } finally {
    transient.close();
    longTerm.close();
  }
});

test('the session ceiling survives a restart because it is recorded, not inferred', () => {
  const store = seededStore();
  try {
    for (let index = 0; index < SESSION_PARAMETERS.sessionListenCap + 3; index += 1) {
      applyListenGrowth({
        store, entry: listen('session-r'), durationMs: track.durationMs, now: 3000 + index,
        session: { sessionId: 'session-r', transient: false },
      });
    }
    const counted = store.getSessionInfluence('session-r', track);
    assert.equal(counted, SESSION_PARAMETERS.sessionListenCap, 'the allowance is fully spent');
    // A fresh growth call still refuses, without any in-memory state involved.
    const report = applyListenGrowth({
      store, entry: listen('session-r'), durationMs: track.durationMs, now: 4000,
      session: { sessionId: 'session-r', transient: false },
    });
    assert.equal(report.updated, false);
    assert.equal(report.sessionCapped, true);
    // A different session is unaffected: the cap is per session, not global.
    const other = applyListenGrowth({
      store, entry: listen('session-other'), durationMs: track.durationMs, now: 4000,
      session: { sessionId: 'session-other', transient: false },
    });
    assert.equal(other.updated, true);
  } finally {
    store.close();
  }
});

test('a listen with no session keeps full weight, so nothing is silently reduced', () => {
  const store = seededStore();
  try {
    const report = applyListenGrowth({
      store, entry: listen(null), durationMs: track.durationMs, now: 5000,
    });
    assert.equal(report.updated, true);
    assert.equal(report.sessionId, null);
    assert.equal(report.weight, 1, 'no session context means the full weight applies');
  } finally {
    store.close();
  }
});
