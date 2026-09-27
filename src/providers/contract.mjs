// The normalized provider contract, and the conformance checks both platform
// adapters must pass.
//
// PROJECT_PLAN requires P2 and P4 to be checked against the same normalized
// contract, so the checks live here and both adapters run them.
//
// The contract itself (docs/CORE_CONTRACT.md):
//   - a track key is (provider, providerTrackId); the provider is `netease` or `qq`;
//   - `resolve(track, { signal, version })` returns `{ handle, expiresAt? }`, and
//     the handle is only ever handed to Playback: it is never written to SQLite
//     or to a state snapshot;
//   - account status and capability status are explicit, and a missing
//     capability must never be presented as an empty result.
import { MusicError, normalizeTrack } from '../contracts.mjs';

export const PROVIDER_NAMES = Object.freeze(['netease', 'qq']);

/** Account states an adapter may report. */
export const ACCOUNT_STATES = Object.freeze(['login_required', 'authorized', 'expired', 'error']);

/** Capabilities every adapter must account for, available or not. */
export const REQUIRED_CAPABILITIES = Object.freeze(['account', 'seed', 'search', 'resolve', 'recommendation']);

/** Capability states. `degraded` means it works from a different source than asked. */
export const CAPABILITY_STATES = Object.freeze(['available', 'degraded', 'unavailable', 'login_required', 'expired']);

/** The methods the core and the registry call on an adapter. */
export const REQUIRED_METHODS = Object.freeze(['getAccount', 'getCapabilities', 'resolve', 'search', 'getSeedTracks']);

export function capability(status, extra = {}) {
  if (!CAPABILITY_STATES.includes(status)) throw new Error(`Unknown capability status ${status}`);
  return { status, ...extra };
}

/** A capability that exists but needs a signed-in account. */
export function needsLogin(what) {
  return capability('login_required', { reason: `Sign in to ${what}` });
}

/** A capability this build genuinely cannot provide, with the real reason. */
export function unavailable(reason) {
  return capability('unavailable', { reason });
}

/**
 * Structural check: does this object even look like an adapter? Throws so a
 * wiring mistake fails loudly instead of silently returning empty results.
 */
export function assertProviderShape(adapter, name) {
  if (!adapter || typeof adapter !== 'object') throw new Error(`${name}: adapter must be an object`);
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') throw new Error(`${name}: adapter is missing ${method}()`);
  }
  const account = adapter.getAccount();
  if (!account || !ACCOUNT_STATES.includes(account.status)) {
    throw new Error(`${name}: getAccount() must report one of ${ACCOUNT_STATES.join(', ')}`);
  }
  const capabilities = adapter.getCapabilities();
  for (const required of REQUIRED_CAPABILITIES) {
    const entry = capabilities?.[required];
    if (!entry || !CAPABILITY_STATES.includes(entry.status)) {
      throw new Error(`${name}: capability ${required} must report one of ${CAPABILITY_STATES.join(', ')}`);
    }
    if (entry.status !== 'available' && !entry.reason) {
      throw new Error(`${name}: capability ${required} is ${entry.status} but gives no reason`);
    }
  }
  return true;
}

/**
 * Runs the shared contract checks against a provider.
 *
 * `fixture` supplies whatever the adapter needs to work (a transport, canned
 * payloads, credentials). Checks that cannot run without a live account are
 * reported as skipped with the reason, never as passed.
 */
