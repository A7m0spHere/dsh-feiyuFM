import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MusicStore} from '../src/storage.mjs';
import {describeDiscoveryJournal} from '../src/discovery-journal.mjs';

const at = 100000, now = 300000;
const track = i => ({provider: 'netease', providerTrackId: String(i), title: `Synthetic ${i}`, artist: `Artist ${i}`, durationMs: 100000,
  discovery: {source: 'netease_similar', seedTrackKey: 'netease:seed', expiresAt: now + 100000, modelCallId: 'batch-call'}});
function fixture(path = ':memory:') {
  const store = new MusicStore(path), tracks = [track(1), track(2)], owner = 'synthetic-owner';
  const filter = {source: 'llm-discovery-filter', callId: 'batch-call', candidateOwner: owner, candidateRevision: 'rev', generatedAt: at,
    picks: tracks.map((t, i) => ({trackKey: `netease:${t.providerTrackId}`, rank: i + 1, reason: 'UNSUPPORTED_MODEL_CLAIM'}))};
  store.setSetting('discovery_filter_v1', filter);
  const facts = {candidateOwner: owner, candidateRevision: 'rev', candidates: tracks.map((t, i) => ({key: `netease:${t.providerTrackId}`, ...(i ? {} : {feedback: 'liked'})})), localCandidates: tracks};
  store.db.prepare(`INSERT INTO music_model_calls (call_id,day,provider,model,fact_hash,status,reserved_tokens,started_at,purpose,facts_json)
    VALUES ('batch-call','2000-01-01','synthetic','synthetic','fixed','completed',0,0,'discovery-filter',?)`).run(JSON.stringify(facts));
  return {store, tracks, pipeline: {pipeline: 'platform-filter', filterCallId: 'batch-call', candidateOwner: owner, referenceCount: 3, tracks},
    entry(id, patch = {}) {
      const entry = {playInstanceId: id, track: tracks[0], selectedBy: 'agent', progressSource: 'audio', effectiveMs: 100000,
        agentEffectiveMs: 100000, audibleMs: 0, progressAccounting: 'segments-v1', durationMs: 100000,
        agentListening: true, audible: false, endReason: 'ended', startedAt: at + 1, endedAt: now - 1, origin: {modelCallId: 'batch-call'}, ...patch};
      return store.recordHistory(entry);
    }};
}
const view = f => describeDiscoveryJournal({...f, now});

test('read-only journal deduplicates valid picks, shares source evidence and never treats a recommendation as hearing', () => {
  const f = fixture();
  try {
    f.pipeline.tracks.push(f.tracks[0]);
    const before = f.store.db.prepare('SELECT total_changes() n').get().n;
    const v = view(f);
    assert.equal(v.items.length, 2); assert.equal(v.items[0].recommended, true);
    assert.equal(v.items[0].agentExperienced, false); assert.equal(v.items[0].audibleHeard, false);
    assert.ok(v.items[0].evidence.some(e => e.kind === 'platform-seed-relation'));
    assert.ok(v.items[0].evidence.some(e => e.kind === 'explicit-feedback' && e.value === 'liked'));
    assert.equal(JSON.stringify(v).includes('UNSUPPORTED_MODEL_CLAIM'), false);
    assert.equal(JSON.stringify(v).includes('synthetic-owner'), false);
    assert.deepEqual(view(f), v);
    assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n, before);
  } finally { f.store.close(); }
});

test('silent effective experience and a small audible segment cannot become an audible listen', () => {
  const f = fixture();
  try {
    f.entry('silent');
    assert.equal(view(f).items[0].agentExperienced, true); assert.equal(view(f).items[0].audibleHeard, false);
    f.entry('tiny-audible', {audible: true, audibleMs: 100});
    assert.equal(view(f).items[0].audibleHeard, false);
    f.entry('audible', {audible: true, audibleMs: 60000});
    assert.equal(view(f).items[0].audibleHeard, true);
    assert.equal(f.entry('audible', {audible: true, audibleMs: 60000}), false, 'history instance is deduplicated');
    assert.equal(view(f).items.length, 2);
  } finally { f.store.close(); }
});

