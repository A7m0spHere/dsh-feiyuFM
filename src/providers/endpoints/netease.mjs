// NetEase endpoint profile.
//
// Direct HTTP entries below are labelled CONFIRMED. Account/seed calls use the
// pinned community Node API package rather than hand-built wire descriptors.
//
// CONFIRMED entries were measured against the live service on 2026-09-27 by
// probing paths and parameters and reading the real responses (recorded in
// docs/spikes/P0-02-netease.md). Probing needs no account: the service answers
// "参数错误"/"接口未找到" for wrong shapes, which is how the correct ones were
// found, and `unikey`/`client/login`/`search` returned real data.
//
// The adapter's behaviour is verified offline; the wire format is data, which is
// why it lives in this file. When a live call disagrees, correct this file and
// the platform parsers — nothing else changes.

const MUSIC = 'https://music.163.com';
const API = `${MUSIC}/api`;

/** Roles whose shapes were measured against the live service. */
export const CONFIRMED_ROLES = Object.freeze([
  'loginQr', 'loginPoll', 'search', 'resolve',
]);

export const NETEASE_ENDPOINT_PROVENANCE = Object.freeze({
  measuredOn: '2026-09-27',
  confirmed: [
    'loginQr: POST /api/login/qrcode/unikey with type=1 → {"code":200,"unikey":"<uuid>"}',
    'loginPoll: POST /api/login/qrcode/client/login with key and type=1 → {"code":800,"message":"二维码不存在或已过期"}; 800 means the code expired or is unknown',
    'search: GET /api/search/get/web with s/type/limit → real songs (POST with a form body answers "参数错误")',
    'resolve: POST /api/song/enhance/player/url with ids=[id] and br → data[] with url/expi/code; url is null without entitlement',
  ],
  communityPackage: {
    name: '@neteasecloudmusicapienhanced/api', version: '4.40.1', license: 'MIT',
    modules: ['login_qr_key', 'login_qr_check', 'login_status', 'user_record', 'likelist', 'user_playlist', 'playlist_detail', 'song_detail', 'recommend_songs', 'personal_fm'],
    note: 'Production QR login uses the pinned type=3 modules with a fresh cookie context. The legacy type=1 descriptors are retained for diagnostic fixtures. A fresh 801 response was measured on 2026-09-30; real authorization still needs user confirmation.',
  },
  legacyHypotheses: [
    'qrImage: the service is expected to render the QR image server side, but no confirmed path was found; the login command therefore builds the scan URL itself if no image is available',
  ],
  note: 'The app sends QR login, account, recent-history, likes and playlist requests through the pinned community package. Real-account response shapes remain subject to desktop acceptance.',
});

/** Where the browser would be sent to complete a QR sign-in. */
export const NETEASE_QR_LOGIN_URL = `${MUSIC}/login`;

/**
 * The endpoint profile.
 *
 * @param {object} [options]
 * @param {string} [options.base] Override the API base (used by tests).
 */
export function neteaseEndpoints({ base = API } = {}) {
  return {
    // CONFIRMED: type=1 is required, otherwise the service answers 参数错误.
    loginQr: {
      url: `${base}/login/qrcode/unikey`,
      method: 'POST',
      body: ({ timestamp }) => ({ type: 1, timestamp: timestamp ?? Date.now() }),
    },
    // CONFIRMED: 800 (expired/unknown), and the confirmed path is client/login.
    loginPoll: {
      url: `${base}/login/qrcode/client/login`,
      method: 'POST',
      body: ({ key, timestamp }) => ({ key, type: 1, timestamp: timestamp ?? Date.now() }),
    },
    // CONFIRMED: query parameters, not a form body.
    search: {
      url: `${base}/search/get/web`,
      method: 'GET',
      query: ({ keywords, limit = 20, offset = 0 }) => ({ s: keywords, type: 1, limit, offset }),
    },
    // CONFIRMED path and parameters; entitlement decides whether url is null.
    resolve: {
      url: `${base}/song/enhance/player/url`,
      method: 'POST',
      body: ({ id, br = 320000 }) => ({ ids: JSON.stringify([Number(id)]), br }),
    },
  };
}

export { MUSIC as NETEASE_ORIGIN };
