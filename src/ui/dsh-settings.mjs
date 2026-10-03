// DSH 0.2.0-rc.1 Connection contract; no new HTTP listener or model tools.
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { assertCommand, normalizeTrack } from '../contracts.mjs';
import { NETEASE_QR_LOGIN_URL } from '../providers/endpoints/netease.mjs';

const ALLOWED = new Set(['pause', 'resume', 'next', 'setListening', 'setHumanPlayback',
  'setDiscovery', 'setDiscoveryRate', 'setMode', 'stopForToday', 'requestTrack']);
const QUICK_LOGIN_PROVIDER = 'netease';
const STATE_ENDPOINT = 'fishfm/state';
const PLATFORM_ENDPOINTS = new Set(['fishfm/login-start', 'fishfm/login-poll', 'fishfm/import', 'fishfm/logout', 'fishfm/discovery-refresh','fishfm/playlists']);
const SAFE_STAGES = new Set(['login_qr_key', 'login_qr_check', 'login_status', 'user_record', 'likelist', 'user_playlist', 'playlist_detail', 'song_detail',
  'accountInfo', 'recentTracks', 'likedTracks', 'playlists', 'playlistTracks', 'songDetails']);

function safeText(value, limit = 280) {
  return String(value ?? '')
    .replace(/\b(?:MUSIC_U|MUSIC_A|__csrf|NMTID|MUSIC_R_T|MUSIC_A_T)=([^;\s]+)/gi, '[已隐藏凭据]')
    .replace(/\b(?:cookie|token|signature|sign)\s*[:=]\s*[^\s,;]+/gi, '[已隐藏凭据]')
    .slice(0, limit);
}

function safeImportDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const result = {};
  if (SAFE_STAGES.has(details.stage)) result.stage = details.stage;
  if (Number.isInteger(details.httpStatus)) result.httpStatus = details.httpStatus;
  if (Number.isInteger(details.platformCode)) result.platformCode = details.platformCode;
  if (Array.isArray(details.attempts)) {
    result.attempts = details.attempts.slice(0, 3).map((row) => ({
      source: ['recent', 'liked', 'playlist'].includes(row?.source) ? row.source : 'unknown',
      count: Number.isInteger(row?.count) && row.count >= 0 ? row.count : 0,
      ok: row?.ok === true,
      code: /^[\w-]{1,40}$/.test(String(row?.code ?? '')) ? row.code : null,
      ...(SAFE_STAGES.has(row?.stage) ? { stage: row.stage } : {}),
      ...(Number.isInteger(row?.httpStatus) ? { httpStatus: row.httpStatus } : {}),
      ...(Number.isInteger(row?.platformCode) ? { platformCode: row.platformCode } : {}),
      stages: Array.isArray(row?.stages) ? row.stages.slice(0, 5).map((stage) => ({
        stage: SAFE_STAGES.has(stage?.stage) ? stage.stage : 'unknown',
        status: ['ok', 'skipped'].includes(stage?.status) ? stage.status : 'error',
        count: Number.isInteger(stage?.count) && stage.count >= 0 ? stage.count : null,
      })) : [],
      reason: safeText(row?.reason),
    }));
  }
  return result;
}

async function readSettingsState(bridge, signal) {
  const [state, platforms, library,insights] = await Promise.all([
    bridge.request({ type: 'snapshot' }, { signal, abortable: true }),
    bridge.request({ type: 'platforms' }, { signal, abortable: true }),
    bridge.request({ type: 'library' }, { signal, abortable: true }),
    bridge.request({type:'insights'},{signal,abortable:true}),
  ]);
  // Publish only the UI projection, never credentials or media handles.
  return { snapshot: state.snapshot, platforms: platforms.platforms, library: library.library, insights:insights?.insights,
    features: { discoveryRefresh: true,importSources:true,insights:true } };
}

