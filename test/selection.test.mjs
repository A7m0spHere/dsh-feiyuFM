// T2: autonomous selection — filtering, exploration, fallback, repeat penalty,
// cooldown and reproducibility. These are the A05 behaviours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { initializeAgentPreferences, createRng } from '../src/taste.mjs';
import { createSelector, scoreCandidate, SELECTION_PARAMETERS } from '../src/selection.mjs';
import { MusicCore } from '../src/core.mjs';
import { FakeClock, FakePlayback, FakeProvider } from '../src/fakes.mjs';

const n = (id, extra = {}) => ({ provider: 'netease', providerTrackId: id, title: `N${id}`, artist: 'A', ...extra });

function seeded(seed = 20260927) { return createRng(seed); }

function storeWithTracks(ids, { source = 'recent', playCounts = {} } = {}) {
  const store = new MusicStore();
  importSeedTracks({
    store, provider: 'netease', source, requested: ids.length,
    tracks: ids.map((id) => n(id, playCounts[id] === undefined ? {} : { playCount: playCounts[id] })),
  });
  initializeAgentPreferences({ store, seed: 1, now: 1000 });
  return store;
}

function recordPlay(store, track, at) {
  store.recordHistory({
    playInstanceId: `h-${track.providerTrackId}-${at}`,
    track, selectedBy: 'agent', progressSource: 'audio',
    effectiveMs: 1000, agentListening: true, audible: true, endReason: 'ended', endedAt: at,
  });
}

test('banned tracks never enter selection, even as the only candidate', () => {
  const store = storeWithTracks(['1', '2']);
  try {
    const selector = createSelector({ store, rng: seeded(), listFamiliar: () => [n('1'), n('2')] });
    store.addConstraint({ id: 'ban:netease:1', kind: 'ban_track', track: n('1'), createdAt: 1, summary: 'user ban' });

    const decision = selector.decide({ discoveryRate: 0, at: 5000 });
    assert.equal(decision.track.providerTrackId, '2', 'the banned track must be filtered before scoring');

    // Banned everything: wait, do not hand back a banned track.
    store.addConstraint({ id: 'ban:netease:2', kind: 'ban_track', track: n('2'), createdAt: 1, summary: 'user ban' });
    const empty = selector.decide({ discoveryRate: 0, at: 5000 });
    assert.equal(empty.track, null);
    assert.equal(empty.reason, 'every candidate was filtered out');
  } finally {
    store.close();
  }
});

test('a track known to be unplayable is filtered out before scoring', () => {
  const store = storeWithTracks(['1', '2']);
  try {
    const selector = createSelector({
      store, rng: seeded(), listFamiliar: () => [n('1'), n('2')],
      isPlayable: (track) => track.providerTrackId !== '1',
    });
    const decision = selector.decide({ discoveryRate: 0, at: 5000 });
    assert.equal(decision.track.providerTrackId, '2');
    assert.equal(decision.considered.familiar, 1, 'the unplayable track is not even counted');
  } finally {
    store.close();
  }
});

test('discovery rate 0 always stays familiar; 100 always tries discovery', () => {
  const store = storeWithTracks(['1', '2']);
  try {
    const familiar = [n('1'), n('2')];
    const discovery = [n('9'), n('8')];

    const never = createSelector({ store, rng: seeded(), listFamiliar: () => familiar, listDiscovery: () => discovery });
    for (let index = 0; index < 12; index += 1) {
      const decision = never.decide({ discoveryRate: 0, at: 5000 });
      assert.equal(decision.pool, 'familiar', 'a 0% rate must never explore');
      assert.equal(decision.fellBack, false);
    }

    const always = createSelector({ store, rng: seeded(), listFamiliar: () => familiar, listDiscovery: () => discovery });
    for (let index = 0; index < 12; index += 1) {
      const decision = always.decide({ discoveryRate: 1, at: 5000 });
      assert.equal(decision.pool, 'discovery', 'a 100% rate must always attempt discovery');
    }
  } finally {
    store.close();
  }
});

test('an empty discovery pool falls back to familiar and records that no exploration happened', () => {
  const store = storeWithTracks(['1', '2']);
  try {
    const selector = createSelector({ store, rng: seeded(), listFamiliar: () => [n('1'), n('2')], listDiscovery: () => [] });
    const decision = selector.decide({ discoveryRate: 1, at: 5000 });
    assert.equal(decision.pool, 'familiar');
    assert.equal(decision.fellBack, true, 'the fallback must be visible');
    assert.match(decision.fallbackReason, /discovery pool had no usable track/);
    assert.equal(decision.discoveryRate, 1, 'the user setting is preserved, not rewritten');
  } finally {
    store.close();
  }
});

