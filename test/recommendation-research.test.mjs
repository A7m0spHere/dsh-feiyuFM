import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {MusicStore} from '../src/storage.mjs';
import {evaluate, feedbackTemplate, digest} from '../scripts/research/quality.mjs';
import {exportSnapshot} from '../scripts/research/snapshot.mjs';
import {parseArgs, writeBundle} from '../scripts/recommendation-research.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('../scripts/fixtures/research/snapshot.json', import.meta.url), 'utf8'));
const temporary = fn => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-research-'));
  try { return fn(directory); } finally { rmSync(directory, {recursive: true, force: true}); }
};

test('saved selection replay is deterministic, does not mutate input and never invents human quality', () => {
  const s = fixture(), before = JSON.stringify(s), r = evaluate(s, {topK: 3});
  assert.deepEqual(r, evaluate(JSON.parse(before), {topK: 3}));
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(r.baseline.ids, ['c001', 'c002', 'c003']);
  assert.deepEqual(r.variant.ids, ['c001', 'c003', 'c004']);
  assert.equal(r.baseline.metrics.artistDiversity, 2 / 3);
  assert.equal(r.variant.metrics.artistDiversity, 1);
  assert.equal(r.baseline.metrics.worthRate, null);
  assert.equal(r.platformPool.metrics.count, 6);
  assert.equal(r.platformPool.metrics.unavailableRate, 1 / 4);
  assert.equal(r.baseline.metrics.newDiscoveryCount, null);
  assert.equal(r.baseline.metrics.reasonSupportRate, null);
  assert.equal(r.costs.replayNewCalls, 0);
  assert.equal(r.costs.unknownUsageCalls, 1);
  assert.equal(r.costs.reservedForUnknown, 512);
  assert.equal(r.costs.knownUsage.inputTokens, 100);
  assert.equal(r.decision, 'synthetic_only');
});

test('production parser rejects invalid picks and deduplicates; variant never adds an unselected candidate', () => {
  const s = fixture();
  s.selection.response.picks = [{i: 2, why: 'valid'}, {i: 2, why: 'duplicate'}, {i: 99, why: 'invented'}];
  const r = evaluate(s);
  assert.deepEqual(r.baseline.ids, ['c003']);
  assert.deepEqual(r.variant.ids, ['c003']);
  assert.equal(r.invalidPickCount, 2);
});

test('empty, failed, expired and mismatched snapshots cannot produce apparently successful recommendations', () => {
  const s = fixture(); s.selection.response.picks = [];
  assert.deepEqual(evaluate(s).baseline.ids, []);
  s.selection.status = 'failed'; assert.equal(evaluate(s).selectionCode, 'failed');
  s.selection.status = 'completed'; s.selection.owner = 'other';
  assert.equal(evaluate(s).selectionCode, 'account_mismatch');
  s.selection.owner = s.batch.owner; s.selection.revision = 'other';
  assert.equal(evaluate(s).selectionCode, 'stale_candidates');
  const expired = fixture(); expired.asOf += 7 * 60 * 60_000;
  assert.equal(evaluate(expired).exclusions.expired, 4);
  assert.deepEqual(evaluate(expired).baseline.ids, []);
});

test('bans, known unavailability and disabled exploration survive both ranking variants', () => {
  const s = fixture(); s.context.discoveryEnabled = false;
  const r = evaluate(s);
  assert.deepEqual(r.baseline.ids, ['c001']);
  assert.deepEqual(r.variant.ids, ['c001']);
  assert.deepEqual(r.exclusions, {banned: 1, unavailable: 1, expired: 0, explorationDisabled: 3});
});

test('missing metadata and playback evidence stay unknown, not zero or unplayable', () => {
  const s = fixture();
  for (const c of s.candidates) { c.artist = ''; c.known = null; c.playable = null; }
  const r = evaluate(s);
  assert.equal(r.baseline.metrics.artistDiversity, null);
  assert.equal(r.baseline.metrics.unfamiliarRate, null);
  assert.equal(r.baseline.metrics.unavailableRate, null);
});

test('human labels require exact input identity and explicit confirmation; unknown votes are excluded', () => {
  const s = fixture(), f = feedbackTemplate(s);
  f.ratings[0] = {...f.ratings[0], rating: 'worth', heardBefore: false, reasonSupported: true};
  assert.throws(() => evaluate(s, {feedback: f}), /confirmedHuman/);
  f.confirmedHuman = true;
  const r = evaluate(s, {feedback: f});
  assert.equal(r.baseline.metrics.humanJudged, 1);
  assert.equal(r.baseline.metrics.worthRate, 1);
  assert.equal(r.baseline.metrics.newDiscoveryRate, 1);
  f.inputHash = 'old'; assert.throws(() => evaluate(s, {feedback: f}), /批次/);
});

