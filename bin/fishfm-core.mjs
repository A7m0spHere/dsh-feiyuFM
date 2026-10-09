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
import { buildProviderRegistry, createProviderFacade, runCoreHost } from '../src/core-host.mjs';
import { FakeProvider } from '../src/fakes.mjs';
import { MusicStore } from '../src/storage.mjs';
import { createPlatformCredentials } from '../src/providers/credentials.mjs';
import { neteaseEndpoints } from '../src/providers/endpoints/netease.mjs';
import { dirname, join, resolve } from 'node:path';
import { createRuntimeEvidence } from '../src/runtime/evidence.mjs';

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

const evidence = createRuntimeEvidence({ directory: dbPath === ':memory:' ? null : join(dirname(resolve(dbPath)), 'runtime'), mode: playbackMode === 'real' && providerMode === 'real' ? 'real' : 'synthetic' });
const onLog = (entry) => {
  evidence.event(entry);
  // Diagnostics only; never log credentials or resolved media URLs.
  process.stderr.write(`fishfm-core: ${JSON.stringify(entry)}\n`);
};

let store = null;
try {
  const canPersistCredentials = providerMode === 'real' && ['win32', 'darwin'].includes(process.platform) && dbPath !== ':memory:';
  let providerRegistry;
  let platformsFacade;
  if (canPersistCredentials) {
    store = new MusicStore(dbPath);
    const credentials = createPlatformCredentials({ directory: join(dirname(resolve(dbPath)), 'credentials') });
    providerRegistry = buildProviderRegistry({
      adapters: { netease: { endpoints: neteaseEndpoints() } },
      credentials, store, onLog,
    });
    platformsFacade = createProviderFacade({ registry: providerRegistry, store, onLog });
  }
  await runCoreHost({
    dbPath,
    playbackMode,
    selectionMode,
    ...(providerMode === 'fake' ? { provider: new FakeProvider() } : {}),
    ...(store ? { store, providerRegistry, platformsFacade } : {}),
    onLog,
  });
} finally {
  evidence.close();
  store?.close();
}
