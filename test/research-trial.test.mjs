import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {participantTemplate, summarizeTrial, trialFiles} from '../scripts/research/trial.mjs';

const snapshot = () => JSON.parse(readFileSync(new URL('../scripts/fixtures/research/snapshot.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-10-18T20:00:00+08:00');
function packet({synthetic = false, participantId = 'p01'} = {}) {
  // This test-only conversion simulates a local input, never a recorded real trial.
  const s = snapshot(); if (!synthetic) s.kind = 'local-snapshot';
  const p = participantTemplate(s, {participantId});
  p.consent = {participate: true, localAnalysis: true, anonymousAggregate: true};
  p.feedback.confirmedHuman = true;
  p.feedback.ratings[0] = {...p.feedback.ratings[0], rating: 'worth', heardBefore: false, playback: 'played', reasonSupported: true};
  p.observations = [{startedAt: '2026-10-18T19:00:00+08:00', endedAt: '2026-10-18T19:30:00+08:00', activeMinutes: 10}];
  p.completed = true;
  return {participant: p, snapshot: s};
}

test('empty materials do not count as human participants, observation or discovery', () => {
  const s = snapshot(), p = participantTemplate(s, {participantId: 'p01'});
  const r = summarizeTrial([{participant: p, snapshot: s}], {now});
  assert.equal(r.completedParticipants, 0);
  assert.equal(r.activeObservationMinutes, 0);
  assert.equal(r.newDiscoveryRate, null);
  assert.deepEqual(r.topIssues, []);
  assert.equal(r.status, 'awaiting_real_trial');
});

test('synthetic labels and withdrawn or nonconsenting people never enter real trial results', () => {
  const synthetic = packet({synthetic: true}), withdrawn = packet({participantId: 'p02'}), noConsent = packet({participantId: 'p03'});
  withdrawn.participant.withdrawn = true; noConsent.participant.consent.anonymousAggregate = false;
  const r = summarizeTrial([synthetic, withdrawn, noConsent], {now});
  assert.deepEqual(r.excludedPackets, {synthetic: 1, withdrawn: 1, 'no-consent': 1});
  assert.equal(r.participantsWithObservation, 0);
  assert.equal(r.newDiscoveryCount, 0);
});

test('explicit feedback and actual participant minutes produce a bounded, anonymous summary', () => {
  const item = packet();
  item.participant.issues = [{stage: 'playback', code: 'playback', blocking: true, note: 'PRIVATE_NOTE_NEVER_EXPORT'}];
  item.participant.experiences.wouldUseAgain = true;
  const r = summarizeTrial([item], {now}), serialized = JSON.stringify(r);
  assert.equal(r.completedParticipants, 1);
  assert.equal(r.activeObservationMinutes, 10);
  assert.equal(r.judgedSongs, 1);
  assert.equal(r.worthRate, 1);
  assert.equal(r.newDiscoveryCount, 1);
  assert.equal(r.newDiscoveryDenominator, 1);
  assert.equal(r.topIssues.length, 1);
  assert.equal(r.topIssues[0].stage, 'playback');
  assert.equal(r.blockingIssueReports, 1);
  assert.equal(serialized.includes('PRIVATE_NOTE'), false);
  assert.equal(serialized.includes('p01'), false);
  assert.equal(serialized.includes('合成歌曲'), false);
  assert.equal(r.experiences.wouldUseAgain.yes, 1);
});

test('not having heard, an unknown rating or no playback cannot become a confirmed new discovery', () => {
  const item = packet(); item.participant.feedback.ratings[0].playback = 'unknown';
  assert.equal(summarizeTrial([item], {now}).newDiscoveryCount, 0);
  assert.equal(summarizeTrial([item], {now}).newDiscoveryRate, null);
  item.participant.feedback.ratings[0].rating = 'unknown'; item.participant.completed = false;
  assert.equal(summarizeTrial([item], {now}).worthRate, null);
});

test('duplicate participants and mixed studies are rejected instead of inflating the sample', () => {
  assert.throws(() => summarizeTrial([packet(), packet()], {now}), /重复/);
  const other = packet({participantId: 'p02'}); other.participant.studyId = 'other';
  assert.throws(() => summarizeTrial([packet(), other], {now}), /study/);
});

test('future, overlapping or inflated observation intervals cannot pass as real use', () => {
  const item = packet(), p = item.participant;
  p.observations[0].activeMinutes = 31;
  assert.throws(() => summarizeTrial([item], {now}), /观察时间/);
  p.observations[0].activeMinutes = 10; p.observations.push({...p.observations[0]});
  assert.throws(() => summarizeTrial([item], {now}), /重叠/);
  p.observations.pop();
  assert.throws(() => summarizeTrial([item], {now: now - 86400000}), /未来/);
});

test('completion and any trial experience require a real human assertion', () => {
  const item = packet(); item.participant.observations = [];
  assert.throws(() => summarizeTrial([item], {now}), /completed/);
  item.participant.completed = false; item.participant.feedback.confirmedHuman = false;
  item.participant.feedback.ratings[0] = {...item.participant.feedback.ratings[0], rating: 'unknown', heardBefore: null, reasonSupported: null, playback: 'unknown'};
  item.participant.experiences.disturbing = false;
  assert.throws(() => summarizeTrial([item], {now}), /confirmedHuman/);
});

test('trial CLI creates editable materials and the untouched packet reports zero real results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-trial-'));
  try {
    const out = join(directory, 'study', 'p01');
    const init = spawnSync(process.execPath, ['scripts/recommendation-research.mjs', 'trial-init', '--input', 'scripts/fixtures/research/snapshot.json', '--participant', 'p01', '--out', out], {encoding: 'utf8'});
    assert.equal(init.status, 0, init.stderr);
    assert.match(readFileSync(join(out, 'task-card.md'), 'utf8'), /合成演示/);
    const report = join(directory, 'report');
    const result = spawnSync(process.execPath, ['scripts/recommendation-research.mjs', 'trial-report', '--input', join(directory, 'study'), '--out', report], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(report, 'report.json'), 'utf8')).completedParticipants, 0);
    // A feedback file from a different batch must fail, even under the same alias.
    const p = JSON.parse(readFileSync(join(out, 'participant.json'), 'utf8'));
    p.consent = {participate: true, localAnalysis: true, anonymousAggregate: true}; p.feedback.inputHash = 'wrong';
    writeFileSync(join(out, 'participant.json'), JSON.stringify(p));
    const wrong = spawnSync(process.execPath, ['scripts/recommendation-research.mjs', 'trial-report', '--input', out, '--out', join(directory, 'wrong')], {encoding: 'utf8'});
    assert.equal(wrong.status, 1);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('generated consent defaults to opt-out and invalid anonymous aliases are rejected', () => {
  const files = trialFiles(snapshot(), {participantId: 'p01'});
  assert.deepEqual(files['participant.json'].consent, {participate: false, localAnalysis: false, anonymousAggregate: false});
  assert.throws(() => trialFiles(snapshot(), {participantId: '../private'}), /匿名/);
});
