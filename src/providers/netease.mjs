// NetEase Cloud Music adapter (P2).
//
// The lifecycle, capability honesty, seed fallback and error mapping live in
// ./platform.mjs and are shared with the QQ adapter, so both platforms cannot
// drift apart. What is specific to NetEase is here: which transport roles it
// uses and how its response bodies map onto normalized values.
//
// Scope note, deliberately explicit: the parsers below accept the shapes this
// platform is believed to use, but none of it has been verified against the
// live service. docs/spikes/P2-netease.md records exactly what remains
// unconfirmed (P0-02 / P3). Nothing here asserts a verified platform API.
import { createPlatformProvider } from './platform.mjs';
import { MusicError, trackId } from '../contracts.mjs';
import { toTrack, capability, needsLogin } from './contract.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCookieJar } from './transport.mjs';
import { NETEASE_QR_LOGIN_URL } from './endpoints/netease.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const communityCallContext = new AsyncLocalStorage();
let defaultCommunityApi = null;
let communityConsoleGuardInstalled = false;

// The pinned QR checker references an out-of-scope `result` in its catch.
// Retain the request's actual rejection instead of losing it to ReferenceError.
export async function callCommunityQrCheck(module, request, query) {
  let requestFailure;
  try {
    return await module(query, async (...args) => {
      try { return await request(...args); }
      catch (error) { requestFailure = error; throw error; }
    });
  } catch (error) { throw requestFailure ?? error; }
}

function installCommunityConsoleGuard() {
  if (communityConsoleGuardInstalled) return;
  communityConsoleGuardInstalled = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      if (communityCallContext.getStore() === true) return;
      return original(...args);
    };
  }
}

