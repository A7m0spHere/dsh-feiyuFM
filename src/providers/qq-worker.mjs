import { parentPort } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createNetworkClient } from '../network.mjs';

const requests = new Map();
const context = new AsyncLocalStorage();
// This global belongs only to the QQ Worker. Every upstream request inherits
// its own proxy snapshot and cancellation, including requests made by the SDK.
globalThis.fetch = async (value, init) => {
  const active = context.getStore();
  if (!active) throw new Error('QQ network request has no owner');
  const request = new Request(value, init);
  const signal = AbortSignal.any([request.signal, active.controller.signal]);
  return createNetworkClient({ getSettings: () => active.network }).fetch(request.url, {
    method: request.method, headers: request.headers, signal,
    body: request.body ? new Uint8Array(await request.arrayBuffer()) : undefined,
  });
};

const { handleRequest } = await import('@yakult-green-tea/qq-music-api/serverless');
parentPort.on('message', async message => {
  if (message.type === 'cancel') {
    requests.get(message.id)?.abort();
    return;
  }
  if (message.type !== 'request') return;
  const controller = new AbortController();
  requests.set(message.id, controller);
  try {
    const response = await context.run({ controller, network: message.network }, () => {
      const url = new URL(message.path, 'http://fishfm.qq.internal');
      for (const [key, value] of Object.entries(message.query ?? {})) {
        if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
      }
      const headers = message.token ? { 'x-qq-session': message.token } : {};
      return handleRequest(new Request(url, { method: message.method ?? 'GET', headers, signal: controller.signal }), {
        QQ_SESSION_SECRET: message.sessionSecret,
        QQ_PLAYBACK_HINTS_ENABLED: '0',
      });
    });
    const body = await response.text();
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error('QQ response is too large');
    parentPort.postMessage({ id: message.id, status: response.status, body: JSON.parse(body) });
  } catch {
    parentPort.postMessage({ id: message.id, error: controller.signal.aborted ? 'cancelled' : 'provider_failure' });
  } finally {
    requests.delete(message.id);
  }
});
parentPort.postMessage({ type: 'ready' });
