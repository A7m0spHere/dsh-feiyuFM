#!/usr/bin/env node
// A soak harness for R2: run the music layer through generated session events
// and produce synthetic request/resource samples.
// It does not observe a real DSH task or establish A09's production evidence.
//
// Default is a short accelerated run (minutes, not the two hours R2 wants);
// `--minutes 120` only extends the same rehearsal. Its generated session and
// playback events cannot stand in for real platform audio or DSH comparisons.
// Use observe-runtime.mjs plus audit-real-observation.mjs for real observation.
//
//   node scripts/soak.mjs [--minutes 5] [--interval 5] [--out <dir>] [--fake]
//
// `--fake` uses the synthetic playback backend, so no audio is produced.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MusicStore } from '../src/storage.mjs';
import { createCoreHost } from '../src/core-host.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { initializeAgentPreferences } from '../src/taste.mjs';
import { createRunRecorder, processProbe, summarizeTrend } from '../src/runtime/recorder.mjs';
import { FakeProvider } from '../src/fakes.mjs';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const hasFlag = (name) => process.argv.includes(name);

const minutes = Number(argValue('--minutes', '5'));
const sampleIntervalSeconds = Number(argValue('--interval', '5'));
const fake = hasFlag('--fake');
// A short track makes an accelerated run complete real listens; the honest
// two-hour run uses realistic three-minute tracks.
const accelerated = minutes < 120;
const outputDirectory = resolve(argValue('--out', join('.tmp', 'soak')));
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error('--minutes must be a positive number');
  process.exit(2);
}

mkdirSync(outputDirectory, { recursive: true });

const recorder = createRunRecorder({ outputDirectory, handleProbe: processProbe() });
/**
 * A run starts from a clean database by default.
 *
 * The core deliberately remembers its current track across restarts, so
 * reopening a previous run's database would restore a track as `current` and
 * selection would correctly decline to pick another — while the fresh playback
 * backend plays nothing. That is real behaviour, but it makes a soak measure the
 * wrong thing, so resuming has to be asked for.
 */
const resume = hasFlag('--resume');
const dbPath = resume ? join(outputDirectory, 'soak.sqlite') : ':memory:';
const tracks = Array.from({ length: 12 }, (_, index) => ({
  provider: 'netease',
  providerTrackId: `soak-${index + 1}`,
  title: `Soak track ${index + 1}`,
  artist: `Soak artist ${(index % 3) + 1}`,
  // Short enough that an accelerated run completes real listens, long enough
  // that the effective-progress threshold is still meaningful.
  durationMs: accelerated ? 12_000 : 180_000,
}));

// The prompt surface is registered once at load. Recording it here is what makes
// "no per-turn injection" checkable: the count must stay 1 for the whole run.
recorder.registerPromptSurface({
  tools: ['fishfm_status', 'fishfm_control', 'fishfm_request_track'],
  commands: ['fishfm', 'fishfm-pause', 'fishfm-next'],
});

const store = new MusicStore(dbPath);
const messages = [];
/**
 * `--fake` also supplies a synthetic provider, so the run genuinely exercises
 * selection, resolution, playback and growth instead of failing at the first
 * resolve with `provider_unavailable`. Without it the run needs real signed-in
 * adapters; this harness still injects synthetic events and is not real R2 evidence.
 */
const syntheticProvider = fake ? (() => {
  const provider = new FakeProvider();
  for (const candidate of tracks) provider.set(candidate, `soak:${candidate.providerTrackId}`);
  provider.setAccount('netease', { status: 'authorized', accountId: 'soak' });
  provider.setCapability('netease', 'recommendation', { status: 'unavailable', reason: 'the soak run has no recommendation surface' });
  return provider;
})() : null;

const host = createCoreHost({
  store,
  output: { write: (chunk) => { for (const line of chunk.split('\n')) if (line.trim()) messages.push(JSON.parse(line)); } },
  playbackMode: fake ? 'fake' : 'real',
  ...(syntheticProvider ? { provider: syntheticProvider } : {}),
  stateIntervalMs: 400,
  onLog: (entry) => {
    // Local bookkeeping and platform traffic are counted; nothing here is a
    // model request, and the recorder would shout if one appeared.
    if (entry.type === 'transport') recorder.request('platform', 'transport');
    else if (entry.type === 'growth') recorder.request('computation', 'growth');
    else if (entry.type === 'maintenance') recorder.request('computation', 'decay');
    else recorder.request('local', 'core-ipc');
  },
});

const startedAt = Date.now();
const deadline = startedAt + minutes * 60 * 1000;
let selections = 0;
let events = 0;
let played = 0;
let lastSnapshot = null;
/** Play instances the agent chose, so each autonomous listen is counted once. */
const autonomousInstances = new Set();

