// QQ Music adapter (P4).
//
// Same shared state machine as NetEase (./platform.mjs), so both platforms pass
// the same contract checks. What is specific to QQ: its ids are `songmid`, its
// recent-list surface is the one the plan expects to be unreliable, and its
// playback URLs are time-limited keys.
//
// AGENTS.md is explicit that a failing recent-list must degrade the *source*,
// not remove QQ support, so the seed order here is the documented fallback chain
// and the adapter reports which source it actually used.
//
// Scope note: as with NetEase, the parsers below accept the shapes this platform
// is believed to use and none of it is verified against the live service. See
// docs/spikes/P4-qq.md (P0-03 / P3).
import { createPlatformProvider } from './platform.mjs';

export const QQ = 'qq';

/** Endpoint roles the transport must serve, as role names rather than URLs. */
export const QQ_ROLES = Object.freeze([
  'loginQr', 'loginPoll', 'accountInfo',
  'recentTracks', 'likedTracks', 'playlists', 'playlistTracks',
  'search', 'resolve',
]);

/**
 * QQ's recent surface is the one expected to fail; the order below is the
 * documented degradation path, and `firstSource` names it in the reason so a
 * fallback can never be mistaken for recent playback.
 */
export const QQ_SEED_ORDER = Object.freeze(['recent', 'liked', 'playlist']);

const unwrap = (body) => body?.req_0?.data ?? body?.data ?? body;

function listOf(body) {
  const data = unwrap(body);
  return data?.list ?? data?.songlist ?? data?.songs ?? data?.tracks ?? data?.v_playlist ?? data ?? [];
}

export function createQQProvider(options = {}) {
  return createPlatformProvider({
    provider: QQ,
    displayName: 'QQ Music',
    labels: { firstSource: 'Recent listening' },
    ...options,
    parse: {
      loginQr: (body) => {
        const data = unwrap(body);
        return {
          key: data?.qrsig ?? data?.key ?? data?.ptqrtoken ?? null,
          qrImage: data?.qrImage ?? data?.qrcode ?? null,
          qrUrl: data?.qrUrl ?? data?.url ?? null,
        };
      },
      loginPoll: (body) => {
        const data = unwrap(body);
        // QQ reports progress with ptuiCB status codes: 65 expired, 66 waiting,
        // 67 scanned, 0 confirmed.
        const code = data?.code ?? data?.status ?? null;
        if (code === 65 || code === 'expired') return { status: 'expired', code };
        if (code === 66 || code === 'waiting') return { status: 'waiting', code };
        if (code === 67 || code === 'scanned') return { status: 'scanned', code };
        if (code !== 0 && code !== 'confirmed' && !data?.cookie) return { status: 'waiting', code };
        return {
          status: 'authorized',
          code,
          secret: data?.cookie ?? null,
          accountId: data?.uin ?? data?.accountId ?? null,
        };
      },
      accountId: (body) => unwrap(body)?.uin ?? unwrap(body)?.accountId ?? null,
      search: (body) => {
        const data = unwrap(body);
        return data?.list ?? data?.song?.list ?? data?.songs ?? [];
      },
      playUrl: (body) => {
        const data = unwrap(body);
        const entry = Array.isArray(data) ? data[0] : data;
        // A `purl` is a time-limited key, so the expiry matters more here than
        // on NetEase and is reported when the platform provides it.
        return {
          url: entry?.purl ?? entry?.url ?? null,
          reason: entry?.reason ?? entry?.msg ?? null,
          expiresInSeconds: Number.isSafeInteger(entry?.expiresIn) ? entry.expiresIn : null,
        };
      },
      resolveParams: ({ track }) => ({ songmid: track.providerTrackId, quality: '320' }),
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
        parse: (body) => {
          const data = unwrap(body);
          return data?.list ?? data?.songlist ?? data?.songs ?? data ?? [];
        },
      },
      playlist: {
        steps: [
          {
            role: 'playlists',
            params: () => ({ limit: 1 }),
            collect: false,
            parse: (body) => {
              const data = unwrap(body);
              const first = (data?.list ?? data?.disslist ?? data?.playlist ?? [])[0];
              return { playlistId: first?.dissid ?? first?.id ?? first?.disstid ?? null };
            },
          },
          {
            role: 'playlistTracks',
            params: ({ limit, playlistId }) => (playlistId ? { disstid: playlistId, limit } : null),
            parse: (body) => listOf(body),
          },
        ],
      },
    },
  });
}

/** Which endpoints still need a real account to confirm. */
export function unverifiedEndpoints() {
  return [...QQ_ROLES];
}