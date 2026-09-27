#!/usr/bin/env node
// Entry point the DSH plugin spawns (and later the desktop UI may attach to).
// Owns the queue, the database and the audio backend; speaks JSON lines on
// stdio. The plugin is responsible for stopping this process on unload.
//
//   node bin/fishfm-core.mjs [--db <path>] [--playback real|fake] [--provider real|fake]
//                             [--selection environment|queue]
//
// `real` is the product path: with no platform adapter installed yet (P2/P4),
// track resolution fails with provider_unavailable rather than inventing a
// playable handle. `fake` exists for tests and offline debugging only.
// `--selection queue` uses the Phase 1 fixed-candidate debug queue instead of
// the user's imported environment.
import { runCoreHost } from '../src/core-host.mjs';
import { FakeProvider } from '../src/fakes.mjs';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const dbPath = argValue('--db', ':memory:');
const playbackMode = argValue('--playback', 'real');
const providerMode = argValue('--provider', 'real');
const selectionMode = argValue('--selection', 'environment');
if (!['real', 'fake'].includes(playbackMode)) throw new Error('--playback must be real or fake');
if (!['real', 'fake'].includes(providerMode)) throw new Error('--provider must be real or fake');
if (!['environment', 'queue'].includes(selectionMode)) throw new Error('--selection must be environment or queue');

process.on('SIGTERM', () => { process.exit(0); });
process.on('SIGINT', () => { process.exit(0); });

await runCoreHost({
  dbPath,
  playbackMode,
  selectionMode,
  ...(providerMode === 'fake' ? { provider: new FakeProvider() } : {}),
  onLog: (entry) => {
    // Diagnostics only; never log credentials or resolved media URLs.
    process.stderr.write(`fishfm-core: ${JSON.stringify(entry)}\n`);
  },
});