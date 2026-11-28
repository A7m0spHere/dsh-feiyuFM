import { createPlatformProvider } from './platform.mjs';
import { capability, needsLogin, toTrack } from './contract.mjs';
import { MusicError, PLAYABILITY_CHECK_BATCH_SIZE, PLAYABILITY_CHECK_MAX_TRACKS, trackId } from '../contracts.mjs';
import { normalizeQQMusicLyrics } from '../lyrics.mjs';
import { qqPlayEntry } from './qq-transport.mjs';

export const QQ = 'qq';
export const QQ_ROLES = Object.freeze(['loginQr', 'loginPoll', 'accountInfo', 'recentTracks',
  'likedTracks', 'playlists', 'playlistTracks', 'search', 'resolve', 'checkPlayability', 'lyrics',
  'dailyRecommendations', 'personalRecommendations', 'similarRecommendations']);
export const QQ_SEED_ORDER = Object.freeze(['liked', 'playlist']);
const unwrap = body => body?.req_0?.data ?? body?.data ?? body;
export function qqRows(body) {
  const data = unwrap(body);
  const rows = data?.items ?? data?.songs ?? data?.songlist ?? data?.list ?? data?.tracks ?? data?.song?.list ?? data;
  if (!Array.isArray(rows)) throw new MusicError('provider_failure', 'QQ 音乐返回的歌曲列表结构无效。');
  return rows;
}
export function normalizeQQTrack(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const id = entry.mid ?? entry.songmid ?? entry.id ?? entry.songid;
  const artists = entry.singer ?? entry.artists ?? entry.ar ?? [];
  return { ...entry, id, name: entry.name ?? entry.title ?? entry.songname,
    artist: entry.artist ?? artists.map(artist => artist?.name).filter(Boolean).join(' / '),
    durationMs: entry.durationMs ?? (Number.isSafeInteger(entry.interval) ? entry.interval * 1000 : entry.duration),
  };
}
function playlistsOf(body) {
  const data = unwrap(body);
  const rows = data?.playlist ?? data?.v_playlist ?? data?.list ?? data?.disslist;
  if (!Array.isArray(rows)) throw new MusicError('provider_failure', 'QQ 音乐返回的歌单列表结构无效。');
  return rows;
}
const playlistId = row => String(row.tid ?? row.dissid ?? row.disstid ?? row.id ?? row.dirId ?? row.dirid ?? '');
const accountIdOf = body => {
  const data = unwrap(body);
  const profile = data?.profile ?? data;
  const value = profile?.str_musicid ?? profile?.musicid ?? profile?.uin ?? profile?.accountId;
  return value === undefined || value === null || value === '' ? null : String(value);
};

