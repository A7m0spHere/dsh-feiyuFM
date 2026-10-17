import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {compareExploration, describeCandidateEvidence} from '../scripts/research/exploration.mjs';
import {digest, feedbackTemplate} from '../scripts/research/quality.mjs';
import {MusicStore} from '../src/storage.mjs';
import {buildSelector} from '../src/core-host.mjs';
import {setTrackFeedback} from '../src/feedback.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('../scripts/fixtures/research/exploration.json', import.meta.url), 'utf8'));
const profile = (r, rate, name) => r.scenarios.find(s => s.requestedRate === rate).profiles.find(p => p.profile === name);

test('source evidence distinguishes familiarity and adjacency without inventing distant music or moods', () => {
  const s = fixture();
  assert.equal(describeCandidateEvidence(s.candidates[0]).category, 'familiar');
  assert.equal(describeCandidateEvidence(s.candidates[2]).category, 'adjacent');
  assert.equal(describeCandidateEvidence(s.candidates[4]).category, 'unknown');
  assert.equal(describeCandidateEvidence(s.candidates[5]).category, 'unknown', 'similar source without a recorded seed link is insufficient');
  for (const c of s.candidates) {
    const e = describeCandidateEvidence(c);
    assert.equal(e.distance, 'unknown'); assert.equal(e.genre, 'unknown'); assert.equal(e.mood, 'unknown');
  }
});

test('frozen prefix hypotheses are deterministic, share costs and never add unselected tracks', () => {
  const s = fixture(), hash = digest(s), r = compareExploration(s, {topK: 3});
  assert.deepEqual(compareExploration(s, {topK: 3}), r);
  assert.equal(digest(s), hash);
  assert.deepEqual(profile(r, 20, 'recorded-rank').ids, ['c001', 'c002', 'c005']);
  assert.deepEqual(profile(r, 20, 'familiar-first').ids, ['c001', 'c002', 'c003']);
  assert.deepEqual(profile(r, 20, 'related-diverse').ids, ['c001', 'c003', 'c004']);
  assert.equal(profile(r, 20, 'related-diverse').metrics.artistDiversity, 1);
  assert.equal(profile(r, 20, 'related-diverse').metrics.worthRate, null);
  assert.equal(r.sharedCosts.recordedCalls, 2);
  assert.equal(r.sharedCosts.recorded.completionRate, .5);
  assert.equal(r.sharedCosts.recorded.meanRecordedElapsedMs, 600);
  assert.equal(r.newModelCalls, 0);
  assert.equal(r.decision, 'keep-current-production-policy');
  const unselected = fixture(); unselected.selection.response.picks = [{i: 0, why: 'only'}];
  for (const row of compareExploration(unselected).scenarios) for (const p of row.profiles) assert.deepEqual(p.ids, ['c001']);
});

test('off and zero rates admit confirmed familiarity only; missing history never becomes familiar', () => {
  const s = fixture();
  for (const p of compareExploration(s).scenarios[0].profiles) assert.deepEqual(p.ids, ['c001', 'c002']);
  s.context.discoveryEnabled = false;
  for (const row of compareExploration(s).scenarios) {
    assert.equal(row.explorationAllowed, false);
    for (const p of row.profiles) assert.deepEqual(p.ids, ['c001', 'c002']);
  }
  s.context.discoveryEnabled = true; s.context.exploration = 0;
  assert.equal(compareExploration(s).scenarios.at(-1).explorationAllowed, false);
  s.candidates[0].known = null;
  assert.deepEqual(profile(compareExploration(s), 100, 'recorded-rank').ids, ['c001', 'c002'], 'explicit like remains familiar without claiming prior listening');
});

test('captured pause and autonomy-off cannot be undone by any replay profile', () => {
  const s = fixture(); s.context.paused = true;
  for (const row of compareExploration(s).scenarios) {
    assert.equal(row.rejection, 'user-paused'); for (const p of row.profiles) assert.deepEqual(p.ids, []);
  }
  s.context.paused = false; s.context.listening = false;
  assert.equal(compareExploration(s).scenarios[0].rejection, 'autonomy-disabled');
  delete s.context.listening; delete s.context.paused;
  assert.deepEqual(compareExploration(s).scenarios[0].controlsUnknown, ['listening', 'paused']);
});

