import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeEvidence, readRuntimeEvidence } from '../src/runtime/evidence.mjs';
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