function loadCommunityApi() {
  if (defaultCommunityApi) return defaultCommunityApi;
  // One optional helper module calls dotenv.config() while the package scans
  // its module directory. Keep it away from the host's .env and Core's
  // JSON-lines output; restore every inherited variable after loading.
  const previous = {
    quiet: process.env.DOTENV_CONFIG_QUIET,
    path: process.env.DOTENV_CONFIG_PATH,
    dotenvKey: process.env.DOTENV_CONFIG_DOTENV_KEY,
    key: process.env.DOTENV_KEY,
  };
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.DOTENV_CONFIG_PATH = join(tmpdir(), `fishfm-no-dotenv-${randomUUID()}`);
  process.env.DOTENV_CONFIG_DOTENV_KEY = '';
  process.env.DOTENV_KEY = '';
  try {
    installCommunityConsoleGuard();
    defaultCommunityApi = communityCallContext.run(true, () => {
      const api = require('@neteasecloudmusicapienhanced/api');
      const check = require('@neteasecloudmusicapienhanced/api/module/login_qr_check.js');
      const request = require('@neteasecloudmusicapienhanced/api/util/request.js');
      return { ...api, login_qr_check: query => callCommunityQrCheck(check, request, query) };
    });
  } finally {
    for (const [key, value] of Object.entries({
      DOTENV_CONFIG_QUIET: previous.quiet,
      DOTENV_CONFIG_PATH: previous.path,
      DOTENV_CONFIG_DOTENV_KEY: previous.dotenvKey,
      DOTENV_KEY: previous.key,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return defaultCommunityApi;
}

export const NETEASE = 'netease';

const COMMUNITY_CALLS = Object.freeze({
  loginQr: { method: 'login_qr_key', stage: 'login_qr_key', qr: true },
  loginPoll: { method: 'login_qr_check', stage: 'login_qr_check', qr: true },
  accountInfo: { method: 'login_status', stage: 'login_status' },
  recentTracks: { method: 'user_record', stage: 'user_record' },
  likedTracks: { method: 'likelist', stage: 'likelist' },
  playlists: { method: 'user_playlist', stage: 'user_playlist' },
  playlistTracks: { method: 'playlist_detail', stage: 'playlist_detail' },
  songDetails: { method: 'song_detail', stage: 'song_detail' },
  dailyRecommendations: { method: 'recommend_songs', stage: 'recommend_songs' },
  personalRecommendations: { method: 'personal_fm', stage: 'personal_fm' },
  similarRecommendations: {method:'simi_song',stage:'simi_song'},
});

const STAGE_LABELS = Object.freeze({
  recommend_songs: '每日推荐', personal_fm: '私人 FM',
  simi_song:'相似歌曲',
  login_qr_key: '生成二维码', login_qr_check: '检测扫码状态',
  login_status: '登录状态', user_record: '近期记录', likelist: '喜欢列表',
  user_playlist: '用户歌单', playlist_detail: '歌单详情', song_detail: '歌曲详情',
});

function communityFailure(stage, { response = null, error = null } = {}) {
  const body = response?.body ?? error?.body ?? null;
  const httpStatus = Number.isInteger(response?.status) ? response.status
    : Number.isInteger(error?.status) ? error.status
      : Number.isInteger(error?.response?.status) ? error.response.status : null;
  const platformCode = Number.isInteger(body?.code) ? body.code
    : Number.isInteger(body?.data?.code) ? body.data.code : null;
  const code = platformCode ?? httpStatus;
  if (httpStatus === 401 || httpStatus === 403 || platformCode === 301) {
    return new MusicError('login_required', `网易云${STAGE_LABELS[stage]}失败：登录状态已失效。`, {
      details: { stage, httpStatus, platformCode },
    });
  }
  const appCode = httpStatus === 429 ? 'rate_limited' : 'provider_failure';
  const detail = [httpStatus ? `HTTP ${httpStatus}` : null, platformCode ? `接口码 ${platformCode}` : null].filter(Boolean).join('，') || '网络或接口错误';
  // Classify known failures without returning a raw upstream response or URL.
  const headerOverflow = /header[^\n]*(?:overflow|too (?:big|large)|size)/i.test(String(body?.msg ?? error?.message ?? ''));
  const verification = /安全风险|环境异常|需要验证/.test(String(body?.msg ?? ''));
  const reason = headerOverflow ? '响应头超过客户端大小限制；' : verification ? '平台要求额外验证或拒绝当前登录环境；' : '';
  return new MusicError(appCode, `网易云${STAGE_LABELS[stage]}请求失败（${reason}${detail}）。`, {
    retryable: httpStatus === 429 || httpStatus === null || httpStatus >= 500 || platformCode === 502,
    details: { stage, httpStatus, platformCode },
  });
}

function createCommunityTransport(transport, { api, credentials, accountRef, communityLogin, onLog = () => {} }) {
  let currentSession = null;
  const cookieJar = createCookieJar();
  return {
    jar: transport.jar,
    useSecret(secret) {
      currentSession = typeof secret === 'string' && secret ? secret : null;
      if (currentSession) cookieJar.absorb(currentSession);
      else cookieJar.clear();
      transport.useSecret?.(secret);
      return currentSession ? cookieJar.size() : 0;
    },
    roles: () => transport.roles?.() ?? [],
    async request(request) {
      const config = COMMUNITY_CALLS[request.role];
      if (!config) return transport.request(request);
      if (config.qr && !communityLogin) return transport.request(request);
      if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
      // A new QR handshake has no account cookie, matching the upstream
      // no-cookie example. Never attach a previous account to a new scan.
      if (!config.qr && !request.session && !currentSession) currentSession = credentials?.read?.(accountRef) ?? null;
      const session = request.session ?? currentSession;
      if (!config.qr && !session) throw new MusicError('login_required', '请先登录网易云音乐。', { details: { stage: config.stage } });
      const method = api?.[config.method];
      if (typeof method !== 'function') {
        throw new MusicError('provider_failure', `网易云接口包缺少 ${config.method} 方法。`, {
          details: { stage: config.stage },
        });
      }
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          onLog({ type: 'platform-request', role: config.method, provider: NETEASE });
          response = await communityCallContext.run(true, () => method({ ...request.params, cookie: config.qr ? {} : session, timeout: config.qr ? 10_000 : 15_000 }));
          if (request.role === 'loginPoll' && (response?.status >= 500 || response?.body?.code === 502)) throw response;
          break;
        } catch (error) {
          const failure = communityFailure(config.stage, { error });
          if (request.role !== 'loginPoll' || attempt !== 0
            || !((failure.details?.httpStatus >= 500) || failure.details?.platformCode === 502)) throw failure;
          await delay(750, undefined, { signal: request.signal ?? undefined });
          if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
        }
      }
      if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
      const body = response?.body ?? response;
      const status = Number.isInteger(response?.status) ? response.status : 200;
      if (config.qr) {
        if (status >= 400) throw communityFailure(config.stage, { response: { status, body } });
        if (request.role === 'loginQr') {
          const key = body?.data?.unikey ?? body?.unikey;
          if (body?.code !== 200 || typeof key !== 'string' || !key) throw communityFailure(config.stage, { response: { status, body } });
          return { status, body: { ...body, qrUrl: `${NETEASE_QR_LOGIN_URL}?codekey=${encodeURIComponent(key)}` }, cookies: null };
        }
        // Only this response's cookies may become the new session. An old jar
        // or the QR key's anonymous NMTID is not evidence of authorization.
        const confirmedCookies = createCookieJar();
        confirmedCookies.absorb(body?.cookie);
        confirmedCookies.absorb(response?.cookie);
        return { status, body: { ...body, cookie: confirmedCookies.toSecret() }, cookies: null };
      }
      const accountPayload = body?.data ?? body;
      if (config.stage === 'login_status' && accountPayload?.code === 200
        && accountPayload.profile == null && accountPayload.account == null) {
        if (request.session) throw new MusicError('login_validation_failed', '手机已确认，但网易云账号校验未通过。可以重试校验，或重新获取二维码。', {
          retryable: true, details: { stage: config.stage, platformCode: 200 },
        });
        throw new MusicError('login_required', '网易云登录已失效，login_status 未返回账号资料。请重新扫码登录。', {
          details: { stage: config.stage, platformCode: 200 },
        });
      }
      const platformCode = Number.isInteger(body?.code) ? body.code
        : Number.isInteger(body?.data?.code) ? body.data.code : null;
      if (status >= 400 || (platformCode !== null && platformCode !== 200)) {
        throw communityFailure(config.stage, { response: { status, body } });
      }

      // The library returns Set-Cookie values separately. Merge them in memory
      // and persist only the changed session through the existing DPAPI store.
      let updated = session;
      if (Array.isArray(response?.cookie) && response.cookie.length) {
        cookieJar.clear();
        cookieJar.absorb(session);
        cookieJar.absorb(response.cookie);
        updated = cookieJar.toSecret();
        if (!request.session && updated && updated !== currentSession) {
          credentials?.write?.(accountRef, updated);
          currentSession = updated;
          transport.useSecret?.(updated);
        }
      }
      return { status, body, cookies: request.session ? updated : null };
    },
  };
}

function responseData(body) {
  return body?.data?.profile || body?.data?.playlist || body?.data?.weekData || body?.data?.ids
    ? body.data : body?.data ?? body;
}

function idsFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === 'object' && entry !== null ? entry.id : entry)
    .filter((id) => id !== undefined && id !== null && String(id));
}