test('manual picks are identified separately and do not count as agent growth', () => {
  const f = fixture();
  try {
    f.entry('manual', {selectedBy: 'user', agentListening: false, agentEffectiveMs: 0, audible: true, audibleMs: 60000, origin: null});
    const item = view(f).items[0];
    assert.equal(item.userRequested, true); assert.equal(item.agentExperienced, false); assert.equal(item.audibleHeard, true);
  } finally { f.store.close(); }
});

test('partially audible or unmeasured experience is not labelled fully silent or audibly heard', () => {
  const f = fixture();
  try {
    f.entry('partial-audible', {audible: true, audibleMs: 1000});
    f.entry('legacy-audible', {audible: false, audibleMs: null});
    const item = view(f).items[0];
    assert.equal(item.agentExperienced, true); assert.equal(item.silentExperienced, false); assert.equal(item.audibleHeard, false);
  } finally { f.store.close(); }
});

test('old batch, legacy provenance and starts before recommendation cannot resurrect discovery history', () => {
  const f = fixture();
  try {
    f.entry('old', {origin: {modelCallId: 'old-call'}, audibleMs: 60000});
    f.entry('legacy', {origin: null, audibleMs: 60000});
    f.entry('early', {startedAt: at - 1, audibleMs: 60000});
    f.entry('manual-early', {selectedBy: 'user', startedAt: at - 1, audibleMs: 60000});
    assert.equal(view(f).items[0].audibleHeard, false);
    assert.equal(view(f).items[0].agentExperienced, false);
    assert.equal(view(f).items[0].userRequested, false);
  } finally { f.store.close(); }
});

test('errors, zero progress and invalid audible accounting do not fabricate listening', () => {
  const f = fixture();
  try {
    f.entry('error', {endReason: 'error', audibleMs: 60000});
    f.entry('short', {effectiveMs: 0, agentEffectiveMs: 0});
    f.entry('invalid', {effectiveMs: 100, agentEffectiveMs: 0, audibleMs: 60000});
    assert.equal(view(f).items[0].audibleHeard, false);
    assert.equal(view(f).items[0].agentExperienced, false);
  } finally { f.store.close(); }
});

test('account changes, clearing inputs, expiry and corrupted batch identity degrade to empty', () => {
  const f = fixture();
  try {
    assert.equal(view({...f, pipeline: {...f.pipeline, candidateOwner: 'other'}}).reason, 'account-changed');
    assert.equal(view({...f, pipeline: {...f.pipeline, referenceCount: 0}}).reason, 'no-input');
    assert.equal(describeDiscoveryJournal({...f, now: now + 200000}).items.length, 0);
    f.store.db.prepare("UPDATE music_model_calls SET facts_json='{}'").run();
    assert.equal(view(f).reason, 'unverified-batch');
    f.store.removeSetting('discovery_filter_v1'); assert.equal(view(f).items.length, 0);
  } finally { f.store.close(); }
});

test('failed replacement preserves a valid prior batch without inventing new discoveries', () => {
  const f = fixture();
  try {
    const v = view({...f, pipeline: {...f.pipeline, lastError: 'model_output_limit'}});
    assert.equal(v.retained, true); assert.equal(v.items.length, 2);
    assert.equal(v.items[0].audibleHeard, false);
  } finally { f.store.close(); }
});

test('file reopen retains one projected discovery per track without a new table or writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-journal-')), path = join(directory, 'music.sqlite');
  const f = fixture(path);
  try {
    f.entry('heard', {audibleMs: 60000}); const expected = view(f); f.store.close();
    const reopened = new MusicStore(path);
    try { assert.deepEqual(view({...f, store: reopened}), expected); } finally { reopened.close(); }
  } finally { if (f.store.db.isOpen) f.store.close(); rmSync(directory, {recursive: true, force: true}); }
});

test('projection caps the history window and malformed evidence never breaks playback reads', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 205; i++) f.entry(`instance-${i}`, {endedAt: now - i - 1});
    assert.equal(view(f).historyLimited, true);
    f.store.db.prepare("UPDATE growth_jobs SET entry_json='invalid'").run();
    assert.equal(view(f).items[0].agentExperienced, false);
    assert.equal(view({...f, pipeline: null}).status, 'unavailable');
  } finally { f.store.close(); }
});
