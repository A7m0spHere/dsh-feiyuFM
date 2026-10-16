import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRuntimeEvidence } from '../../src/runtime/evidence.mjs';
// A realistic long session: mostly progress (rate-limited), plus the real milestones.
const mix = [];
for (let i = 0; i < 4000; i++) {
  const r = i % 10;
  if (r < 7) mix.push({ type: 'playback', event: 'progress', playInstanceId: 'p' + (i % 20), positionMs: i });
  else if (r === 7) mix.push({ type: 'command', kind: 'playPause', accepted: true });
  else if (r === 8) mix.push({ type: 'platform-request', role: 'song_detail', provider: 'netease' });
  else mix.push({ type: 'playback', event: 'started', playInstanceId: 'p' + (i % 20), accepted: true });
}
const directory = mkdtempSync(join(tmpdir(), 'fishfm-bench2-'));
let now = 1_000_000;
const evidence = createRuntimeEvidence({ directory, now: () => now, intervalMs: 600000 });
const rows = [];
for (let i = 0; i < mix.length; i++) {
  evidence.event(mix[i]);
  if ((i + 1) % 500 === 0) {
    now += 5000;
    const runs = [];
    for (let k = 0; k < 3; k++) { now += 5000; const t0 = performance.now(); evidence.flush(); runs.push(performance.now() - t0); }
    const r = evidence.report();
    rows.push({ fed: i + 1, keptEvents: r.events.length, counts: Object.keys(r.counts).length, bytes: statSync(join(directory, 'core.json')).size, flushWarmMs: Math.min(...runs.slice(1)).toFixed(1) });
  }
}
console.log(JSON.stringify(rows, null, 1));
evidence.close(); rmSync(directory, { recursive: true, force: true });