export function createQQProvider(options = {}) {
  const { transport, store, now = () => Date.now() } = options;
  const provider = createPlatformProvider({
    provider: QQ, displayName: 'QQ 音乐', labels: { firstSource: '喜欢歌曲' }, ...options,
    parse: {
      normalizeTrack: normalizeQQTrack,
      validTrackId: id => typeof id === 'string' && /^[\w-]{1,80}$/.test(id),
      loginQr: body => {
        const data = unwrap(body);
        return { key: data?.unikey ?? data?.key, qrImage: data?.qrimg ?? data?.qrImage, qrUrl: data?.qrurl ?? null };
      },
      loginPoll: body => {
        const data = unwrap(body);
        const code = data?.code;
        if (data?.upstreamCode === 20279 || data?.errorKey === 'auth.device-limit') {
          throw new MusicError('device_limit', '设备数已满，请在 QQ 音乐 App 移除旧设备。', { details: { stage: 'login_qr_check' } });
        }
        if (code === 800 && data?.failureReason && !['qr-timeout', 'qr-canceled'].includes(data.failureReason)) {
          throw new MusicError('provider_failure', 'QQ 音乐扫码未完成，请重试或重新获取二维码。',
            { retryable: true, details: { stage: 'login_qr_check' } });
        }
        if (code === 800) return { status: 'expired', code };
        if (code === 801) return { status: 'waiting', code };
        if (code === 802) return { status: 'scanned', code };
        if (code !== 803 || !data?.cookie) throw new MusicError('provider_failure', 'QQ 音乐尚未确认扫码登录。', { retryable: true });
        return { status: 'authorized', code, secret: data.cookie, accountId: accountIdOf(data) };
      },
      async validateLogin(state, loginOptions) {
        const response = await transport.request({ role: 'accountInfo', params: {}, session: state.secret, signal: loginOptions.signal });
        const accountId = accountIdOf(response.body);
        if (!accountId) throw new MusicError('account_id_unavailable', 'QQ 音乐尚未返回有效账号资料，请重试校验。', { retryable: true });
        return { ...state, accountId };
      },
      accountId: accountIdOf,
      validateResponse(body, role) {
        if (role === 'accountInfo' && !accountIdOf(body)) throw new MusicError('login_required', 'QQ 音乐登录已失效，请重新扫码。');
      },
      searchParams: ({ query, limit }) => ({ keyword: query, type: 'song', limit: Math.min(20, limit), page: 1 }),
      search: qqRows,
      playUrl: (body, track) => {
        const result = qqPlayEntry(body, track.providerTrackId);
        if (result?.preview === true) throw new MusicError('media_unavailable', 'QQ 音乐仅提供试听片段。');
        return { url: result?.url ?? result?.purl ?? null, reason: 'QQ 音乐暂未提供完整播放链接。',
          expiresInSeconds: Number.isSafeInteger(result?.expiresIn) ? result.expiresIn : null };
      },
      resolveParams: ({ track }) => ({ songmid: track.providerTrackId, quality: '320' }),
      lyrics: normalizeQQMusicLyrics,
    },
    seedSources: {
      liked: { role: 'likedTracks', params: ({ limit }) => ({ limit }), parse: qqRows },
      playlist: { steps: [
        { role: 'playlists', params: () => ({}), collect: false,
          parse(body, { playlistId: selected }) {
            const list = playlistsOf(body);
            const row = selected ? list.find(item => playlistId(item) === String(selected))
              : list.find(item => Number(item.dirId ?? item.dirid) !== 201) ?? list[0];
            if (selected && !row) throw new MusicError('invalid_command', '指定歌单不在当前 QQ 账号的歌单列表中。');
            return { playlistId: row ? playlistId(row) : null, tid: row?.tid ?? row?.dissid ?? row?.disstid ?? row?.id,
              dirid: row?.dirId ?? row?.dirid };
          } },
        { role: 'playlistTracks', params: ({ tid, dirid, limit, playlistId: id }) => id ? { tid, dirid, limit } : null, parse: qqRows },
      ] },
    },
  });
  const baseAccount = provider.getAccount.bind(provider);
  let verified = !transport.requiresRestore || store?.getCredentialReference(QQ)?.state !== 'authorized';
  let restoreFailed = false;
  provider.getAccount = () => {
    const account = baseAccount();
    if (account.status === 'authorized' && !verified && restoreFailed) {
      return { status: 'error', canRestore: true, reason: 'QQ 音乐登录验证失败，请重试验证。' };
    }
    return account.status === 'authorized' && !verified ? { status: 'login_required', checking: true } : account;
  };
  const restore = provider.restore.bind(provider);
  provider.restore = async options => {
    try {
      const result = await restore(options);
      verified = result.status === 'authorized';
      restoreFailed = false;
      return result;
    } catch (error) {
      restoreFailed = true;
      throw error;
    }
  };
  const poll = provider.pollLogin.bind(provider);
  provider.pollLogin = async options => {
    const result = await poll(options);
    if (result.status === 'authorized') { verified = true; restoreFailed = false; }
    return result;
  };
  const getSeeds = provider.getSeedTracks.bind(provider);
  provider.getSeedTracks = options => {
    if (options?.source === 'recent') throw new MusicError('capability_unavailable', 'QQ 接口暂不提供最近播放记录，请选择喜欢或歌单。');
    if (!Number.isSafeInteger(options?.limit ?? 300) || (options?.limit ?? 300) < 1 || (options?.limit ?? 300) > 1000) {
      throw new MusicError('invalid_command', '导入数量必须为 1–1000。');
    }
    return getSeeds(options);
  };
  provider.getUserPlaylists = async ({ signal = null } = {}) => {
    if (provider.getAccount().status !== 'authorized') throw new MusicError('login_required', '请先登录 QQ 音乐。');
    const response = await transport.request({ role: 'playlists', params: {}, signal });
    return playlistsOf(response.body).map(row => ({ id: playlistId(row), title: row.name ?? row.title ?? row.dissname ?? row.dirName ?? '未命名歌单',
      trackCount: row.songnum ?? row.songCount ?? row.song_cnt ?? null })).filter(row => row.id);
  };
  const baseCapabilities = provider.getCapabilities.bind(provider);
  provider.getCapabilities = () => ({ ...baseCapabilities(), recent: capability('unavailable', { reason: 'QQ 接口暂不提供最近播放记录。' }),
    recommendation: provider.getAccount().status === 'authorized' ? capability('available', { source: 'qq_daily' }) : needsLogin('QQ 音乐推荐') });
  provider.getDiscoveryTracks = async ({ limit = 40, signal = null, seeds = [] } = {}) => {
    if (provider.getAccount().status !== 'authorized') throw new MusicError('login_required', '请先登录 QQ 音乐。');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new MusicError('invalid_command', '候选数量必须为 1–200。');
    const context = provider.resourceContext();
    const result = new Map();
    const failures = [];
    const calls = [
      ...seeds.filter(track => track.provider === QQ).slice(0, 3).map(track => ({ role: 'similarRecommendations', source: 'qq_similar', params: { songmid: track.providerTrackId }, seed: track })),
      { role: 'dailyRecommendations', source: 'qq_daily', params: {} },
      { role: 'personalRecommendations', source: 'qq_personal_fm', params: {} },
    ];
    for (const call of calls) {
      if (result.size >= limit) break;
      try {
        const response = await transport.request({ role: call.role, params: call.params, signal });
        if (signal?.aborted || provider.resourceContext() !== context) throw new MusicError('cancelled', 'QQ 推荐请求已取消。');
        const fetchedAt = now();
        for (const row of qqRows(response.body)) {
          const track = toTrack(QQ, normalizeQQTrack(row));
          if (!track) continue;
          result.set(trackId(track), { ...track, discovery: { source: call.source,
            seedTrackKey: call.seed ? trackId(call.seed) : null, fetchedAt, expiresAt: fetchedAt + 6 * 60 * 60_000 } });
        }
      } catch (error) {
        if (['login_required', 'cancelled'].includes(error.code) || signal?.aborted) {
          if (error.code === 'login_required') {
            const saved = store?.getCredentialReference(QQ);
            if (saved) store.setCredentialReference({ provider: QQ, accountId: saved.account_id, credentialRef: saved.credential_ref, state: 'expired', updatedAt: now() });
          }
          throw error;
        }
        failures.push(error.code ?? 'provider_failure');
      }
    }
    if (!result.size && failures.length === calls.length) throw new MusicError('provider_failure', 'QQ 音乐推荐暂不可用。', { retryable: true });
    return [...result.values()].slice(0, limit);
  };
  provider.checkPlayability = async (tracks = [], { signal = null } = {}) => {
    if (provider.getAccount().status !== 'authorized') throw new MusicError('login_required', '请先登录 QQ 音乐。');
    if (typeof transport.roles === 'function' && !transport.roles().includes('checkPlayability')) {
      return { playable: [], unplayable: [], checked: 0, skipped: true };
    }
    const mids = [...new Set((tracks ?? [])
      .filter(track => track?.provider === QQ && typeof track.providerTrackId === 'string' && /^[\w-]{1,80}$/.test(track.providerTrackId))
      .map(track => track.providerTrackId))].slice(0, PLAYABILITY_CHECK_MAX_TRACKS);
    if (!mids.length) return { playable: [], unplayable: [], checked: 0, skipped: false };
    const context = provider.resourceContext();
    const playable = [];
    const unplayable = [];
    let checked = 0;
    for (let index = 0; index < mids.length; index += PLAYABILITY_CHECK_BATCH_SIZE) {
      if (signal?.aborted || provider.resourceContext() !== context) throw new MusicError('cancelled', 'QQ 可播检查已取消。');
      const chunk = mids.slice(index, index + PLAYABILITY_CHECK_BATCH_SIZE);
      try {
        const response = await transport.request({ role: 'checkPlayability', params: { songmids: chunk }, signal });
        if (signal?.aborted || provider.resourceContext() !== context) throw new MusicError('cancelled', 'QQ 可播检查已取消。');
        const data = unwrap(response?.body);
        const playMap = data?.playUrl;
        if (!playMap || typeof playMap !== 'object') continue;
        for (const mid of chunk) {
          const entry = playMap[mid];
          if (!entry || typeof entry !== 'object') continue;
          checked++;
          const hasFullUrl = entry.preview !== true && Boolean(entry.url || entry.purl);
          (hasFullUrl ? playable : unplayable).push(`${QQ}:${mid}`);
        }
      } catch (error) {
        if (signal?.aborted || error?.code === 'cancelled' || error?.name === 'AbortError') {
          throw new MusicError('cancelled', 'QQ 可播检查已取消。');
        }
        if (error?.code === 'login_required') {
          const saved = store?.getCredentialReference(QQ);
          if (saved) store.setCredentialReference({ provider: QQ, accountId: saved.account_id, credentialRef: saved.credential_ref, state: 'expired', updatedAt: now() });
          throw error;
        }
        if (error?.code === 'media_unavailable' && chunk.length === 1) {
          checked++;
          unplayable.push(`${QQ}:${chunk[0]}`);
          continue;
        }
        break;
      }
    }
    return { playable, unplayable, checked, skipped: checked === 0 };
  };
  return provider;
}
export function unverifiedEndpoints() { return [...QQ_ROLES]; }