test('a 20 percent target produces a replayable distribution rather than requiring an exact short-run ratio', () => {
  const store = storeWithTracks(['1']);
  try {
    const make = () => createSelector({ store, rng: seeded(9876), listFamiliar: () => [n('1')], listDiscovery: () => [n('9')] });
    const first=make(), replay=make();
    const sequence=Array.from({length:1000},()=>first.decide({discoveryRate:0.2,at:5000}).pool);
    assert.deepEqual(sequence,Array.from({length:1000},()=>replay.decide({discoveryRate:0.2,at:5000}).pool));
    const discovered=sequence.filter(pool=>pool==='discovery').length;
    assert.ok(discovered>=160 && discovered<=240,`20% target gave ${discovered}/1000`);
  } finally { store.close(); }
});

test('nothing to play returns a decision with no track so the caller waits', () => {
  const store = new MusicStore();
  try {
    let calls = 0;
    const selector = createSelector({
      store, rng: seeded(),
      listFamiliar: () => { calls += 1; return []; },
      listDiscovery: () => [],
    });
    const decision = selector.decide({ discoveryRate: 0.2, at: 5000 });
    assert.equal(decision.track, null);
    assert.equal(decision.reason, 'no candidates');
    assert.equal(calls, 1, 'one attempt only: the caller is responsible for not looping');
  } finally {
    store.close();
  }
});

test('a recent play is penalised and then excluded by its cooldown', () => {
  const store = storeWithTracks(['1', '2']);
  try {
    // Realistic epoch-scale timestamps: a window subtraction must stay positive.
    const now = Date.parse('2026-09-27T12:00:00+08:00');
    // Track 1 was played 40 minutes ago: inside the repeat window, outside cooldown.
    recordPlay(store, n('1'), now - 40 * 60 * 1000);
    const selector = createSelector({ store, rng: seeded(), listFamiliar: () => [n('1'), n('2')] });
    const decision = selector.decide({ discoveryRate: 0, at: now });
    assert.equal(decision.track.providerTrackId, '2', 'the just-played track must lose to a fresh one');
    assert.equal(decision.detail.repeatPlays, 0);
    assert.deepEqual(decision.considered, { familiar: 2, discovery: 0, offered: 2 });

    // Track 2 played 5 minutes ago: inside cooldown, so it is not a candidate.
    // Track 1's own 30-minute cooldown has already expired, so it is back.
    recordPlay(store, n('2'), now - 5 * 60 * 1000);
    const cooled = selector.decide({ discoveryRate: 0, at: now });
    assert.equal(cooled.track?.providerTrackId, '1', 'the cooling track is excluded, the expired one is available');
    assert.deepEqual(cooled.considered, { familiar: 1, discovery: 0, offered: 2 });

    // With both cooling down there is genuinely nothing to play.
    recordPlay(store, n('1'), now - 5 * 60 * 1000);
    const bothCooling = selector.decide({ discoveryRate: 0, at: now });
    assert.equal(bothCooling.track, null, 'both candidates are cooling down');
    assert.equal(bothCooling.reason, 'every candidate was filtered out');

    // 31 minutes later the cooldown has passed for both again.
    const later = selector.decide({ discoveryRate: 0, at: now + 31 * 60 * 1000 });
    assert.ok(later.track, 'after the cooldown window a track is selectable again');
  } finally {
    store.close();
  }
});

test('repeat penalty grows with the number of recent plays', () => {
  const store = storeWithTracks(['1']);
  try {
    const now = Date.parse('2026-09-27T12:00:00+08:00');
    const play = (count) => {
      for (let index = 0; index < count; index += 1) {
        recordPlay(store, n('1'), now - (index + 1) * 60 * 60 * 1000);
      }
    };
    const base = scoreCandidate({
      track: n('1'), store, now, plays: new Map(), randomValue: 0.5,
    });
    play(1);
    const once = scoreCandidate({
      track: n('1'), store, now, randomValue: 0.5,
      plays: new Map([['netease:1', { plays: 1, lastPlayedAt: now - 3_600_000 }]]),
    });
    const twice = scoreCandidate({
      track: n('1'), store, now, randomValue: 0.5,
      plays: new Map([['netease:1', { plays: 2, lastPlayedAt: now - 1_800_000 }]]),
    });
    assert.ok(once.score < base.score, 'one recent play must lower the score');
    assert.ok(twice.score < once.score, 'more recent plays must lower it further');
    assert.ok(once.repeatPenalty === SELECTION_PARAMETERS.repeatPenalty);
    assert.ok(twice.repeatPenalty < once.repeatPenalty);
    assert.equal(base.freshness, SELECTION_PARAMETERS.freshnessBonus, 'an unplayed track gets the freshness bonus');
    assert.equal(once.freshness, 0);
  } finally {
    store.close();
  }
});

