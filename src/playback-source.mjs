import { MusicError, PROVIDERS } from './contracts.mjs';
import { musicAccount } from './music-account.mjs';

const SETTING_KEY = 'playback_source_v1';

export function playbackSourceView(store) {
  const account = musicAccount(store);
  if (account) return { version: 1, revision: account.revision, provider: account.provider ?? 'netease' };
  const saved = store?.getSetting?.(SETTING_KEY, null);
  if (saved?.version === 1 && Number.isSafeInteger(saved.revision) && saved.revision >= 0 && PROVIDERS.includes(saved.provider)) {
    return { version: 1, revision: saved.revision, provider: saved.provider };
  }
  return { version: 1, revision: 0, provider: 'netease' };
}

export function savePlaybackSource(store, provider, expectedRevision) {
  if (musicAccount(store)) throw new MusicError('source_follows_account', '自动播放使用当前登录账号的平台。');
  if (!PROVIDERS.includes(provider) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new MusicError('invalid_playback_source', '请选择有效的自动播放平台。');
  }
  return store.transaction(() => {
    const current = playbackSourceView(store);
    if (current.revision !== expectedRevision) {
      throw new MusicError('playback_source_conflict', '另一窗口已更改自动播放来源，请读取后重新选择。');
    }
    if (current.provider === provider) return current;
    if (!Number.isSafeInteger(current.revision + 1)) throw new MusicError('invalid_playback_source', '来源配置版本已超出范围。');
    const saved = { version: 1, revision: current.revision + 1, provider };
    store.setSetting(SETTING_KEY, saved);
    return saved;
  });
}

export function isRecommendationSource(source, provider) {
  return source === 'platform_recommendation'
    || ['daily', 'personal_fm', 'similar'].some(kind => source === `${provider}_${kind}`);
}
