// P0 #6 probe: reproduce the silent evidence-file failure with a held write target.
// Not a test: it prints the observed JSON so the claim can be quoted verbatim.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeEvidence, readRuntimeEvidence } from '../../src/runtime/evidence.mjs';

const directory = mkdtempSync(join(tmpdir(), 'fishfm-probe-'));
let now = 1_000_000;
const make = () => createRuntimeEvidence({ directory, now: () => now, intervalMs: 20 });

const before = make();
before.event({ type: 'selected', playInstanceId: 'p1' });
before.flush();
const healthy = readRuntimeEvidence(directory, now).components.core;
console.log('BEFORE ' + JSON.stringify({ runIdPresent: Boolean(healthy?.runId), updatedAt: healthy?.updatedAt, closed: healthy?.closed, events: healthy?.events?.length }));

// The hold: the flush target itself becomes a directory, so writeFileSync fails
// with EISDIR (the same class as EBUSY/EACCES: the write simply cannot land).
const core = make();
core.event({ type: 'selected', playInstanceId: 'p2' });
core.flush();
rmSync(join(directory, 'core.json'), { force: true });
mkdirSync(join(directory, 'core.json'));
for (const type of ['playback', 'history', 'growth', 'selected', 'command']) core.event({ type, playInstanceId: 'p2' });
core.flush();
now += 30_000;
const after = readRuntimeEvidence(directory, now);

// What the module itself believes happened.
const selfReport = core.report();
console.log('SELF ' + JSON.stringify({ runIdPresent: Boolean(selfReport.runId), events: selfReport.events.length, counts: selfReport.counts, writeHealth: core.writeHealth(), stale: null }));

// A second root cause, independent of fs failures: a retry can never publish
// after another run wrote the file, so every later write is silently dropped.
const dir2 = mkdtempSync(join(tmpdir(), 'fishfm-probe2-'));
const make2 = () => createRuntimeEvidence({ directory: dir2, now: () => now, intervalMs: 20 });
const staleFlush = make2();
staleFlush.event({ type: 'selected', playInstanceId: 'p3' });
staleFlush.flush();
const freshRun = make2();
freshRun.event({ type: 'selected', playInstanceId: 'p4' });
freshRun.flush();

// The pre-restart instance is still alive (the restart race the module warns
// about) and keeps flushing. The stale runId check should refuse it -- and the
// refusal is a silent early return, indistinguishable from a successful write.
staleFlush.event({ type: 'selected', playInstanceId: 'p5-stale' });
staleFlush.flush();
const onDiskAfterStale = readRuntimeEvidence(dir2, now).components.core;
console.log('SUPERSEDE-ATTEMPT ' + JSON.stringify({
  refused: onDiskAfterStale?.runId === freshRun.report().runId,
  refusedEvents: onDiskAfterStale?.events?.map(e => e.playInstanceId),
  staleThinksItWrote: staleFlush.report().events.length,
  writeHealth: staleFlush.writeHealth(),
}));
now += 30_000;
const third = readRuntimeEvidence(dir2, now);
const thirdRunId = third.components.core?.runId;
console.log('SUPERSEDED ' + JSON.stringify({
  onDiskRunId: thirdRunId,
  staleRunId: staleFlush.report().runId,
  freshRunId: freshRun.report().runId,
  freshRunKeptItsFile: thirdRunId === freshRun.report().runId,
  onDiskEvents: third.components.core?.events?.length,
}));

// What the module can now say while its own file is unreadable.
console.log('HEALTH-WHILE-BROKEN ' + JSON.stringify(core.writeHealth()));
staleFlush.close(); freshRun.close(); core.close(); before.close();
rmSync(directory, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true });