function playlistIdForUser(body, uid) {
  const data = responseData(body);
  const playlists = data?.playlist ?? data?.list ?? [];
  if (!Array.isArray(playlists)) return null;
  const owned = playlists.find((playlist) => {
    const owner = playlist?.userId ?? playlist?.creator?.userId;
    return String(owner ?? '') === String(uid) && playlist?.specialType !== 5;
  });
  return owned?.id ?? null;
}

function communityTracks(body, limit) {
  const data = responseData(body);
  const songs = data?.songs ?? data?.list ?? data?.tracks ?? data;
  return Array.isArray(songs) ? songs.slice(0, limit) : [];
}

/**
 * Endpoint roles the transport must serve. These are role names, not URLs; the
 * real wire format stays out of this file.
 */
export const NETEASE_ROLES = Object.freeze([
  'loginQr', 'loginPoll', 'accountInfo',
  'recentTracks', 'likedTracks', 'playlists', 'playlistTracks', 'songDetails',
  'search', 'resolve',
]);

/** Seed sources in the order the plan prefers, with the documented fallback. */
export const NETEASE_SEED_ORDER = Object.freeze(['recent', 'liked', 'playlist']);

const listOf = (body) => body?.data?.list ?? body?.list ?? body?.songs ?? body?.data ?? [];

/**
 * Creates the NetEase provider.
 *
 * @param {object} options
 * @param {object} options.transport `request({ role, params, signal })` → `{ status, body }`
 * @param {object} [options.credentials] `read(ref)`, `write(ref, secret)`, `delete(ref)`
 * @param {object} [options.store] MusicStore; holds the credential reference only
 */
