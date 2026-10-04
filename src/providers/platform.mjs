// The shared provider state machine, used by every platform adapter.
//
// PROJECT_PLAN requires P2 and P4 to pass the same normalized contract checks,
// and the cheapest way to guarantee that is for both to run this one
// implementation. Platform differences are confined to two places:
//
//   roles   — which transport roles exist and how to call them;
//   parse   — how that platform's response body maps onto normalized values.
//
// `parse` is explicitly where unverified platform knowledge lives. Nothing in
// this file claims a wire format: it only guarantees that, whatever the
// platform answers, the adapter reports account state, capabilities and errors
// honestly.
import { MusicError, trackId } from '../contracts.mjs';
import { capability, needsLogin, unavailable, mapTransportError, toTrack } from './contract.mjs';

/**
 * @param {object} options
 * @param {'netease'|'qq'} options.provider
 * @param {object} options.transport `request({ role, params, signal })` → `{ status, body }`
 * @param {object} options.parse     platform response parsers (see below)
 * @param {object} options.seedSources ordered source descriptors
 * @param {object} [options.labels]  human phrases used in reasons
 */
export function createPlatformProvider({
  provider: providerName,
  transport,
  parse,
  seedSources,
  credentials = null,
  store = null,
  accountRef = `fishfm/${providerName}`,
  now = () => Date.now(),
  labels = {},
  displayName = providerName,
} = {}) {
  if (!transport || typeof transport.request !== 'function') {
    throw new Error('A transport with request({ role, params, signal }) is required');
  }
  if (!parse || typeof parse !== 'object') throw new Error('A parse configuration is required');
  if (!seedSources || !Object.keys(seedSources).length) throw new Error('At least one seed source is required');

  const phrase = {
    connect: `connect your ${displayName} account`,
    import: `import your ${displayName} music`,
    search: `search ${displayName}`,
    play: `play ${displayName} audio`,
    recommend: `fetch ${displayName} recommendations`,
    ...labels,
  };
  const seedOrder = Object.keys(seedSources);

  let pendingLogin = null;
  let loginVersion = 0;
  let lastError = null;
  let cachedSecret;
  const noted = { seedSource: null, seedReason: null, seedDegraded: false, recommendation: null, lastResolveAt: null };

  const readSecret = () => {
    if (cachedSecret !== undefined) return cachedSecret;
    if (!credentials?.read) return null;
    try {
      cachedSecret = credentials.read(accountRef) ?? null;
      if (cachedSecret) transport.useSecret?.(cachedSecret);
      return cachedSecret;
    } catch (error) {
      cachedSecret = null;
      lastError = `credential read failed: ${error.message}`;
      return null;
    }
  };

  const persistCredential = (secret, { accountId = null } = {}) => {
    if (!credentials?.write) throw new MusicError('credential_store_unavailable', 'No credential store is configured');
    credentials.write(accountRef, secret);
    cachedSecret = secret;
    transport.useSecret?.(secret);
    // Only the reference is recorded; the secret itself never reaches SQLite.
    store?.setCredentialReference({
      provider: providerName, accountId, credentialRef: accountRef, state: 'authorized', updatedAt: now(),
    });
  };

  const forgetCredential = () => {
    try {
      credentials?.delete?.(accountRef);
    } catch { /* already gone is the desired end state */ }
    store?.removeCredentialReference(providerName);
  };

  const authorized = () => {
    const reference = store?.getCredentialReference?.(providerName) ?? null;
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
      const body = response?.body ?? response;
      parse.validateResponse?.(body, role);
      return body;
    } catch (error) {
      const mapped = mapTransportError(error, { provider: providerName });
      // A platform answer of "not authorised" means the stored sign-in is no
      // longer usable. Saying so once is better than continuing to report
      // `authorized` until some later explicit restore() notices.
      if (mapped.code === 'login_required' && role !== (parse.loginQrRole ?? 'loginQr')
        && role !== (parse.loginPollRole ?? 'loginPoll') && store?.setCredentialReference && authorized()) {
        lastError = 'the platform rejected the stored sign-in';
        store.setCredentialReference({
          provider: providerName, accountId: null, credentialRef: accountRef, state: 'expired', updatedAt: now(),
        });
      }
      throw mapped;
    }
  }

  /** Runs one seed source, which may need more than one platform call. */
  async function fetchSource(source, { limit, signal, playlistId = null }) {
    const descriptor = seedSources[source];
    if (!descriptor) throw new MusicError('invalid_command', `Unknown seed source ${source}`);
    const steps = descriptor.steps ?? [{ role: descriptor.role, params: descriptor.params, parse: descriptor.parse }];
    let context = { playlistId };
    let entries = [];
    const stages = [];
    for (const step of steps) {
      const stage = step.stage ?? step.role;
      const params = typeof step.params === 'function' ? step.params({ limit, ...context }) : (step.params ?? {});
      if (params === null) {
        stages.push({ stage, status: 'skipped', count: 0 });
        return { tracks: [], stages };
      }
      let body;
      let parsed;
      try {
        body = await call(step.role, params, { signal });
        parsed = step.parse(body, { limit, ...context });
      } catch (error) {
        error.details = { ...(error.details ?? {}), stage: error.details?.stage ?? stage };
        error.seedStages = stages;
        throw error;
      }
      stages.push({ stage, status: 'ok', count: Array.isArray(parsed) ? parsed.length : null });
      if (step.collect === false) context = { ...context, ...parsed };
      else entries = parsed;
    }
    return { tracks: normalizeList(entries), stages, sourceRef: source==='playlist' ? String(context.playlistId??'') : '' };
  }

  function normalizeList(entries) {
    if (!Array.isArray(entries)) return [];
    const seen = new Set();
    const tracks = [];
    for (const entry of entries) {
      // Playlist entries usually wrap the song under `track`.
      const track = toTrack(providerName, entry?.track ?? entry);
      if (!track) continue;
      const key = trackId(track);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
    }
    return tracks;
  }

  const provider = {
    name: providerName,

    getAccount() {
      if (pendingLogin) return { status: 'login_required', pending: true, hint: 'scan the QR code to continue' };
      const reference = store?.getCredentialReference?.(providerName) ?? null;
      if (reference && (reference.state === 'expired' || reference.state === 'revoked')) {
        return {
          status: reference.state === 'expired' ? 'expired' : 'login_required',
          reason: 'the stored sign-in is no longer usable',
        };
      }
      if (authorized()) {
        return { status: 'authorized', accountId: reference?.account_id ?? null, credentialRef: accountRef };
      }
      if (lastError) return { status: 'error', reason: lastError };
      return { status: 'login_required', reason: `no sign-in is stored for ${displayName}` };
    },

    getCapabilities() {
      const account = provider.getAccount();
      const signedIn = account.status === 'authorized';
      const loggedOut = account.status === 'login_required' || account.status === 'expired';
      return {
        account: signedIn
          ? capability('available', { accountId: account.accountId ?? null })
          : loggedOut
            ? needsLogin(phrase.connect)
            : unavailable(account.reason ?? 'the account state is unknown'),
        seed: signedIn
          ? noted.seedSource
            ? capability(noted.seedDegraded ? 'degraded' : 'available', {
              source: noted.seedSource, reason: noted.seedReason,
            })
            : noted.seedReason
              // An import ran and failed: claiming "no import has run yet"
              // would hide the failure the user needs to see.
              ? capability('unavailable', { source: null, reason: noted.seedReason })
              : capability('available', { source: null, reason: 'no import has run yet' })
          : needsLogin(phrase.import),
        search: signedIn ? capability('available') : needsLogin(phrase.search),
        resolve: signedIn ? capability('available') : needsLogin(phrase.play),
        recommendation: noted.recommendation
          ?? (signedIn ? unavailable('the recommendation surface is not implemented yet') : needsLogin(phrase.recommend)),
      };
    },

    // ---- account lifecycle ----

    async beginLogin(options = {}) {
      const version = ++loginVersion;
      pendingLogin = null;
      const body = await call(parse.loginQrRole ?? 'loginQr', { timestamp: now() }, options);
      if (version !== loginVersion) throw new MusicError('cancelled', 'This sign-in attempt has been replaced');
      const started = parse.loginQr(body);
      pendingLogin = { key: started.key ?? null, startedAt: now() };
      return { qrImage: started.qrImage ?? null, qrUrl: started.qrUrl ?? null, key: pendingLogin.key };
    },

    async pollLogin(options = {}) {
      const attempt = pendingLogin;
      if (!attempt) throw new MusicError('invalid_command', 'No sign-in is in progress');
      const state = attempt.confirmed ?? parse.loginPoll(await call(parse.loginPollRole ?? 'loginPoll',
        { key: attempt.key, timestamp: now() }, options));
      if (pendingLogin !== attempt) throw new MusicError('cancelled', 'This sign-in attempt has been replaced');
      if (state.status === 'expired') {
        pendingLogin = null;
        return { status: 'expired', code: state.code ?? null };
      }
      if (state.status !== 'authorized') {
        return { status: state.status, code: state.code ?? null };
      }
      if (!state.secret) {
        state.secret = transport.jar?.toSecret?.() ?? null;
      }
      if (!state.secret) {
        throw new MusicError('provider_failure', `${displayName} confirmed the sign-in but sent no session material`);
      }
      // Keep confirmed session material private while verifying it. Failed
      // verification neither overwrites a working credential nor consumes the
      // QR result; a retry verifies the candidate without polling again.
      attempt.confirmed = state;
      const verified = typeof parse.validateLogin === 'function' ? await parse.validateLogin(state, options) : state;
      if (pendingLogin !== attempt) throw new MusicError('cancelled', 'This sign-in attempt has been replaced');
      if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
      persistCredential(verified.secret ?? state.secret, { accountId: verified.accountId ?? state.accountId ?? null });
      pendingLogin = null;
      lastError = null;
      return { status: 'authorized', accountId: verified.accountId ?? state.accountId ?? null };
    },

    async restore(options = {}) {
      if (!authorized()) return { status: provider.getAccount().status };
      try {
        const body = await call('accountInfo', { timestamp: now() }, options);
        const accountId = parse.accountId(body);
        if (accountId !== null) {
          store?.setCredentialReference({
            provider: providerName, accountId: String(accountId), credentialRef: accountRef,
            state: 'authorized', updatedAt: now(),
          });
        }
        return { status: 'authorized', accountId: accountId === null ? null : String(accountId) };
      } catch (error) {
        if (error.code === 'login_required') {
          store?.setCredentialReference({
            provider: providerName, accountId: null, credentialRef: accountRef, state: 'expired', updatedAt: now(),
          });
          return { status: 'expired' };
        }
        throw error;
      }
    },

    async logout() {
      ++loginVersion;
      forgetCredential();
      cachedSecret = null;
      transport.useSecret?.('');
      pendingLogin = null;
      noted.seedSource = null;
      noted.seedReason = null;
      return { status: 'login_required' };
    },

    // ---- seed ----

    /**
     * Tries the sources in their documented order and reports the one that
     * actually worked. A fallback is labelled degraded; it is never presented
     * as the preferred source.
     */
    async getSeedTracks({ limit = 300, source = null, signal = null, playlistId = null } = {}) {
      if (!authorized()) throw new MusicError('login_required', `Sign in to ${displayName} before importing`);

      const order = source ? [source] : seedOrder;
      const attempts = [];
      for (const candidate of order) {
        try {
          const fetched = await fetchSource(candidate, { limit, signal, playlistId });
          const tracks = fetched.tracks;
          if (!tracks.length) {
            attempts.push({ source: candidate, count: 0, ok: false, code: 'empty_result',
              stage: fetched.stages.at(-1)?.stage ?? null, stages: fetched.stages,
              reason: '网易云此来源没有返回可用曲目。' });
            continue;
          }
          attempts.push({ source: candidate, count: tracks.length, ok: true, code: null,
            stage: null, stages: fetched.stages, reason: null });
          noted.seedSource = candidate;
          noted.seedDegraded = !source && candidate !== seedOrder[0];
          noted.seedReason = !noted.seedDegraded
            ? null
            : `${phrase.firstSource ?? seedOrder[0]} was unavailable, so ${candidate} was used instead`;
          return {
            source: candidate,
            sourceRef: fetched.sourceRef,
            tracks,
            requested: limit,
            imported: tracks.length,
            degraded: noted.seedDegraded,
            attempts,
            reason: noted.seedReason,
          };
        } catch (error) {
          attempts.push({ source: candidate, count: 0, ok: false, code: error.code ?? 'error',
            stage: error.details?.stage ?? null, httpStatus: error.details?.httpStatus ?? null,
            platformCode: error.details?.platformCode ?? null, stages: error.seedStages ?? [],
            reason: error.message });
          if (error.code === 'login_required') throw error;
        }
      }

      noted.seedSource = null;
      noted.seedReason = attempts.map((row) => `${row.source}: ${row.code ?? 'error'}: ${row.reason}`).join('; ');
      throw new MusicError('provider_failure', `No ${displayName} seed source was usable (${noted.seedReason})`,
        { retryable: true, details: { attempts } });
    },

    // ---- search and resolve ----

    async search(query, { limit = 20, signal = null } = {}) {
      if (!authorized()) throw new MusicError('login_required', `Sign in to ${displayName} before searching`);
      if (typeof query !== 'string' || !query.trim()) {
        throw new MusicError('invalid_command', 'A search query is required');
      }
      const params = parse.searchParams ? parse.searchParams({ query, limit }) : { keywords: query, limit };
      const body = await call('search', params, { signal });
      return { query, tracks: normalizeList(parse.search(body)), capability: capability('available') };
    },

    /**
     * Resolves a track to a playable handle. The handle goes to the caller and
     * nowhere else: it is never written to storage.
     */
    async resolve(track, { signal = null, version = null } = {}) {
      if (!track || track.provider !== providerName) {
        throw new MusicError('invalid_command', `This adapter only resolves ${providerName} tracks`);
      }
      if (!authorized()) throw new MusicError('login_required', `Sign in to ${displayName} before playing`);

      const params = parse.resolveParams
        ? parse.resolveParams({ track })
        : { id: track.providerTrackId };
      const body = await call('resolve', params, { signal });
      const resolved = parse.playUrl(body);
      if (!resolved?.url) {
        // A track that exists but cannot be played is a distinct, honest answer:
        // it is not a network failure and must not look like one.
        throw new MusicError('media_unavailable',
          resolved?.reason ?? `${displayName} did not return a playable URL (the track may need a subscription or be region limited)`);
      }
      noted.lastResolveAt = now();
      const expiresAt = Number.isSafeInteger(resolved.expiresAt)
        ? resolved.expiresAt
        : (Number.isSafeInteger(resolved.expiresInSeconds) ? now() + resolved.expiresInSeconds * 1000 : null);
      return { handle: resolved.url, expiresAt, version };
    },
  };

  return provider;
}
