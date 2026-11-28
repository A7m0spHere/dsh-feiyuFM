import React from 'react';
import { h, sourceNames, stageNames } from './shared.mjs';

export function PlatformAccount({ id, title, state, controller, regionRef }) {
  const platform = state.platforms?.[id];
  const own = state.platformStates?.[id] ?? (id === 'netease'
    ? { login: state.login, playlists: state.playlists, imported: state.imported, importAttempts: state.importAttempts } : {});
  const login = own.login;
  const [source, setSource] = React.useState('auto');
  const [playlistId, setPlaylistId] = React.useState('');
  const busy = Boolean(own.busy);
  const disabled = !state.connected || state.busy || busy;
  React.useEffect(() => {
    if (!['waiting', 'scanned'].includes(login?.status)) return undefined;
    const timer = setInterval(() => { void controller.platformAction('poll', id); }, 2500);
    return () => clearInterval(timer);
  }, [login?.status, controller, id]);
  const authorized = platform?.account?.status === 'authorized';
  const active = state.snapshot?.musicAccount?.provider === id;
  const pending = Boolean(platform?.account?.pending || login?.attemptId && ['waiting', 'scanned', 'error'].includes(login.status));
  const selected = playlistId || own.playlists?.[0]?.id || '';
  const status = !state.snapshot ? state.initializationState === 'error' ? '读取失败' : '读取中' : state.platformError ? '读取失败' : !platform?.installed ? '接口尚未接入'
    : authorized ? '已登录' : platform.account?.checking ? '正在验证登录' : platform.account?.status === 'error' ? '验证失败' : platform.account?.status === 'expired' ? '登录已过期'
      : platform.account?.pending || ['waiting', 'scanned'].includes(login?.status) ? '等待扫码' : '未登录';
  const act = action => controller.platformAction(action, id);
  const signOut = h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: !state.connected,
    onClick: () => act('logout') }, active ? '退出并切换账号' : '退出');
  return h('div', { ref: regionRef, tabIndex: -1, role: 'group', 'aria-label': `${title}连接与导入` },
    h('div', { className: 'fm-platform' },
      h('div', { className: 'fm-platform-name' }, h('span', { className: 'fm-platform-mark', 'aria-hidden': true }, id === 'qq' ? 'Q' : '网'), title),
      h('div', { className: 'fm-platform-actions' }, h('span', { className: 'fm-badge', 'data-ok': authorized || undefined }, status),
        platform?.account?.cleanupPending
          ? h('button', { type: 'button', className: 'fm-button', disabled: !state.connected || busy, onClick: () => act('logout') }, '重试清理凭据')
          : platform?.account?.canRestore
            ? h(React.Fragment, null, h('button', { type: 'button', className: 'fm-button', disabled, onClick: () => act('restore') }, '重试登录验证'), signOut)
          : authorized ? h(React.Fragment, null,
            state.features?.importSources && h('select', { 'aria-label': id === 'netease' ? '导入来源' : `${title}导入来源`,
              'data-guide-import': true, value: source, disabled,
              onChange: event => { setSource(event.target.value); if (event.target.value === 'playlist') void act('playlists'); } },
            h('option', { value: 'auto' }, '自动来源'),
            id === 'netease' && h('option', { value: 'recent' }, '近期播放'),
            h('option', { value: 'liked' }, '我喜欢'), h('option', { value: 'playlist' }, '指定歌单')),
            source === 'playlist' && h('select', { 'aria-label': id === 'netease' ? '输入歌单' : `${title}输入歌单`, value: selected, disabled: disabled || !own.playlists?.length,
              onChange: event => setPlaylistId(event.target.value) }, ...(own.playlists?.length
              ? own.playlists.map(row => h('option', { key: row.id, value: row.id }, row.title)) : [h('option', { value: '' }, '读取歌单…')])),
            h('button', { type: 'button', className: 'fm-button fm-primary', 'data-guide-import': true,
              disabled: disabled || (source === 'playlist' && !selected),
              onClick: () => controller.platformAction('import', id, { source: source === 'auto' ? null : source, playlistId: source === 'playlist' ? selected : null }) }, '导入我的音乐'),
            signOut)
            : active ? signOut
            : platform?.installed && !state.platformError && !pending && !['waiting', 'scanned'].includes(login?.status)
              && h('button', { type: 'button', className: 'fm-button fm-primary', 'data-guide-login': true, disabled,
                onClick: () => act('begin') }, '扫码登录'))),
    login && login.status !== 'authorized' && h('div', { className: 'fm-login' },
      h('div', { className: 'fm-label' }, login.status === 'scanned' ? '已扫码，请在手机上确认'
        : login.status === 'expired' ? login.qrExpired === false ? '登录已失效' : '二维码已过期' : login.status === 'error' ? login.canRetryValidation ? '登录校验未通过' : '登录未完成'
          : `使用${id === 'qq' ? '手机 QQ' : '网易云音乐 App'}扫描`),
      login.qrImage && ['waiting', 'scanned'].includes(login.status)
        && h('img', { src: login.qrImage, width: 172, height: 172, alt: `${title}登录二维码` }),
      login.identityError && h('p', { role: 'status' }, login.identityError),
      login.status === 'error' && (login.canRetryValidation || login.canRetryCheck)
        && h('button', { type: 'button', className: 'fm-button', disabled, onClick: () => act('poll') }, login.canRetryValidation ? '重试登录校验' : '重试扫码检测'),
      !active && !pending && ['error', 'expired'].includes(login.status)
        && h('button', { type: 'button', className: 'fm-button', disabled, onClick: () => act('begin') }, '重新获取二维码'),
      (pending || ['waiting', 'scanned'].includes(login.status))
        && h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: !state.connected, onClick: () => act('logout') }, '取消登录')),
    !login && pending && h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: !state.connected, onClick: () => act('logout') }, '取消登录'),
    active && authorized && platform?.legacyRecoveryAvailable && h('div', { className: 'fm-import' },
      h('p', { className: 'fm-note' }, '这台设备有未关联账号的旧版曲库、反馈或播放历史。请确认当前登录的是原账号。'),
      h('button', { type: 'button', className: 'fm-button', disabled,
        onClick: () => act('recoverLegacy') }, '恢复旧版资料到当前账号')),
    own.imported && h('div', { className: 'fm-import', role: 'status' },
      `最近导入 ${sourceNames[own.imported.source] ?? '平台音乐'}，新增 ${own.imported.imported ?? 0} 首。`,
      own.imported.reason ? h('p', { className: 'fm-note' }, own.imported.reason) : null),
    own.importAttempts?.length > 0 && h('div', { className: 'fm-attempts' },
      own.importAttempts.map((row, index) => h('p', { className: 'fm-note', key: index },
        `${sourceNames[row.source] ?? row.source} · ${row.ok ? `可用 ${row.count} 首` : `${stageNames[row.stage] ?? '请求'}失败 · ${row.code ?? ''}`}`))),
    (own.error || platform?.account?.canRestore) && h('p', { className: 'fm-note', role: 'alert' }, own.error || platform.account.reason),
    own.notice && h('p', { className: 'fm-note', role: 'status', 'aria-live': 'polite' }, own.notice));
}
