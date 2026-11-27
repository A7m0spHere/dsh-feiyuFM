import { randomBytes } from 'node:crypto';
import { MusicError } from '../contracts.mjs';
import { createQQUpstream } from './qq-upstream.mjs';

const ROUTES = Object.freeze({
  accountInfo: '/login/status', playlists: '/user/playlist', likedTracks: '/user/liked-songs',
  playlistTracks: '/user/playlist-detail', search: '/search', lyrics: '/getLyric',
  dailyRecommendations: '/user/daily-songs', personalRecommendations: '/user/personal-fm',
  similarRecommendations: '/song/similar',
});
const RUNTIME_REFERENCE = 'fishfm/qq-runtime';
const isNumericSongId = value => /^\d{1,15}$/.test(String(value ?? '')) && Number(value) > 0;

export function createQQCommunityTransport({ credentials, getNetworkSettings = () => ({ mode: 'direct', url: '' }),
  upstream = createQQUpstream(), now = () => Date.now() } = {}) {
  let runtimeSecret;
  let session = '';
  let generation = 0;
  let writer = null;
  let refreshedAt = null;
  let refreshing = null;
  const controllers = new Set();
  function secret() {
    if (runtimeSecret) return runtimeSecret;
    runtimeSecret = credentials?.read(RUNTIME_REFERENCE);
    if (!runtimeSecret) {
      if (!credentials?.write) throw new MusicError('credential_store_unavailable', 'QQ 登录需要可用的本机加密存储。');
      const generated = randomBytes(32).toString('hex');
      credentials.write(RUNTIME_REFERENCE, generated);
      runtimeSecret = generated;
    }
    return runtimeSecret;
  }
  const tokenOf = value => /(?:^|;\s*)qqmusic_session=([^;\s]+)/.exec(value ?? '')?.[1] ?? '';
  async function invoke(path, query, { signal, candidate = session, method = 'GET', role } = {}) {
    const response = await upstream.request({ path, query, method, token: tokenOf(candidate),
      sessionSecret: secret(), network: getNetworkSettings(), role }, { signal });
    const body = response.body;
    if (response.status < 400) return response;
    if (response.status === 422 && body?.errorKey === 'resource.not-found'
      && ['dailyRecommendations', 'personalRecommendations', 'similarRecommendations'].includes(role)) {
      return { status: 200, body: { songs: [] } };
    }
    const details = { stage: role, httpStatus: response.status,
      ...(typeof body?.errorKey === 'string' && /^[\w.-]{1,80}$/.test(body.errorKey) ? { errorKey: body.errorKey } : {}),
      ...(Number.isFinite(body?.retryAfterMs) ? { retryAfterMs: Math.max(0, body.retryAfterMs) } : {}) };
    if (body?.errorKey === 'auth.device-limit' || body?.upstreamCode === 20279) {
      throw new MusicError('device_limit', '设备数已满，请在 QQ 音乐 App 移除旧设备。', { details });
    }
    const codes = { 400: 'invalid_command', 401: 'login_required', 429: 'rate_limited' };
    let code = codes[response.status] ?? 'provider_failure';
    if (body?.errorKey === 'auth.credential-invalid') code = 'login_required';
    if ([404, 422].includes(response.status) && role === 'resolve') code = 'media_unavailable';
    const messages = { login_required: 'QQ 音乐登录已失效，请重新扫码。',
      media_unavailable: 'QQ 音乐暂未提供完整播放链接。', invalid_command: 'QQ 请求参数无效，请检查关键词或歌单。' };
    throw new MusicError(code, messages[code] ?? 'QQ 音乐接口请求失败，请稍后重试。', {
      retryable: typeof body?.retryable === 'boolean' ? body.retryable : response.status >= 500 || response.status === 429, details,
    });
  }
  async function refresh(signal) {
    if (!session || (refreshedAt !== null && now() - refreshedAt < 60 * 60_000)) return;
    if (!refreshing) {
      const controller = new AbortController();
      const previous = session;
      const version = generation;
      const entry = { controller, promise: null };
      entry.promise = (async () => {
        const response = await invoke('/login/refresh', {}, { signal: controller.signal, candidate: previous, method: 'POST', role: 'accountInfo' });
        if (controller.signal.aborted || version !== generation || session !== previous) throw new MusicError('cancelled', 'QQ 会话更新已取消。');
        const rotated = response.body?.data;
        if (rotated?.rotated && typeof rotated.token === 'string' && rotated.token) {
          const next = `qqmusic_session=${rotated.token}`;
          if (!writer) throw new MusicError('credential_store_unavailable', 'QQ 会话更新无法保存。');
          writer(next);
          session = next;
        }
        refreshedAt = now();
      })().finally(() => { if (refreshing === entry) refreshing = null; });
      refreshing = entry;
    }
    const task = refreshing.promise;
    // The refresh owns its network request. Cancelling one playback waiter
    // must not cancel a simultaneous library import using the same account.
    return new Promise((resolve, reject) => {
      const abort = () => reject(new MusicError('cancelled', 'QQ 请求已取消。'));
      signal.addEventListener('abort', abort, { once: true });
      task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
  }
  return {
    requiresRestore: true,
    roles: () => ['loginQr', 'loginPoll', 'resolve', ...Object.keys(ROUTES)],
    setSessionWriter(value) { writer = value; },
    useSecret(value) {
      const next = typeof value === 'string' ? value : '';
      if (session === next) return;
      generation++;
      refreshing?.controller.abort();
      for (const controller of controllers) controller.abort();
      session = next;
      refreshedAt = null;
    },
    async request({ role, params = {}, signal = null, session: candidate } = {}) {
      if (role === 'recentTracks') throw new MusicError('capability_unavailable', 'QQ 接口暂不提供最近播放记录。');
      const controller = new AbortController();
      controllers.add(controller);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const version = generation;
      try {
        if (role === 'loginQr') {
          const key = await invoke('/login/qr/key', { channel: 'qq' }, { signal: combined, candidate: '', role });
          const unikey = key.body?.data?.unikey;
          if (typeof unikey !== 'string' || !unikey) throw new MusicError('provider_failure', 'QQ 未返回登录二维码标识。');
          const image = await invoke('/login/qr/create', { key: unikey, qrimg: 1 }, { signal: combined, candidate: '', role });
          return { status: 200, body: { data: { unikey, qrimg: image.body?.data?.qrimg } } };
        }
        if (role === 'loginPoll') return await invoke('/login/qr/check', { key: params.key }, { signal: combined, candidate: '', role });
        if (role !== 'lyrics' && !candidate) await refresh(combined);
        const path = role === 'resolve' ? `/getMusicPlay/${encodeURIComponent(params.songmid)}` : ROUTES[role];
        if (!path) throw new MusicError('capability_unavailable', 'QQ 暂不支持该操作。');
        let query = role === 'resolve' ? { quality: '320' } : params;
        if (role === 'lyrics') query = { songmid: params.id, trans: 1 };
        if (role === 'similarRecommendations') {
          // Playback and storage use MID. The similarity endpoint takes a numeric song ID.
          let id = params.songmid;
          if (!isNumericSongId(id)) {
            const detail = await invoke('/getSongInfo/' + encodeURIComponent(id), {}, { signal: combined, candidate: '', role });
            const reply = detail.body?.response;
            const song = reply?.songinfo;
            const track = song?.data?.track_info;
            if (reply?.code !== 0 || song?.code !== 0 || track?.mid !== id || !isNumericSongId(track?.id)) {
              throw new MusicError('provider_failure', 'QQ 音乐未返回对应的歌曲数字 ID。', { retryable: true });
            }
            id = track.id;
          }
          query = { id };
        }
        const requestOptions = { signal: combined, candidate: role === 'lyrics' ? '' : candidate ?? session, role };
        let response = await invoke(path, query, requestOptions);
        if (['likedTracks', 'playlistTracks'].includes(role)) {
          const wanted = Math.min(1000, Math.max(1, Number.isSafeInteger(params.limit) ? params.limit : 300));
          const songs = [...(response.body?.songs ?? [])];
          let offset = songs.length;
          while (response.body?.more && songs.length && songs.length < wanted) {
            response = await invoke(path, { ...params, offset, limit: Math.min(100, wanted - songs.length) }, requestOptions);
            const page = response.body?.songs;
            if (!Array.isArray(page) || !page.length) break;
            songs.push(...page);
            offset += page.length;
          }
          response = { status: 200, body: { ...response.body, songs: songs.slice(0, wanted) } };
        }
        if (combined.aborted || version !== generation) throw new MusicError('cancelled', 'QQ 账号状态已变化。');
        return response;
      } finally { controllers.delete(controller); }
    },
    async dispose() {
      refreshing?.controller.abort();
      for (const controller of controllers) controller.abort();
      await upstream.close();
    },
  };
}
