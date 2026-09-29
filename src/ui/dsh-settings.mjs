// DSH 0.2.0-rc.1 Connection contract; no new HTTP listener or model tools.
import { randomUUID } from 'node:crypto';
import { assertCommand } from '../contracts.mjs';

const ALLOWED = new Set(['pause', 'resume', 'next', 'setListening', 'setHumanPlayback',
  'setDiscovery', 'setDiscoveryRate', 'setMode', 'stopForToday']);

export function createSettingsHandler(bridge) {
  return async (endpoint, payload, signal) => {
    try {
      if (endpoint !== 'fishfm/state' && endpoint !== 'fishfm/command') {
        throw Object.assign(new Error('Unknown FishFM endpoint'), { code: 'not_found' });
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
      const [state, platforms] = await Promise.all([
        bridge.request({ type: 'snapshot' }, { signal, abortable: true }),
        bridge.request({ type: 'platforms' }, { signal, abortable: true }),
      ]);
      // Publish only the UI projection, never credentials or media handles.
      return { ok: true, value: { snapshot: state.snapshot, platforms: platforms.platforms } };
    } catch (error) {
      return { ok: false, error: { code: error.code ?? 'core_unavailable',
        message: '音乐服务未能完成操作，请刷新后重试。', details: {} } };
    }
  };
}

export function registerSettingsApi(ctx, bridge) {
  ctx.effect(() => ctx.connection.rpc.intercept('/api',
    (endpoint) => endpoint === 'fishfm/state' || endpoint === 'fishfm/command',
    createSettingsHandler(bridge)));
}
