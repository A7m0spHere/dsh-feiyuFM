import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeEvidence, readRuntimeEvidence } from '../src/runtime/evidence.mjs';
test('high frequency progress retains exact counts without evicting the useful playback milestones', () => {
  const evidence = createRuntimeEvidence({ now: () => 1000, limit: 10 });
  try {
    evidence.event({ type: 'selected', playInstanceId: 'p1' });
    for (let i=0; i<10000; i++) evidence.event({ type: 'playback', event: 'progress', playInstanceId: 'p1', positionMs: i });
    assert.equal(evidence.report().counts['playback:progress'],10000);
    assert.equal(evidence.report().events.length,2);
    assert.equal(evidence.report().events[0].type,'selected');
  } finally { evidence.close(); }
});
test('production evidence retains actual counts, bounds traces and cannot claim unobserved DSH coverage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-'));
  let now = 1000;
  const evidence = createRuntimeEvidence({ directory, now: () => now, limit: 2 });
  try {
    for (let i = 0; i < 3; i++) evidence.event({ type: 'platform-request', role: 'song_detail', cookie: 'MUSIC_U=secret', url: 'https://secret', message: 'secret', params: { token: 'secret' } });
    evidence.flush();
    const read = readRuntimeEvidence(directory, now);
    assert.equal(read.components.core.counts['platform-request:song_detail'], 3);
    assert.equal(read.components.core.events.length, 2);
    assert.equal(read.components.core.droppedEvents, 1);
    assert.equal(read.components.core.coverage.dshModelRequests, null);
    assert.equal(read.a09.holds, null);
    assert.equal(JSON.stringify(read).includes('secret'), false);
    assert.equal(read.components.adapter, null);
    now += 30_000;
    assert.equal(readRuntimeEvidence(directory, now).components.core.stale, true);
  } finally { evidence.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a late shutdown from the old Core does not overwrite the new runtime report', () => {
  const directory=mkdtempSync(join(tmpdir(),'fishfm-evidence-restart-'));
  const old=createRuntimeEvidence({directory}), fresh=createRuntimeEvidence({directory});
  try {
    fresh.event({type:'selected',playInstanceId:'new'}); fresh.flush();
    old.close();
    const current=readRuntimeEvidence(directory).components.core;
    assert.equal(current.runId,fresh.report().runId);
    assert.equal(current.closed,false);
    assert.equal(current.events[0].playInstanceId,'new');
  } finally {fresh.close();rmSync(directory,{recursive:true,force:true});}
});
