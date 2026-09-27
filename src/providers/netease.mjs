// NetEase Cloud Music adapter (P2).
//
// Scope note, deliberately explicit: this module implements the adapter's own
// behaviour — account lifecycle, capability honesty, seed-source fallback,
// response normalization, error mapping, and the rule that a resolved handle is
// never persisted. It does NOT assert that any particular endpoint shape is
// correct. Endpoint roles are supplied as configuration by the transport, and
// docs/spikes/P2-netease.md records which parts still need a real account to
// confirm (P0-02 / P3). Nothing here has been verified against the live service.
import { MusicError, normalizeTrack, trackId } from '../contracts.mjs';
import {
  capability, needsLogin, unavailable, mapTransportError, toTrack,
  ACCOUNT_STATES, REQUIRED_CAPABILITIES,
} from './contract.mjs';

export const NETEASE = 'netease';

/**
 * Endpoint roles the transport must be able to serve. These are role names, not
 * URLs: the real wire format is confirmed during P3 and stays out of this file
 * so nothing here claims a verified platform API.
 */
export const NETEASE_ROLES = Object.freeze([
  'loginQr', 'loginPoll', 'accountInfo',
  'recentTracks', 'likedTracks', 'playlists', 'playlistTracks',
  'search', 'songUrl',
]);

/** Seed sources in the order the plan prefers, with the documented fallback. */
export const NETEASE_SEED_ORDER = Object.freeze(['recent', 'liked', 'playlist']);

function requireTransport(transport) {
  if (!transport || typeof transport.request !== 'function') {
    throw new Error('A transport with request({ role, params, signal }) is required');
  }
  return transport;
}

/**
 * Creates the NetEase provider.
 *
 * @param {object} options
 * @param {object} options.transport   `request({ role, params, signal })` -> `{ status, body, cookies? }`
 * @param {object} [options.credentials] `read(ref)`, `write(ref, secret)`, `delete(ref)`
 * @param {object} [options.store]     MusicStore; holds the credential reference only
 * @param {string} [options.accountRef] key the credential lives under
 * @param {Function} [options.now]
 */
