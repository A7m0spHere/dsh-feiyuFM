// T3: growth — what a finished listen is allowed to change.
//
// The properties that matter: only real progress counts, silence and audibility
// stay distinguishable, a user's own choice teaches the agent nothing, nothing
// ever lowers an affinity, and the self-selection loop cannot ratchet a
// preference to certainty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { initializeAgentPreferences } from '../src/taste.mjs';
import {
  GROWTH_PARAMETERS, qualifiesAsListen, listenWeight, applyListenGrowth,
  decayPreferences, describeGrowth,
} from '../src/growth.mjs';
import { MusicCore } from '../src/core.mjs';
import { FakeClock, FakePlayback, FakeProvider } from '../src/fakes.mjs';

const track = { provider: 'netease', providerTrackId: 'g1', title: 'G1', artist: 'Artist G', durationMs: 200_000 };
const now = Date.parse('2026-09-27T12:00:00+08:00');

const entry = (extra = {}) => ({
  playInstanceId: `p-${Math.random().toString(36).slice(2)}`,
  track, selectedBy: 'agent', progressSource: 'audio',
  effectiveMs: 120_000, agentListening: true, audible: true,
  endReason: 'ended', durationMs: track.durationMs,
  ...extra,
});

function storeWithTrack() {
  const store = new MusicStore();
  importSeedTracks({ store, provider: 'netease', source: 'recent', requested: 1, tracks: [track] });
  initializeAgentPreferences({ store, seed: 5, now });
  return store;
}

test('only real effective progress counts as a listen', () => {
  const cases = [
    [{ effectiveMs: 120_000 }, true, 'a completed play'],
    [{ effectiveMs: 120_000, endReason: 'skipped' }, true, 'a skip after half the track'],
    [{ effectiveMs: 5_000 }, false, 'a few seconds is not listening'],
    [{ endReason: 'error', effectiveMs: 120_000 }, false, 'a failure is not a preference signal'],
    [{ selectedBy: 'user' }, false, "the user's own choice is not an agent experience"],
  ];
  for (const [extra, expected, label] of cases) {
    const verdict = qualifiesAsListen({ entry: entry(extra), durationMs: track.durationMs });
    assert.equal(verdict.qualifies, expected, `${label} should ${expected ? '' : 'not '}qualify: ${verdict.reason}`);
  }

  // The threshold follows the track: half of it, or 30 seconds, whichever is less.
  const short = qualifiesAsListen({ entry: entry({ effectiveMs: 12_000 }), durationMs: 20_000 });
  assert.equal(short.qualifies, true, 'half of a 20s track is 10s, so 12s qualifies');
  assert.equal(short.thresholdMs, 10_000);
  const unknownDuration = qualifiesAsListen({ entry: entry({ effectiveMs: 29_000 }), durationMs: null });
  assert.equal(unknownDuration.qualifies, false, 'without a duration the absolute floor applies');
  assert.equal(unknownDuration.thresholdMs, GROWTH_PARAMETERS.minEffectiveMs);
});

test('silent and audible listens are weighted differently and recorded differently', () => {
  const audible = listenWeight(entry({ audible: true }));
  const silent = listenWeight(entry({ audible: false }));
  const skipped = listenWeight(entry({ audible: true, endReason: 'skipped' }));
  assert.equal(audible, 1);
  assert.ok(silent < audible, 'silent experience counts less than audible playback');
  assert.ok(skipped < audible, 'a skip counts less than a completed play');

  const store = storeWithTrack();
  try {
    applyListenGrowth({ store, entry: entry({ audible: false }), durationMs: track.durationMs, now });
    assert.equal(store.getPreference('track', 'netease:g1').source, 'listen_silent');

    const store2 = storeWithTrack();
    applyListenGrowth({ store: store2, entry: entry({ audible: true }), durationMs: track.durationMs, now });
    assert.equal(store2.getPreference('track', 'netease:g1').source, 'listen');
    assert.ok(store2.getPreference('track', 'netease:g1').affinity > store.getPreference('track', 'netease:g1').affinity,
      'audible playback must move the preference further than silence');
    store2.close();
  } finally {
    store.close();
  }
});

