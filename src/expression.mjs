// Local presentation only: never a model prompt, preference signal or command.
import {MusicError} from './contracts.mjs';

export const EXPRESSION_KEY = 'expression_style_v1';
export const EXPRESSION_STYLES = Object.freeze(['current', 'concise', 'lively']);
export function validateExpressionInput(style, expectedRevision) {
  if (!EXPRESSION_STYLES.includes(style) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new MusicError('invalid_expression', '请选择有效的表达预设，并先读取已保存的设置。');
  }
}
export function formatExpression(style, kind, original, snapshot) {
  if (style === 'current' || !EXPRESSION_STYLES.includes(style)) return original;
  const lively = style === 'lively', current = snapshot?.current;
  if (snapshot?.paused) return lively ? '先停在这里，等你准备好再继续。' : '已暂停，等待你的操作。';
  if (snapshot?.lastError) return lively ? '这次播放没完成，先看看状态提示吧。' : '播放未成功，请查看状态。';
  if (snapshot?.settings?.listening === false) return lively ? '自主听歌已关闭，先保持你的当前设置。' : '自主听歌已关闭。';
  if (!current) return lively ? '电台待命，准备好后再选歌。' : '电台待命。';
  let text;
  if (kind === 'user') text = lively ? '这是你点的歌，按你的选择播放。' : '用户点播。';
  else if (kind === 'legacy') text = lively ? '这是旧版记录，选曲来源还没法完整确认。' : '旧版记录，选曲来源未完整标记。';
  else if (kind === 'llm-picked') text = lively ? '这首从网易云候选里挑出，本地播放规则继续把关。' : '平台候选经模型筛选，本地规则执行。';
  else if (kind === 'model-recommended') text = lively ? '这首来自已核对的缓存歌单，继续按本地规则播放。' : '来自平台已核对的缓存歌单。';
  else if (kind === 'recommended-next') text = snapshot?.lastSelection?.fallbackReason?.includes('输入曲库')
    ? lively ? '你想换一首，筛选歌单暂时不可用，这次从输入曲库选。' : '应请求换曲，回退输入曲库。'
    : lively ? '收到换曲请求，这首由本地推荐规则选出。' : '应请求换曲，由本地规则选歌。';
  else if (kind === 'fallback') text = lively ? '陌生候选暂不可用，这次先回到熟悉歌曲。' : '陌生候选不可用，回到熟悉池。';
  else if (kind === 'related') text = lively ? '这次沿着平台的相似推荐试一首，本地规则仍在把关。' : '平台相似推荐，本地规则选曲。';
  else if (kind === 'account') {
    const source = current.origin?.source === 'netease_personal_fm' ? '网易云私人 FM' : '网易云每日推荐';
    text = lively ? `这首来自${source}，先沿着平台给出的候选试试。` : `来自${source}。`;
  } else if (kind === 'earned') text = lively ? '这次参考了已记录的自主经历，也保留本地规则的限制。' : '按已记录的自主经历与本地规则选择。';
  else text = lively ? '这次继续按本地规则选歌，缺少的来源信息先不猜。' : '按本地规则选歌。';
  return (snapshot?.settings?.humanPlayback === false && snapshot?.status === 'playing' ? '静音播放。' : '') + text;
}
export function expressionVariants(kind, original, snapshot) {
  return Object.fromEntries(EXPRESSION_STYLES.map(style => [style, formatExpression(style, kind, original, snapshot)]));
}
export function expressionView(store) {
  const saved = store.getSetting(EXPRESSION_KEY, null);
  const valid = saved && saved.version === 1 && EXPRESSION_STYLES.includes(saved.style)
    && Number.isSafeInteger(saved.revision) && saved.revision >= 0;
  const sample = {paused: false, status: 'playing', settings: {listening: true, humanPlayback: true}, current: {origin: {source: 'netease_similar'}}};
  return {version: 1, style: valid ? saved.style : 'current', revision: valid ? saved.revision : 0, available: saved === null || Boolean(valid),
    examples: expressionVariants('related', '这首与已有种子存在平台相似关系，本地偏好和重复限制共同选中了它。', sample)};
}
export function setExpressionStyle(store, style, expectedRevision) {
  validateExpressionInput(style, expectedRevision);
  return store.transaction(() => {
    const view = expressionView(store);
    if (!view.available) throw new MusicError('unsupported_expression', '已有表达配置版本不兼容，暂时保留原配置。');
    if (view.revision !== expectedRevision) throw new MusicError('expression_conflict', '另一窗口已更改表达设置，请先读取新设置。');
    if (view.style === style) return view;
    if (!Number.isSafeInteger(view.revision + 1)) throw new MusicError('invalid_expression', '表达设置版本已超出可用范围。');
    store.setSetting(EXPRESSION_KEY, {version: 1, style, revision: view.revision + 1});
    return expressionView(store);
  });
}
