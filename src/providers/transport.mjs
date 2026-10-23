// HTTP API transport. Each instance owns one explicitly trusted origin; media
// URLs belong to Playback and are never fetched with this account cookie jar.
import { isIP } from 'node:net';
import { MusicError } from '../contracts.mjs';

export const HTTP_LIMITS = Object.freeze({ responseBytes: 4 * 1024 * 1024, cookieBytes: 16 * 1024, redirects: 5 });
const ATTRIBUTES = /^(path|domain|expires|max-age|httponly|secure|samesite)$/i;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const fail = (code, message) => new MusicError(code, message);

function positiveLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('HTTP limits must be positive safe integers');
  return value;
}

function parseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('endpoint_untrusted', 'Platform endpoint URL is invalid'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw fail('endpoint_untrusted', 'Platform endpoint requires an http(s) URL without user information');
  }
  return url;
}

function pathMatches(path, cookiePath) {
  return path === cookiePath || (path.startsWith(cookiePath) && (cookiePath.endsWith('/') || path[cookiePath.length] === '/'));
}

/** Raw credential headers remain supported; an origin-bound jar also scopes
 * Set-Cookie to its response path, Domain, Secure and expiry attributes. It is
 * intentionally narrower than a browser jar: cookies never cross origins. */
export function createCookieJar({ origin = null, maxBytes = HTTP_LIMITS.cookieBytes } = {}) {
  positiveLimit(maxBytes);
  const bound = origin === null ? null : parseUrl(origin);
  let cookies = new Map();
  const live = record => record.expiresAt === null || record.expiresAt > Date.now();
  return {
    origin: bound?.origin ?? null,
    absorb(input, responseUrl = bound) {
      if (!input) return;
      const parts = Array.isArray(input) ? input : String(input).split(';');
      if (parts.reduce((n, part) => n + Buffer.byteLength(String(part)) + 2, 0) > maxBytes) {
        throw fail('cookie_too_large', 'Platform cookies exceed the configured size limit');
      }
      const url = bound ? parseUrl(responseUrl) : null;
      if (bound && url.origin !== bound.origin) throw fail('endpoint_untrusted', 'Cookie response origin is not trusted');
      const next = new Map([...cookies].filter(([, record]) => live(record)));
      for (const part of parts) {
        const [pair, ...attributes] = String(part).split(';');
        const index = pair.indexOf('=');
        if (index <= 0) continue;
        const name = pair.slice(0, index).trim(), value = pair.slice(index + 1).trim();
        if (ATTRIBUTES.test(name)) continue;
        if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\x00-\x20\x7f;,]/.test(value)) {
          throw fail('invalid_cookie', 'Platform cookie contains invalid characters');
        }
        let path = '/', secure = false, expiresAt = null;
        if (url && Array.isArray(input)) {
          const slash = url.pathname.lastIndexOf('/');
          path = slash > 0 ? url.pathname.slice(0, slash) : '/';
          const attrs = new Map(attributes.map(attribute => {
            const split = attribute.indexOf('=');
            return split < 0 ? [attribute.trim().toLowerCase(), '']
              : [attribute.slice(0, split).trim().toLowerCase(), attribute.slice(split + 1).trim()];
          }));
          if (attrs.has('domain')) {
            const domain = attrs.get('domain').replace(/^\./, '').toLowerCase();
            if (!domain || (domain !== url.hostname && (isIP(url.hostname) || !url.hostname.endsWith(`.${domain}`)))) continue;
          }
          if (attrs.get('path')?.startsWith('/')) path = attrs.get('path');
          secure = attrs.has('secure');
          const expires = Date.parse(attrs.get('expires'));
          if (Number.isFinite(expires)) expiresAt = expires;
          if (/^-?\d+$/.test(attrs.get('max-age') ?? '')) {
            const seconds = Number(attrs.get('max-age'));
            expiresAt = seconds <= 0 ? 0 : Date.now() + Math.min(seconds * 1000, Number.MAX_SAFE_INTEGER - Date.now());
          }
        }
        const key = `${path}\0${name}`;
        const record = { name, value, path, secure, expiresAt };
        if (live(record)) next.set(key, record);
        else next.delete(key);
      }
      // Count all paths, not just the current request. Updates are atomic.
      const size = [...next.values()].reduce((n, row) => n + Buffer.byteLength(`${row.name}=${row.value}; ${row.path}`), 0);
      if (size > maxBytes) throw fail('cookie_too_large', 'Platform cookies exceed the configured size limit');
      cookies = next;
    },
    header(requestUrl = bound) {
      const url = bound ? parseUrl(requestUrl) : null;
      if (bound && url.origin !== bound.origin) return null;
      const selected = [...cookies.values()].filter(record => live(record)
        && (!url || (pathMatches(url.pathname, record.path) && (!record.secure || url.protocol === 'https:'))));
      selected.sort((a, b) => b.path.length - a.path.length);
      return selected.map(({ name, value }) => `${name}=${value}`).join('; ') || null;
    },
    toSecret(url = bound) { return this.header(url) ?? ''; },
    clear() { cookies.clear(); },
    size() { return [...cookies.values()].filter(live).length; },
  };
}

