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

test('a permanent write failure still reaches a reader through the failure note', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-perm-'));
  let now = 1_000_000;
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  try {
    evidence.event({ type: 'selected', playInstanceId: 'p1' });
    evidence.flush();
    // The report target can never be written again.
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    for (let i = 0; i < 3; i++) { now += 5000; evidence.flush(); }

    // Without the note a reader sees only "missing", which is ambiguous.
    const read = readRuntimeEvidence(directory, now);
    assert.equal(read.components.core, null);
    assert.equal(typeof read.writeFailures.core?.lastError, 'string', 'the reason survives even with no report');
    assert.equal(read.writeFailures.core.failures >= 1, true);
    assert.equal(read.writeFailures.core.component, 'core');
  } finally { evidence.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a recovered write clears the failure note instead of leaving a stale warning', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-heal-'));
  const now = 1_000_000;
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  try {
    evidence.event({ type: 'selected', playInstanceId: 'p1' });
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    evidence.flush();
    assert.equal(readRuntimeEvidence(directory, now).writeFailures.core?.lastError, 'EPERM');

    rmSync(join(directory, 'core.json'), { recursive: true, force: true });
    evidence.flush();
    const healed = readRuntimeEvidence(directory, now);
    assert.equal(healed.writeFailures.core, null, 'the note is gone once writing works again');
    assert.equal(healed.components.core.writeHealth.failures, 1, 'but the history is not erased');
  } finally { evidence.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a live process hears about a write failure without waiting for a later write', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-callback-'));
  const now = 1_000_000;
  const seen = [];
  const evidence = createRuntimeEvidence({ directory, now: () => now, onWriteFailure: health => seen.push(health.lastError) });
  try {
    evidence.event({ type: 'selected', playInstanceId: 'p1' });
    evidence.flush();
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    for (let i = 0; i < 4; i++) evidence.flush();
    assert.deepEqual(seen, ['EPERM'], 'one notice per cause, not one per failed attempt');
    assert.equal(evidence.writeHealth().failures, 4, 'but every failed attempt is still counted');

    // Once writing works again the notice is armed for the next real cause.
    rmSync(join(directory, 'core.json'), { recursive: true, force: true });
    evidence.flush();
    assert.equal(seen.length, 1, 'recovery does not fire a false notice');
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    evidence.flush();
    assert.deepEqual(seen, ['EPERM', 'EPERM'], 'a failure after recovery is reported again');
  } finally { evidence.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failed first flush is never reported as a clean shutdown', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-firstfail-'));
  const now = 1_000_000;
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  try {
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    evidence.flush();
    evidence.close();
    assert.equal(evidence.report().closed, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a recorded error is a code, never a free-form message', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-code-'));
  const now = 1_000_000;
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  try {
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    evidence.flush();
    // Simulate a future fs error carrying an unsafe code shape.
    assert.match(String(evidence.writeHealth().lastError), /^[\w:.-]{1,40}$/);
    assert.equal(String(evidence.writeHealth().lastError).includes(' '), false);
  } finally { evidence.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a note left by a crashed run does not outlive it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-evidence-crash-'));
  const now = 1_000_000;
  const broken = createRuntimeEvidence({ directory, now: () => now });
  try {
    broken.event({ type: 'selected', playInstanceId: 'a1' });
    broken.flush();
    rmSync(join(directory, 'core.json'), { force: true });
    mkdirSync(join(directory, 'core.json'));
    broken.flush();
    assert.equal(readRuntimeEvidence(directory, now).writeFailures.core?.lastError, 'EPERM');

    // The obstruction is cleared, but the broken run never called close().
    rmSync(join(directory, 'core.json'), { recursive: true, force: true });
    const healthy = createRuntimeEvidence({ directory, now: () => now });
    try {
      healthy.event({ type: 'selected', playInstanceId: 'b1' });
      healthy.flush();
      const read = readRuntimeEvidence(directory, now);
      assert.equal(read.components.core.runId, healthy.report().runId, 'the healthy run owns the file');
      assert.equal(read.writeFailures.core, null, 'the dead run no longer warns');
      assert.equal(read.components.core.writeHealth.failures, 0);
    } finally { healthy.close(); }
  } finally { broken.close(); rmSync(directory, { recursive: true, force: true }); }
});
