// The music core as a long-lived process the DSH plugin owns.
//
// It holds the single queue, the database and the audio backend, and speaks a
// versioned JSON-line protocol over stdio (or any line stream) so the plugin —
// and later the desktop UI — can drive it without importing it. Keeping the
// core out of the host process is what lets music survive the visible window
// closing: the plugin owns this process and stops it on unload.
//
// No music decision here contacts a model. Session events only gate local work.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { MusicError } from './contracts.mjs';
import { MusicStore } from './storage.mjs';
import { MusicCore } from './core.mjs';
import { FakePlayback } from './fakes.mjs';
import { createSelector } from './selection.mjs';
import { createRng, readAgentSeed, initializeAgentPreferences, describeTaste } from './taste.mjs';
import { importSeedTracks, describeEnvironment } from './environment.mjs';
import { applyListenGrowth, describeGrowth } from './growth.mjs';
import { createHttpTransport } from './providers/transport.mjs';
import { createNetEaseProvider } from './providers/netease.mjs';
import { createQQProvider } from './providers/qq.mjs';
import { describePlatforms, collectDiscovery, resolveOnOwnPlatform, summarizeSeedRuns } from './providers/coordinator.mjs';

/** Bump when the host/owner message shapes change in a way an older peer cannot read. */
export const CORE_HOST_PROTOCOL = 1;

/**
 * Which real DSH session events are allowed to influence music.
 * Anything absent is ignored rather than guessed — the plan forbids inventing
 * work context, and I1 must not add background model requests.
 */
export const SESSION_EVENT_MAP = Object.freeze({
  'turn/end': { kind: 'turn_end', allowsAutonomy: true },
  'turn/start': { kind: 'session_start', allowsAutonomy: false },
  'tool/call': { kind: 'activity', allowsAutonomy: false },
  'tool/result': { kind: 'activity', allowsAutonomy: false },
});

export function mapSessionEvent(type) {
  return SESSION_EVENT_MAP[type] ?? { kind: 'unknown', allowsAutonomy: false };
}

/**
 * A registry that reports the truth about platform capabilities. Until the
 * NetEase and QQ adapters exist (P2/P4) every provider is explicitly
 * `login_required`, so nothing can quietly look like an empty search result.
 */
export class ProviderRegistry {
  constructor({ providers = {} } = {}) {
    this.providers = providers;
  }

  has(provider) { return Boolean(this.providers[provider]); }

  getAccount(provider) {
    const adapter = this.providers[provider];
    if (!adapter) return { status: 'unavailable', source: null, reason: 'Adapter not implemented yet' };
    return adapter.getAccount();
  }

  getCapabilities(provider) {
    const adapter = this.providers[provider];
    if (!adapter) return { seed: { status: 'unavailable', source: null, reason: 'Adapter not implemented yet' } };
    return adapter.getCapabilities();
  }

  async resolve(track, options) {
    const adapter = this.providers[track.provider];
    if (!adapter) {
      throw new MusicError('provider_unavailable', `No adapter is installed for ${track.provider}`);
    }
    return adapter.resolve(track, options);
  }

  async search(provider, query, options) {
    const adapter = this.providers[provider];
    if (!adapter) {
      throw new MusicError('provider_unavailable', `No adapter is installed for ${provider}`);
    }
    return adapter.search(query, options);
  }

  async getSeedTracks(provider, options) {
    const adapter = this.providers[provider];
    if (!adapter) {
      throw new MusicError('provider_unavailable', `No adapter is installed for ${provider}`);
    }
    return adapter.getSeedTracks(options);
  }

  /**
   * Discovery candidates from one platform. Recommendation support is optional
   * by design, so an adapter without it reports that rather than returning an
   * empty list that would look like "no new music exists".
   */
  async getDiscoveryTracks(provider, options = {}) {
    const adapter = this.providers[provider];
    if (!adapter) {
      throw new MusicError('provider_unavailable', `No adapter is installed for ${provider}`);
    }
    if (typeof adapter.getDiscoveryTracks !== 'function') {
      throw new MusicError('capability_unavailable', `${provider} does not implement recommendations`);
    }
    return adapter.getDiscoveryTracks(options);
  }
}