async function readBoundedBody(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw fail('response_too_large', 'Platform response exceeds the configured size limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw fail('response_too_large', 'Platform response exceeds the configured size limit');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally { reader.releaseLock(); }
}

/** Endpoint configuration cannot grant trust. HTTP is only allowed for explicit
 * IP loopback fixtures, never for a production platform or downgrade redirect. */
export function createHttpTransport({
  endpoints = {}, trustedOrigin = null, allowInsecureLoopback = false,
  fetchImpl = globalThis.fetch, timeoutMs = 15_000,
  userAgent = 'FishFM/0.1 (+local music persona)',
  maxResponseBytes = HTTP_LIMITS.responseBytes, maxCookieBytes = HTTP_LIMITS.cookieBytes,
  maxRedirects = HTTP_LIMITS.redirects, onLog = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  positiveLimit(maxResponseBytes); positiveLimit(maxCookieBytes); positiveLimit(timeoutMs);
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) throw new TypeError('Invalid redirect limit');
  const trusted = trustedOrigin === null ? null : parseUrl(trustedOrigin);
  if (trusted && (trusted.pathname !== '/' || trusted.search || trusted.hash)) {
    throw fail('endpoint_untrusted', 'Trust configuration must be an origin');
  }
  function validateTarget(value) {
    const url = parseUrl(value);
    const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
    if (!trusted || url.origin !== trusted.origin
      || (url.protocol !== 'https:' && !(allowInsecureLoopback && loopback))) {
      throw fail('endpoint_untrusted', 'Platform endpoint is outside the trusted HTTPS origin');
    }
    return url;
  }
  for (const descriptor of Object.values(endpoints)) validateTarget(descriptor.url);
  const jar = createCookieJar({ origin: trusted?.origin ?? null, maxBytes: maxCookieBytes });

  return {
    jar,
    useSecret(secret) {
      jar.clear();
      jar.absorb(secret);
      return jar.size();
    },
    hasEndpoint(role) { return Boolean(endpoints[role]); },
    roles() { return Object.keys(endpoints); },
    async request({ role, params = {}, signal = null } = {}) {
      if (signal?.aborted) throw fail('cancelled', 'Platform request was cancelled');
      const descriptor = endpoints[role];
      if (!descriptor) throw fail('endpoint_unconfigured', `No endpoint is configured for role "${role}"`);
      let url = validateTarget(descriptor.url);
      const query = descriptor.query ? descriptor.query(params) : params;
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null && typeof value !== 'object') url.searchParams.set(key, String(value));
      }
      let method = (descriptor.method ?? (descriptor.body ? 'POST' : 'GET')).toUpperCase();
      const baseHeaders = new Headers({ 'user-agent': userAgent, accept: 'application/json', ...(descriptor.headers ?? {}) });
      for (const name of ['cookie', 'cookie2', 'authorization', 'proxy-authorization', 'host']) {
        if (baseHeaders.has(name)) throw fail('endpoint_untrusted', 'Platform credentials must use the scoped cookie jar');
      }
      const qr = role === 'loginQr' || role === 'loginPoll';
      const cookieEnabled = descriptor.includeCookies !== false;
      const requestJar = qr ? createCookieJar({ origin: trusted.origin, maxBytes: maxCookieBytes }) : jar;
      let payload;
      if (descriptor.body) {
        const body = descriptor.body(params);
        if (body !== null && body !== undefined) {
          const encoded = new URLSearchParams();
          for (const [key, value] of Object.entries(body)) {
            if (value !== undefined && value !== null) encoded.set(key, String(value));
          }
          payload = encoded.toString();
          baseHeaders.set('content-type', 'application/x-www-form-urlencoded');
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      try {
        onLog({ type: 'platform-request', role, provider: 'http' });
        for (let hop = 0; ; hop++) {
          const headers = new Headers(baseHeaders);
          const cookie = cookieEnabled && !qr ? requestJar.header(url) : null;
          if (cookie) headers.set('cookie', cookie);
          const response = await fetchImpl(url, { method, headers, body: payload, signal: controller.signal, redirect: 'manual', credentials: 'omit' });
          if (response.redirected) {
            await response.body?.cancel();
            throw fail('redirect_blocked', 'Platform fetch followed an unexpected redirect');
          }
          if (response.url) {
            try { validateTarget(response.url); }
            catch (error) { await response.body?.cancel(); throw error; }
          }
          const location = response.headers.get('location');
          let next = null;
          if (REDIRECTS.has(response.status) && location !== null) {
            try {
              next = validateTarget(new URL(location, url));
              if (hop >= maxRedirects) throw fail('redirect_limit', 'Platform redirect limit exceeded');
            } catch (error) { await response.body?.cancel(); throw error; }
          }
          const setCookie = cookieEnabled ? response.headers.getSetCookie() : [];
          if (next) {
            await response.body?.cancel();
            requestJar.absorb(setCookie, url);
            if ((response.status === 303 && method !== 'HEAD') || ([301, 302].includes(response.status) && method === 'POST')) {
              method = 'GET'; payload = undefined; baseHeaders.delete('content-type');
            }
            url = next;
            continue;
          }
          const text = await readBoundedBody(response, maxResponseBytes);
          let body = text;
          if ((response.headers.get('content-type') ?? '').includes('json') || /^\s*[[{]/.test(text)) {
            try { body = JSON.parse(text); } catch { /* preserve platform failures */ }
          }
          if (body && typeof body === 'object' && body.cookie) {
            const candidate = createCookieJar({ maxBytes: maxCookieBytes });
            candidate.absorb(body.cookie);
          }
          requestJar.absorb(setCookie, url);
          if (setCookie.length) onLog({ type: 'transport', role, cookies: setCookie.length });
          const secret = cookieEnabled ? requestJar.toSecret(url) : '';
          if (body && typeof body === 'object' && !body.cookie && secret) body.cookie = secret;
          return { status: response.status, body, url: url.toString(), cookies: secret };
        }
      } catch (error) {
        if (signal?.aborted) throw fail('cancelled', 'Platform request was cancelled');
        if (error instanceof MusicError) throw error;
        // Discard raw fetch errors: they may include a URL or credential.
        throw Object.assign(new Error('Platform HTTP request failed'), {
          code: controller.signal.aborted || error.name === 'AbortError' ? 'ETIMEDOUT' : 'ECONNRESET',
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** Syntactic map validation; trust is checked separately by the transport. */
export function assertEndpointMap(endpoints, { provider, required = [] } = {}) {
  if (!endpoints || typeof endpoints !== 'object') throw new Error(`${provider}: an endpoint map is required`);
  for (const role of required) {
    const descriptor = endpoints[role];
    if (!descriptor) throw new Error(`${provider}: endpoint role "${role}" is missing`);
    if (typeof descriptor.url !== 'string' || !/^https?:\/\//.test(descriptor.url)) {
      throw new Error(`${provider}: endpoint role "${role}" needs an http(s) url`);
    }
    parseUrl(descriptor.url);
  }
  return true;
}