export async function runProviderConformance({ provider, name, fixture = {}, account = 'netease' }) {
  const results = [];
  const check = async (title, run) => {
    try {
      const detail = await run();
      results.push({ title, ok: true, detail: detail ?? '' });
    } catch (error) {
      if (error?.skip) results.push({ title, ok: true, skipped: true, detail: error.message });
      else results.push({ title, ok: false, detail: error?.message ?? String(error) });
    }
  };
  const skip = (message) => { const error = new Error(message); error.skip = true; throw error; };

  await check('exposes the required adapter surface', () => assertProviderShape(provider, name));

  await check('reports an explicit account state that matches its credentials', async () => {
    const state = provider.getAccount().status;
    if (!ACCOUNT_STATES.includes(state)) throw new Error(`unexpected account state ${state}`);
    const hasCredential = Boolean(fixture.hasCredential?.());
    if (!hasCredential && state === 'authorized') {
      throw new Error('claims to be authorized while no credential is stored');
    }
    return `account=${state}, credential=${hasCredential ? 'present' : 'absent'}`;
  });

  await check('a missing capability is never an empty result', async () => {
    const account = provider.getAccount();
    if (account.status === 'authorized') skip('signed in, so the unavailable path does not apply');
    let threw = null;
    try {
      await provider.search('anything', {});
    } catch (error) {
      threw = error;
    }
    if (!threw) throw new Error('search returned successfully while the provider is not usable');
    if (!(threw instanceof MusicError) || !threw.code) throw new Error(`search threw a bare error: ${threw.message}`);
    return `search refused with ${threw.code}`;
  });

  await check('seed import reports the source it really used and a real count', async () => {
    const account = provider.getAccount();
    if (account.status !== 'authorized') skip('import needs a signed-in account');
    const result = await provider.getSeedTracks({ limit: 5 });
    if (!Array.isArray(result.tracks)) throw new Error('getSeedTracks must return tracks[]');
    if (typeof result.source !== 'string' || !result.source) throw new Error('the actual source must be reported');
    if (result.tracks.length !== result.imported) {
      throw new Error(`imported count ${result.imported} does not match ${result.tracks.length} tracks`);
    }
    return `source=${result.source}, imported=${result.imported}`;
  });

  await check('resolve returns a handle and never persists it', async () => {
    const account = provider.getAccount();
    if (account.status !== 'authorized') skip('resolution needs a signed-in account');
    const track = fixture.track ?? { provider: account, providerTrackId: 'conformance-1' };
    const resource = await provider.resolve(track, { signal: null, version: 1 });
    if (typeof resource?.handle !== 'string' || !resource.handle) throw new Error('resolve must return a handle');
    if (fixture.store) {
      const dumped = JSON.stringify({
        state: fixture.store.getCoreState?.() ?? null,
        // The provider name keys the reference; passing the account object here
        // would be read by SQLite as named parameters.
        references: fixture.store.getCredentialReference?.(name) ?? null,
      });
      if (dumped.includes(resource.handle)) throw new Error('the handle leaked into persistent storage');
    }
    return `handle=${resource.handle.slice(0, 12)}…, expiresAt=${resource.expiresAt ?? 'none'}`;
  });

  await check('logout removes the stored credential reference', async () => {
    if (typeof provider.logout !== 'function') skip('this adapter has no logout()');
    if (!fixture.hasCredential?.()) skip('nothing is signed in');
    await provider.logout();
    if (fixture.hasCredential()) throw new Error('the credential is still present after logout');
    return 'credential removed';
  });

  return {
    name,
    passed: results.filter((row) => row.ok && !row.skipped).length,
    skipped: results.filter((row) => row.skipped).length,
    failed: results.filter((row) => !row.ok).length,
    results,
  };
}

/** Normalizes a platform payload entry into a contract track, or null. */
export function toTrack(provider, entry) {
  if (!entry || typeof entry !== 'object') return null;
  // NetEase uses `id`, QQ uses `songmid`; accept both plus the obvious variants.
  const id = entry.id ?? entry.songId ?? entry.songid ?? entry.songmid ?? entry.mid;
  if (id === undefined || id === null || id === '') return null;
  const track = normalizeTrack({
    provider,
    providerTrackId: String(id),
    title: typeof entry.name === 'string' ? entry.name : (typeof entry.title === 'string' ? entry.title : ''),
    artist: artistOf(entry),
    durationMs: Number.isSafeInteger(entry.durationMs ?? entry.dt ?? entry.duration)
      ? (entry.durationMs ?? entry.dt ?? entry.duration)
      : null,
  });
  return track;
}

/** Platform payloads disagree about where the artist lives; accept the shapes. */
export function artistOf(entry) {
  if (typeof entry.artist === 'string') return entry.artist;
  const list = entry.artists ?? entry.ar;
  if (Array.isArray(list) && list.length) {
    const names = list.map((item) => item?.name).filter((value) => typeof value === 'string' && value);
    if (names.length) return names.join(' / ');
  }
  const first = entry.artists?.[0]?.name;
  return typeof first === 'string' ? first : '';
}

/**
 * Maps a transport failure onto the project's error vocabulary. Platform
 * specifics stay in the transport; this is the shared interpretation.
 */
export function mapTransportError(error, { provider }) {
  if (error instanceof MusicError) return error;
  const status = error?.status ?? error?.statusCode ?? null;
  if (status === 401 || status === 403) {
    return new MusicError('login_required', `${provider} needs a valid sign-in`, { cause: error });
  }
  if (status === 404) {
    return new MusicError('media_unavailable', `${provider} does not have this resource`, { cause: error });
  }
  if (status === 429) {
    return new MusicError('rate_limited', `${provider} is rate limiting us`, { retryable: true, cause: error });
  }
  if (typeof status === 'number' && status >= 500) {
    return new MusicError('provider_failure', `${provider} returned ${status}`, { retryable: true, cause: error });
  }
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' || error?.name === 'AbortError') {
    return new MusicError('provider_failure', `${provider} request failed: ${error.code ?? error.name}`,
      { retryable: true, cause: error });
  }
  return new MusicError('provider_failure', `${provider} request failed: ${error?.message ?? error}`,
    { retryable: true, cause: error });
}