/**
 * Builds the local selector the core consults for autonomous playback.
 *
 * The familiar pool is the user's own imported environment. The discovery pool
 * comes from platform recommendations, which do not exist until the NetEase and
 * QQ adapters land (P2/P4); an empty pool is a real state, and the selector then
 * records that no exploration happened while keeping the user's rate setting.
 */
export function buildSelector({ store, now = () => Date.now(), rng = null, listDiscovery = null }) {
  const seed = readAgentSeed(store);
  return createSelector({
    store,
    // A stored seed keeps selection reproducible across restarts; without one
    // the session still works, it just is not reproducible.
    rng: rng ?? createRng(Number.isSafeInteger(seed) ? seed : 1),
    listFamiliar: () => store.listEnvironment({ limit: 5000 }).map((row) => {
      // Restore the stored metadata, not just the key: the effective-progress
      // threshold needs the real duration, and a title is needed to tell the
      // user what is playing.
      const stored = store.getTrack({
        provider: row.provider,
        providerTrackId: row.track_key.split(':').slice(1).join(':'),
      });
      return {
        provider: row.provider,
        providerTrackId: row.track_key.split(':').slice(1).join(':'),
        ...(stored?.title ? { title: stored.title } : {}),
        ...(stored?.artist ? { artist: stored.artist } : {}),
        ...(stored?.duration_ms ? { durationMs: stored.duration_ms } : {}),
      };
    }),
    // Platform recommendations feed the discovery pool. They are read from a cache
// because the selector runs synchronously and must never perform network I/O;
// an empty pool is a real state and is recorded as such.
    listDiscovery: listDiscovery ?? (() => []),
    now,
  });
}

/**
 * Builds the real provider registry from adapter configurations.
 *
 * Each entry is `{ provider, transport, credentials, endpoints }`; an entry with
 * no transport or endpoints is deliberately left uninstalled, so the host reports
 * "not installed" instead of pretending to have the platform.
 */
export function buildProviderRegistry({ adapters = {}, credentials = null, store = null, now = () => Date.now(), onLog = () => {} } = {}) {
  const providers = {};
  for (const [name, config] of Object.entries(adapters)) {
    // A caller may supply a ready transport (a custom client, or a test double)
    // or an endpoint map to build the standard HTTP one from. Either way the
    // adapter is only installed when it has something to talk through.
    const transport = config?.transport
      ?? (config?.endpoints
        ? createHttpTransport({
          endpoints: config.endpoints,
          fetchImpl: config.fetchImpl,
          timeoutMs: config.timeoutMs,
          onLog,
        })
        : null);
    if (!transport) {
      onLog({ type: 'provider', provider: name, installed: false, reason: 'no transport or endpoints configured' });
      continue;
    }
    const options = { transport, credentials, store, now, ...(config.options ?? {}) };
    providers[name] = name === 'qq' ? createQQProvider(options) : createNetEaseProvider(options);
    onLog({
      type: 'provider', provider: name, installed: true,
      // A caller-supplied transport need not implement roles(); reporting the
      // count is diagnostics, never a requirement.
      roles: typeof transport.roles === 'function' ? transport.roles().length : null,
    });
  }
  return new ProviderRegistry({ providers });
}

/**
 * The provider facade the core and the host share: resolution goes through the
 * platform the track belongs to, and account state is checked first so a missing
 * sign-in is reported as such rather than as a platform failure.
 */
export function createProviderFacade({ registry, store = null, now = () => Date.now(), onLog = () => {} }) {
  // Discovery candidates are refreshed on demand and cached, because the
  // selector is synchronous and must never block playback on the network.
  let discovery = [];

  return {
    registry,
    has: (provider) => registry.has(provider),
    getAccount: (provider) => registry.getAccount(provider),
    getCapabilities: (provider) => registry.getCapabilities(provider),
    getSeedTracks: (provider, options) => registry.getSeedTracks(provider, options),
    search: (provider, query, options) => registry.search(provider, query, options),
    resolve: (track, options) => resolveOnOwnPlatform({ registry, track, options }),
    platforms: () => describePlatforms(registry),

    /** Synchronous, cache-only: the selector must not perform network I/O. */
    discoveryTracks: () => discovery,

    async refreshDiscovery({ limit = 40, signal = null } = {}) {
      const result = await collectDiscovery({ registry, limit, signal });
      discovery = result.tracks;
      onLog({ type: 'discovery', count: result.tracks.length, attempts: result.attempts.length, reason: result.reason });
      return result;
    },

    clearDiscovery() { discovery = []; },
  };
}

