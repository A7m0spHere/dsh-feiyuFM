import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeEvidence, readRuntimeEvidence } from '../src/runtime/evidence.mjs';

test('playback stage timings retain duration without credentials or media URLs', () => {
  const evidence = createRuntimeEvidence();
  try {
    evidence.event({ type: 'playback-stage', phase: 'load', playInstanceId: 'p1', durationMs: 7123, handle: 'secret', cookie: 'secret' });
    const event = evidence.report().events[0];
    assert.equal(event.phase, 'load');
    assert.equal(event.durationMs, 7123);
    assert.equal(JSON.stringify(event).includes('secret'), false);
  } finally { evidence.close(); }
});
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

test('a log write that cannot land is counted instead of silently passing as healthy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-write-'));
  let now = 1_000_000;
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  try {
    evidence.event({ type: 'selected', playInstanceId: 'p1' });
    evidence.flush();
    assert.equal(evidence.writeHealth().failures, 0, 'a healthy write is reported as a success');
    assert.equal(readRuntimeEvidence(directory, now).components.core.writeHealth.lastError, null);

    // The target becomes unwritable (the held-file class: EBUSY/EACCES/EPERM).
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    evidence.event({ type: 'selected', playInstanceId: 'p2' });
    evidence.flush();

    const health = evidence.writeHealth();
    assert.equal(health.failures >= 1, true, 'the dropped write is counted');
    assert.equal(typeof health.lastError, 'string', 'and it names the cause rather than swallowing it');
    assert.equal(health.lastSuccessAt !== null, true, 'the last good write is still known');
    // The report itself carries the failure, so a reader is not left with a
    // quietly stale file that looks like a wedged process.
    assert.equal(evidence.report().writeHealth.failures >= 1, true);
  } finally { evidence.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a flush that is refused because another run owns the file is counted, not passed over', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-supersede-'));
  let now = 1_000_000;
  const stale = createRuntimeEvidence({ directory, now: () => now });
  const fresh = createRuntimeEvidence({ directory, now: () => now });
  try {
    fresh.event({ type: 'selected', playInstanceId: 'new' });
    fresh.flush();
    now += 30_000;
    stale.event({ type: 'selected', playInstanceId: 'old' });
    stale.flush();

    const current = readRuntimeEvidence(directory, now).components.core;
    assert.equal(current.runId, fresh.report().runId, 'the newer run keeps the file');
    assert.deepEqual(current.events.map(e => e.playInstanceId), ['new']);
    assert.equal(stale.writeHealth().skipped, 1, 'the skipped write is visible');
    assert.equal(stale.writeHealth().failures, 0, 'and it is not confused with an fs failure');
  } finally { stale.close(); fresh.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('close() never labels a run closed when its final write did not land', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-close-'));
  let now = 1_000_000;
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  try {
    evidence.event({ type: 'selected', playInstanceId: 'p1' });
    evidence.flush();
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    evidence.close();
    // closed=true would make a reader treat the last good content as final.
    assert.equal(readRuntimeEvidence(directory, now).components.core, null);
    assert.equal(evidence.report().closed, false, 'an unlanded final write does not claim a clean close');
    assert.equal(evidence.writeHealth().failures >= 1, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
