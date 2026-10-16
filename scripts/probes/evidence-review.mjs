// Review probe for the REV-04 fix: what a reader can and cannot learn when
// evidence writing fails. Not a test -- it prints observed JSON for quoting.
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeEvidence, readRuntimeEvidence } from '../../src/runtime/evidence.mjs';

const now = 1_000_000;

// (1) A PERMANENT failure: the report target can never be written again. The
// failure must still reach a reader through the sidecar.
{
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-review-perm-'));
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  evidence.event({ type: 'selected', playInstanceId: 'p1' });
  evidence.flush();
  rmSync(join(directory, 'core.json'), { force: true });
  mkdirSync(join(directory, 'core.json'));
  for (let i = 0; i < 5; i++) evidence.event({ type: 'selected', playInstanceId: 'p' + i });
  evidence.flush();
  const read = readRuntimeEvidence(directory, now);
  console.log('PERMANENT ' + JSON.stringify({
    inMemory: evidence.writeHealth(),
    reportOnDisk: read.components.core,
    writeFailureOnDisk: read.writeFailures.core,
    targetIsDirectory: statSync(join(directory, 'core.json')).isDirectory(),
  }));
  evidence.close(); rmSync(directory, { recursive: true, force: true });
}

// (2) Recovery clears the sidecar: a stale failure note would be a lie.
{
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-review-recover-'));
  const evidence = createRuntimeEvidence({ directory, now: () => now });
  evidence.event({ type: 'selected', playInstanceId: 'p1' });
  rmSync(join(directory, 'core.json'), { force: true });
  mkdirSync(join(directory, 'core.json'));
  evidence.flush();
  console.log('BROKEN ' + JSON.stringify({ writeFailure: readRuntimeEvidence(directory, now).writeFailures.core?.lastError }));
  rmSync(join(directory, 'core.json'), { recursive: true, force: true });
  evidence.flush();
  const healed = readRuntimeEvidence(directory, now);
  console.log('RECOVERED ' + JSON.stringify({
    writeFailure: healed.writeFailures.core,
    reportFailures: healed.components.core?.writeHealth?.failures,
    lastError: healed.components.core?.writeHealth?.lastError,
  }));
  evidence.close(); rmSync(directory, { recursive: true, force: true });
}

// (3) A live process learns about the failure without waiting for a later write.
{
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-review-callback-'));
  const seen = [];
  const evidence = createRuntimeEvidence({ directory, now: () => now, onWriteFailure: h => seen.push(h.lastError) });
  evidence.event({ type: 'selected', playInstanceId: 'p1' });
  evidence.flush();
  rmSync(join(directory, 'core.json'), { force: true });
  mkdirSync(join(directory, 'core.json'));
  for (let i = 0; i < 4; i++) evidence.flush();
  console.log('CALLBACK ' + JSON.stringify({ calls: seen, noteOncePerCause: seen.length === 1 }));
  evidence.close(); rmSync(directory, { recursive: true, force: true });
}

// (4) A brand-new instance must not silently steal the file from a live owner.
{
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-review-owner-'));
  const owner = createRuntimeEvidence({ directory, now: () => now });
  owner.event({ type: 'selected', playInstanceId: 'owner' });
  owner.flush();
  const latecomer = createRuntimeEvidence({ directory, now: () => now });
  latecomer.event({ type: 'selected', playInstanceId: 'latecomer' });
  latecomer.flush();
  const shown = readRuntimeEvidence(directory, now).components.core;
  console.log('OWNERSHIP ' + JSON.stringify({
    onDisk: shown?.events?.map(e => e.playInstanceId),
    ownerKeptFile: shown?.runId === owner.report().runId,
    latecomerHealth: latecomer.writeHealth(),
  }));
  owner.close(); latecomer.close(); rmSync(directory, { recursive: true, force: true });
}