export function createNetEaseProvider(options = {}) {
  const accountRef = options.accountRef ?? 'fishfm/netease';
  const store = options.store;
  const communityApi = options.communityApi ?? loadCommunityApi();
  const transport = createCommunityTransport(options.transport, {
    api: communityApi,
    credentials: options.credentials,
    accountRef,
    communityLogin: options.communityLogin !== false,
    onLog: options.onLog,
  });
  const uid = () => store?.getCredentialReference?.(NETEASE)?.account_id ?? null;
  const provider = createPlatformProvider({
    provider: NETEASE,
    displayName: 'NetEase',
    labels: { firstSource: 'Recent playback' },
    ...options,
    transport,
    parse: {
      // Scan responses.
      // CONFIRMED (2026-09-27): POST /api/login/qrcode/unikey?type=1 answers
      // {"code":200,"unikey":"<uuid>"} — the key is at the top level.
      loginQr: (body) => {
        const data = body?.data ?? body;
        return {
          key: body?.unikey ?? data?.unikey ?? body?.key ?? data?.key ?? null,
          qrImage: body?.qrimg ?? data?.qrimg ?? null,
          qrUrl: body?.qrurl ?? data?.qrurl ?? body?.qrUrl ?? null,
        };
      },
      // Upstream: 800 expired, 801 waiting, 802 scanned, 803 confirmed.
      // Cookies exist even in guest/error replies; only 803 can authorize.
      loginPoll: (body) => {
        const code = body?.code ?? body?.status ?? null;
        if (code === 800 || code === 'expired') return { status: 'expired', code };
        if (code === 801 || code === 'waiting') return { status: 'waiting', code };
        if (code === 802 || code === 'scanned') return { status: 'scanned', code };
        if (code !== 803 && code !== 'confirmed') {
          throw new MusicError('provider_failure', '网易云未确认扫码授权，请稍后重试或重新获取二维码。', {
            retryable: true, details: { stage: 'login_qr_check', platformCode: Number.isInteger(code) ? code : null },
          });
        }
        const jar = createCookieJar();
        jar.absorb(body?.cookie);
        const secret = jar.toSecret();
        if (!/(?:^|;\s*)MUSIC_U=[^;\s]+/.test(secret)) {
          throw new MusicError('login_cookie_missing', '手机已确认，但网易云没有返回账号登录凭据。请重新获取二维码。', {
            details: { stage: 'login_qr_check', platformCode: 803 },
          });
        }
        return { status: 'authorized', code, secret, accountId: body?.accountId ?? body?.userId ?? null };
      },
      async validateLogin(state, loginOptions) {
        const response = await transport.request({ role: 'accountInfo', session: state.secret,
          params: { timestamp: (options.now ?? Date.now)() }, signal: loginOptions.signal ?? null });
        const body = response.body;
        const accountId = body?.data?.profile?.userId ?? body?.profile?.userId ?? body?.data?.account?.id ?? body?.account?.id ?? body?.accountId ?? body?.userId;
        if (accountId === undefined || accountId === null || !String(accountId)) {
          throw new MusicError('account_id_unavailable', '手机已确认，但账号校验没有返回用户 ID。可以重试校验，无需立即重新扫码。', {
            retryable: true, details: { stage: 'login_status' },
          });
        }
        return { secret: response.cookies || state.secret, accountId: String(accountId) };
      },
      // CONFIRMED shape when signed out: {"code":200,"account":null,"profile":null}.
      accountId: (body) => body?.data?.profile?.userId ?? body?.profile?.userId ?? body?.data?.account?.id ?? body?.account?.id ?? body?.accountId ?? body?.userId ?? null,
      search: (body) => body?.songs ?? body?.result?.songs ?? [],
      playUrl: (body) => {
        const entry = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body);
        return {
          url: entry?.url ?? null,
          reason: entry?.reason ?? null,
          expiresInSeconds: Number.isSafeInteger(entry?.expi) ? entry.expi : null,
          expiresAt: Number.isSafeInteger(entry?.expiresAt) ? entry.expiresAt : null,
        };
      },
      resolveParams: ({ track }) => ({ id: track.providerTrackId, br: 320000 }),
    },
    seedSources: {
      recent: {
        role: 'recentTracks',
        params: ({ limit }) => ({ uid: uid(), type: 1, limit }),
        parse: (body, { limit }) => {
          const data = responseData(body);
          const rows = data?.weekData ?? data?.recent ?? listOf(body);
          return Array.isArray(rows) ? rows.slice(0, limit).map((entry) => ({ ...(entry?.song ?? entry?.track ?? entry),
            ...(Number.isSafeInteger(entry?.playCount)?{playCount:entry.playCount}:{}),
            ...(Number.isSafeInteger(entry?.lastPlayedAt)?{lastPlayedAt:entry.lastPlayedAt}:{}) })) : [];
        },
      },
      liked: {
        steps: [
          {
            role: 'likedTracks',
            params: ({ limit }) => ({ uid: uid(), limit }),
            collect: false,
            parse: (body, { limit }) => {
              const data = responseData(body);
              const ids = idsFrom(data?.ids ?? body?.ids ?? []);
              return { ids: ids.slice(0, limit) };
            },
          },
          {
            role: 'songDetails',
            params: ({ ids }) => ids?.length ? { ids: ids.join(',') } : null,
            parse: (body, { limit }) => communityTracks(body, limit),
          },
        ],
      },
      playlist: {
        steps: [
          {
            role: 'playlists', params: () => ({ uid: uid(), limit: 100, offset: 0 }), collect: false,
            parse: (body, {playlistId}) => {
              const list=responseData(body)?.playlist??[];
              if(playlistId && !list.some(p=>String(p.id)===String(playlistId))) throw new MusicError('invalid_command','指定歌单不在此账号的歌单列表中。');
              return {playlistId:playlistId ? String(playlistId) : playlistIdForUser(body,uid())};
            },
          },
          {
            role: 'playlistTracks', params: ({ playlistId }) => (playlistId ? { id: playlistId } : null), collect: false,
            parse: (body) => {
              const data = responseData(body);
              const playlist = data?.playlist ?? data;
              return { ids: idsFrom(playlist?.trackIds ?? playlist?.track_ids ?? []) };
            },
          },
          {
            role: 'songDetails',
            params: ({ ids, limit }) => ids?.length ? { ids: ids.slice(0, limit).join(',') } : null,
            parse: (body, { limit }) => communityTracks(body, limit),
          },
        ],
      },
    },
  });
  const baseCapabilities = provider.getCapabilities.bind(provider);
  provider.getUserPlaylists = async ({signal=null}={}) => {
    if(provider.getAccount().status!=='authorized')throw new MusicError('login_required','请先登录网易云音乐。');
    if(!uid())await provider.restore({signal});
    const response=await transport.request({role:'playlists',params:{uid:uid(),limit:100,offset:0},signal});
    const rows=responseData(response.body)?.playlist;
    if(!Array.isArray(rows))throw new MusicError('provider_failure','歌单列表结构无效。');
    return rows.slice(0,100).map(p=>({id:String(p.id),title:typeof p.name==='string'?p.name:'未命名歌单',
      trackCount:Number.isSafeInteger(p.trackCount)?p.trackCount:null,owned:String(p.creator?.userId??p.userId??'')===String(uid())}));
  };
  const canRecommend = typeof communityApi.recommend_songs === 'function';
  let recommendationError = null;
  provider.getCapabilities = () => ({ ...baseCapabilities(),
    recommendation: provider.getAccount().status !== 'authorized' ? needsLogin('fetch NetEase recommendations')
      : canRecommend ? capability(recommendationError ? 'degraded' : 'available', { source: 'netease_daily', ...(recommendationError ? { reason: recommendationError } : {}) })
        : capability('unavailable', { reason: 'The pinned API has no recommend_songs method' }) });
  provider.getDiscoveryTracks = async ({ limit = 40, signal = null } = {}) => {
    if (provider.getAccount().status !== 'authorized') throw new MusicError('login_required', '请先登录网易云音乐。');
    if (!canRecommend) throw new MusicError('capability_unavailable', '网易云每日推荐入口不可用。');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new MusicError('invalid_command', '候选数量必须为 1–200。');
    const roles = ['dailyRecommendations', ...(typeof communityApi.personal_fm === 'function' ? ['personalRecommendations'] : [])];
    const failures = [];
    for (const role of roles) {
      if (signal?.aborted) throw new MusicError('cancelled', 'Discovery was cancelled');
      try {
        const response = await transport.request({ role, params: {}, signal });
        const body = response.body;
        const rows = role === 'dailyRecommendations' ? body?.data?.dailySongs : body?.data;
        if (!Array.isArray(rows)) throw new MusicError('provider_failure', '推荐结果结构与已验证接口不符。');
        const seen = new Set();
        const fetchedAt = (options.now ?? Date.now)();
        const tracks = rows.map(row => toTrack(NETEASE, row)).filter(track => {
          if (!track || seen.has(trackId(track))) return false;
          seen.add(trackId(track)); return true;
        }).slice(0, limit).map(track => ({ ...track, discovery: {
          source: role === 'dailyRecommendations' ? 'netease_daily' : 'netease_personal_fm',
          seedTrackKey: null, fetchedAt, expiresAt: fetchedAt + 6 * 60 * 60_000,
        } }));
        if (tracks.length || role === roles.at(-1)) {
          recommendationError = failures.length ? failures.join('; ') : null;
          return tracks;
        }
      } catch (error) {
        if (error.code === 'login_required') {
          const saved = store?.getCredentialReference(NETEASE);
          if (saved) store.setCredentialReference({ provider: NETEASE, accountId: saved.account_id, credentialRef: accountRef, state: 'expired', updatedAt: (options.now ?? Date.now)() });
        }
        if (signal?.aborted || ['cancelled','login_required','expired'].includes(error.code)) throw error;
        failures.push(`${role}:${error.code ?? 'provider_failure'}`);
      }
    }
    recommendationError = failures.join('; ');
    throw new MusicError('provider_failure', `网易云推荐暂不可用（${recommendationError}）。`, { retryable: true });
  };
  const accountRecommendations=provider.getDiscoveryTracks.bind(provider);
  provider.getDiscoveryTracks=async(options={})=>{
    if(!Number.isInteger(options.limit??40)||(options.limit??40)<1||(options.limit??40)>200)throw new MusicError('invalid_command','候选数量必须为 1–200。');
    let account=[],accountError=null;
    try{account=await accountRecommendations(options);}catch(error){accountError=error;if(['login_required','cancelled'].includes(error.code))throw error;}
    const seeds=Array.isArray(options.seeds)?options.seeds.filter(t=>t?.provider===NETEASE&&/^\d{1,20}$/.test(t.providerTrackId)).slice(0,3):[];
    if(!seeds.length||typeof communityApi.simi_song!=='function'){if(accountError)throw accountError;return account;}
    const related=new Map(),fetchedAt=(options.now??Date.now)();
    for(const seed of seeds){
      if(options.signal?.aborted)throw new MusicError('cancelled','Discovery was cancelled');
      try{
        const response=await transport.request({role:'similarRecommendations',params:{id:seed.providerTrackId,limit:12},signal:options.signal});
        if(!Array.isArray(response.body?.songs))throw new MusicError('provider_failure','相似歌曲结构无效。');
        for(const raw of response.body.songs.slice(0,12)){
          const track=toTrack(NETEASE,raw);if(!track||trackId(track)===trackId(seed))continue;
          const existing=related.get(trackId(track));
          const keys=[...new Set([...(existing?.discovery.seedTrackKeys??[]),trackId(seed)])];
          related.set(trackId(track),{...track,discovery:{source:'netease_similar',seedTrackKey:keys[0],seedTrackKeys:keys,
            fetchedAt,expiresAt:fetchedAt+6*60*60_000}});
        }
      }catch(error){
        if(error.code==='login_required'){
          const ref=store?.getCredentialReference(NETEASE);if(ref)store.setCredentialReference({provider:NETEASE,accountId:ref.account_id,credentialRef:accountRef,state:'expired',updatedAt:fetchedAt});
        }
        if(options.signal?.aborted)throw new MusicError('cancelled','Discovery was cancelled');
        if(error.code==='login_required')throw error;
        options.onRelationError?.({code:error.code??'provider_failure'});
      }
    }
    const merged=new Map([...related.entries(),...account.filter(t=>!related.has(trackId(t))).map(t=>[trackId(t),t])]);
    if(!merged.size&&accountError)throw accountError;
    return[...merged.values()].slice(0,options.limit??40);
  };
  const getSeedTracks = provider.getSeedTracks.bind(provider);
  provider.getSeedTracks = async (seedOptions = {}) => {
    if (provider.getAccount().status === 'authorized' && !uid()) {
      const identity = await provider.restore({ signal: seedOptions.signal ?? null });
      if (identity.status !== 'authorized') throw new MusicError('login_required', '网易云登录已失效，请重新扫码。');
      if (!uid()) {
        throw new MusicError('account_id_unavailable', '网易云已授权，但 login_status 未返回 profile.userId。已停止导入请求；请检查账号登录状态后重试。', {
          details: { stage: 'login_status' },
        });
      }
    }
    if (!Number.isFinite(Number(seedOptions.limit ?? 300)) || Number(seedOptions.limit ?? 300) <= 0) {
      throw new MusicError('invalid_command', '导入数量必须是正数。');
    }
    return getSeedTracks(seedOptions);
  };
  return provider;
}

/** Which endpoints still need a real account to confirm. */
export function unverifiedEndpoints() {
  return ['accountInfo', 'recentTracks', 'likedTracks', 'playlists', 'playlistTracks', 'songDetails'];
}
