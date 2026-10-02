// The real HTTP transport the platform adapters run on.
//
// Endpoints are *configuration*, never defaults: this file contains no platform
// URL, so it cannot be mistaken for a verified integration. P3 supplies the
// endpoint map together with a signed-in account, and everything here has been
// exercised against a local HTTP server in the tests.
//
// Session material flows one way: responses may carry `Set-Cookie`, the
// transport keeps it in a jar and hands the caller a `cookie` string. The
// adapter decides to store it in the credential store; the transport itself
// persists nothing.
import { MusicError } from '../contracts.mjs';

/** A minimal cookie jar: enough for a single signed-in user, nothing more. */
export function createCookieJar() {
  const cookies = new Map();
  return {
    /** Accepts `a=1; b=2` as well as a list of cookie objects. */
    absorb(input) {
      if (!input) return;
      if (Array.isArray(input)) {
        for (const item of input) absorbOne(item);
        return;
      }
      if (typeof input === 'string') {
        for (const part of input.split(';')) absorbOne(part.trim());
      }
    },
    header() {
      if (!cookies.size) return null;
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    toSecret() { return this.header() ?? ''; },
    clear() { cookies.clear(); },
    size() { return cookies.size; },
  };

  function absorbOne(item) {
    if (!item) return;
    const pair = typeof item === 'string' ? item : String(item);
    const index = pair.indexOf('=');
    if (index <= 0) return;
    const name = pair.slice(0, index).trim();
    // Attributes such as Path/HttpOnly are not part of the value.
    const value = pair.slice(index + 1).split(';')[0].trim();
    if (!name || /^(path|domain|expires|max-age|httponly|secure|samesite)$/i.test(name)) return;
    cookies.set(name, value);
  }
}

/**
 * Creates the transport.
 *
 * @param {object} options
 * @param {Record<string, object>} options.endpoints role → descriptor:
 *   `{ url, method?, query?(params), body?(params), headers?, includeCookies? }`
 * @param {Function} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export function createHttpTransport({
  endpoints = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  userAgent = 'FishFM/0.1 (+local music persona)',
  jar = createCookieJar(),
  onLog = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  const transport = {
    jar,

    /** Loads a stored session back into the jar after a restart. */
    useSecret(secret) {
      jar.clear();
      jar.absorb(secret);
      return jar.size();
    },

    hasEndpoint(role) { return Boolean(endpoints[role]); },

    roles() { return Object.keys(endpoints); },

    async request({ role, params = {}, signal = null } = {}) {
      const descriptor = endpoints[role];
      if (!descriptor) {
        // Naming the missing role is the honest answer: it means this build was
        // not configured for that operation, not that the platform failed.
        throw new MusicError('endpoint_unconfigured', `No endpoint is configured for role "${role}"`);
      }

      const url = new URL(descriptor.url);
      const query = descriptor.query ? descriptor.query(params) : params;
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value === undefined || value === null || typeof value === 'object') continue;
        url.searchParams.set(key, String(value));
      }

      const method = (descriptor.method ?? (descriptor.body ? 'POST' : 'GET')).toUpperCase();
      onLog({ type: 'platform-request', role, provider: 'http' });
      const headers = { 'user-agent': userAgent, accept: 'application/json', ...(descriptor.headers ?? {}) };
      const cookie = jar.header();
      if (cookie && descriptor.includeCookies !== false) headers.cookie = cookie;

      let payload;
      if (descriptor.body) {
        payload = descriptor.body(params);
        if (payload !== null && payload !== undefined) {
          const encoded = new URLSearchParams();
          for (const [key, value] of Object.entries(payload)) {
            if (value === undefined || value === null) continue;
            encoded.set(key, String(value));
          }
          payload = encoded.toString();
          headers['content-type'] = 'application/x-www-form-urlencoded';
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (signal?.addEventListener) signal.addEventListener('abort', () => controller.abort(), { once: true });

      let response;
      try {
        response = await fetchImpl(url, { method, headers, body: payload, signal: controller.signal, redirect: 'follow' });
      } catch (error) {
        // Surfaced as a transport-level failure; the adapter maps it to the
        // project's error vocabulary.
        throw Object.assign(new Error(`request to ${role} failed: ${error.message}`), {
          code: error.name === 'AbortError' ? 'ETIMEDOUT' : (error.code ?? 'ECONNRESET'),
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }

      // Capture the session before parsing, so a login response cannot be lost
      // because its body shape was unexpected.
      const setCookie = response.headers?.getSetCookie?.() ?? [];
      if (setCookie.length) {
        jar.absorb(setCookie);
        onLog({ type: 'transport', role, cookies: setCookie.length });
      }

      const text = await response.text();
      let body = text;
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (contentType.includes('json') || /^\s*[[{]/.test(text)) {
        try { body = JSON.parse(text); } catch { /* keep the raw text */ }
      }

      // A confirmed sign-in arrives as a cookie; expose it the same way a body
      // field would be, so the adapter's parser has one shape to handle.
      if (typeof body === 'object' && body !== null && !body.cookie && jar.size()) {
        body.cookie = jar.toSecret();
      }

      return { status: response.status, body, url: url.toString(), cookies: jar.toSecret() };
    },
  };

  return transport;
}

/**
 * Endpoint maps are deployment data. This validates a map before use so a
 * misconfiguration fails at startup instead of mid-song.
 */
export function assertEndpointMap(endpoints, { provider, required = [] } = {}) {
  if (!endpoints || typeof endpoints !== 'object') throw new Error(`${provider}: an endpoint map is required`);
  for (const role of required) {
    const descriptor = endpoints[role];
    if (!descriptor) throw new Error(`${provider}: endpoint role "${role}" is missing`);
    if (typeof descriptor.url !== 'string' || !/^https?:\/\//.test(descriptor.url)) {
      throw new Error(`${provider}: endpoint role "${role}" needs an http(s) url`);
    }
  }
  return true;
}