const log = (line) => console.log(`[soak ${String(Math.round((Date.now() - startedAt) / 1000)).padStart(5)}s] ${line}`);

try {
  await host.start();
  // A realistic starting environment, imported through the normal path.
  importSeedTracks({ store, provider: 'netease', source: 'recent', requested: tracks.length, tracks });
  initializeAgentPreferences({ store, seed: 20_260_927, now: Date.now() });
  recorder.sample({ label: 'after-import' });

  // The user turns autonomy on and then leaves it alone: this is exactly the
  // A09 scenario of "the user does not talk about music".
  await host.handle({ id: 'self', type: 'command', command: { type: 'chooseSelf', commandId: 'soak-1' } });
  recorder.request('local', 'command');
  {
    // Say out loud whether the run actually started making music; a soak that
    // silently plays nothing would otherwise look like a clean pass.
    const opening = host.snapshot();
    log(`after opt-in: status ${opening.status}, current ${opening.current?.track?.providerTrackId ?? 'none'}`
      + `${opening.lastError ? `, error ${opening.lastError.code}: ${opening.lastError.message}` : ''}`);
    if (!opening.current) {
      console.log('the run did not start a track; the numbers below describe an idle session');
    }
  }

  let tick = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, sampleIntervalSeconds * 1000));
    tick += 1;

    const snapshot = host.snapshot();
    lastSnapshot = snapshot;
    // Session activity, as a working user would generate.
    await host.handle({
      id: `ev-${tick}`, type: 'session-event', name: 'turn/end',
      turn: tick, reason: { kind: 'completed' }, sessionId: 'soak-session',
    });
    events += 1;
    recorder.request('local', 'session-event');
    // Count each agent-chosen listen once, by play instance. A session event
    // that is refused because music is already playing is not a selection, and
    // a track handed over by `ended` is one, so counting instances is the honest
    // measure of "how much music the agent started by itself".
    const started = host.snapshot().current;
    if (started?.selectedBy === 'agent' && !autonomousInstances.has(started.playInstanceId)) {
      autonomousInstances.add(started.playInstanceId);
      selections += 1;
    }

    // Drive progress so the audio timeline actually advances, then report the
    // listen as finished once it reaches the end: that exercises growth and
    // hands over to the next track the way a real session does.
    const current = host.snapshot().current;
    if (current) {
      const duration = current.track.durationMs ?? 45_000;
      const next = Math.min((current.positionMs ?? 0) + sampleIntervalSeconds * 1000, duration);
      host.core.onPlaybackEvent({
        type: 'progress', playInstanceId: current.playInstanceId,
        positionMs: next, progressSource: 'audio',
      });
      if (next >= duration) {
        host.core.onPlaybackEvent({ type: 'ended', playInstanceId: current.playInstanceId });
        played += 1;
      }
    }

    recorder.sample({
      label: snapshot.current ? 'playing' : 'idle',
      extra: { status: snapshot.status, queue: snapshot.queue.length },
    });

    // Occasional user traffic, so the run is not purely autonomous.
    if (tick % 12 === 0) {
      await host.handle({ id: `pause-${tick}`, type: 'command', command: { type: 'pause', commandId: `p-${tick}` } });
      await host.handle({ id: `resume-${tick}`, type: 'command', command: { type: 'resume', commandId: `r-${tick}` } });
      recorder.request('local', 'command');
      recorder.request('local', 'command');
    }
    if (tick % 20 === 0) log(`elapsed ${Math.round((Date.now() - startedAt) / 60000)}min · selections ${selections} · status ${snapshot.status}`);
  }
} finally {
  await host.close();
  store.close();
}

const report = recorder.write(outputDirectory, { name: 'soak-report.json' });
const trend = summarizeTrend(report.report.samples ?? []);
console.log('');
console.log(`ran for ${(report.report.elapsedMs / 60000).toFixed(2)} minutes (requested ${minutes})`);
console.log(`autonomous selections: ${selections} · session events: ${events} · tracks played: ${played}`);
console.log(`model requests from the music layer: ${report.report.modelRequests}`);
console.log(`prompt surface registrations: ${report.report.promptSurface.registrations}`);
console.log(`memory trend: ${trend.verdict ?? 'unknown'} — ${trend.reason}`);
console.log(`report: ${report.path}`);
if (played === 0) {
  const failure = lastSnapshot?.lastError;
  console.log(failure
    ? `no track ever played: ${failure.code} — ${failure.message}`
    : 'no track ever played, and the core reported no error');
}
if (minutes < 120) {
  console.log('');
  console.log('NOTE: this was a short run. R2 asks for two hours; use --minutes 120 for that,');
  console.log('      and only then treat the result as the A09 evidence.');
}
process.exit(report.report.a09.holds ? 0 : 1);
