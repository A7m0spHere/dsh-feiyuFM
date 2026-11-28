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
import { createLyricsService } from './lyrics.mjs';
import { MusicError, PROVIDERS, normalizeTrack, trackId } from './contracts.mjs';
import { MusicStore } from './storage.mjs';
import { MusicCore } from './core.mjs';
import { FakePlayback } from './fakes.mjs';
import { createSelector } from './selection.mjs';
import {initializeRecentPlayback,repeatContext} from './recent-playback.mjs';
import {SUPPLY_POLICY,reviewedKeys} from './recommendation-supply.mjs';
import { createRng, readAgentSeed, initializeAgentPreferences, describeTaste } from './taste.mjs';
import { importSeedTracks, describeEnvironment, describeEnvironmentProfile } from './environment.mjs';
import { applyListenGrowth, decayPreferences, describeGrowth } from './growth.mjs';
import { createSessionRegistry, mayStartPlayback } from './sessions.mjs';
import { createHttpTransport } from './providers/transport.mjs';
import { createNetworkClient, networkProxyView, saveNetworkProxy } from './network.mjs';
import { playbackSourceView, savePlaybackSource, isRecommendationSource } from './playback-source.mjs';
import { activateMusicAccount, hasLegacyMusicData, initializeMusicAccount, musicAccount, recoverLegacyMusicData, requireCurrentMusicAccount } from './music-account.mjs';
import { NETEASE_ORIGIN } from './providers/endpoints/netease.mjs';
import { createNetEaseProvider } from './providers/netease.mjs';
import { createQQProvider } from './providers/qq.mjs';
import { describePlatforms, collectDiscovery, resolveOnOwnPlatform, summarizeSeedRuns } from './providers/coordinator.mjs';
import { createDiscoveryCache } from './discovery.mjs';
import {describeMusicFacts,describeMusicInsights} from './insights.mjs';
import {describeDiscoveryJournal} from './discovery-journal.mjs';
import {setExpressionStyle} from './expression.mjs';
import {listTrackFeedback,clearTrackFeedback,validateFeedbackQuery,feedbackView} from './feedback.mjs';
import {createTrackGraphCache} from './track-graph.mjs';
import {personaView,reserveSummary,startSummary,finishSummary,recoverSummaryCalls,setSummaryBudget,setSummaryOutputTokens,setSummaryAutomatic,factBundle} from './persona.mjs';
import {modelRecommendations,modelRecommendationTracks,recommendationMode,createModelRecommendationResolver,STRATEGY_PURPOSE} from './model-recommendations.mjs';

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
  async close() {
    await Promise.allSettled(Object.values(this.providers).map(provider => provider.dispose?.()));
  }

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

  async checkPlayability(provider, tracks, options = {}) {
    const adapter = this.providers[provider];
    if (!adapter || typeof adapter.checkPlayability !== 'function') {
      return { playable: [], unplayable: [], checked: 0, skipped: true };
    }
    return adapter.checkPlayability(tracks, options);
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
export function buildSelector({ store, now = () => Date.now(), rng = null, listDiscovery = null, graphCache = null }) {
  const seed = readAgentSeed(store);
  const familiar = track => store.getEnvironmentEntry(track)||store.hasEffectiveListen(track)
    ||store.listLikedTracks().some(row=>row.track_key===`${track.provider}:${track.providerTrackId}`);
  const selector = createSelector({
    store,
    graphCache,
    // A stored seed keeps selection reproducible across restarts; without one
    // the session still works, it just is not reproducible.
    rng: rng ?? createRng(store.getCoreState()?.selectionRngState ?? (Number.isSafeInteger(seed) ? seed : 1)),
    // Availability is filtered by the selector itself; see core.mjs.
    // LLM 模式的默认池只来自模型歌单。options.libraryFallback 是用户主动
    // 下一首的回退通道：歌单没有可播曲目时改用输入曲库，自主续播不用它。
    listFamiliar: (options = {}) => recommendationMode(store)==='filtered'&&!options.libraryFallback
      ? (listDiscovery?.()??[]).filter(track=>track.provider===playbackSourceView(store).provider&&Number.isSafeInteger(track.discovery?.llmRank)
        &&track.discovery.llmRank>0&&isRecommendationSource(track.discovery?.source, track.provider)
        &&(options.discoveryRate>0||familiar(track)))
      : recommendationMode(store)==='llm'&&!options.libraryFallback
      ? modelRecommendationTracks(store).filter(t=>t.provider===playbackSourceView(store).provider).filter(t=>store.getEnvironmentEntry(t)||store.hasEffectiveListen(t)||store.listLikedTracks().some(r=>r.track_key===`${t.provider}:${t.providerTrackId}`))
      : [...new Map([...store.listEnvironment({ limit: 100000 }), ...store.listAgentKnownTracks(), ...store.listLikedTracks()].map(row => [row.track_key, row])).values()].map((row) => {
      // Restore the stored metadata, not just the key: the effective-progress
      // threshold needs the real duration, and a title is needed to tell the
      // user what is playing.
      const stored = store.getNormalizedTrack({
        provider: row.provider,
        providerTrackId: row.track_key.split(':').slice(1).join(':'),
      });
      return stored;
    }).filter(track => track.provider === playbackSourceView(store).provider),
    listDiscovery: (options = {}) => {
      if(recommendationMode(store)==='filtered')return [];
      // LLM 模式探索池：模型歌单中未听过的歌 + 平台发现候选（后续由 LLM 筛选排序）。
      if (recommendationMode(store) === 'llm' && !options.libraryFallback) {
        const playlist = modelRecommendationTracks(store).filter(t=>t.provider===playbackSourceView(store).provider).filter(t=>!store.getEnvironmentEntry(t)&&!store.hasEffectiveListen(t)&&!store.listLikedTracks().some(r=>r.track_key===`${t.provider}:${t.providerTrackId}`));
        const seen = new Set(playlist.map(t=>`${t.provider}:${t.providerTrackId}`));
        const platform = (listDiscovery?.() ?? []).filter(t => !seen.has(`${t.provider}:${t.providerTrackId}`));
        return [...playlist, ...platform];
      }
      return (listDiscovery?.()??[]).filter(track => track.provider === playbackSourceView(store).provider);
    },
    now,
  });
  return {...selector,next(options={}){
    // The filtered playlist is one pool; local constraints decide when a pick
    // can play. Keep novelty accounting without treating the playlist as two
    // unrelated pools that can randomly produce "no candidates".
    const decision=selector.next(options);
    if(recommendationMode(store)==='filtered'&&decision.track&&decision.pool!=='queue'&&!options.libraryFallback){
      const unfamiliar=!familiar(decision.track);
      return {...decision,pool:unfamiliar?'discovery':'familiar',fellBack:false,fallbackReason:null,attemptedDiscovery:unfamiliar};
    }
    return decision;
  }};
}

/**
 * Builds the real provider registry from adapter configurations.
 *
 * Each entry is `{ provider, transport, credentials, endpoints }`; an entry with
 * no transport or endpoints is deliberately left uninstalled, so the host reports
 * "not installed" instead of pretending to have the platform.
 */
export function buildProviderRegistry({ adapters = {}, credentials = null, store = null, now = () => Date.now(), onLog = () => {}, network = null } = {}) {
  network ??= createNetworkClient({ getSettings: () => networkProxyView(store) });
  const providers = {};
  for (const [name, config] of Object.entries(adapters)) {
    // A caller may supply a ready transport (a custom client, or a test double)
    // or an endpoint map to build the standard HTTP one from. Either way the
    // adapter is only installed when it has something to talk through.
    const transport = config?.transport
      ?? (config?.endpoints
        ? createHttpTransport({
          endpoints: config.endpoints,
          trustedOrigin: name === 'netease' ? NETEASE_ORIGIN : config.trustedOrigin,
          maxResponseBytes: config.maxResponseBytes,
          maxCookieBytes: config.maxCookieBytes,
          fetchImpl: config.fetchImpl ?? network.fetch,
          timeoutMs: config.timeoutMs,
          onLog,
        })
        : null);
    if (!transport) {
      onLog({ type: 'provider', provider: name, installed: false, reason: 'no transport or endpoints configured' });
      continue;
    }
    const options = { transport, credentials, store, now, onLog, network, ...(config.options ?? {}) };
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
  const modelResolver=createModelRecommendationResolver({store,registry,now,onChange:()=>listeners.forEach(fn=>fn())});
  const listeners=new Set();
  const freshTracks = tracks => {
    const recent=repeatContext(store),current=store?.getCoreState()?.current?.track;
    const currentKey=current?`${current.provider}:${current.providerTrackId}`:recent.lastTrackKey;
    return tracks.filter(track=>{const key=`${track.provider}:${track.providerTrackId}`;return !recent.keys.has(key)&&key!==currentKey;});
  };
  let replenishing=true;
  const playbackSupply=(includeTracks=false)=>{
    const approved=discovery.playbackRecommendations(),recent=repeatContext(store),settings=store.getCoreState()?.settings;
    const discoveryOff=Boolean(settings&&(settings.discovery===false||settings.discoveryRate===0));
    const liked=new Set(discoveryOff?store.listLikedTracks().map(r=>r.track_key):[]);
    // Batched sets instead of two prepared statements per approved track.
    const environment=discoveryOff?(store.environmentKeys?.()??new Set()):null;
    const effective=discoveryOff?(store.effectiveListenKeys?.()??new Set()):null;
    const permitted=discoveryOff
      ?approved.filter(t=>environment.has(`${t.provider}:${t.providerTrackId}`)||effective.has(`${t.provider}:${t.providerTrackId}`)||liked.has(`${t.provider}:${t.providerTrackId}`)):approved;
    const availableTracks=freshTracks(permitted),available=availableTracks.length;
    if(available<=SUPPLY_POLICY.lowWater)replenishing=true;
    if(available>=SUPPLY_POLICY.target)replenishing=false;
    return{total:approved.length,available,recentBlocked:approved.filter(t=>recent.keys.has(`${t.provider}:${t.providerTrackId}`)).length,
      replenishing,lowWater:SUPPLY_POLICY.lowWater,target:SUPPLY_POLICY.target,
      ...(includeTracks?{tracks:availableTracks.slice(0,100).map(track=>({
        ...normalizeTrack(track),discovery:{source:track.discovery?.source??'platform_recommendation',
          llmReason:typeof track.discovery?.llmReason==='string'?track.discovery.llmReason.slice(0,420):''},
      }))}:{})};
  };
  const recommendationCandidates=()=>{
    const owner=discovery.status().candidateOwner,reviewed=reviewedKeys(store,owner,now());
    const approved=new Set(discovery.playbackRecommendations().map(t=>`${t.provider}:${t.providerTrackId}`));
    return freshTracks(discovery.candidates().filter(track=>track.provider===playbackSourceView(store).provider))
      .filter(t=>!reviewed.has(`${t.provider}:${t.providerTrackId}`)&&!approved.has(`${t.provider}:${t.providerTrackId}`));
  };

  return {
    registry,
    has: (provider) => registry.has(provider),
    getAccount: (provider) => registry.getAccount(provider),
    getCapabilities: (provider) => registry.getCapabilities(provider),
    getSeedTracks: (provider, options) => registry.getSeedTracks(provider, options),
    search: (provider, query, options) => registry.search(provider, query, options),
    resolve: (track, options) => resolveOnOwnPlatform({ registry, track, options }),
    checkPlayability: (provider, tracks, options) => registry.checkPlayability(provider, tracks, options),
    resourceContext: track => registry.providers[track.provider]?.resourceContext?.() ?? '',
    platforms: () => describePlatforms(registry),

    /** Synchronous, cache-only: the selector must not perform network I/O. */
    discoveryTracks: () => recommendationMode(store)==='filtered'
      ? discovery.playbackRecommendations().filter(track=>track.provider===playbackSourceView(store).provider) : discovery.tracks(),
    recommendationCandidates,
    // LLM 模式下平台候选同样进入缓存，供 LLM 筛选（探索池）；歌单核对信息单列。
    discoveryStatus: () => {
      const status = discovery.status();
      if(recommendationMode(store)==='filtered'){
        const picks=discovery.recommendations().filter(track=>track.provider===playbackSourceView(store).provider);
        const filter=store.getSetting('discovery_filter_v1',null);
        const selectionComplete=filter?.source==='llm-discovery-filter'&&filter.candidateRevision===status.candidateRevision;
        return {...status,pipeline:'platform-filter',count:discovery.candidates().filter(track=>track.provider===playbackSourceView(store).provider).length,
          picked:picks.length,remaining:freshTracks(picks).length,filterCallId:filter?.callId??null,
          tracks:picks.slice(0,12),summary:selectionComplete||picks.length?filter?.text??'':'',selectionComplete,
          playbackPool:playbackSupply(true),
          referenceCount:store.countEnvironment(playbackSourceView(store).provider),playlist:null};
      }
      if (recommendationMode(store) !== 'llm') return status;
      const record = modelRecommendations(store);
      return { ...status, playlist: record ? { verification: record.verification, verified: record.verified.length, total: record.songs.length } : null };
    },
    setDiscoveryEnabled: value => discovery.setEnabled(recommendationMode(store)==='filtered'?store.countEnvironment(playbackSourceView(store).provider)>0:Boolean(value)),
    tickDiscovery: () => {
      if(recommendationMode(store)==='filtered'){
        const snapshot=store.getCoreState(),status=discovery.status();
        const allowed=snapshot?.settings.listening!==false&&!(snapshot?.blockUntil>now());
        discovery.tick({replenish:allowed&&!status.filtering&&playbackSupply().replenishing&&recommendationCandidates().length===0});
      }else{discovery.tick();if(recommendationMode(store)==='llm')modelResolver.tick();}
    },
    onDiscoveryChange: fn => {listeners.add(fn);const off=discovery.onChange(fn);return()=>{listeners.delete(fn);off();};},
    closeDiscovery: () => {modelResolver.close();discovery.close();listeners.clear();},

    refreshDiscovery: options => discovery.refresh(options),
    verifyModelRecommendations:()=>{if(recommendationMode(store)==='llm')modelResolver.tick();},

    clearDiscovery() { modelResolver.cancel();discovery.clear(); },
    cancelAccountWork() { modelResolver.cancel(); discovery.cancel(); replenishing = true; },
  };
}

export function createPlayback({ mode = 'real', onLog = () => {}, network = createNetworkClient() }) {
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
    const { MediaDownloads } = await import('./playback/media-download.mjs');
    const { backendForPlatform } = await import('./playback/backends.mjs');
    const supervisor = new PlaybackSupervisor({ backend: backendForPlatform(), onLog });
    const playback = new PlaybackService({ supervisor, onLog, mediaDownloads: new MediaDownloads({ network, onLog }) });
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
  accountIsolation = false,
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
  const network = createNetworkClient({ getSettings: () => networkProxyView(store) });
  if(playbackMode==='real'&&store.getSetting('recommendation_pipeline_v1',null)!==1){
    store.setSetting('recommendation_mode_v1','filtered');
    store.setSetting('recommendation_pipeline_v1',1);
  }
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
  const lyrics = createLyricsService({ providerFor: name => platformsFacade?.registry.providers[name] ?? registry.providers[name], now });
  let core = null;
  let playback = null;
  let disposePlayback = async () => {};
  /**
   * 画像计算缓存：UI 每 ~2 秒轮询 persona/insights，重块（全部曲目/偏好/
   * 成长任务解析）只在失效事件后重算一次。失效是显式白名单——任何命令、
   * 成长回调、导入、实际生效的衰减、模型调用收尾。
   */
  const trackGraph=createTrackGraphCache({store});
  const profileCache={valid:false,insightsFacts:null,bundle:null,strategyBundle:null,growthRows:null,callRows:null,graph:null};
  const invalidateProfile=()=>{trackGraph.invalidate();profileCache.valid=false;};
  const profileInputs=()=>{
    if(profileCache.valid)return profileCache;
    profileCache.insightsFacts=describeMusicFacts(store);
    // 相似图与画像同源失效；歌单生成的事实包也带关系事实（P2）。
    profileCache.graph=trackGraph.get();
    profileCache.bundle=factBundle(store,core.snapshot());
    profileCache.strategyBundle=factBundle(store,core.snapshot(),STRATEGY_PURPOSE,null,profileCache.graph);
    profileCache.growthRows=store.db.prepare('SELECT rowid,entry_json FROM growth_jobs ORDER BY rowid').all()
      .map(row=>{try{return{rowid:row.rowid,entry:JSON.parse(row.entry_json)};}catch{return null;}}).filter(Boolean);
    profileCache.callRows=store.db.prepare('SELECT * FROM music_model_calls ORDER BY started_at DESC').all();
    profileCache.valid=true;
    return profileCache;
  };
  /** Periodic maintenance handle (preference decay); cleared on close. */
  let maintenance = null;
  // Which DSH session is active, and therefore who may start music.
  const sessions = createSessionRegistry({ now });
  let closed = false;
  let lastRevision = -1;
  const platformPending = new Map();
  // Independent of playback commands: input resets supersede even imports
  // queued by another client before the reset, without cancelling on pause.
  let inputEpoch = 0;
  let loginAttempt = null;
  let disconnecting = false;
  let restoringAccount = null;

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
    // Unchanged revisions cannot be published. Avoid projecting the entire
    // platform/library state on every 400ms heartbeat just to discard it.
    if (!core || core.state.revision === lastRevision) return;
    const started = performance.now();
    const snapshot = core.snapshot();
    const durationMs = performance.now() - started;
    if (durationMs >= 50) onLog({ type: 'slow-op', op: 'snapshot', durationMs: Math.round(durationMs) });
    if (snapshot.revision !== lastRevision) {
      lastRevision = snapshot.revision;
      send({ type: 'state', reason: 'changed', snapshot });
    }
  };

  /** Commands are serialised so two user commands cannot interleave mid-flight. */
  const enqueue = (provider, work) => {
    const next = (platformPending.get(provider) ?? Promise.resolve()).then(work, work);
    platformPending.set(provider, next);
    return next;
  };

  const updateAccount = () => {
    invalidateProfile();
    core._commit();
    platformsFacade?.setDiscoveryEnabled(core.state.settings.discovery && core.state.settings.discoveryRate > 0);
    platformsFacade?.tickDiscovery();
    publishIfChanged();
  };

  function checkAccount(message, provider = null) {
    return requireCurrentMusicAccount(store, provider, message.accountRevision ?? message.command?.accountRevision);
  }

  function checkPlatformAccess(message) {
    const current = checkAccount(message, message.provider);
    if (!current) return;
    const platform = registry.getAccount(message.provider);
    if (platform.status !== 'authorized' || platform.accountId !== current.accountId) {
      throw new MusicError('login_required', '请先完成当前音乐账号的登录验证。');
    }
  }

  async function disconnectAccount(name, adapter) {
    if (disconnecting) throw new MusicError('music_account_busy', '正在退出音乐账号，请稍后重试。');
    if (loginAttempt?.provider === name) {
      loginAttempt.controller.abort();
      loginAttempt = null;
    }
    disconnecting = true;
    restoringAccount = null;
    try {
      if (musicAccount(store).provider === name) {
        ++inputEpoch;
        platformsFacade.cancelAccountWork();
        core.resetAccountPlayback();
        activateMusicAccount(store);
        initializeRecentPlayback(store);
      }
      return await adapter.logout();
    } finally {
      disconnecting = false;
      updateAccount();
    }
  }

  async function restoreAccount(name, adapter) {
    if (restoringAccount) return restoringAccount;
    const scope = musicAccount(store);
    const work = (async () => {
      try {
        const restored = await adapter.restore({ signal: null });
        if (closed || musicAccount(store).revision !== scope.revision) throw new MusicError('cancelled', '旧账号验证已取消。');
        if (restored.status === 'authorized' && restored.accountId !== scope.accountId) {
          await disconnectAccount(name, adapter);
          throw new MusicError('music_account_changed', '登录凭据对应的账号已变化，请重新扫码。');
        }
        return restored;
      } finally {
        if (!closed && musicAccount(store).revision === scope.revision) updateAccount();
      }
    })();
    restoringAccount = work;
    try { return await work; }
    finally { if (restoringAccount === work) restoringAccount = null; }
  }

  async function loginSingleAccount(message, adapter, step) {
    const name = message.provider;
    const active = musicAccount(store);
    if (message.accountRevision !== undefined && message.accountRevision !== active.revision) {
      throw new MusicError('music_account_changed', '音乐账号已变化，请刷新后重试。');
    }
    if (disconnecting) throw new MusicError('music_account_busy', '正在退出音乐账号，请稍后重试。');
    if (step === 'restore') {
      checkAccount(message, name);
      return await restoreAccount(name, adapter);
    }
    if (active.provider) throw new MusicError('music_account_connected', '请先退出当前账号，再扫码登录。');
    if (step === 'begin') {
      if (loginAttempt) {
        throw new MusicError('music_login_pending', '已有扫码登录，请先完成或取消。');
      }
      const attempt = { id: randomUUID(), provider: name, controller: new AbortController(), polling: false, ready: false };
      loginAttempt = attempt;
      try {
        const result = await adapter.beginLogin({ signal: attempt.controller.signal });
        if (loginAttempt !== attempt) throw new MusicError('cancelled', '扫码登录已取消。');
        attempt.ready = true;
        return { ...result, status: 'pending', attemptId: attempt.id };
      } catch (error) {
        if (loginAttempt === attempt) loginAttempt = null;
        throw error;
      }
    }
    if (step !== 'poll') throw new MusicError('invalid_command', `Unknown login step ${String(step)}`);
    const attempt = loginAttempt;
    if (!attempt?.ready || attempt.provider !== name || attempt.id !== message.attemptId) {
      throw new MusicError('music_login_changed', '扫码登录已变化，请重新获取二维码。');
    }
    if (attempt.polling) throw new MusicError('music_account_busy', '正在验证扫码登录，请稍后重试。', { retryable: true });
    attempt.polling = true;
    try {
      const result = await adapter.pollLogin({ signal: attempt.controller.signal });
      if (loginAttempt !== attempt) throw new MusicError('cancelled', '扫码登录已取消。');
      if (result.status === 'expired') loginAttempt = null;
      if (result.status === 'authorized') {
        loginAttempt = null;
        try {
          if (!result.accountId) throw new MusicError('account_id_unavailable', '音乐平台未返回可验证的账号 ID。');
          activateMusicAccount(store, name, result.accountId);
          store.clearUnavailable?.(name);
        } catch (error) {
          await disconnectAccount(name, adapter);
          throw error;
        }
        initializeRecentPlayback(store);
        ++inputEpoch;
        updateAccount();
      }
      return { ...result, attemptId: attempt.id };
    } finally { attempt.polling = false; }
  }

  const handle = async (message, inputVersion = inputEpoch) => {
    const id = message.id ?? null;
    try {
      switch (message.type) {
        case 'lyrics': {
          const current = core.state.current;
          if (!current || trackId(current.track) !== trackId(message.track)) throw new MusicError('stale_track', '歌曲已经切换，请重新读取歌词。');
          const value = await lyrics.get(current.track);
          send({ type: 'result', id, ok: true, lyrics: value });
          return;
        }
        case 'snapshot': {
          const snapshotStarted = performance.now();
          const snapshot = core.snapshot();
          const snapshotMs = performance.now() - snapshotStarted;
          if (snapshotMs >= 50) onLog({ type: 'slow-op', op: 'snapshot-request', durationMs: Math.round(snapshotMs) });
          send({ type: 'result', id, ok: true, snapshot });
          return;
        }
        case 'command': {
          const kind = message.command?.type;
          if (['requestTrack','banTrack','unbanTrack','setTrackFeedback','resetTaste','resetLibrary','undoTasteReset','chooseSelf','next','previous','resume','seek'].includes(kind)) {
            checkAccount(message, message.command.track?.provider);
          }
          const coreReceivedAt = Date.now();
          const traceId = typeof message.command?.traceId === 'string' && /^[\w:.-]{1,100}$/.test(message.command.traceId)
            ? message.command.traceId : null;
          if (traceId) onLog({ type: 'playback-timing', phase: 'core-received', traceId, at: coreReceivedAt });
          onLog({ type: 'command', kind: message.command?.type });
          // A full snapshot projects platform discovery and can take hundreds
          // of ms on a real library. Reading revision needs no projection.
          const revision = core.state.revision;
          const dispatchStarted = performance.now();
          const snapshot = core.dispatch({ ...message.command, commandId: message.command?.commandId ?? randomUUID() });
          const dispatchMs = performance.now() - dispatchStarted;
          if (dispatchMs >= 50) onLog({ type: 'slow-op', op: 'dispatch', durationMs: Math.round(dispatchMs), kind: message.command?.type });
          if (snapshot.revision !== revision && ['resetLibrary', 'resetTaste', 'undoTasteReset'].includes(message.command?.type)) ++inputEpoch;
          if (message.command?.type !== 'setVolume') {
            invalidateProfile();
            if(['resetLibrary','resetTaste','undoTasteReset','setRecommendationMode'].includes(message.command?.type))platformsFacade?.clearDiscovery();
            platformsFacade?.setDiscoveryEnabled(snapshot.settings.discovery && snapshot.settings.discoveryRate > 0);
            platformsFacade?.tickDiscovery();
          }
          // Transport commands do not change discovery settings. Dispatch has
          // already produced the accepted snapshot; rebuilding it delayed the
          // UI reply and the foreground load queued behind this handler.
          const transport = ['pause', 'resume', 'next', 'previous', 'seek', 'requestTrack', 'stopForToday'].includes(message.command?.type);
          const acceptedSnapshot = transport || message.command?.type === 'setVolume' ? snapshot : core.snapshot();
          const coreAcceptedAt = Date.now();
          if (traceId) onLog({ type: 'playback-timing', phase: 'core-accepted', traceId, at: coreAcceptedAt,
            version: acceptedSnapshot.commandVersion, playInstanceId: acceptedSnapshot.current?.playInstanceId });
          send({ type: 'result', id, ok: true, snapshot: acceptedSnapshot, accepted: snapshot.revision,
            ...(traceId ? { timing: { traceId, coreReceivedAt, coreAcceptedAt } } : {}) });
          return;
        }
        case 'setQueue': {
          for (const track of message.tracks ?? []) checkAccount(message, track.provider);
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
          invalidateProfile();
          send({ type: 'result', id, ok: true, import: result, taste, snapshot: core.snapshot() });
          return;
        }
        case 'library': {
          const { query = '', offset = 0, limit = 12 } = message;
          if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0
            || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw new MusicError('invalid_command', '曲库查询参数无效。');
          }
          const library = store.searchEnvironment({ query: query.trim(), offset, limit });
          const provider = playbackSourceView(store).provider;
          const first = store.listEnvironment({ provider, limit: 1 })[0];
          library.firstTrack = first ? store.getNormalizedTrack({ provider, providerTrackId: first.track_key.slice(provider.length + 1) }) : null;
          const active = musicAccount(store);
          if (active) library.accountRevision = active.revision;
          send({ type: 'result', id, ok: true, library });
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
        case 'insights': {
          send({type:'result',id,ok:true,accountRevision:musicAccount(store)?.revision,insights:describeMusicInsights(store,core.snapshot(),now(),profileInputs().insightsFacts)});return;
        }
        case 'feedback-list': {
          send({type:'result',id,ok:true,accountRevision:musicAccount(store)?.revision,feedbackPage:listTrackFeedback(store,message)});return;
        }
        case 'feedback-clear': {
          checkAccount(message, message.track?.provider);
          const query=validateFeedbackQuery(message.view??{});
          clearTrackFeedback(store,message,now());
          invalidateProfile();
          send({type:'result',id,ok:true,accountRevision:musicAccount(store)?.revision,feedbackPage:listTrackFeedback(store,query),feedback:feedbackView(store,core.snapshot())});return;
        }
        case 'expression-style': {
          const expression=setExpressionStyle(store,message.style,message.expectedRevision);
          send({type:'result',id,ok:true,expression});return;
        }
        case 'playback-source': {
          const previous = playbackSourceView(store);
          const playbackSource = Object.hasOwn(message, 'provider')
            ? savePlaybackSource(store, message.provider, message.expectedRevision) : previous;
          if (playbackSource.revision !== previous.revision) {
            core.cancelSourcePreparation();
            platformsFacade?.clearDiscovery();
            invalidateProfile();
            core._commit();
            platformsFacade?.setDiscoveryEnabled(core.state.settings.discovery && core.state.settings.discoveryRate > 0);
            platformsFacade?.tickDiscovery();
            publishIfChanged();
          }
          send({ type: 'result', id, ok: true, playbackSource });
          return;
        }
        case 'network-proxy': {
          const networkProxy = Object.hasOwn(message, 'value')
            ? saveNetworkProxy(store, message.value, message.expectedRevision)
            : networkProxyView(store);
          send({ type: 'result', id, ok: true, networkProxy });
          return;
        }
        case 'persona':{
          const cachedProfile=profileInputs();
          const persona=personaView(store,core.snapshot(),now(),
            {bundle:cachedProfile.bundle,strategyBundle:cachedProfile.strategyBundle,growthRows:cachedProfile.growthRows,callRows:cachedProfile.callRows,graph:cachedProfile.graph});
          persona.recommendationPipeline=platformsFacade?.discoveryStatus?.()??null;
          if(persona.recommendationPipeline){const last=cachedProfile.callRows.find(row=>row.purpose==='discovery-filter');
            const refused=store.getSetting('recommendation_error_v1',null);
            persona.recommendationPipeline.lastError=refused?.candidateRevision===persona.recommendationPipeline.candidateRevision?refused.code:last?.status==='failed'?last.error_code:null;}
          persona.recommendationRoute=store.getSetting('recommendation_route_v1',null);
          persona.discoveryJournal=describeDiscoveryJournal({store,pipeline:persona.recommendationPipeline,snapshot:core.snapshot(),now:now()});
          send({type:'result',id,ok:true,accountRevision:musicAccount(store)?.revision,persona});return;
        }
        case 'recommendation-route':{
          const route={provider:message.provider,model:message.model};
          if(!Object.values(route).every(value=>typeof value==='string'&&/^[\w./:-]{1,120}$/.test(value)))throw new MusicError('invalid_model','请选择已配置的筛选模型。');
          store.setSetting('recommendation_route_v1',route);
          store.setSetting('recommendation_mode_v1','filtered');
          invalidateProfile();
          platformsFacade?.setDiscoveryEnabled(true);
          send({type:'result',id,ok:true});return;
        }
        case 'persona-budget':setSummaryBudget(store,message.value);invalidateProfile();send({type:'result',id,ok:true});return;
        case 'persona-output':setSummaryOutputTokens(store,message.value);invalidateProfile();send({type:'result',id,ok:true});return;
        case 'persona-automatic':setSummaryAutomatic(store,message.value);invalidateProfile();send({type:'result',id,ok:true});return;
        case 'persona-reserve':{
          // 发现候选筛选：预留时把缓存里的候选（带来源线索）交给事实组装。
          const reservePurpose=message.purpose??'persona-summary';
          const candidates=reservePurpose==='discovery-filter'&&platformsFacade
            ? (recommendationMode(store)==='filtered'?platformsFacade.recommendationCandidates():platformsFacade.discoveryTracks()).map(track=>{
              let seedTitle;
              try {
                const seedKey=track.discovery?.seedTrackKey;
                if (typeof seedKey === 'string' && seedKey.includes(':')) {
                  const split=seedKey.indexOf(':');
                  seedTitle=store.getNormalizedTrack({provider:seedKey.slice(0,split),providerTrackId:seedKey.slice(split+1)})?.title||undefined;
                }
              } catch { /* 来源线索缺失只是提示变弱，不影响筛选 */ }
              return {...track,discovery:{...track.discovery,seedTitle}};
            })
            : null;
          const plan=reserveSummary({store,snapshot:core.snapshot(),provider:message.provider,model:message.model,now:now(),automatic:message.automatic===true,purpose:reservePurpose,candidates,graph:profileInputs().graph,
            candidateRevision:reservePurpose==='discovery-filter'&&recommendationMode(store)==='filtered'?platformsFacade?.discoveryStatus().candidateRevision:null,
            candidateOwner:reservePurpose==='discovery-filter'&&recommendationMode(store)==='filtered'?platformsFacade?.discoveryStatus().candidateOwner:null});
          profileCache.valid=false;
          send({type:'result',id,ok:true,plan});
          return;
        }
        case 'persona-start':{const started=startSummary(store,message.callId);profileCache.valid=false;send({type:'result',id,ok:true,started});return;}
        case 'persona-finish':{const status=platformsFacade?.discoveryStatus?.();const result=finishSummary({store,...message,now:now(),candidateRevision:status?.candidateRevision??null,candidateOwner:status?.candidateOwner});invalidateProfile();
          if(result.success)store.removeSetting('recommendation_error_v1');
          platformsFacade?.setDiscoveryEnabled(core.snapshot().settings.discovery&&core.snapshot().settings.discoveryRate>0);
          if(message.status==='completed'&&result.success&&recommendationMode(store)==='filtered')core.selectAutonomously();
          send({type:'result',id,ok:true,result});platformsFacade?.verifyModelRecommendations();return;}
        case 'platforms': {
          if (!platformsFacade) {
            send({ type: 'result', id, ok: true, platforms: { platforms: {}, usable: [], reason: 'no platform adapters are configured in this build' } });
            return;
          }
          const view = platformsFacade.platforms();
          const pending = accountIsolation && loginAttempt && view.platforms[loginAttempt.provider];
          if (pending && !pending.account.pending) pending.account = { ...pending.account, pending: true };
          const active = accountIsolation ? musicAccount(store) : null;
          const current = active?.provider && view.platforms[active.provider];
          if (current?.account.status === 'authorized' && current.account.accountId === active.accountId
            && hasLegacyMusicData(store, active.provider)) current.legacyRecoveryAvailable = true;
          send({ type: 'result', id, ok: true, ...view });
          return;
        }
        case 'login': {
          requireFacade();
          const accountProvider = requireProvider(message.provider);
          const step = message.step ?? 'begin';
          if (accountIsolation) {
            const login = await loginSingleAccount(message, accountProvider, step);
            send({ type: 'result', id, ok: true, status: login.status, login, account: accountProvider.getAccount() });
            return;
          }
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
          if (accountIsolation) {
            const active = musicAccount(store);
            if ((message.accountRevision !== undefined && message.accountRevision !== active.revision)
              || (message.attemptId && message.attemptId !== loginAttempt?.id)) {
              throw new MusicError('music_account_changed', '音乐账号已变化，请刷新后重试。');
            }
            const result = await disconnectAccount(message.provider, accountProvider);
            send({ type: 'result', id, ok: true, status: result.status, accountDisconnected: active.provider === message.provider, account: accountProvider.getAccount() });
            return;
          }
          let result;
          try { result = await accountProvider.logout(); }
          finally {
            core.suspendProvider(message.provider);
            if (message.provider === playbackSourceView(store).provider) platformsFacade.clearDiscovery();
            publishIfChanged();
          }
          send({ type: 'result', id, ok: true, status: result.status, account: accountProvider.getAccount() });
          return;
        }
        case 'recover-legacy-music': {
          requireFacade();
          checkPlatformAccess(message);
          const restored = recoverLegacyMusicData(store, message.provider, message.accountRevision);
          if (restored) {
            ++inputEpoch;
            if (recommendationMode(store) === 'filtered') platformsFacade.clearDiscovery();
            updateAccount();
          }
          send({ type: 'result', id, ok: true, restored });
          return;
        }
        case 'import-platform': {
          // Provider-driven import: the adapter decides which source it could
          // actually use, and the environment records exactly that source.
          requireFacade();
          const accountProvider = requireProvider(message.provider);
          try {
            const checkInput = () => {
              if (closed || inputVersion !== inputEpoch) throw new MusicError('cancelled', '曲库或偏好已重置，本次旧导入已取消，请重新导入。');
              checkPlatformAccess(message);
            };
            checkInput();
            const seed = await accountProvider.getSeedTracks({
              limit: message.limit ?? 300, source: message.source ?? null, signal: null,
              playlistId: message.playlistId ?? null,
            });
            checkInput();
            const imported = importSeedTracks({
              store, provider: message.provider, source: seed.source, tracks: seed.tracks,
              requested: seed.requested, degraded: seed.degraded, reason: seed.reason, sourceRef:seed.sourceRef??'', now: now(),
            });
            const taste = initializeAgentPreferences({ store, seed: message.seed ?? null, now: now() });
            invalidateProfile();
            if(recommendationMode(store)==='filtered' && message.provider===playbackSourceView(store).provider)platformsFacade.clearDiscovery();
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
          // 解析器的工作 promise 可能拒绝（如存储层故障），不能变成未处理拒绝。
          Promise.resolve(platformsFacade.refreshDiscovery({ manual: true })).catch(() => {});
          const status = platformsFacade.discoveryStatus();
          send({
            type: 'result', id, ok: true,
            discovery: status,
          });
          return;
        }
        case 'discovery-filter-status': {
          // 调度器/设置页据此决定是否跑一次发现候选筛选；判定保持诚实：
          // 没有候选、有调用进行中、筛选结果仍新于最近一次成功刷新，都不算 due。
          const llmMode = ['llm','filtered'].includes(store.getSetting('recommendation_mode_v1', null));
          platformsFacade?.tickDiscovery();
          const status = platformsFacade?.discoveryStatus?.() ?? null;
          const filter = store.getSetting('discovery_filter_v1', null);
          const stale = !filter
            || !Number.isSafeInteger(status?.picked) || (status.picked === 0&&!(status?.pipeline==='platform-filter'&&status.selectionComplete&&filter.picks?.length===0))
            || (status?.pipeline==='platform-filter'&&filter.candidateRevision!==status.candidateRevision)
            || (status?.pipeline==='platform-filter'&&status.remaining<=1&&status.picked>0&&platformsFacade.recommendationCandidates()
              .some(track=>!status.tracks.some(pick=>pick.provider===track.provider&&pick.providerTrackId===track.providerTrackId)))
            || (Number.isFinite(status?.lastSuccessAt) && Number.isFinite(filter.generatedAt) && filter.generatedAt < status.lastSuccessAt);
          const snapshot=core.snapshot();
          const automaticAllowed=status?.pipeline!=='platform-filter'||(snapshot.settings.listening&&!(snapshot.blockUntil>now()));
          const pendingCandidates=status?.pipeline==='platform-filter'?platformsFacade.recommendationCandidates():null;
          const due = Boolean(llmMode && automaticAllowed && status && !status.refreshing && !status.filtering
            &&(pendingCandidates?status.playbackPool.replenishing&&pendingCandidates.length>0:status.count>0&&stale));
          send({ type: 'result', id, ok: true, filter: {
            due, count: pendingCandidates?.length??status?.count ?? 0, picked: status?.picked ?? 0,
            candidateSignature:pendingCandidates?.map(t=>`${t.provider}:${t.providerTrackId}`).join('|')??null,
            playbackPool:status?.playbackPool??null,
            filtering: status?.filtering === true, refreshing: status?.refreshing === true,
            hasFilter: Boolean(filter), llmMode, pipeline:status?.pipeline??null,
            referenceCount:store.countEnvironment(playbackSourceView(store).provider),
          } });
          return;
        }
        case 'search': {
          requireFacade();
          checkPlatformAccess(message);
          const accountProvider = requireProvider(message.provider);
          const found = await accountProvider.search(message.query ?? '', { limit: message.limit ?? 20, signal: null });
          if (inputVersion !== inputEpoch) throw new MusicError('music_account_changed', '音乐账号已变化，请重新搜索。');
          send({ type: 'result', id, ok: true, provider: message.provider, query: found.query, tracks: found.tracks, capability: found.capability });
          return;
        }
        case 'playlists': {
          checkPlatformAccess(message);
          const adapter=requireProvider(message.provider);
          if(typeof adapter.getUserPlaylists!=='function')throw new MusicError('capability_unavailable','Playlist selection is unavailable');
          const playlists=await adapter.getUserPlaylists();
          if (inputVersion !== inputEpoch) throw new MusicError('music_account_changed', '音乐账号已变化，请重新读取歌单。');
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
      if(message.type==='persona-reserve'&&message.purpose==='discovery-filter'&&recommendationMode(store)==='filtered'){
        store.setSetting('recommendation_error_v1',{code:error.code??'model_failed',candidateRevision:platformsFacade?.discoveryStatus?.().candidateRevision??null});
        invalidateProfile();core._commit();publishIfChanged();
      }
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
    loginAttempt?.controller.abort();
    loginAttempt = null;
    clearInterval(timer);
    clearInterval(loopTimer);
    if (maintenance) clearInterval(maintenance);
    platformsFacade?.closeDiscovery();
    lyrics.close();
    core?._invalidate();
    await registry.close?.();
    try { await disposePlayback(); } catch (error) { onLog({ type: 'playback-dispose-failed', message: error.message }); }
    try { await core?.waitForIdle(); } catch { /* late tasks cannot publish after invalidation */ }
    try { if (!givenStore) store.close(); } catch { /* already closed */ }
  }

  let timer = null;
  // Event-loop lag: synchronous projections and SQLite writes block the pipe
  // reader, so a host event can sit unread for a second. Log only real stalls.
  let loopExpected = Date.now() + 100;
  const loopTimer = setInterval(() => {
    const nowMs = Date.now();
    const delayMs = nowMs - loopExpected;
    loopExpected = nowMs + 100;
    if (delayMs >= 50) onLog({ type: 'loop-delay', delayMs });
  }, 100);
  loopTimer.unref?.();

  return {
    async start() {
      if (accountIsolation) {
        const previous = musicAccount(store);
        const active = initializeMusicAccount(store, playbackSourceView(store).provider);
        for (const name of PROVIDERS) {
          if (name === active.provider || !store.getCredentialReference(name)) continue;
          try { await registry.providers[name]?.logout(); }
          catch (error) { onLog({ type: 'account-cleanup', provider: name, code: error.code ?? 'provider_failure' }); }
        }
        const saved = store.getCoreState();
        if (saved && (!previous || active.revision !== previous.revision)) {
          store.setCoreState({ ...saved, queue: [], lastSelection: null, lastError: null,
            current: !previous && saved.current?.track.provider === active.provider ? saved.current : null });
        }
      }
      const created = await createPlayback({ mode: playbackMode, onLog, network });
      playback = created.playback;
      disposePlayback = created.dispose;
      // Maintenance: preferences decay toward neutral as time passes. Growth is
      // non-negative by rule, so without a scheduled decay pass a preference
      // could only ever ratchet upward. This is a requirement, not housekeeping.
      // 数据保留（P1）：命令去重表与已完成成长任务只留 30 天，至多每小时清一次。
      let lastPruneAt = 0;
      const pruneStore = () => {
        const at = now();
        if (at - lastPruneAt < 3_600_000) return;
        lastPruneAt = at;
        try {
          const removedCommands = store.pruneProcessedCommands({ now: at });
          const removedJobs = store.pruneCompletedGrowthJobs({ now: at });
          if (removedCommands || removedJobs) {
            invalidateProfile();
            onLog({ type: 'maintenance-prune', removedCommands, removedJobs });
          }
        } catch (error) {
          onLog({ type: 'maintenance_error', message: error.message });
        }
      };
      pruneStore();
      maintenance = setInterval(() => {
        try {
          pruneStore();
          const result = decayPreferences({ store, now: now() });
          if (result.changed) { invalidateProfile(); onLog({ type: 'maintenance', decayed: result.changed }); }
        } catch (error) {
          onLog({ type: 'maintenance_error', message: error.message });
        }
      }, Math.max(maintenanceIntervalMs ?? stateIntervalMs * 30, 250));
      maintenance.unref?.();
      recoverSummaryCalls(store,now());
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
            graphCache: trackGraph,
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
          invalidateProfile();
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
      if (registry.providers.qq && store.getCredentialReference('qq')?.state === 'authorized'
        && (!accountIsolation || musicAccount(store).provider === 'qq')) {
        if (accountIsolation) {
          void restoreAccount('qq', registry.providers.qq)
            .catch(error => { if (!closed) onLog({ type: 'provider-restore', provider: 'qq', code: error.code ?? 'provider_failure' }); });
        } else void registry.providers.qq.restore().then(() => {
          if (closed) return;
          invalidateProfile();
          core._commit();
          platformsFacade?.tickDiscovery();
          publishIfChanged();
        }).catch(error => { if (!closed) onLog({ type: 'provider-restore', provider: 'qq', code: error.code ?? 'provider_failure' }); });
      }
      platformsFacade?.onDiscoveryChange(() => { invalidateProfile(); core._commit(); publishIfChanged(); });
      platformsFacade?.tickDiscovery();
      timer = setInterval(() => {
        const tickStarted = performance.now();
        platformsFacade?.tickDiscovery();
        const afterTick = performance.now();
        publishIfChanged();
        const afterPublish = performance.now();
        if (afterPublish - tickStarted >= 50) onLog({ type: 'slow-op', op: 'tick', durationMs: Math.round(afterPublish - tickStarted),
          tickMs: Math.round(afterTick - tickStarted), publishMs: Math.round(afterPublish - afterTick) });
      }, stateIntervalMs);
      timer.unref?.();
      return core;
    },
    // Dispatch/reads are synchronous until their first await. Keep them out of
    // long account/import work so a slow media request cannot hold up pause.
    handle: (message) => {
      const inputVersion = inputEpoch;
      if (accountIsolation && message.type === 'login') return handle(message, inputVersion);
      return ['lyrics','command','snapshot','platforms','library','account','environment','insights','expression-style','playback-source','network-proxy','feedback-list','feedback-clear','persona','recommendation-route','persona-budget','persona-output','persona-automatic','persona-reserve','persona-start','persona-finish','sessions','discovery','discovery-filter-status','logout','recover-legacy-music','shutdown','wait','autonomous','session-event','setQueue'].includes(message.type)
        ? handle(message, inputVersion) : enqueue(message.provider ?? 'default', () => handle(message, inputVersion));
    },
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
