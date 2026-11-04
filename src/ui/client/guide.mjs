import { h } from './shared.mjs';

export const GUIDE_KEY = 'fishfm.guide.v1';
export function storedGuideStatus(value) {
  if (value?.version > 1) return 'existing';
  return value?.version === 1 && ['skipped', 'completed', 'existing'].includes(value.status) ? value.status : 'pending';
}

export function guideReady(state) {
  return state.connected && state.initializationState === 'ready' && Boolean(state.snapshot) && !state.platformError;
}

export function firstUseDecision(state) {
  if (!guideReady(state)) return 'wait';
  const account = state.platforms?.netease?.account;
  const profile = state.insights?.profile;
  const feedback = state.insights?.feedback;
  if (['authorized', 'expired'].includes(account?.status) || account?.pending || account?.cleanupPending || state.login
    || state.library?.total > 0 || state.library?.tracks?.length || state.imported?.total > 0
    || state.snapshot.current || state.snapshot.queue?.length || state.snapshot.navigation?.previous
    || state.insights?.statistics?.observedStarts > 0 || profile?.artists?.length || profile?.tracks?.length
    || feedback?.liked > 0 || feedback?.reduced > 0 || state.persona?.referenceCoverage?.total > 0) return 'existing';
  // Reuse existing reads. Unknown data is not evidence of a fresh install;
  // the explicit settings entry remains available without these extra facts.
  if (!state.libraryReady || state.libraryBusy || state.libraryError || state.profileState !== 'ready'
    || state.busy || state.platformBusy || state.platforms?.netease?.installed !== true
    || !['login_required', 'signed_out'].includes(account?.status)) return 'wait';
  return state.library.total === 0 ? 'new' : 'wait';
}

export function UsageGuide({ state, onStep, onClose, rootRef, titleId }) {
  if (!state.guideVisible || !guideReady(state)) return null;
  const connected = state.platforms?.netease?.account?.status === 'authorized';
  const imported = state.libraryReady && state.library?.total > 0;
  const steps = [
    ['connect', '连接网易云音乐', connected ? '网易云已连接，可继续导入参考歌曲。' : '用网易云音乐 App 扫码并确认连接。', connected ? '查看连接' : '去连接'],
    ['import', '导入参考歌单', '参考歌曲帮助电台了解你常听的音乐，作为后续推荐的起点。', imported ? '查看导入' : '去导入'],
    ['listen', '开始听歌', '自行点击播放；“喜欢／少推荐”会影响本机后续推荐。', '去播放页'],
  ];
  return h('section', { className: 'fm-card fm-guide', ref: rootRef, tabIndex: -1, 'aria-labelledby': titleId },
    h('h2', { id: titleId }, '欢迎使用feiyuFM'),
    h('p', { className: 'fm-note fm-guide-intro' }, '三步开始听歌，也可稍后从电台设置重新打开。'),
    h('ol', { className: 'fm-guide-steps', 'aria-label': '开始使用的三个步骤' }, steps.map(([id, title, text, action], index) =>
      h('li', { key: id, className: 'fm-guide-step' },
        h('span', { className: 'fm-platform-mark', 'aria-hidden': true }, String(index + 1)),
        h('div', null, h('h3', null, title), h('p', { className: 'fm-note' }, text)),
        h('button', { type: 'button', className: `fm-button${index === 0 && !connected ? ' fm-primary' : ''}`,
          'data-guide-step': id, 'aria-label': `步骤 ${index + 1}：${title}`, onClick: () => onStep(id) }, action)))),
    state.guideStage === 'listen' && h('p', { className: 'fm-guide-tip fm-note', role: 'status' },
      imported ? '已回到正在听。准备好后点击底部播放按钮；听到喜欢的歌时，试试“喜欢／少推荐”。'
        : '已回到正在听。连接并导入歌曲后，点击底部播放按钮；“喜欢／少推荐”只影响本机推荐。'),
    h('div', { className: 'fm-guide-footer' },
      h('button', { type: 'button', className: 'fm-button fm-subtle', onClick: () => onClose('skipped') }, '跳过引导'),
      h('button', { type: 'button', className: 'fm-button', onClick: () => onClose('completed') }, '完成引导')));
}