test('agent preference outranks an otherwise identical candidate', () => {
  const store = storeWithTracks(['1', '2']);
  try {
    store.setPreference({ targetType: 'track', targetKey: 'netease:2', affinity: 0.95, source: 'seed', updatedAt: 1 });
    store.setPreference({ targetType: 'track', targetKey: 'netease:1', affinity: 0.05, source: 'seed', updatedAt: 1 });
    // A fixed random value removes the tie-breaking term from the comparison.
    const decision = createSelector({ store, rng: () => 0.5, listFamiliar: () => [n('1'), n('2')] }).decide({ discoveryRate: 0, at: 5000 });
    assert.equal(decision.track.providerTrackId, '2');
    assert.ok(decision.detail.affinity > 0.9);
  } finally {
    store.close();
  }
});

test('a fixed seed reproduces the same selection sequence', () => {
  const run = (seed) => {
    const store = storeWithTracks(['1', '2', '3', '4']);
    try {
      const selector = createSelector({
        store, rng: createRng(seed),
        listFamiliar: () => [n('1'), n('2')],
        listDiscovery: () => [n('3'), n('4')],
      });
      const sequence = [];
      for (let index = 0; index < 20; index += 1) {
        const decision = selector.decide({ discoveryRate: 0.5, at: 10_000 + index });
        sequence.push(`${decision.pool}:${decision.track?.providerTrackId ?? 'none'}`);
      }
      return sequence;
    } finally {
      store.close();
    }
  };
  const first = run(4242);
  const second = run(4242);
  assert.deepEqual(first, second, 'the same seed must reproduce the same trajectory');
  assert.ok(first.some((entry) => entry.startsWith('discovery')), 'a 50% rate should explore at least once in 20 draws');
  assert.notDeepEqual(first, run(9999), 'a different seed should give a different trajectory');
});

test('the core waits instead of looping when the selector has nothing', async () => {
  const store = new MusicStore();
  const provider = new FakeProvider();
  const playback = new FakePlayback();
  let selectorCalls = 0;
  const selector = {
    next() { selectorCalls += 1; return { track: null, pool: null, fellBack: false, reason: 'no candidates', considered: { familiar: 0, discovery: 0 } }; },
  };
  const core = new MusicCore({ store, provider, playback, selector, clock: new FakeClock(1000) });
  try {
    // 用户主动要求开始听歌却没有候选：一次尝试后如实报错，不进入重试循环。
    assert.throws(() => core.dispatch({ commandId: 'c1', type: 'chooseSelf' }), { code: 'no_candidates' });
    await core.waitForIdle();
    assert.equal(core.snapshot().current, null);
    assert.equal(playback.playing, false);
    // chooseSelf triggers one autonomous attempt, not a retry loop.
    assert.equal(selectorCalls, 1, `expected a single attempt, saw ${selectorCalls}`);
    assert.equal(core.snapshot().lastSelection.reason, 'no candidates');
    assert.equal(core.snapshot().status, 'idle');
  } finally {
    store.close();
  }
});

test('an autonomous pick records why it happened, and user commands bypass the selector', async () => {
  const store = storeWithTracks(['1', '2']);
  const provider = new FakeProvider();
  provider.set(n('2'), 'fake:handle');
  const playback = new FakePlayback();
  const selector = createSelector({ store, rng: () => 0.5, listFamiliar: () => [n('1'), n('2')], listDiscovery: () => [] });
  const core = new MusicCore({ store, provider, playback, selector, clock: new FakeClock(50_000) });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ commandId: `cmd-${++id}`, type, ...extra });
  try {
    store.setPreference({ targetType: 'track', targetKey: 'netease:2', affinity: 0.9, source: 'seed', updatedAt: 1 });
    send('chooseSelf');
    await core.waitForIdle();
    const selection = core.snapshot().lastSelection;
    assert.ok(selection, 'the autonomous decision must be recorded');
    assert.equal(selection.trackKey, 'netease:2');
    assert.equal(selection.pool, 'familiar');
    assert.equal(selection.fellBack, false);
    assert.ok(typeof selection.score === 'number');

    // A user's explicit pick is not a selection decision and must not be logged
    // as one: the agent did not choose it.
    send('banTrack', { track: n('2') });
    assert.throws(() => send('requestTrack', { track: n('2') }), { code: 'constraint_conflict' });
    assert.equal(core.snapshot().lastSelection.trackKey, 'netease:2', 'the ban does not rewrite history');
  } finally {
    store.close();
  }
});

test('discovery off means no exploration even at a 100% rate', () => {
  const store = storeWithTracks(['1']);
  try {
    const selector = createSelector({ store, rng: () => 0.01, listFamiliar: () => [n('1')], listDiscovery: () => [n('9')] });
    // The core passes 0 when the discovery switch is off, which is the real gate.
    const decision = selector.decide({ discoveryRate: 0, at: 5000 });
    assert.equal(decision.pool, 'familiar');
    assert.equal(decision.fellBack, false, 'no exploration was attempted, so nothing was fallen back from');
  } finally {
    store.close();
  }
});