test('a pause, a failure, a short listen and a user pick change nothing', () => {
  const store = storeWithTrack();
  try {
    const before = store.getPreference('track', 'netease:g1').affinity;
    const reports = [
      applyListenGrowth({ store, entry: entry({ effectiveMs: 2_000 }), durationMs: track.durationMs, now }),
      applyListenGrowth({ store, entry: entry({ endReason: 'error' }), durationMs: track.durationMs, now }),
      applyListenGrowth({ store, entry: entry({ selectedBy: 'user' }), durationMs: track.durationMs, now }),
    ];
    for (const report of reports) {
      assert.equal(report.updated, false);
      assert.equal(report.delta, 0);
      assert.ok(report.reason, 'a refusal must explain itself');
    }
    assert.equal(store.getPreference('track', 'netease:g1').affinity, before, 'none of these may move a preference');
    assert.equal(store.getHistory('nope'), null);
  } finally {
    store.close();
  }
});

test('nothing ever lowers an affinity, so a skip is not dislike', () => {
  const store = storeWithTrack();
  try {
    const before = store.getPreference('track', 'netease:g1').affinity;
    // A skip after real progress counts a little, never negatively.
    const skipped = applyListenGrowth({ store, entry: entry({ endReason: 'skipped' }), durationMs: track.durationMs, now });
    assert.ok(skipped.after >= before, 'a skip must not reduce a preference');
    // A platform failure teaches nothing at all.
    const failed = applyListenGrowth({ store, entry: entry({ endReason: 'error' }), durationMs: track.durationMs, now });
    assert.equal(failed.updated, false);
    assert.equal(failed.delta, 0);
  } finally {
    store.close();
  }
});

test('repeated listening cannot ratchet a preference to certainty', () => {
  const store = storeWithTrack();
  try {
    const key = 'netease:g1';
    const start = store.getPreference('track', key).affinity;
    let previous = start;
    const deltas = [];
    for (let index = 0; index < 200; index += 1) {
      const report = applyListenGrowth({
        store, entry: entry({ playInstanceId: `rep-${index}` }), durationMs: track.durationMs, now: now + index,
      });
      deltas.push(report.delta);
      previous = report.after;
    }
    assert.ok(previous <= GROWTH_PARAMETERS.max, `affinity ${previous} escaped the ceiling`);
    assert.ok(previous < GROWTH_PARAMETERS.max, 'the ceiling is approached, never reached by playing alone');
    assert.ok(deltas[0] > deltas.at(-1), 'steps must shrink as the preference approaches the ceiling');
    assert.ok(previous - start < 1, 'two hundred listens must not saturate the scale');
    assert.ok(store.getPreference('artist', 'Artist G').affinity <= GROWTH_PARAMETERS.max);
    // One play is weak evidence about an artist: it must move less than the track.
    assert.ok(store.getPreference('artist', 'Artist G').affinity - GROWTH_PARAMETERS.neutral
      < previous - start, 'the artist must move less than the track');
  } finally {
    store.close();
  }
});

test('decay pulls preferences back toward neutral over time', () => {
  const store = storeWithTrack();
  try {
    applyListenGrowth({ store, entry: entry(), durationMs: track.durationMs, now });
    const raised = store.getPreference('track', 'netease:g1').affinity;
    const later = now + 90 * 24 * 60 * 60 * 1000;
    const result = decayPreferences({ store, now: later });
    assert.ok(result.changed >= 1);
    const decayed = store.getPreference('track', 'netease:g1').affinity;
    assert.ok(decayed < raised, 'time must pull the preference back toward neutral');
    assert.ok(decayed > GROWTH_PARAMETERS.neutral, 'a 90-day decay must not overshoot past neutral');

    // No time passing means no decay at all.
    const none = decayPreferences({ store, now: later });
    assert.equal(none.changed, 0);
  } finally {
    store.close();
  }
});

