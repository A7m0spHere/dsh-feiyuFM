import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicStore} from '../src/storage.mjs';
import {setTrackFeedback} from '../src/feedback.mjs';
import {factBundle, reserveSummary, finishSummary, FILTER_POLICY} from '../src/persona.mjs';
import {runPreferenceSignals, signalCandidates} from '../scripts/research/preference-signals.mjs';

const snapshot = {settings: {discoveryRate: .2, discovery: true, strategy: 'normal'}, current: null};
test('opposite track votes remain distinguishable when feedback counts are the same, and neutral is reversible', () => {
  const store = new MusicStore(), candidates = signalCandidates();
  try {
    candidates.forEach(t => store.upsertTrack(t, 1000));
    const bundle = () => factBundle(store, snapshot, 'discovery-filter', candidates);
    const before = bundle();
    setTrackFeedback(store, candidates[0], 1, 1001); setTrackFeedback(store, candidates[1], -1, 1001);
    const first = bundle();
    setTrackFeedback(store, candidates[0], -1, 1002); setTrackFeedback(store, candidates[1], 1, 1002);
    const other = bundle();
    assert.deepEqual(first.facts.taste, other.facts.taste);
    assert.notEqual(first.factHash, other.factHash);
    assert.equal(first.facts.candidates[0].feedback, 'liked');
    assert.equal(other.facts.candidates[0].feedback, 'reduced');
    assert.equal(Object.hasOwn(first.facts.candidates[2], 'feedback'), false);
    setTrackFeedback(store, candidates[0], 0, 1003); setTrackFeedback(store, candidates[1], 0, 1003);
    assert.equal(bundle().factHash, before.factHash);
    assert.equal(bundle().system, before.system);
  } finally { store.close(); }
});

test('per-track feedback reaches the actual reserved prompt within the existing budget, output parsing and ledger', () => {
  const store = new MusicStore(), candidates = signalCandidates();
  try {
    candidates.forEach(t => store.upsertTrack(t, 1000));
    store.setSetting('recommendation_mode_v1', 'filtered'); store.setSetting('summary_daily_tokens', 100000);
    setTrackFeedback(store, candidates[1], 1, 1001);
    const plan = reserveSummary({store, snapshot, provider: 'synthetic', model: 'synthetic', now: 1002,
      purpose: 'discovery-filter', candidates, candidateRevision: 'fixed-revision', candidateOwner: 'fixed-owner'});
    assert.equal(JSON.parse(plan.prompt).candidates[1].feedback, 'liked');
    assert.ok(Buffer.byteLength(plan.system + plan.prompt) <= FILTER_POLICY.maxPromptBytes);
    const completed = finishSummary({store, callId: plan.callId, status: 'completed', now: 1003,
      candidateRevision: 'fixed-revision', text: JSON.stringify({summary: 'synthetic', picks: [{i: 1, why: 'explicit like'}]}),
      usage: {inputTokens: 100, outputTokens: 30}});
    assert.equal(completed.success, true);
    assert.equal(store.getSetting('discovery_filter_v1').picks[0].trackKey, 'netease:2');
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM music_model_calls').get().n, 1);
    assert.equal(snapshot.current, null, 'preparing a prompt does not start playback');
  } finally { store.close(); }
});

test('feedback in large batches remains bounded by the existing candidate trimming and token budget', () => {
  const store = new MusicStore();
  try {
    const candidates = Array.from({length: 40}, (_, i) => ({provider: 'netease', providerTrackId: String(i), title: '长标题'.repeat(8), artist: '长艺人名'.repeat(5)}));
    candidates.forEach(t => { store.upsertTrack(t, 1000); setTrackFeedback(store, t, iVote(t), 1001); });
    const bundle = factBundle(store, snapshot, 'discovery-filter', candidates);
    assert.ok(bundle.facts.candidates.length <= FILTER_POLICY.maxCandidates);
    assert.ok(bundle.bytes <= FILTER_POLICY.maxPromptBytes);
    for (const c of bundle.facts.candidates) assert.ok(['liked', 'reduced'].includes(c.feedback));
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM music_model_calls').get().n, 0);
  } finally { store.close(); }
});
function iVote(t) { return Number(t.providerTrackId) % 2 ? 1 : -1; }

test('fixed preference signal counterfactuals are reproducible across feedback, learning, reset and account switch', () => {
  const r = runPreferenceSignals();
  assert.equal(r.passed, r.checkCount, JSON.stringify(r.checks.filter(c => !c.passed)));
  assert.ok(r.checkCount >= 15);
  assert.deepEqual(runPreferenceSignals(), r);
  assert.equal(r.newModelCalls, 0);
  assert.equal(r.productionDatabaseTouched, false);
  assert.equal(r.qualityGain, null);
});
