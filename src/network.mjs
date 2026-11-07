import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { MusicError } from './contracts.mjs';

export const DEFAULT_NETWORK_PROXY = Object.freeze({ mode: 'direct', url: '' });
const SETTING_KEY = 'network_proxy_v1';

function invalidProxy() {
  return new MusicError('invalid_network_proxy', '请选择直连或自定义代理，代理地址需为有效的 HTTP/HTTPS 主机和端口。');
}

export function validateNetworkProxy(input) {
  if (!input || Array.isArray(input) || !['direct', 'proxy'].includes(input.mode) || typeof input.url !== 'string') throw invalidProxy();
  const text = input.url.trim();
  if (!text && input.mode === 'direct') return { mode: 'direct', url: '' };
  if (!text || text.length > 2048 || /[\u0000-\u0020\u007f]/.test(text)) throw invalidProxy();
  let url;
  try { url = new URL(text); } catch { throw invalidProxy(); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || text.includes('@')
    || url.pathname !== '/' || text.includes('?') || text.includes('#') || url.port === '0') throw invalidProxy();
  return { mode: input.mode, url: url.origin };
}

export function networkProxyView(store) {
  const saved = store?.getSetting?.(SETTING_KEY, null);
  if (saved?.version === 1 && Number.isSafeInteger(saved.revision) && saved.revision >= 0) {
    try { return { version: 1, revision: saved.revision, ...validateNetworkProxy(saved) }; }
    catch { /* Invalid persisted data uses the direct default. */ }
  }
  return { version: 1, revision: 0, ...DEFAULT_NETWORK_PROXY };
}

export function saveNetworkProxy(store, input, expectedRevision) {
  const settings = validateNetworkProxy(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw invalidProxy();
  return store.transaction(() => {
    const current = networkProxyView(store);
    if (current.revision !== expectedRevision) throw new MusicError('network_proxy_conflict', '另一窗口已更改网络代理，请先读取已保存的设置。');
    if (current.mode === settings.mode && current.url === settings.url) return current;
    if (!Number.isSafeInteger(current.revision + 1)) throw invalidProxy();
    const value = { version: 1, revision: current.revision + 1, ...settings };
    store.setSetting(SETTING_KEY, value);
    return value;
  });
}

function requestUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new MusicError('invalid_network_request', '网络请求地址无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new MusicError('invalid_network_request', '网络请求地址无效。');
  }
  return url;
}

/** Per-request agents keep plugin settings separate from the host environment.
 * Direct mode controls application proxies; VPN/TUN routing belongs to the OS. */
export function createNetworkClient({ getSettings = () => DEFAULT_NETWORK_PROXY } = {}) {
  const client = {
    createAgent(protocol) {
      const settings = validateNetworkProxy(getSettings());
      const proxyEnv = settings.mode === 'proxy'
        ? { HTTP_PROXY: settings.url, HTTPS_PROXY: settings.url, NO_PROXY: '' }
        : { HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '*' };
      if (protocol === 'http:') return new HttpAgent({ keepAlive: false, proxyEnv });
      if (protocol === 'https:') return new HttpsAgent({ keepAlive: false, proxyEnv });
      throw new MusicError('invalid_network_request', '网络请求地址无效。');
    },
    request(value, { signal, headers, method = 'GET', body } = {}) {
      return new Promise((resolve, reject) => {
        const url = requestUrl(value);
        const agent = client.createAgent(url.protocol);
        let released = false;
        const release = () => { if (!released) { released = true; agent.destroy(); } };
        const requestHeaders = headers instanceof Headers ? Object.fromEntries(headers) : headers;
        let request;
        try {
          request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
            method, headers: requestHeaders, signal, agent,
          }, response => {
            response.on('error', () => {});
            response.once('close', release);
            resolve(response);
          });
          request.once('error', error => { release(); reject(error); });
          request.end(body);
        } catch (error) {
          request?.destroy(); release(); reject(error);
        }
      });
    },
    async fetch(value, init = {}) {
      const response = await client.request(value, init);
      const headers = new Headers();
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
      }
      const empty = init.method?.toUpperCase() === 'HEAD' || [204, 205, 304].includes(response.statusCode);
      let body = null;
      if (empty) response.resume();
      else {
        body = Readable.toWeb(response);
        const encodings = String(response.headers['content-encoding'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        const formats = { gzip: 'gzip', deflate: 'deflate', br: 'brotli' };
        if (encodings.every(encoding => formats[encoding])) {
          for (const encoding of encodings.reverse()) body = body.pipeThrough(new DecompressionStream(formats[encoding]));
        }
      }
      return new Response(body, { status: response.statusCode, statusText: response.statusMessage, headers });
    },
  };
  return client;
}
