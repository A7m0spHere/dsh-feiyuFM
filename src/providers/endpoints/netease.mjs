// NetEase endpoint profile.
//
// PROVENANCE — every entry below is labelled CONFIRMED or HYPOTHESIS.
//
// CONFIRMED entries were measured against the live service on 2026-09-27 by
// probing paths and parameters and reading the real responses (recorded in
// docs/spikes/P0-02-netease.md). Probing needs no account: the service answers
// "参数错误"/"接口未找到" for wrong shapes, which is how the correct ones were
// found, and `unikey`/`client/login`/`search` returned real data.
//
// HYPOTHESIS entries come from community practice and remain unverified; they
// are used only where a wrong guess produces a clear error rather than a wrong
// result. Nothing here claims platform compatibility beyond what was measured.
//
// The adapter's behaviour is verified offline; the wire format is data, which is
// why it lives in this file. When a live call disagrees, correct this file and
// the platform parsers — nothing else changes.

const MUSIC = 'https://music.163.com';
const API = `${MUSIC}/api`;

/** Roles whose shapes were measured against the live service. */
export const CONFIRMED_ROLES = Object.freeze([
  'loginQr', 'loginPoll', 'accountInfo', 'search', 'resolve',
]);

export const NETEASE_ENDPOINT_PROVENANCE = Object.freeze({
  measuredOn: '2026-09-27',
  confirmed: [
    'loginQr: POST /api/login/qrcode/unikey with type=1 → {"code":200,"unikey":"<uuid>"}',
    'loginPoll: POST /api/login/qrcode/client/login with key and type=1 → {"code":800,"message":"二维码不存在或已过期"}; 800 means the code expired or is unknown',
    'accountInfo: POST /api/nuser/account/get → {"code":200,"account":null,"profile":null} when signed out',
    'search: GET /api/search/get/web with s/type/limit → real songs (POST with a form body answers "参数错误")',
    'resolve: POST /api/song/enhance/player/url with ids=[id] and br → data[] with url/expi/code; url is null without entitlement',
  ],
  hypotheses: [
    'qrImage: the service is expected to render the QR image server side, but no confirmed path was found; the login command therefore builds the scan URL itself if no image is available',
    'recentTracks: POST /api/v1/play/record with uid and type=1 (POST returned HTTP 400 while probing, so the shape is doubtful)',
    'likedTracks: POST /api/song/like/get with uid',
    'playlists: POST /api/user/playlist with uid',
    'playlistTracks: POST /api/v6/playlist/detail with id',
  ],
  note: 'Wrong parameters make the service answer "参数错误", so an unexpected body should be recorded in docs/spikes/P0-02-netease.md before changing code. Roles that need an account (recent/liked/playlists) and any weapi-encrypted route are still unverified.',
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
    accountInfo: {
      url: `${base}/nuser/account/get`,
      method: 'POST',
      body: ({ timestamp }) => ({ timestamp: timestamp ?? Date.now() }),
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

    // HYPOTHESES below: they need an account (a uid) to test at all.
    recentTracks: {
      url: `${base}/v1/play/record`,
      method: 'POST',
      body: ({ uid, limit }) => ({ uid, type: 1, limit }),
    },
    likedTracks: {
      url: `${base}/song/like/get`,
      method: 'POST',
      body: ({ uid, limit }) => ({ uid, limit, offset: 0 }),
    },
    playlists: {
      url: `${base}/user/playlist`,
      method: 'POST',
      body: ({ uid, limit }) => ({ uid, limit, offset: 0 }),
    },
    playlistTracks: {
      url: `${base}/v6/playlist/detail`,
      method: 'POST',
      body: ({ id, limit }) => ({ id, n: limit }),
    },
  };
}

export { MUSIC as NETEASE_ORIGIN };