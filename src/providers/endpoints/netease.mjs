// NetEase endpoint profile.
//
// PROVENANCE — read this before trusting anything here.
//
// These URLs and parameter names come from widely used community API projects
// (the NeteaseCloudMusicApi family and the clients built on it), not from
// NetEase documentation, and **none of them has been confirmed against the live
// service by this project**. Web fetching was unavailable while writing this, so
// even the community sources could not be re-read: treat every entry as a
// hypothesis that P0-02 must confirm with a real account.
//
// That is why this is a *profile* rather than defaults inside the adapter: the
// adapter's behaviour is verified offline, while the wire format is data. When a
// live call disagrees, correct this file and the platform parsers — the rest of
// the pipeline does not change.
//
// Roles absent from this map are deliberately absent: the transport reports
// `endpoint_unconfigured`, which is the honest answer for "this build does not
// know how to do that yet".

const MUSIC = 'https://music.163.com';
const API = `${MUSIC}/api`;

export const NETEASE_ENDPOINT_PROVENANCE = Object.freeze({
  confirmed: [],
  hypotheses: [
    'loginQr: POST /api/login/qr/key → data.unikey',
    'qrImage: POST /api/login/qr/create with qrimg=true → data.qrimg (base64 PNG)',
    'loginPoll: POST /api/login/qr/check?key=… → code 800/801/802/803, cookie on 803',
    'accountInfo: POST /api/nuser/account/get → profile.userId',
    'recentTracks: POST /api/v1/play/record with uid and type=1',
    'likedTracks: POST /api/song/like/get with uid',
    'playlists: POST /api/user/playlist with uid',
    'playlistTracks: POST /api/v6/playlist/detail with id',
    'search: POST /api/search/get/web with s/type/limit/offset',
    'resolve: POST /api/song/enhance/player/url with ids and br',
  ],
  note: 'Parameter names may need weapi encryption for some roles; if a role answers 200 with an unexpected body, record the shape in docs/spikes/P0-02-netease.md before changing code.',
});

/**
 * The default profile.
 *
 * @param {object} [options]
 * @param {string} [options.base]   Override the API base (useful for a local test server).
 */
export function neteaseEndpoints({ base = API } = {}) {
  return {
    loginQr: {
      url: `${base}/login/qr/key`,
      method: 'POST',
      query: ({ timestamp }) => ({ timestamp }),
    },
    // The QR image is produced server side, so no QR encoder is needed locally.
    qrImage: {
      url: `${base}/login/qr/create`,
      method: 'POST',
      query: ({ key, timestamp }) => ({ key, qrimg: 'true', timestamp }),
    },
    loginPoll: {
      url: `${base}/login/qr/check`,
      method: 'POST',
      query: ({ key, timestamp }) => ({ key, timestamp, noCookie: 'true' }),
    },
    accountInfo: {
      url: `${base}/nuser/account/get`,
      method: 'POST',
      query: ({ timestamp }) => ({ timestamp }),
    },
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
    search: {
      url: `${base}/search/get/web`,
      method: 'POST',
      body: ({ keywords, limit }) => ({ s: keywords, type: 1, limit, offset: 0 }),
    },
    resolve: {
      url: `${base}/song/enhance/player/url`,
      method: 'POST',
      body: ({ id, br = 320000 }) => ({ ids: JSON.stringify([Number(id)]), br }),
    },
  };
}

export { MUSIC as NETEASE_ORIGIN };