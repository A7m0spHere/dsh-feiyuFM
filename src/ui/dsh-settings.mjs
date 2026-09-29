// DSH 0.2.0-rc.1 Connection contract; no new HTTP listener or model tools.
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { assertCommand } from '../contracts.mjs';
import { NETEASE_QR_LOGIN_URL } from '../providers/endpoints/netease.mjs';

const ALLOWED = new Set(['pause', 'resume', 'next', 'setListening', 'setHumanPlayback',
  'setDiscovery', 'setDiscoveryRate', 'setMode', 'stopForToday']);
const QUICK_LOGIN_PROVIDER = 'netease';
const STATE_ENDPOINT = 'fishfm/state';
const PLATFORM_ENDPOINTS = new Set(['fishfm/login-start', 'fishfm/login-poll', 'fishfm/import', 'fishfm/logout']);

async function readSettingsState(bridge, signal) {
  const [state, platforms] = await Promise.all([
    bridge.request({ type: 'snapshot' }, { signal, abortable: true }),
    bridge.request({ type: 'platforms' }, { signal, abortable: true }),
  ]);
  // Publish only the UI projection, never credentials or media handles.
  return { snapshot: state.snapshot, platforms: platforms.platforms };
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
          const polled = await bridge.request({ type: 'login', step: 'poll', provider: QUICK_LOGIN_PROVIDER }, { signal, abortable: true });
          return { ok: true, value: { login: { provider: QUICK_LOGIN_PROVIDER, status: polled.status }, ...(await readSettingsState(bridge, signal)) } };
        }
        if (endpoint === 'fishfm/logout') {
          await bridge.request({ type: 'logout', provider: QUICK_LOGIN_PROVIDER }, { signal, abortable: true });
          return { ok: true, value: { login: null, imported: null, ...(await readSettingsState(bridge, signal)) } };
        }
        const imported = await bridge.request({ type: 'import-platform', provider: QUICK_LOGIN_PROVIDER, limit: 300 },
          { signal, abortable: true, timeoutMs: 75_000 });
        return { ok: true, value: { login: { provider: QUICK_LOGIN_PROVIDER, status: 'authorized' }, imported: imported.import,
          snapshot: imported.snapshot, ...(await readSettingsState(bridge, signal)) } };
      }
      let command;
      if (endpoint === 'fishfm/command') {
        if (!payload || !ALLOWED.has(payload.type)) {
          throw Object.assign(new Error('Unsupported settings command'), { code: 'invalid_command' });
        }
        command = { type: payload.type, value: payload.value, commandId: randomUUID() };
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
        message: '音乐服务未能完成操作，请刷新后重试。', details: {} } };
    }
  };
}

export function registerSettingsApi(ctx, bridge) {
  ctx.effect(() => ctx.connection.rpc.intercept('/api',
    (endpoint) => endpoint === STATE_ENDPOINT || endpoint === 'fishfm/command' || PLATFORM_ENDPOINTS.has(endpoint),
    createSettingsHandler(bridge)));
}