export function createPlayback({ mode = 'real', onLog = () => {} }) {
  if (mode === 'fake') {
    const playback = new FakePlayback();
    return {
      playback,
      // Stopping the owner must stop the music in every mode, so the fake
      // backend is silenced too instead of leaving a "playing" decoy behind.
      dispose: async () => { await playback.stop({ version: Number.MAX_SAFE_INTEGER }); },
    };
  }
  // Imported lazily so the fake mode never loads the supervisor machinery.
  return import('./playback/supervisor.mjs').then(async ({ PlaybackSupervisor }) => {
    const { PlaybackService } = await import('./playback/service.mjs');
    const { wpfBackend } = await import('./playback/backends.mjs');
    const supervisor = new PlaybackSupervisor({ backend: wpfBackend(), onLog });
    const playback = new PlaybackService({ supervisor, onLog });
    return { playback, dispose: () => playback.close() };
  });
}

/**
 * Wires one core instance to a line stream. Returns a controller so tests can
 * drive it in-process as well as over stdio.
 */
export function createCoreHost({
  input = process.stdin,
  output = process.stdout,
  dbPath = ':memory:',
  /** Optional existing store; when supplied the host does not create or close it. */
  store: givenStore = null,
  playbackMode = 'real',
  /**
   * Where autonomous selection gets its candidates.
   *   'environment' (default): the local selector reads the user's imported
   *     environment and platform discovery candidates.
   *   'queue': the Phase 1 fixed-candidate debug queue passed via setQueue.
   * The two are mutually exclusive on purpose, so it is never ambiguous which
   * source produced a track.
   */
  selectionMode = 'environment',
  provider = null,
  providerRegistry = null,
  /** Optional facade from createProviderFacade(); enables the platform messages. */
  platformsFacade = null,
  clock,
  now = () => Date.now(),
  stateIntervalMs = 400,
  onLog = () => {},
} = {}) {
  if (!['environment', 'queue'].includes(selectionMode)) {
    throw new MusicError('invalid_command', `Unknown selection mode ${String(selectionMode)}`);
  }
  // An existing store may be supplied: the platform adapters must read credential
// references from the same store the host writes them to, and a caller that
// already owns a store should not end up with two.
  const store = givenStore ?? new MusicStore(dbPath);
  // With no adapter installed the core must fail resolution honestly instead of
  // resolving through a stand-in, so a fake provider is opt-in only.
  const registry = providerRegistry ?? new ProviderRegistry({});
  const requireFacade = () => {
      if (!platformsFacade) {
        throw new MusicError('provider_unavailable', 'No platform adapters are configured in this build');
      }
      return platformsFacade;
    };
    const requireProvider = (name) => {
      const facade = requireFacade();
      if (!name || !facade.has(name)) {
        throw new MusicError('provider_unavailable', `No adapter is installed for ${String(name)}`);
      }
      return facade.registry.providers[name];
    };

    const activeProvider = provider ?? providerRegistry ?? (platformsFacade ? platformsFacade : registry);
  let core = null;
  let playback = null;
  let disposePlayback = async () => {};
  let closed = false;
  let lastRevision = -1;
  let pending = Promise.resolve();

  const send = (message) => {
    if (closed) return;
    try { output.write(`${JSON.stringify({ v: CORE_HOST_PROTOCOL, ...message })}\n`); } catch { /* owner is gone */ }
  };

  const emitState = (reason) => {
    if (!core) return;
    const snapshot = core.snapshot();
    lastRevision = snapshot.revision;
    send({ type: 'state', reason, snapshot });
  };

  const publishIfChanged = () => {
    if (!core) return;
    const snapshot = core.snapshot();
    if (snapshot.revision !== lastRevision) {
      lastRevision = snapshot.revision;
      send({ type: 'state', reason: 'changed', snapshot });
    }
  };

  /** Commands are serialised so two user commands cannot interleave mid-flight. */
  const enqueue = (work) => {
    pending = pending.then(work, work);
    return pending;
  };

  const handle = async (message) => {
    const id = message.id ?? null;
    try {
      switch (message.type) {
        case 'snapshot':
          send({ type: 'result', id, ok: true, snapshot: core.snapshot() });
          return;
        case 'command': {
          const snapshot = core.dispatch({ ...message.command, commandId: message.command?.commandId ?? randomUUID() });
          await core.waitForIdle();
          send({ type: 'result', id, ok: true, snapshot: core.snapshot(), accepted: snapshot.revision });
          return;
        }
        case 'setQueue': {
          core.setQueue(message.tracks ?? []);
          send({ type: 'result', id, ok: true, snapshot: core.snapshot() });
          return;
        }
        case 'autonomous': {
          const selected = core.selectAutonomously();
          await core.waitForIdle();
          send({ type: 'result', id, ok: true, selected, snapshot: core.snapshot() });
          return;
        }
        case 'session-event': {
          const mapped = mapSessionEvent(String(message.name ?? ''));
          onLog({ type: 'session-event', name: message.name, kind: mapped.kind });
          let selected = false;
          if (mapped.allowsAutonomy) {
            selected = core.selectAutonomously();
            if (selected) await core.waitForIdle();
          }
          send({ type: 'result', id, ok: true, kind: mapped.kind, selected, snapshot: core.snapshot() });
          return;
        }
        case 'import': {
          // Records an import batch the way a platform adapter will: real
          // source, real counts, dedup by platform id, then the agent's
          // personality is initialized from what actually arrived.
          const result = importSeedTracks({
            store,
            provider: message.provider,
            source: message.source ?? 'recent',
            tracks: message.tracks ?? [],
            requested: message.requested ?? 0,
            degraded: message.degraded === true,
            reason: message.reason ?? null,
            now: now(),
          });
          const taste = initializeAgentPreferences({ store, seed: message.seed ?? null, now: now() });
          send({ type: 'result', id, ok: true, import: result, taste, snapshot: core.snapshot() });
          return;
        }
        case 'environment': {
          send({
            type: 'result', id, ok: true,
            environment: describeEnvironment(store),
            taste: describeTaste(store),
            growth: describeGrowth(store),
          });
          return;
        }
        case 'platforms': {
          if (!platformsFacade) {
            send({ type: 'result', id, ok: true, platforms: { platforms: {}, usable: [], reason: 'no platform adapters are configured in this build' } });
            return;
          }
          send({ type: 'result', id, ok: true, ...platformsFacade.platforms() });
          return;
        }
        case 'login': {
          requireFacade();
          const accountProvider = requireProvider(message.provider);
          const step = message.step ?? 'begin';
          if (step === 'begin') {
            const started = await accountProvider.beginLogin({ signal: null });
            send({ type: 'result', id, ok: true, status: 'pending', login: started });
            return;
          }
          if (step === 'poll') {
            const polled = await accountProvider.pollLogin({ signal: null });
            // A confirmed sign-in unlocks resolution, so the pool is rebuilt.
            if (polled.status === 'authorized') await platformsFacade.refreshDiscovery({ limit: 40 }).catch(() => {});
            publishIfChanged();
            send({ type: 'result', id, ok: true, status: polled.status, login: polled, account: accountProvider.getAccount() });
            return;
          }
          if (step === 'restore') {
            const restored = await accountProvider.restore({ signal: null });
            publishIfChanged();
            send({ type: 'result', id, ok: true, status: restored.status, login: restored, account: accountProvider.getAccount() });
            return;
          }
          throw new MusicError('invalid_command', `Unknown login step ${String(step)}`);
        }
        case 'logout': {
          requireFacade();
          const accountProvider = requireProvider(message.provider);
          const result = await accountProvider.logout();
          platformsFacade.clearDiscovery();
          publishIfChanged();
          send({ type: 'result', id, ok: true, status: result.status, account: accountProvider.getAccount() });
          return;
        }
        case 'import-platform': {
          // Provider-driven import: the adapter decides which source it could
          // actually use, and the environment records exactly that source.
          requireFacade();
          const accountProvider = requireProvider(message.provider);
          try {
            const seed = await accountProvider.getSeedTracks({
              limit: message.limit ?? 300, source: message.source ?? null, signal: null,
            });
            const imported = importSeedTracks({
              store, provider: message.provider, source: seed.source, tracks: seed.tracks,
              requested: seed.requested, degraded: seed.degraded, reason: seed.reason, now: now(),
            });
            const taste = initializeAgentPreferences({ store, seed: message.seed ?? null, now: now() });
            publishIfChanged();
            send({ type: 'result', id, ok: true, provider: message.provider, source: seed.source, import: imported, attempts: seed.attempts, taste, snapshot: core.snapshot() });
          } catch (error) {
            // A failed import is reported with its reason and attempt trail; it
            // is never turned into an empty success.
            send({
              type: 'error', id, provider: message.provider, ok: false,
              error: { code: error.code ?? 'provider_failure', message: error.message, retryable: Boolean(error.retryable) },
              attempts: error.details?.attempts ?? [],
            });
          }
          return;
        }
        case 'discovery': {
          requireFacade();
          const result = await platformsFacade.refreshDiscovery({ limit: message.limit ?? 40, signal: null });
          send({
            type: 'result', id, ok: true,
            discovery: { count: result.tracks.length, attempts: result.attempts, reason: result.reason },
          });
          return;
        }
        case 'search': {
          requireFacade();
          const accountProvider = requireProvider(message.provider);
          const found = await accountProvider.search(message.query ?? '', { limit: message.limit ?? 20, signal: null });
          send({ type: 'result', id, ok: true, provider: message.provider, query: found.query, tracks: found.tracks, capability: found.capability });
          return;
        }
        case 'account': {
          send({
            type: 'result',
            id,
            ok: true,
            account: registry.getAccount(message.provider),
            capabilities: registry.getCapabilities(message.provider),
          });
          return;
        }
        case 'wait': {
          await core.waitForIdle();
          send({ type: 'result', id, ok: true, snapshot: core.snapshot() });
          return;
        }
        case 'shutdown': {
          send({ type: 'result', id, ok: true, snapshot: core.snapshot() });
          await close();
          return;
        }
        default:
          throw new MusicError('invalid_command', `Unknown host message: ${String(message.type)}`);
      }
    } catch (error) {
      send({
        type: 'error',
        id,
        error: { code: error.code ?? 'internal', message: error.message },
        snapshot: core?.snapshot() ?? null,
      });
    }
  };

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    try { await disposePlayback(); } catch (error) { onLog({ type: 'playback-dispose-failed', message: error.message }); }
    try { if (!givenStore) store.close(); } catch { /* already closed */ }
  }

  let timer = null;

  return {
    async start() {
      const created = await createPlayback({ mode: playbackMode, onLog });
      playback = created.playback;
      disposePlayback = created.dispose;
      core = new MusicCore({
        store,
        provider: activeProvider,
        playback,
        selector: selectionMode === 'environment'
          ? buildSelector({
            store,
            now,
                            listDiscovery: platformsFacade ? () => platformsFacade.discoveryTracks() : null,
          })
          : null,
        // A finished listen is reported here; growth policy decides what, if
        // anything, it changes about the agent's preferences.
        onListened: (entry) => {
          const report = applyListenGrowth({ store, entry, durationMs: entry.durationMs, now: now() });
          onLog({ type: 'growth', updated: report.updated, reason: report.reason, delta: report.delta ?? 0 });
          if (report.updated) publishIfChanged();
          return report;
        },
        ...(clock ? { clock } : {}),
      });
      playback.onEvent((event) => {
        const accepted = core.onPlaybackEvent(event);
        if (accepted) publishIfChanged();
        return accepted;
      });
      timer = setInterval(publishIfChanged, stateIntervalMs);
      timer.unref?.();
      send({ type: 'ready', protocol: CORE_HOST_PROTOCOL, snapshot: core.snapshot() });
      return core;
    },
    handle: (message) => enqueue(() => handle(message)),
    close,
    get core() { return core; },
    get playback() { return playback; },
    get store() { return store; },
    snapshot: () => core?.snapshot() ?? null,
  };
}

/** Runs the host against a readline stream, the way the plugin starts it. */
export async function runCoreHost(options = {}) {
  const host = createCoreHost(options);
  await host.start();
  const rl = createInterface({ input: options.input ?? process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      options.output?.write?.(`${JSON.stringify({ v: CORE_HOST_PROTOCOL, type: 'error', id: null, error: { code: 'invalid_command', message: 'Line is not JSON' } })}\n`);
      continue;
    }
    await host.handle(message);
    if (message.type === 'shutdown') break;
  }
  rl.close();
  await host.close();
  return host;
}