export function createNetEaseProvider({
  transport,
  credentials = null,
  store = null,
  accountRef = 'fishfm/netease',
  now = () => Date.now(),
  seedOrder = NETEASE_SEED_ORDER,
} = {}) {
  requireTransport(transport);

  // Session material stays in memory between calls and is only ever written
  // through the credential store; it never enters SQLite.
  let pendingLogin = null;
  let lastError = null;
  const noted = {
    seedSource: null, seedReason: null, recommendation: null, lastResolveAt: null,
  };

  const readSecret = () => {
    if (!credentials?.read) return null;
    try {
      return credentials.read(accountRef) ?? null;
    } catch (error) {
      lastError = `credential read failed: ${error.message}`;
      return null;
    }
  };

  const persistCredential = (secret, { accountId = null } = {}) => {
    if (!credentials?.write) throw new MusicError('credential_store_unavailable', 'No credential store is configured');
    credentials.write(accountRef, secret);
    // Only the reference is recorded here, never the secret itself.
    store?.setCredentialReference({
      provider: NETEASE, accountId, credentialRef: accountRef, state: 'authorized', updatedAt: now(),
    });
  };

  const forgetCredential = () => {
    try {
      credentials?.delete?.(accountRef);
    } catch { /* an already-gone credential is the desired end state */ }
    store?.removeCredentialReference(NETEASE);
  };

  const authorized = () => {
    const reference = store?.getCredentialReference?.(NETEASE) ?? null;
    if (!reference) return false;
    if (reference.state === 'expired' || reference.state === 'revoked') return false;
    return Boolean(readSecret());
  };

  async function call(role, params = {}, options = {}) {
    try {
      const response = await transport.request({ role, params, signal: options.signal ?? null });
      if (response?.status && response.status >= 400) {
        throw Object.assign(new Error(`transport status ${response.status}`), { status: response.status });
      }
      return response?.body ?? response;
    } catch (error) {
      throw mapTransportError(error, { provider: NETEASE });
    }
  }

  const provider = {
    name: NETEASE,

    getAccount() {
      if (pendingLogin) return { status: 'login_required', pending: true, hint: 'scan the QR code to continue' };
      const reference = store?.getCredentialReference?.(NETEASE) ?? null;
      if (reference && (reference.state === 'expired' || reference.state === 'revoked')) {
        return { status: reference.state === 'expired' ? 'expired' : 'login_required', reason: 'the stored sign-in is no longer usable' };
      }
      if (authorized()) {
        return { status: 'authorized', accountId: reference?.account_id ?? null, credentialRef: accountRef };
      }
      if (lastError) return { status: 'error', reason: lastError };
      return { status: 'login_required', reason: 'no sign-in is stored for NetEase' };
    },

    getCapabilities() {
      const account = provider.getAccount();
      const signedIn = account.status === 'authorized';
      const loggedOut = account.status === 'login_required' || account.status === 'expired';
      return {
        account: signedIn
          ? capability('available', { accountId: account.accountId ?? null })
          : loggedOut
            ? needsLogin('connect your NetEase account')
            : unavailable(account.reason ?? 'the account state is unknown'),
        seed: signedIn
          ? noted.seedSource
            ? capability(noted.seedSource === seedOrder[0] ? 'available' : 'degraded', {
              source: noted.seedSource, reason: noted.seedReason,
            })
            : noted.seedReason
              // An import ran and failed: saying "no import has run yet" here
              // would hide the failure the user needs to see.
              ? capability('unavailable', { source: null, reason: noted.seedReason })
              : capability('available', { source: null, reason: 'no import has run yet' })
          : needsLogin('import your recent music'),
        search: signedIn ? capability('available') : needsLogin('search NetEase'),
        resolve: signedIn ? capability('available') : needsLogin('play NetEase audio'),
        // Recommendations are a separate platform surface and are allowed to be
        // unavailable without breaking playback; the selector then records that
        // no exploration happened.
        recommendation: noted.recommendation
          ?? (signedIn
            ? unavailable('the recommendation surface is not implemented yet')
            : needsLogin('fetch NetEase recommendations')),
      };
    },

    // ---- account lifecycle ----

    /** Starts a QR sign-in. The pending key lives in memory only. */
    async beginLogin(options = {}) {
      const body = await call('loginQr', { timestamp: now() }, options);
      pendingLogin = { key: body?.key ?? null, startedAt: now() };
      return { qrImage: body?.qrImage ?? body?.qrimg ?? null, qrUrl: body?.qrUrl ?? body?.url ?? null, key: pendingLogin.key };
    },

    /**
     * Polls the pending sign-in once. On success the session material is handed
     * to the credential store; the caller never sees it.
     */
    async pollLogin(options = {}) {
      if (!pendingLogin) throw new MusicError('invalid_command', 'No sign-in is in progress');
      const body = await call('loginPoll', { key: pendingLogin.key, timestamp: now() }, options);
      const code = body?.code ?? body?.status ?? null;
      if (code === 800 || code === 'expired') {
        pendingLogin = null;
        return { status: 'expired' };
      }
      if (code === 801 || code === 'waiting') return { status: 'waiting' };
      if (code === 802 || code === 'scanned') return { status: 'scanned' };
      if (code !== 803 && code !== 'confirmed' && !body?.cookie) {
        return { status: 'waiting', code };
      }

      const secret = body?.cookie ?? null;
      if (!secret) throw new MusicError('provider_failure', 'NetEase confirmed the sign-in but sent no session material');
      persistCredential(secret, { accountId: body?.accountId ?? body?.userId ?? null });
      pendingLogin = null;
      lastError = null;
      return { status: 'authorized', accountId: body?.accountId ?? null };
    },

    /** Restores a stored sign-in, validating it against the platform. */
    async restore(options = {}) {
      if (!authorized()) return { status: provider.getAccount().status };
      try {
        const body = await call('accountInfo', { timestamp: now() }, options);
        const accountId = body?.accountId ?? body?.userId ?? body?.profile?.userId ?? null;
        if (accountId !== null) {
          store?.setCredentialReference({
            provider: NETEASE, accountId: String(accountId), credentialRef: accountRef, state: 'authorized', updatedAt: now(),
          });
        }
        return { status: 'authorized', accountId: accountId === null ? null : String(accountId) };
      } catch (error) {
        if (error.code === 'login_required') {
          store?.setCredentialReference({
            provider: NETEASE, accountId: null, credentialRef: accountRef, state: 'expired', updatedAt: now(),
          });
          return { status: 'expired' };
        }
        throw error;
      }
    },

    /** Signs out and removes the stored session material. */
    async logout() {
      forgetCredential();
      pendingLogin = null;
      noted.seedSource = null;
      noted.seedReason = null;
      return { status: 'login_required' };
    },

    // ---- seed ----

    /**
     * Imports seed tracks, trying the preferred sources in order and recording
     * which one actually worked. A degraded source is reported as degraded; it
     * is never labelled as recent playback.
     */
    async getSeedTracks({ limit = 300, source = null, signal = null } = {}) {
      if (!authorized()) throw new MusicError('login_required', 'Sign in to NetEase before importing');

      const order = source ? [source] : seedOrder;
      const attempts = [];
      for (const candidate of order) {
        try {
          const tracks = await fetchSource(candidate, { limit, signal });
          if (!tracks.length) {
            attempts.push({ source: candidate, count: 0, ok: false, reason: 'the platform returned nothing' });
            continue;
          }
          // The successful attempt is part of the record too, so the trail shows
          // exactly what was tried and what worked.
          attempts.push({ source: candidate, count: tracks.length, ok: true, reason: null });
          noted.seedSource = candidate;
          noted.seedReason = candidate === seedOrder[0]
            ? null
            : `Recent playback was unavailable, so ${candidate} was used instead`;
          return {
            source: candidate,
            tracks,
            requested: limit,
            imported: tracks.length,
            degraded: candidate !== seedOrder[0],
            attempts,
            reason: noted.seedReason,
          };
        } catch (error) {
          attempts.push({ source: candidate, count: 0, ok: false, reason: `${error.code ?? 'error'}: ${error.message}` });
          if (error.code === 'login_required') throw error;
        }
      }

      noted.seedSource = null;
      noted.seedReason = attempts.map((row) => `${row.source}: ${row.reason}`).join('; ');
      throw new MusicError('provider_failure', `No NetEase seed source was usable (${noted.seedReason})`,
        { retryable: true, details: { attempts } });
    },

    // ---- search and resolve ----

    async search(query, { limit = 20, signal = null } = {}) {
      if (!authorized()) throw new MusicError('login_required', 'Sign in to NetEase before searching');
      if (typeof query !== 'string' || !query.trim()) {
        throw new MusicError('invalid_command', 'A search query is required');
      }
      const body = await call('search', { keywords: query, limit }, { signal });
      const entries = body?.songs ?? body?.result?.songs ?? [];
      const seen = new Set();
      const tracks = [];
      for (const entry of entries) {
        const track = toTrack(NETEASE, entry);
        if (!track) continue;
        const key = trackId(track);
        if (seen.has(key)) continue;
        seen.add(key);
        tracks.push(track);
      }
      return { query, tracks, capability: capability('available') };
    },

    /**
     * Resolves a track to a playable handle. Enforces the contract rule: the
     * handle is returned to the caller and never written to storage.
     */
    async resolve(track, { signal = null, version = null } = {}) {
      if (!track || track.provider !== NETEASE) {
        throw new MusicError('invalid_command', `This adapter only resolves ${NETEASE} tracks`);
      }
      if (!authorized()) throw new MusicError('login_required', 'Sign in to NetEase before playing');

      const body = await call('songUrl', { id: track.providerTrackId, br: 320000 }, { signal });
      const entry = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body);
      const url = entry?.url ?? null;
      if (!url) {
        // A track that exists but cannot be played is a distinct, honest answer:
        // it is not a network failure and must not look like one.
        throw new MusicError('media_unavailable',
          entry?.reason ?? 'NetEase did not return a playable URL (the track may need a subscription or be region limited)');
      }
      noted.lastResolveAt = now();
      const expiresAt = Number.isSafeInteger(entry?.expiresAt)
        ? entry.expiresAt
        : (Number.isSafeInteger(entry?.expi) ? now() + entry.expi * 1000 : null);
      // `version` is echoed for the caller's staleness checks; it is not part of
      // the handle and never reaches storage.
      return { handle: url, expiresAt, version };
    },
  };

  async function fetchSource(source, { limit, signal }) {
    if (source === 'recent') {
      const body = await call('recentTracks', { limit }, { signal });
      return normalizeList(body?.data?.list ?? body?.list ?? body?.songs ?? body?.data ?? []);
    }
    if (source === 'liked') {
      const body = await call('likedTracks', { limit }, { signal });
      return normalizeList(body?.ids ?? body?.data?.ids ?? body?.songs ?? body?.data ?? []);
    }
    if (source === 'playlist') {
      const list = await call('playlists', { limit: 1 }, { signal });
      const first = (list?.playlist ?? list?.data?.playlist ?? [])[0];
      if (!first?.id) return [];
      const body = await call('playlistTracks', { id: first.id, limit }, { signal });
      return normalizeList(body?.songs ?? body?.playlist?.tracks ?? body?.data ?? []);
    }
    throw new MusicError('invalid_command', `Unknown seed source ${source}`);
  }

  function normalizeList(entries) {
    if (!Array.isArray(entries)) return [];
    const seen = new Set();
    const tracks = [];
    for (const entry of entries) {
      // A playlist entry often wraps the song under `track`.
      const track = toTrack(NETEASE, entry?.track ?? entry);
      if (!track) continue;
      const key = trackId(track);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
    }
    return tracks;
  }

  return provider;
}

/** Convenience: which endpoints remain unverified for this adapter. */
export function unverifiedEndpoints() {
  return [...NETEASE_ROLES];
}

export { ACCOUNT_STATES, REQUIRED_CAPABILITIES, normalizeTrack };