export function createSettingsHandler(bridge) {
  return async (endpoint, payload, signal) => {
    try {
      if (endpoint !== STATE_ENDPOINT && endpoint !== 'fishfm/command' && !PLATFORM_ENDPOINTS.has(endpoint)) {
        throw Object.assign(new Error('Unknown FishFM endpoint'), { code: 'not_found' });
      }
      if (PLATFORM_ENDPOINTS.has(endpoint)) {
        if (payload?.provider !== QUICK_LOGIN_PROVIDER) {
          throw Object.assign(new Error('Quick login is only available for the configured NetEase adapter'), { code: 'platform_unavailable' });
        }
        await bridge.start();
        if(endpoint==='fishfm/playlists') {
          const listed=await bridge.request({type:'playlists',provider:QUICK_LOGIN_PROVIDER},{signal,abortable:true,timeoutMs:40000});
          return {ok:true,value:{playlists:listed.playlists,...(await readSettingsState(bridge,signal))}};
        }
        if (endpoint === 'fishfm/discovery-refresh') {
          const refreshed = await bridge.request({ type: 'discovery' }, { signal, abortable: true });
          return { ok: true, value: { discovery: refreshed.discovery, ...(await readSettingsState(bridge, signal)) } };
        }
        if (endpoint === 'fishfm/login-start') {
          const started = await bridge.request({ type: 'login', step: 'begin', provider: QUICK_LOGIN_PROVIDER }, { signal, abortable: true });
          const key = started.login?.key;
          if (typeof key !== 'string' || !key) throw Object.assign(new Error('The platform did not return a QR login key'), { code: 'login_qr_unavailable' });
          const providedUrl = started.login?.qrUrl;
          const qrUrl = providedUrl || `${NETEASE_QR_LOGIN_URL}?codekey=${encodeURIComponent(key)}`;
          let parsedUrl;
          try { parsedUrl = new URL(qrUrl); } catch { throw Object.assign(new Error('The platform returned an invalid QR URL'), { code: 'login_qr_unavailable' }); }
          if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'music.163.com') {
            throw Object.assign(new Error('The platform returned an unsupported QR destination'), { code: 'login_qr_unavailable' });
          }
          const image = typeof started.login?.qrImage === 'string' && started.login.qrImage.startsWith('data:image/')
            ? started.login.qrImage
            : await QRCode.toDataURL(qrUrl, { width: 288, margin: 2, errorCorrectionLevel: 'M' });
          return { ok: true, value: { login: { provider: QUICK_LOGIN_PROVIDER, status: 'waiting', qrImage: image }, ...(await readSettingsState(bridge, signal)) } };
        }
        if (endpoint === 'fishfm/login-poll') {
          const polled = await bridge.request({ type: 'login', step: 'poll', provider: QUICK_LOGIN_PROVIDER }, { signal, abortable: true, timeoutMs: 40_000 });
          return { ok: true, value: { login: { provider: QUICK_LOGIN_PROVIDER, status: polled.status, qrExpired: polled.status === 'expired',
            accountId: polled.login?.accountId ?? null, identityError: polled.login?.identityError ?? null },
          ...(await readSettingsState(bridge, signal)) } };
        }
        if (endpoint === 'fishfm/logout') {
          await bridge.request({ type: 'logout', provider: QUICK_LOGIN_PROVIDER }, { signal, abortable: true });
          return { ok: true, value: { login: null, imported: null, ...(await readSettingsState(bridge, signal)) } };
        }
        const source=['recent','liked','playlist'].includes(payload.source)?payload.source:null;
        const playlistId=source==='playlist' && /^\d{1,20}$/.test(String(payload.playlistId??''))?String(payload.playlistId):null;
        if(source==='playlist'&&!playlistId)throw Object.assign(new Error('请选择有效歌单。'),{code:'invalid_command'});
        const imported = await bridge.request({ type: 'import-platform', provider: QUICK_LOGIN_PROVIDER, limit: 300,source,playlistId },
          { signal, abortable: true, timeoutMs: 75_000 });
        return { ok: true, value: { login: { provider: QUICK_LOGIN_PROVIDER, status: 'authorized' }, imported: imported.import,
          attempts: imported.attempts ?? [], snapshot: imported.snapshot, ...(await readSettingsState(bridge, signal)) } };
      }
      let command;
      if (endpoint === 'fishfm/command') {
        if (!payload || !ALLOWED.has(payload.type)) {
          throw Object.assign(new Error('Unsupported settings command'), { code: 'invalid_command' });
        }
        command = { type: payload.type, value: payload.value, commandId: randomUUID() };
        if (command.type === 'requestTrack') {
          try { const t=payload.track; command.track = normalizeTrack({provider:t?.provider,providerTrackId:t?.providerTrackId,
            title:t?.title,artist:t?.artist,durationMs:t?.durationMs}); }
          catch { throw Object.assign(new Error('A valid platform track is required'), { code: 'invalid_command' }); }
        }
        if (command.type === 'setDiscoveryRate' && !Number.isFinite(command.value)) {
          throw Object.assign(new Error('Exploration rate must be finite'), { code: 'invalid_command' });
        }
        assertCommand(command);
      }
      await bridge.start();
      if (command) {
        const value = await bridge.command(command, { signal });
        return { ok: true, value };
      }
      return { ok: true, value: await readSettingsState(bridge, signal) };
    } catch (error) {
      return { ok: false, error: { code: error.code ?? 'core_unavailable',
        message: safeText(error.message || '音乐服务未能完成操作，请刷新后重试。', 420),
        retryable: Boolean(error.retryable), details: safeImportDetails(error.details) } };
    }
  };
}

export function registerSettingsApi(ctx, bridge) {
  const handler = createSettingsHandler(bridge);
  // rc.2 reserves the shared /api interceptor for the host Gateway. Exact
  // Fetch routes coexist with it and use the same authenticated carrier in
  // both the Electron renderer and a Web profile.
  if (typeof ctx.connection.fetch?.register === 'function') {
    ctx.effect(() => {
      const disposers = [STATE_ENDPOINT, 'fishfm/command', ...PLATFORM_ENDPOINTS].map(endpoint =>
        ctx.connection.fetch.register({
          path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
          async fetch(request) {
            if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
              return new Response('Expected application/json', { status: 415 });
            }
            let message;
            try { message = await request.json(); }
            catch { return new Response('Invalid JSON', { status: 400 }); }
            const valid = message?.type === 'client-request' && typeof message.rpcId === 'string' && message.method === endpoint;
            const result = valid ? await handler(endpoint, message.payload, request.signal)
              : { ok: false, error: { code: 'gateway/bad-request', message: 'Invalid FishFM RPC envelope' } };
            return Response.json({ type: 'server-response', rpcId: typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request', result });
          },
        }));
      return () => disposers.forEach(dispose => dispose());
    }, 'fishfm: authenticated settings routes');
  } else {
    ctx.effect(() => ctx.connection.rpc.intercept('/api',
      endpoint => endpoint === STATE_ENDPOINT || endpoint === 'fishfm/command' || PLATFORM_ENDPOINTS.has(endpoint), handler));
  }
}
