// NetEase Cloud Music adapter (P2).
//
// The lifecycle, capability honesty, seed fallback and error mapping live in
// ./platform.mjs and are shared with the QQ adapter, so both platforms cannot
// drift apart. What is specific to NetEase is here: which transport roles it
// uses and how its response bodies map onto normalized values.
//
// Scope note, deliberately explicit: the parsers below accept the shapes this
// platform is believed to use, but none of it has been verified against the
// live service. docs/spikes/P2-netease.md records exactly what remains
// unconfirmed (P0-02 / P3). Nothing here asserts a verified platform API.
import { createPlatformProvider } from './platform.mjs';

export const NETEASE = 'netease';

/**
 * Endpoint roles the transport must serve. These are role names, not URLs; the
 * real wire format stays out of this file.
 */
export const NETEASE_ROLES = Object.freeze([
  'loginQr', 'loginPoll', 'accountInfo',
  'recentTracks', 'likedTracks', 'playlists', 'playlistTracks',
  'search', 'resolve',
]);

/** Seed sources in the order the plan prefers, with the documented fallback. */
export const NETEASE_SEED_ORDER = Object.freeze(['recent', 'liked', 'playlist']);

const listOf = (body) => body?.data?.list ?? body?.list ?? body?.songs ?? body?.data ?? [];

/**
 * Creates the NetEase provider.
 *
 * @param {object} options
 * @param {object} options.transport `request({ role, params, signal })` → `{ status, body }`
 * @param {object} [options.credentials] `read(ref)`, `write(ref, secret)`, `delete(ref)`
 * @param {object} [options.store] MusicStore; holds the credential reference only
 */
export function createNetEaseProvider(options = {}) {
  return createPlatformProvider({
    provider: NETEASE,
    displayName: 'NetEase',
    labels: { firstSource: 'Recent playback' },
    ...options,
    parse: {
      // Scan responses: a key to poll with, plus whatever the caller may show.
      loginQr: (body) => ({ key: body?.key ?? null, qrImage: body?.qrImage ?? body?.qrimg ?? null, qrUrl: body?.qrUrl ?? body?.url ?? null }),
      loginPoll: (body) => {
        const code = body?.code ?? body?.status ?? null;
        if (code === 800 || code === 'expired') return { status: 'expired', code };
        if (code === 801 || code === 'waiting') return { status: 'waiting', code };
        if (code === 802 || code === 'scanned') return { status: 'scanned', code };
        if (code !== 803 && code !== 'confirmed' && !body?.cookie) return { status: 'waiting', code };
        return { status: 'authorized', code, secret: body?.cookie ?? null, accountId: body?.accountId ?? body?.userId ?? null };
      },
      accountId: (body) => body?.accountId ?? body?.userId ?? body?.profile?.userId ?? null,
      search: (body) => body?.songs ?? body?.result?.songs ?? [],
      playUrl: (body) => {
        const entry = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body);
        return {
          url: entry?.url ?? null,
          reason: entry?.reason ?? null,
          expiresInSeconds: Number.isSafeInteger(entry?.expi) ? entry.expi : null,
          expiresAt: Number.isSafeInteger(entry?.expiresAt) ? entry.expiresAt : null,
        };
      },
      resolveParams: ({ track }) => ({ id: track.providerTrackId, br: 320000 }),
    },
    seedSources: {
      recent: {
        role: 'recentTracks',
        params: ({ limit }) => ({ limit }),
        parse: (body) => listOf(body),
      },
      liked: {
        role: 'likedTracks',
        params: ({ limit }) => ({ limit }),
        parse: (body) => body?.ids ?? body?.data?.ids ?? body?.songs ?? body?.data ?? [],
      },
      playlist: {
        steps: [
          // Pick one playlist, then read its tracks: two calls, one source.
          { role: 'playlists', params: () => ({ limit: 1 }), parse: (body) => ({ playlistId: (body?.playlist ?? body?.data?.playlist ?? [])[0]?.id ?? null }), collect: false },
          { role: 'playlistTracks', params: ({ limit, playlistId }) => (playlistId ? { id: playlistId, limit } : null), parse: (body) => body?.songs ?? body?.playlist?.tracks ?? body?.data ?? [] },
        ],
      },
    },
  });
}

/** Which endpoints still need a real account to confirm. */
export function unverifiedEndpoints() {
  return [...NETEASE_ROLES];
}