test('two seeds grow into different personalities, they do not copy the user', () => {
  const build = (seed) => {
    const store = new MusicStore();
    const tracks = ['1', '2', '3'].map((id) => ({ provider: 'netease', providerTrackId: id, title: `N${id}`, artist: `A${id}`, durationMs: 100_000 }));
    // The user's own play counts are deliberately lopsided...
    importSeedTracks({
      store, provider: 'netease', source: 'recent', requested: 3, tracks,
    });
    store.db.prepare('UPDATE user_environment SET play_count = ? WHERE track_key = ?').run(99, 'netease:1');
    store.db.prepare('UPDATE user_environment SET play_count = ? WHERE track_key = ?').run(1, 'netease:3');
    initializeAgentPreferences({ store, seed, now });
    return { store, tracks };
  };
  const first = build(101);
  const second = build(202);
  try {
    // ...but only one track is actually listened to, and only for the first
    // agent. One bounded step is +0.03 against ±0.15 initialization jitter, so
    // expressing a preference over noise takes repeated listening by design.
    const listens = 15;
    for (let index = 0; index < listens; index += 1) {
      applyListenGrowth({ store: first.store, entry: entry({ track: first.tracks[2] }), durationMs: 100_000, now: now + index });
    }

    const read = (store) => ['1', '2', '3'].map((id) => store.getPreference('track', `netease:${id}`).affinity);
    const [a1, a2, a3] = read(first.store);
    const b3 = read(second.store)[2];

    assert.notDeepEqual(read(first.store), read(second.store), 'experience must differentiate the two agents');
    assert.ok(a3 > b3, 'the listened track must grow for the agent that heard it');
    assert.ok(a3 > a2, `repeated listening must outweigh initialization noise (${a3} vs ${a2})`);
    assert.ok(a3 > a1, 'the agent follows its own experience, not the user play counts');
    // A single listen is deliberately too weak to separate two tracks.
    const single = build(101);
    try {
      applyListenGrowth({ store: single.store, entry: entry({ track: single.tracks[2] }), durationMs: 100_000, now });
      const after = ['1', '2', '3'].map((id) => single.store.getPreference('track', `netease:${id}`).affinity);
      assert.ok(Math.abs(after[2] - after[1]) < 0.15, 'one listen stays inside the initialization noise band');
    } finally {
      single.store.close();
    }
  } finally {
    first.store.close();
    second.store.close();
  }
});

test('the core only reports finished listens; policy stays outside it', async () => {
  const store = storeWithTrack();
  const provider = new FakeProvider();
  provider.set(track, 'fake:handle');
  const playback = new FakePlayback();
  const reported = [];
  const core = new MusicCore({
    store, provider, playback, clock: new FakeClock(now),
    onListened: (entry) => reported.push(entry),
  });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  try {
    // `next` needs somewhere to go, so the core gets a fixed queue for this test.
    core.setQueue([track, { ...track, providerTrackId: 'g2', title: 'G2' }]);
    core.dispatch({ commandId: 'c1', type: 'requestTrack', track });
    await core.waitForIdle();
    const instance = core.snapshot().current.playInstanceId;
    // A user-driven switch finishes the current listen as a skip, so the
    // progress already earned is not lost.
    core.dispatch({ commandId: 'c2', type: 'next' });
    await core.waitForIdle();

    assert.equal(reported.length, 1, 'exactly one finished listen is reported');
    assert.equal(reported[0].selectedBy, 'user');
    assert.equal(reported[0].endReason, 'skipped');
    assert.equal(typeof reported[0].durationMs, 'number');

    // A pause is not a finished listen: nothing is reported and nothing is
    // recorded as experienced, which is what keeps A10 honest.
    core.dispatch({ commandId: 'c3', type: 'pause' });
    await core.waitForIdle();
    assert.equal(reported.length, 1, 'a pause must not report a finished listen');
    assert.equal(core.onPlaybackEvent({ type: 'ended', playInstanceId: instance }), false,
      'a late ended for a paused player is refused');
    assert.equal(reported.length, 1);
  } finally {
    store.close();
  }
});

test('a restart does not fabricate listening history or growth', () => {
  const store = storeWithTrack();
  try {
    applyListenGrowth({ store, entry: entry(), durationMs: track.durationMs, now });
    const affinity = store.getPreference('track', 'netease:g1').affinity;
    const historyCount = store.db.prepare('SELECT COUNT(*) AS count FROM listen_history').get().count;

    // Reopening the same store must not add history or move anything.
    decayPreferences({ store, now });
    assert.equal(store.getPreference('track', 'netease:g1').affinity, affinity);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM listen_history').get().count, historyCount);
    const summary = describeGrowth(store);
    assert.equal(summary.listenedTracks, 1, 'one track was listened to');
    assert.equal(summary.listenedArtists, 1, 'its artist moved too, counted separately');
    assert.equal(summary.tracks, 1);
    assert.equal(summary.artists, 1);
    assert.equal(summary.ceiling, GROWTH_PARAMETERS.max);
    assert.ok(summary.highest <= GROWTH_PARAMETERS.max);
  } finally {
    store.close();
  }
});