test('duplicate votes, unexpected fields and invalid limits are rejected before reporting', () => {
  const s = fixture(), f = feedbackTemplate(s);
  f.ratings.push(f.ratings[0]);
  assert.throws(() => evaluate(s, {feedback: f}), /重复/);
  assert.throws(() => evaluate({...s, cookie: 'must not export'}), /字段/);
  assert.throws(() => evaluate(s, {topK: NaN}), /topK/);
  assert.throws(() => parseArgs(['replay', '--input', 'a', '--out', 'b', '--wat']), /参数/);
});

function database(directory, {mismatch = false, listenOffset = null} = {}) {
  const path = join(directory, 'source.sqlite'), store = new MusicStore(path), at = fixture().asOf;
  try {
    const raw = [{key: 'netease:private-song-id', title: 'Public song', artist: 'Public artist'}];
    const facts = {candidateRevision: 'private-revision', candidateOwner: 'private-account-digest', candidates: raw,
      references: [['Public song', 'Public artist']], taste: {exploration: 20},
      localCandidates: [{provider: 'netease', providerTrackId: 'private-song-id', discovery: {source: 'netease_similar', expiresAt: at + 10000}}]};
    store.db.prepare(`INSERT INTO music_model_calls (call_id,day,provider,model,fact_hash,status,reserved_tokens,started_at,finished_at,purpose,facts_json)
      VALUES ('private-call','2000-01-01','private-provider','test-model','hash','completed',512,?,?,'discovery-filter',?)`).run(at - 10, at, JSON.stringify(facts));
    store.setSetting('discovery_filter_v1', {callId: 'private-call', source: 'llm-discovery-filter', candidateRevision: mismatch ? 'changed' : facts.candidateRevision,
      candidateOwner: facts.candidateOwner, picks: [{trackKey: raw[0].key, rank: 1, reason: 'Public reason'}], summary: 'Saved summary'});
    store.setSetting('provider_cookie', 'NEVER_EXPORT_COOKIE');
    if (listenOffset !== null) store.db.prepare(`INSERT INTO listen_history
      (play_instance_id,track_key,selected_by,progress_source,effective_ms,agent_listening,audible,end_reason,ended_at)
      VALUES ('private-play','netease:private-song-id','user','host',1000,1,1,'ended',?)`).run(at + listenOffset);
    store.db.prepare("INSERT INTO credential_references VALUES ('netease','private-account','NEVER_EXPORT_CREDENTIAL','authorized',?)").run(at);
  } finally { store.close(); }
  return path;
}

test('read-only export whitelists one batch and leaves database bytes unchanged', () => temporary(directory => {
  const path = database(directory), hash = () => createHash('sha256').update(readFileSync(path)).digest('hex');
  const before = hash(), s = exportSnapshot(path), serialized = JSON.stringify(s);
  assert.equal(hash(), before);
  for (const privateValue of ['NEVER_EXPORT', 'private-account', 'private-song-id', 'private-call', 'private-provider', 'private-revision', 'Public song', 'Public reason']) assert.equal(serialized.includes(privateValue), false);
  assert.equal(s.selection.reconstructed, true);
  assert.equal(s.candidates[0].playable, null);
  assert.equal(s.candidates[0].known, null, 'same title and artist do not prove the same recording was heard');
  assert.deepEqual(evaluate(s).baseline.ids, ['c001']);
  const catalogue = exportSnapshot(path, {metadata: true});
  assert.equal(catalogue.candidates[0].title, 'Public song');
  assert.notEqual(digest(catalogue), digest(s));
}));

test('export refuses selection and ledger identity mismatch', () => temporary(directory => {
  assert.throws(() => exportSnapshot(database(directory, {mismatch: true})), /不匹配/);
}));

test('historical context never leaks listens that occurred during or after the original model call', () => {
  temporary(directory => {
    const s = exportSnapshot(database(directory, {listenOffset: -5}));
    assert.equal(s.candidates[0].known, null);
    assert.deepEqual(s.recentIds, []);
  });
  temporary(directory => {
    const s = exportSnapshot(database(directory, {listenOffset: -20}));
    assert.equal(s.candidates[0].known, true);
    assert.deepEqual(s.recentIds, ['c001']);
  });
});

test('CLI writes reviewable reports once and refuses to overwrite human feedback', () => temporary(directory => {
  const out = join(directory, 'replay');
  const args = ['scripts/recommendation-research.mjs', 'replay', '--input', 'scripts/fixtures/research/snapshot.json', '--out', out, '--top-k', '3'];
  const first = spawnSync(process.execPath, args, {encoding: 'utf8'});
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(report.baseline.metrics.artistDiversity, 2 / 3);
  assert.equal(JSON.parse(readFileSync(join(out, 'feedback.template.json'), 'utf8')).confirmedHuman, false);
  assert.equal(spawnSync(process.execPath, args, {encoding: 'utf8'}).status, 1);
  assert.throws(() => writeBundle(out, {'report.json': {}}), /已存在/);
}));
