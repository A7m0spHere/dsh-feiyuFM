// Measures what one synchronous evidence flush costs on the main thread.
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRuntimeEvidence } from '../../src/runtime/evidence.mjs';

const directory = mkdtempSync(join(tmpdir(), 'fishfm-bench-'));
const evidence = createRuntimeEvidence({ directory, intervalMs: 600000 });
const samples = [];
for (const [label, count] of [['24', 24], ['300', 300], ['900', 900], ['2000', 2000]]) {
  evidence.report().events.length; // touch
  const pad = Math.max(0, count - evidence.report().events.length);
  for (let i = 0; i < pad; i++) evidence.event({ type: 'playback', event: 'started', playInstanceId: 'p' + i, positionMs: i });
  // Warm one flush, then time three.
  evidence.flush();
  // Three timed flushes; the first pays OS cache warm-up.
  const runs = [];
  for (let k = 0; k < 3; k++) { const t0 = performance.now(); evidence.flush(); runs.push(performance.now() - t0); }
  const bytes = statSync(join(directory, 'core.json')).size;
  samples.push({
    events: evidence.report().events.length,
    bytes,
    flushMs: { first: runs[0].toFixed(1), warmMin: Math.min(...runs.slice(1)).toFixed(1), warmMax: Math.max(...runs.slice(1)).toFixed(1) },
  });
}
console.log(JSON.stringify(samples, null, 1));
evidence.close();
rmSync(directory, { recursive: true, force: true });