test('expired, unavailable, banned, empty, failed and mismatched batches retain explicit rejection paths', () => {
  const s = fixture(), r = compareExploration(s);
  for (const row of r.scenarios) for (const p of row.profiles) { assert.equal(p.ids.includes('c007'), false); assert.equal(p.ids.includes('c008'), false); }
  s.asOf += 7 * 60 * 60_000;
  assert.equal(compareExploration(s).scenarios[0].rejection, 'no-eligible-model-picks');
  for (const [field, value, code] of [['owner', 'other', 'account_mismatch'], ['revision', 'other', 'stale_candidates'], ['status', 'failed', 'failed']]) {
    const bad = fixture(); bad.selection[field] = value;
    assert.equal(compareExploration(bad).scenarios[0].rejection, code);
  }
  const empty = fixture(); empty.candidates = []; empty.recentIds = []; empty.selection.response.picks = [];
  assert.equal(compareExploration(empty).scenarios[0].rejection, 'no-platform-candidates');
});

test('human judgments evaluate profiles but cannot leak into ranking or authorize production changes', () => {
  const s = fixture(), f = feedbackTemplate(s), before = compareExploration(s, {topK: 3});
  f.confirmedHuman = true;
  f.ratings[2] = {...f.ratings[2], rating: 'worth', heardBefore: false, reasonSupported: true, playback: 'played'};
  f.ratings[4] = {...f.ratings[4], rating: 'not-worth', heardBefore: false, playback: 'played'};
  const after = compareExploration(s, {feedback: f, topK: 3});
  assert.deepEqual(after.scenarios.map(s => s.profiles.map(p => p.ids)), before.scenarios.map(s => s.profiles.map(p => p.ids)));
  assert.equal(profile(after, 20, 'related-diverse').metrics.worthRate, 1);
  assert.equal(profile(after, 20, 'recorded-rank').humanRatings['not-worth'], 1);
  assert.equal(profile(after, 20, 'related-diverse').humanRatings.worth, 1);
  assert.equal(after.evidenceStatus, 'synthetic-only');
  assert.equal(after.decision, 'keep-current-production-policy');
  f.inputHash = 'other'; assert.throws(() => compareExploration(s, {feedback: f}), /批次/);
});

test('missing historical duration and quality stay unknown and invalid options are rejected', () => {
  const s = fixture(); s.calls.forEach(c => delete c.elapsedMs);
  assert.equal(compareExploration(s).sharedCosts.recorded.meanRecordedElapsedMs, null);
  assert.equal(compareExploration(s).sharedCosts.recorded.elapsedUnknownCount, 2);
  assert.throws(() => compareExploration(s, {rates: [20, 20]}), /rates/);
  assert.throws(() => compareExploration(s, {rates: [NaN]}), /rates/);
  assert.throws(() => compareExploration(s, {rates: [-1]}), /rates/);
  assert.throws(() => compareExploration(s, {topK: 0}), /topK/);
  s.candidates[0].seedRelated = 'maybe'; assert.throws(() => compareExploration(s), /seedRelated/);
});

test('actual filtered selector gates zero rate and bans; positive rates do not promise a proportion', () => {
  const store = new MusicStore();
  try {
    const tracks = [1, 2].map(i => ({provider: 'netease', providerTrackId: String(i), title: `Synthetic ${i}`, artist: `Artist ${i}`,
      discovery: {source: 'netease_similar', llmRank: i}}));
    tracks.forEach(t => store.upsertTrack(t, 1000));
    store.setSetting('recommendation_mode_v1', 'filtered'); setTrackFeedback(store, tracks[1], 1, 1000);
    const next = rate => buildSelector({store, rng: () => 0, now: () => 2000, listDiscovery: () => tracks}).next({discoveryRate: rate}).track;
    assert.equal(next(0).providerTrackId, '2');
    for (const rate of [.2, .7, 1]) assert.equal(next(rate).providerTrackId, '2');
    store.addConstraint({id: 'ban', kind: 'ban_track', track: tracks[1], createdAt: 1000, summary: 'synthetic'});
    assert.equal(next(0), null);
    assert.equal(next(1).providerTrackId, '1');
  } finally { store.close(); }
});

test('exploration CLI creates a bounded standalone artifact and refuses malformed rate lists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fishfm-explore-'));
  try {
    const out = join(dir, 'report'), input = 'scripts/fixtures/research/exploration.json';
    const first = spawnSync(process.execPath, ['scripts/recommendation-research.mjs', 'exploration', '--input', input, '--out', out, '--top-k', '3'], {encoding: 'utf8'});
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).scenarios.length, 4);
    const bad = spawnSync(process.execPath, ['scripts/recommendation-research.mjs', 'exploration', '--input', input, '--out', join(dir, 'bad'), '--rates', '20,'], {encoding: 'utf8'});
    assert.equal(bad.status, 1);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
