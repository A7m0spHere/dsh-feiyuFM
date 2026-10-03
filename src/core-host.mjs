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
import { importSeedTracks, describeEnvironment, describeEnvironmentProfile } from './environment.mjs';
import { applyListenGrowth, decayPreferences, describeGrowth } from './growth.mjs';
import { createSessionRegistry, mayStartPlayback } from './sessions.mjs';
import { createHttpTransport } from './providers/transport.mjs';
import { createNetEaseProvider } from './providers/netease.mjs';
import { createQQProvider } from './providers/qq.mjs';
import { describePlatforms, collectDiscovery, resolveOnOwnPlatform, summarizeSeedRuns } from './providers/coordinator.mjs';
import { createDiscoveryCache } from './discovery.mjs';

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
    rng: rng ?? createRng(store.getCoreState()?.selectionRngState ?? (Number.isSafeInteger(seed) ? seed : 1)),
    isPlayable: track => store.isTrackAvailable(track, now()),
    listFamiliar: () => [...new Map([...store.listEnvironment({ limit: 100000 }), ...store.listAgentKnownTracks()].map(row => [row.track_key, row])).values()].map((row) => {
      // Restore the stored metadata, not just the key: the effective-progress
      // threshold needs the real duration, and a title is needed to tell the
      // user what is playing.
      const stored = store.getNormalizedTrack({
        provider: row.provider,
        providerTrackId: row.track_key.split(':').slice(1).join(':'),
      });
      return stored;
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
    const options = { transport, credentials, store, now, onLog, ...(config.options ?? {}) };
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
  const discovery = createDiscoveryCache({ registry, store, now, onLog });

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
    discoveryTracks: () => discovery.tracks(),
    discoveryStatus: () => discovery.status(),
    setDiscoveryEnabled: value => discovery.setEnabled(value),
    tickDiscovery: () => discovery.tick(),
    onDiscoveryChange: fn => discovery.onChange(fn),
    closeDiscovery: () => discovery.close(),

    refreshDiscovery: options => discovery.refresh(options),

    clearDiscovery() { discovery.clear(); },
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
  /**
   * How often preferences are decayed. Defaults to a slow cadence derived from
   * the state interval; explicit so tests and long-running hosts can choose.
   */
  maintenanceIntervalMs = undefined,
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

    const activeProvider = provider ?? platformsFacade ?? providerRegistry ?? registry;
  let core = null;
  let playback = null;
  let disposePlayback = async () => {};
  /** Periodic maintenance handle (preference decay); cleared on close. */
  let maintenance = null;
  // Which DSH session is active, and therefore who may start music.
  const sessions = createSessionRegistry({ now });
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
          onLog({ type: 'command', kind: message.command?.type });
          const snapshot = core.dispatch({ ...message.command, commandId: message.command?.commandId ?? randomUUID() });
          platformsFacade?.setDiscoveryEnabled(snapshot.settings.discovery && snapshot.settings.discoveryRate > 0);
          platformsFacade?.tickDiscovery();
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
          // Every session event is noted so the registry knows who is active,
          // even when the event itself may not start music.
          const note = sessions.note(message.sessionId, { at: now(), kind: mapped.kind });
          // The active session is what a listen gets attributed to, so growth can
          // tell a transient session's activity from long-term use.
          const active = sessions.activeSessionId(now());
          if (active) {
            core.currentSessionId = active;
            core.currentSessionTransient = sessions.isTransient(active, now());
          }
          const gate = mapped.allowsAutonomy
            ? mayStartPlayback({
              registry: sessions, sessionId: message.sessionId,
              playing: Boolean(core.snapshot().current), at: now(),
            })
            : { allowed: false, reason: 'this event may not start music' };
          onLog({
            type: 'session-event', name: message.name, kind: mapped.kind,
            session: typeof message.sessionId === 'string' ? `${message.sessionId.slice(0, 8)}…` : null,
            autonomy: gate.allowed, reason: gate.reason,
          });
          let selected = false;
          if (gate.allowed) {
            selected = core.selectAutonomously();
            if (selected) await core.waitForIdle();
          }
          send({
            type: 'result', id, ok: true, kind: mapped.kind, selected,
            autonomy: { allowed: gate.allowed, reason: gate.reason },
            sessions: sessions.describe(now()),
            snapshot: core.snapshot(),
          });
          return;
        }
        case 'sessions': {
          send({ type: 'result', id, ok: true, ...sessions.describe(now()) });
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
        case 'library': {
          const tracks = store.listEnvironment({ limit: 300 }).map(row => {
            const track = store.getTrack({ provider: row.provider, providerTrackId: row.track_key.split(':').slice(1).join(':') });
            return { provider: track.provider, providerTrackId: track.provider_track_id,
              title: track.title, artist: track.artist, durationMs: track.duration_ms };
          });
          send({ type: 'result', id, ok: true, library: { total: store.countEnvironment(), tracks } });
          return;
        }
        case 'environment': {
          send({
            type: 'result', id, ok: true,
            environment: describeEnvironment(store),
            profile: describeEnvironmentProfile(store,now()),
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
            if (polled.status === 'authorized') platformsFacade.tickDiscovery();
            publishIfChanged();
            send({ type: 'result', id, ok: true, status: polled.status, login: polled, account: accountProvider.getAccount() });
            return;
          }
          if (step === 'restore') {
            const restored = await accountProvider.restore({ signal: null });
            if (restored.status === 'authorized') platformsFacade.tickDiscovery();
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
              playlistId: message.playlistId ?? null,
            });
            const imported = importSeedTracks({
              store, provider: message.provider, source: seed.source, tracks: seed.tracks,
              requested: seed.requested, degraded: seed.degraded, reason: seed.reason, sourceRef:seed.sourceRef??'', now: now(),
            });
            const taste = initializeAgentPreferences({ store, seed: message.seed ?? null, now: now() });
            platformsFacade.tickDiscovery();
            publishIfChanged();
            send({ type: 'result', id, ok: true, provider: message.provider, source: seed.source, import: imported, attempts: seed.attempts, taste, snapshot: core.snapshot() });
          } catch (error) {
            // A failed import is reported with its reason and attempt trail; it
            // is never turned into an empty success.
            send({
              type: 'error', id, provider: message.provider, ok: false,
              error: { code: error.code ?? 'provider_failure', message: error.message,
                retryable: Boolean(error.retryable), details: error.details ?? null },
              attempts: error.details?.attempts ?? [],
            });
          }
          return;
        }
        case 'discovery': {
          requireFacade();
          void platformsFacade.refreshDiscovery({ manual: true });
          const status = platformsFacade.discoveryStatus();
          send({
            type: 'result', id, ok: true,
            discovery: status,
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
        case 'playlists': {
          const adapter=requireProvider(message.provider);
          if(typeof adapter.getUserPlaylists!=='function')throw new MusicError('capability_unavailable','Playlist selection is unavailable');
          const playlists=await adapter.getUserPlaylists();
          send({type:'result',id,ok:true,playlists});return;
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
        error: { code: error.code ?? 'internal', message: error.message,
          retryable: Boolean(error.retryable), details: error.details ?? null },
        snapshot: core?.snapshot() ?? null,
      });
    }
  };

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    if (maintenance) clearInterval(maintenance);
    platformsFacade?.closeDiscovery();
    core?._invalidate();
    try { await disposePlayback(); } catch (error) { onLog({ type: 'playback-dispose-failed', message: error.message }); }
    try { await core?.waitForIdle(); } catch { /* late tasks cannot publish after invalidation */ }
    try { if (!givenStore) store.close(); } catch { /* already closed */ }
  }

  let timer = null;

  return {
    async start() {
      const created = await createPlayback({ mode: playbackMode, onLog });
      playback = created.playback;
      disposePlayback = created.dispose;
      // Maintenance: preferences decay toward neutral as time passes. Growth is
      // non-negative by rule, so without a scheduled decay pass a preference
      // could only ever ratchet upward. This is a requirement, not housekeeping.
      maintenance = setInterval(() => {
        try {
          const result = decayPreferences({ store, now: now() });
          if (result.changed) onLog({ type: 'maintenance', decayed: result.changed });
        } catch (error) {
          onLog({ type: 'maintenance_error', message: error.message });
        }
      }, Math.max(maintenanceIntervalMs ?? stateIntervalMs * 30, 250));
      maintenance.unref?.();
      core = new MusicCore({
        onLog,
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
          const sessionId = entry.sessionId ?? null;
          const report = applyListenGrowth({
            store, entry, durationMs: entry.durationMs, now: now(),
            // A session that has not been around long precipitates only a little
            // into long-term preferences, and its total influence is capped.
            session: sessionId ? { sessionId, transient: entry.sessionTransient ?? sessions.isTransient(sessionId, now()) } : null,
          });
          onLog({
            type: 'growth', updated: report.updated, reason: report.reason, delta: report.delta ?? 0,
            playInstanceId: entry.playInstanceId, effectiveMs: entry.effectiveMs, before: report.before, after: report.after,
            session: sessionId ? `${sessionId.slice(0, 8)}…` : null, capped: Boolean(report.sessionCapped),
          });
          if (report.updated) publishIfChanged();
          return report;
        },
        ...(clock ? { clock } : {}),
      });
      for (const entry of store.pendingGrowthEntries()) {
        try { core.onListened(entry); }
        catch { onLog({ type: 'growth-replay-failed', playInstanceId: entry.playInstanceId }); }
      }
      playback.onEvent((event) => {
        const accepted = core.onPlaybackEvent(event);
        onLog({ type: 'playback', event: event.type, playInstanceId: event.playInstanceId, positionMs: event.positionMs, effectiveDeltaMs: event.effectiveDeltaMs, code: event.code, accepted });
        if (accepted) publishIfChanged();
        return accepted;
      });
      platformsFacade?.setDiscoveryEnabled(core.snapshot().settings.discovery && core.snapshot().settings.discoveryRate > 0);
      send({ type: 'ready', protocol: CORE_HOST_PROTOCOL, snapshot: core.snapshot() });
      platformsFacade?.onDiscoveryChange(() => { core._commit(); publishIfChanged(); });
      platformsFacade?.tickDiscovery();
      timer = setInterval(() => { platformsFacade?.tickDiscovery(); publishIfChanged(); }, stateIntervalMs);
      timer.unref?.();
      return core;
    },
    // Dispatch/reads are synchronous until their first await. Keep them out of
    // long account/import work so a slow media request cannot hold up pause.
    handle: (message) => ['command','snapshot','platforms','library','account','environment','sessions','discovery','shutdown','wait','autonomous','session-event','setQueue'].includes(message.type)
      ? handle(message) : enqueue(() => handle(message)),
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
  const running = new Set();
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    let message;
    try {
      message = JSON.parse(text);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid message shape');
    } catch {
      (options.output ?? process.stdout).write(`${JSON.stringify({ v: CORE_HOST_PROTOCOL, type: 'error', id: null, error: { code: 'invalid_command', message: 'Line must be a JSON Host message object' } })}\n`);
      continue;
    }
    const work = host.handle(message);
    running.add(work);
    work.finally(() => running.delete(work)).catch(() => {});
    if (message.type === 'shutdown') { await work; break; }
  }
  rl.close();
  await host.close();
  await Promise.allSettled([...running]);
  return host;
}
