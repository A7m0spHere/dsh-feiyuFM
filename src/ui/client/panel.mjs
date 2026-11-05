import { playbackPresentation, playbackControls, discoveryPresentation, playbackNotice } from './presentation.mjs';
import React from 'react';
import { h, minutes, progressPercent, modes, sourceNames, stageNames } from './shared.mjs';
import { Svg, StatusMark, PlaybackArtwork, useSmoothProgress } from './components.mjs';
import { Library } from './library.mjs';
import {Persona} from './persona.mjs';
import {FeedbackSettings} from './feedback.mjs';
import {Discoveries} from './discoveries.mjs';
import {ExpressionSettings} from './expression.mjs';
import { DollLayer } from './dolls.mjs';
import { UsageGuide, guideReady } from './guide.mjs';
import { Lyrics } from './lyrics.mjs';
export function Panel({ controller, back }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const snapshot = state.snapshot;
  const settings = snapshot?.settings || {};
  const [rate, setRate] = React.useState(20);
  const [importSource,setImportSource]=React.useState('auto');
  const [playlistId,setPlaylistId]=React.useState('');
  const rateId = React.useId();
  const feedbackRef = React.useRef(null);
  const platformDetailsRef = React.useRef(null), neteaseRef = React.useRef(null);
  const guideRef = React.useRef(null), playRef = React.useRef(null);
  const [platformExpanded, setPlatformExpanded] = React.useState(false);
  const [guideFocus, setGuideFocus] = React.useState(null);
  const [view, setView] = React.useState('listen');
  // Pages mount on first visit and stay mounted (hidden) afterwards, so the
  // first frame only renders the visible tab instead of all four.
  const [mountedViews, setMountedViews] = React.useState(() => new Set([view]));
  React.useEffect(() => {
    if (!guideFocus || view !== (['connect', 'import'].includes(guideFocus) ? 'settings' : 'listen')) return;
    const region = neteaseRef.current;
    const target = guideFocus === 'connect' ? region?.querySelector('[data-guide-login]:not(:disabled)') ?? region
      : guideFocus === 'import' ? region?.querySelector('[data-guide-import]:not(:disabled)') ?? region?.querySelector('[data-guide-login]:not(:disabled)') ?? region
        : guideFocus === 'listen' && playRef.current && !playRef.current.disabled ? playRef.current : guideRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    setGuideFocus(null);
  }, [guideFocus, view, state.guideVisible]);
  const selectedModel = state.recommendationChoice || '';
  const setSelectedModel = value => controller.chooseRecommendationModel(value);
  React.useEffect(() => { if (snapshot) setRate(Math.round(settings.discoveryRate * 100)); }, [settings.discoveryRate]);
  React.useEffect(() => {
    if (!['waiting', 'scanned'].includes(state.login?.status)) return undefined;
    const poll = setInterval(() => controller.platformAction('poll', state.login.provider), 2500);
    return () => clearInterval(poll);
  }, [state.login?.status, state.login?.provider, controller]);
  // Insights/persona are not part of the first frame; load them once this panel
  // is actually visible, then let invalidation events refresh them.
  React.useEffect(() => { controller.ensureProfile(); }, [controller]);
  const disabled = state.busy || !state.connected || !snapshot;
  const mode = !settings.listening ? (!settings.humanPlayback ? 'off' : 'manual') : !settings.humanPlayback ? 'silent' : settings.strategy === 'focus' ? 'focus' : 'normal';
  const current = snapshot?.current;
  const playing = snapshot?.status === 'playing';
  const presentation = playbackPresentation(snapshot, state.connected);
  const transport = playbackControls(state);
  const positionMs = useSmoothProgress(current, presentation.active && !snapshot?.seekPending);
  const insights=state.insights;
  const art = presentation.art;
  const accountHint = state.platformError ? '连接状态读取失败' : !state.connected ? '连接中断' : ({authorized:'网易云已登录',expired:'登录已过期',signed_out:'未登录',login_required:'等待登录'}[state.platforms?.netease?.account?.status] || '查看连接');
  const guideAccountHint = state.guideVisible && ['connect', 'import'].includes(state.guideStage);
  function toggle(title, description, field, command) {
    return h('div', { className: 'fm-row', key: field }, h('div', null, h('div', { className: 'fm-label' }, title), h('p', null, description)),
      h('button', { type: 'button', className: 'fm-toggle', role: 'switch', 'aria-label': title, 'aria-checked': Boolean(settings[field]), disabled,
        onClick: () => controller.command(command, !settings[field]) }, h('span')));
  }
  const button = (label, type, blocked = false, extra = {}) => h('button', { type: 'button', className: 'fm-button', disabled: disabled || blocked, onClick: () => controller.command(type), ...extra }, label);
  const platformRows = [['netease', '网易云音乐', '网'], ['qq', 'QQ 音乐', 'Q']].map(([id, title, mark]) => {
    const platform = state.platforms?.[id];
    const label = !snapshot ? (state.initializationState === 'error' ? '读取失败' : '读取中')
      : state.platformError ? '读取失败' : !platform?.installed ? '接口尚未接入' : ({
      authorized: '已登录', expired: '登录已过期', signed_out: '未登录',
      login_required: platform.account?.pending ? '等待扫码' : '未登录',
    }[platform.account?.status] || '未连接');
    const available = id === 'netease' && platform?.installed && !state.platformError;
    const selectedPlaylist=playlistId||state.playlists?.[0]?.id||'';
    const action = state.platformError ? null : platform?.account?.cleanupPending
      ? h('button', { type: 'button', className: 'fm-button', disabled: (state.busy || state.platformBusy) || !state.connected,
        onClick: () => controller.platformAction('logout', id) }, '重试清理凭据')
      : platform?.account?.status === 'authorized'
      ? h(React.Fragment, null,
        state.features?.importSources&&h('select',{ 'aria-label':'导入来源','data-guide-import':true,value:importSource,disabled:(state.busy || state.platformBusy)||!state.connected,
          onChange:e=>{setImportSource(e.target.value);if(e.target.value==='playlist')controller.platformAction('playlists',id);} },
          h('option',{value:'auto'},'自动来源'),h('option',{value:'recent'},'近期播放'),h('option',{value:'liked'},'我喜欢'),h('option',{value:'playlist'},'指定歌单')),
        state.features?.importSources&&importSource==='playlist'&&h('select',{'aria-label':'输入歌单',value:selectedPlaylist,disabled:(state.busy || state.platformBusy)||!state.playlists?.length,
          onChange:e=>setPlaylistId(e.target.value)},...(state.playlists?.length?state.playlists.map(p=>h('option',{key:p.id,value:p.id},p.title)):[h('option',{value:''},'读取歌单…')])),
        h('button', { type: 'button', className: 'fm-button fm-primary', 'data-guide-import': true, disabled: (state.busy || state.platformBusy) || !state.connected || (importSource==='playlist'&&!selectedPlaylist),
          onClick: () => controller.platformAction('import', id,{source:importSource==='auto'?null:importSource,playlistId:importSource==='playlist'?selectedPlaylist:null}) }, '导入我的音乐'),
        h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: (state.busy || state.platformBusy) || !state.connected,
          onClick: () => controller.platformAction('logout', id) }, '退出'))
      : available && !state.login && h('button', { type: 'button', className: 'fm-button fm-primary', 'data-guide-login': true, disabled: (state.busy || state.platformBusy) || !state.connected,
        onClick: () => controller.platformAction('begin', id) }, '扫码登录');
    return h('div', { className: 'fm-platform', key: id, ...(id === 'netease' ? { ref: neteaseRef, tabIndex: -1, role: 'group', 'aria-label': '网易云音乐连接与导入' } : {}) },
      h('div', { className: 'fm-platform-name' }, h('span', { className: 'fm-platform-mark', 'aria-hidden': true }, mark), title),
      h('div', { className: 'fm-platform-actions' }, h('span', { className: 'fm-badge', 'data-ok': platform?.account?.status === 'authorized' || undefined }, label), action));
  });
  const loginPanel = state.login?.provider === 'netease'
    ? h('div', { className: 'fm-login' },
      h('div', { className: 'fm-label' }, state.login.status === 'authorized' ? '网易云音乐已连接'
        : state.login.status === 'scanned' ? '已扫码，请在手机上确认'
          : state.login.status === 'expired' ? state.login.qrExpired === false ? '登录已失效' : '二维码已过期'
            : state.login.status === 'error' ? state.login.canRetryValidation ? '登录校验未通过' : '登录未完成' : '使用网易云音乐 App 扫描'),
      state.login.qrImage && !['authorized', 'expired', 'error'].includes(state.login.status)
        && h('img', { src: state.login.qrImage, width: 172, height: 172, alt: '网易云音乐登录二维码' }),
      h('p', { role: 'status', 'aria-live': 'polite' }, state.login.identityError || (state.login.status === 'authorized'
        ? state.login.accountId ? `账号已连接（ID ${state.login.accountId}），可以导入音乐。` : '账号已连接；导入前会自动补读账号 ID。'
        : state.login.status === 'expired' ? '请重新获取二维码后再试。' : '手机确认后会自动读取账号状态，随后即可导入音乐。')),
      (state.login.canRetryValidation || state.login.canRetryCheck) && state.login.status === 'error'
        && h('button', { type: 'button', className: 'fm-button', disabled: (state.busy || state.platformBusy) || !state.connected,
          onClick: () => controller.platformAction('poll', 'netease') }, state.login.canRetryValidation ? '重试登录校验' : '重试扫码检测'),
      ['expired', 'error'].includes(state.login.status)
        && h('button', { type: 'button', className: 'fm-button fm-primary', disabled: (state.busy || state.platformBusy) || !state.connected,
          onClick: () => controller.platformAction('begin', 'netease') }, '重新获取二维码'))
    : null;
  const importNotice = state.imported
    ? h('div', { className: 'fm-import', role: 'status', 'aria-live': 'polite' },
      h('strong', null, `最近导入：${sourceNames[state.imported.source] || state.imported.source || '平台音乐'}`),
      ` · 新增 ${state.imported.imported ?? 0} 首，当前共 ${state.imported.total ?? 0} 首`,
      state.imported.degraded && state.imported.reason ? h('span', null, ` · ${state.imported.reason}`) : null)
    : null;
  const attempts = Array.isArray(state.importAttempts) && state.importAttempts.length
    ? h('div', { className: 'fm-attempts' }, h('div', { className: 'fm-attempts-title' }, '本次来源尝试'),
      state.importAttempts.map((row, index) => h('div', { className: 'fm-attempt', key: `${row.source}-${index}` },
        h('div', null, h('strong', null, sourceNames[row.source] || row.source),
          h('span', { className: 'fm-attempt-note' }, row.ok
            ? `可用 · ${row.count} 首`
            : `${stageNames[row.stage] || '请求'}失败${row.code ? ` · ${row.code}` : ''}${row.httpStatus ? ` · HTTP ${row.httpStatus}` : ''}${row.platformCode ? ` · 接口码 ${row.platformCode}` : ''}${row.reason ? ` · ${row.reason}` : ''}`)),
        h('span', { className: 'fm-badge', 'data-ok': row.ok || undefined }, row.ok ? `${row.count} 首` : '失败'))))
    : null;
  const platformSection = h('section', null,
    h('h2', null, '音乐平台', h('small', null, 'ACCOUNTS')),
    h('div', { className: 'fm-card' }, platformRows,
      state.platformError && h('div', { className: 'fm-notice', role: 'alert' }, state.platformError,
        h('button', { type: 'button', className: 'fm-button', onClick: controller.refresh }, '重试连接状态')),
      guideAccountHint && h('p', { className: 'fm-note fm-guide-target-note', role: 'status' }, state.guideStage === 'import'
        ? state.platforms?.netease?.account?.status === 'authorized' ? '选择来源，再点击“导入我的音乐”。参考歌曲是后续推荐的起点。'
          : '请先扫码连接网易云，授权后即可在这里选择来源并导入。'
        : state.platforms?.netease?.account?.status === 'authorized' ? '网易云已连接，可在这里选择来源并导入参考歌曲。'
          : '点击“扫码登录”，用网易云音乐 App 扫描并确认。'),
      loginPanel, importNotice, attempts,
      h('p', { className: 'fm-platform-note' }, '近期记录优先，读取失败时尝试喜欢列表和用户歌单。QQ 接入暂缓。登录材料仅保存在本机。')));

  const preferencesColumn = h('div', {className:'fm-main-column'},
        h(FeedbackSettings,{state,controller}),
        insights&&h('section',null,h('h2',null,'听歌记录'),h('details',{className:'fm-card fm-profile-details',open:true},h('summary',null,'查看偏好与听歌记录'),
          h('p',{className:'fm-note'},'本地画像 · 来自已保存的独立偏好'),
          ...(insights.profile?.artists?.length?insights.profile.artists.slice(0,5).map(a=>h('div',{className:'fm-row',key:a.key},
            h('span',null,a.name),h('span',{className:'fm-badge'},`权重 ${Math.round(a.affinity*100)}% · ${['listen','listen_silent'].includes(a.source)?'有效经历':a.source==='legacy_artist_link'?'旧偏好链接':'初始化/维护'}`))):[h('p',{className:'fm-note'},'还没有足够的艺人偏好记录。')]),
          h('p',{className:'fm-note'},'流派/情绪特征尚未提供，不据歌名推断。'),
          Array.isArray(insights.profile?.tracks)&&h('details',null,h('summary',null,'查看歌曲偏好与最近变化'),
            ...(insights.profile?.tracks??[]).map(t=>h('p',{className:'fm-note',key:t.key},`${t.title} · 权重 ${Math.round(t.affinity*100)}% · ${['listen','listen_silent'].includes(t.source)?'有效经历':'初始化/维护'}`)),
            h('p',{className:'fm-label'},'最近有效更新'),
            ...(insights.recentChanges?.length?insights.recentChanges.slice(0,3).map(c=>h('p',{className:'fm-note',key:c.playInstanceId},`${c.title} · ${c.before.toFixed(3)} → ${c.after.toFixed(3)} · ${c.audible?'有声':'静音'}经历`)):[h('p',{className:'fm-note'},'此决策窗口还没有有效偏好更新。')])),
          h('details',null,h('summary',null,'查看选歌统计'),h('p',{className:'fm-note'},`最近保留 ${insights.statistics?.retainedDecisions??0} 次自主决策；探索尝试 ${insights.statistics?.explorationAttempts??0} 次，选中陌生候选 ${insights.statistics?.unfamiliarSelections??0} 次，已观测开始 ${insights.statistics?.observedStarts??0} 次，有效陌生经历 ${insights.statistics?.validUnfamiliarListens??0} 次。`),
            Number.isFinite(insights.statistics?.repeatedSelections)&&h('p',{className:'fm-note'},`其中 ${insights.statistics.repeatedSelections} 次选中歌曲在近期已有播放历史。`),
            ...(insights.decisions??[]).slice(0,3).map(d=>h('p',{className:'fm-note',key:d.decisionId},`${d.trackTitle??d.trackKey??'未选中歌曲'} · ${d.pool==='queue'?'队列':d.pool==='discovery'?'新歌':'常听歌曲'}${d.fellBack?'（回退）':''}${d.trackKey?'':' · 本次未开始播放'}`)),
            h('p',{className:'fm-note'},`${Number.isFinite(insights.statistics?.windowStart)?`窗口始于 ${new Date(insights.statistics.windowStart).toLocaleString()}。`:''}按已追踪的决策实例统计，历史覆盖不足时不视作全期比例。`)))));
  const controlsColumn = h('aside', {className:'fm-controls-column','aria-label':'电台设置'},
        h('section', null, h('h2', null, '听歌方式', h('small', null, 'MODES')), h('div', { className: 'fm-modes' }, modes.map(([id, title, desc]) =>
          h('button', { type: 'button', key: id, className: 'fm-mode', 'data-selected': mode === id, 'aria-pressed': mode === id, disabled,
            title: desc, onClick: () => controller.command('setMode', id) }, h('strong', null, title), h('span', null, desc)))),
          mode === 'manual' && h('p', { className: 'fm-note' }, '仅手动点播：保留声音，不自动选歌。'),
          button('今天停止', 'stopForToday', Boolean(state.transportPending))),
        h('section', null, h('h2', null, '听歌偏好', h('small', null, 'PREFERENCES')), h('div', { className: 'fm-card' },
          toggle('DeepSeek 自主听歌', '自动选歌、续播并积累偏好。', 'listening', 'setListening'),
          toggle('电脑输出声音', '关闭只静音，不暂停听歌。', 'humanPlayback', 'setHumanPlayback'),
          toggle('探索新音乐', '从可播放的新歌候选中探索。', 'discovery', 'setDiscovery'),
          h('p', { className: 'fm-note', role: 'status', 'aria-live': 'polite' }, discoveryPresentation(snapshot)),
          snapshot?.lastSelection?.fellBack && h('p', { className: 'fm-note' }, '最近一次自主选择：没有合适的新歌，先播了常听歌曲。'),
          state.features?.discoveryRefresh && insights?.recommendationMode!=='filtered' && h('button', { type: 'button', className: 'fm-button', disabled: disabled || state.platformBusy || !settings.discovery || settings.discoveryRate === 0 || state.platforms?.netease?.account?.status !== 'authorized',
            onClick: () => controller.platformAction('discovery', 'netease') }, '刷新新歌推荐'),
          h('div', { className: 'fm-rate' }, h('div', { className: 'fm-rate-head' }, h('label', { htmlFor: rateId }, '新歌探索率'), h('output', { htmlFor: rateId }, `${rate}%`)),
            h('input', { id: rateId, 'aria-label': '新歌探索率', type: 'range', min: 0, max: 100, step: 1, value: rate, disabled: disabled || !settings.discovery,
              onChange: e => setRate(Number(e.target.value)) }),
            h('div', { className: 'fm-save-line' }, h('span', { className: 'fm-save', role: 'status', 'aria-live': 'polite' }, state.notice || '开关即时保存；探索率需点击保存。'),
              h('button', { type: 'button', className: 'fm-button', disabled: disabled || !settings.discovery || rate === Math.round(settings.discoveryRate * 100),
                onClick: () => controller.command('setDiscoveryRate', rate / 100) }, '保存'))))));
  const management = h('div', {className:'fm-management','aria-label':'曲库与界面设置'},
        h('section', null, h('h2', null, '输入与连接',h('small',null,'LIBRARY')),
          h('details',{className:'fm-input-library'},h('summary',null,`输入曲库 · ${state.library?.total??0} 首（展开查看）`),h(Library,{state,controller})),
          h('details',{className:'fm-platform-details fm-input-library',ref:platformDetailsRef,open:platformExpanded,
            'data-guide-reveal':['connect','import'].includes(guideFocus)||undefined,
            onToggle:event=>setPlatformExpanded(event.currentTarget.open)},h('summary',null,'音乐平台',h('span',{className:'fm-disclosure-meta'},accountHint)),platformSection)),
        h('section', null, h('h2', null, '使用指南'), h('div', { className: 'fm-card' },
          h('p', { className: 'fm-note' }, '连接网易云、导入参考歌曲，了解推荐反馈。'),
          h('button', { type: 'button', className: 'fm-button fm-guide-open', disabled: !guideReady(state), onClick: () => {
            controller.openGuide(); selectView('listen', false); setGuideFocus('guide');
          } }, '打开使用指南'),
          !guideReady(state) && h('p', { className: 'fm-note' }, '连接状态恢复后可打开指南。'))),
        h(Persona,{key:'settings',state,controller,settingsOnly:true,selectedModel,onSelectModel:setSelectedModel}),
        h('section', null, h('h2', null, '界面选项', h('small', null, 'INTERFACE')), h('details', { className: 'fm-card fm-interface-details' }, h('summary',null,'界面与悬浮条'),
          h(ExpressionSettings,{state,controller}),
          h('div', { className: 'fm-motion-row' }, h('label', { htmlFor: `${rateId}-motion` }, '动态效果'),
            h('select', { id: `${rateId}-motion`, 'aria-label': '动态效果', value: state.motion || 'full', onChange: event => controller.setMotion(event.target.value) },
              h('option', { value: 'full' }, '完整'), h('option', { value: 'reduced' }, '轻量'), h('option', { value: 'off' }, '关闭'))),
          h('p', { className: 'fm-note' }, '同时遵循系统的减少动态效果设置。'),
          h('div', { className: 'fm-motion-row' }, h('label', { htmlFor: `${rateId}-spectrum` }, '背景频谱'),
            h('button', { type: 'button', id: `${rateId}-spectrum`, className: 'fm-toggle', role: 'switch',
              'aria-label': '背景频谱', 'aria-checked': Boolean(state.spectrumVisible),
              onClick: () => controller.setSpectrumVisible(!state.spectrumVisible) }, h('span'))),
          h('p', { className: 'fm-note' }, '对话区左缘的 ASCII 频谱背景；模拟观感，非音频测量，随窗口与会话宽度自适应。'),
          h('div', { className: 'fm-widget-note' }, h(Svg, { type: 'grip' }),
            h('span', null, state.widgetVisible ? '离开面板后显示，可拖动吸附。' : '悬浮条已隐藏，可随时显示。'), h('button', { type: 'button', className: 'fm-button fm-widget-pref',
              'aria-pressed': state.widgetVisible, 'aria-label': '显示或隐藏悬浮条',
              onClick: () => controller.setWidgetVisible(!state.widgetVisible) }, state.widgetVisible ? '隐藏' : '显示')))));
  const settingsBody = h('div', { className: 'fm-settings-body' }, controlsColumn, management);
  const replyCurrent = !current?.decisionId || !insights?.reply?.decisionId || current.decisionId === insights.reply.decisionId;
  const selectView = (value, loadProfile = true) => {
    controller.setFeedbackOpen(value === 'taste' && feedbackRef.current?.querySelector('.fm-feedback-manager')?.open === true);
    setView(value);
    setMountedViews(current => current.has(value) ? current : new Set(current).add(value));
    if (loadProfile) controller.ensureProfile();
  };
  const guideStep = step => {
    controller.setGuideStage(step);
    selectView(step === 'listen' ? 'listen' : 'settings', false);
    if (step !== 'listen') setPlatformExpanded(true);
    setGuideFocus(step);
  };
  const dock = () => h('div', { className: 'fm-player-dock', 'aria-label': '播放控制' },
    h('div', { className: 'fm-dock-track' }, h('strong', null, current?.track?.title || '肥鱼电台'), h('span', null, current?.track?.artist || '等待音乐')),
    h('div', { className: 'fm-dock-center' }, h('div', { className: 'fm-controls' },
      h('button', { type: 'button', className: 'fm-button fm-transport', disabled: transport.previousDisabled,
        'aria-busy': state.transportPending === 'previous', onClick: () => controller.command('previous') },
        h(Svg, { type: 'prev' }), transport.previousLabel),
      h('button', { type: 'button', className: 'fm-button fm-primary fm-transport', ref: playRef, disabled: transport.playDisabled,
        'aria-busy': state.transportPending === 'pause', onClick: () => transport.action === 'pause' ? controller.command('pause') : controller.playOrPause() },
        h(Svg, { type: transport.icon }), transport.label),
      h('button', { type: 'button', className: 'fm-button fm-transport', disabled: transport.nextDisabled,
        'aria-busy': state.transportPending === 'next', onClick: () => controller.command('next') }, h(Svg, { type: 'next' }), transport.nextLabel)),
      current && h('div', { className: 'fm-dock-timeline' }, h('span', null, minutes(positionMs)),
        h('div', { className: 'fm-progress', 'aria-label': '播放进度' }, h('span', { style: { width: `${progressPercent({ ...current, positionMs })}%` } })),
        h('span', null, current.track.durationMs ? minutes(current.track.durationMs) : '--:--'))),
    h('button', { type: 'button', className: 'fm-button fm-sound-action', disabled,
      'aria-label': settings.humanPlayback ? '关闭电脑声音' : '开启电脑声音', 'aria-pressed': Boolean(settings.humanPlayback),
      onClick: () => controller.command('setHumanPlayback', !settings.humanPlayback) },
      h(Svg, { type: settings.humanPlayback ? 'sound' : 'muted' }), h('span', null, settings.humanPlayback ? '声音开启' : '已静音')));


  const hero = h('section', { className: 'fm-hero fm-companion-hero', 'aria-label': '当前播放' },
    h('div', { className: 'fm-art' }, h('span', { className: 'fm-character-halo', 'aria-hidden': true }),
      h(PlaybackArtwork, { art, active: presentation.active, motion: state.motion, effects: state.playbackEffects, available: state.features?.artwork?.gif, alt: '鲸鱼娘音乐状态' }),
      h('button', { type: 'button', className: 'fm-toggle fm-effects-toggle', role: 'switch', 'aria-label': '小开关',
        'aria-checked': Boolean(state.playbackEffects && state.features?.artwork?.gif), disabled: !state.features?.artwork?.gif,
        onClick: () => controller.setPlaybackEffects(!state.playbackEffects), onKeyDown: event => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault(); controller.setPlaybackEffects(event.key === 'ArrowRight');
        } }, h('span', { 'aria-hidden': true }))),
    h('div', { className: 'fm-hero-copy' },
      h('div', { className: 'fm-live', role: 'status' }, h(StatusMark, { active: presentation.active }), transport.message || presentation.label,
        h('span', { className: 'fm-mode-label' }, modes.find(([id]) => id === mode)?.[1] || '手动')),
      h('div', { className: 'fm-track-swap', key: `track:${current?.playInstanceId || 'empty'}` },
        h('div', { className: 'fm-track' }, current?.track?.title || '今天，从哪一首开始？'),
        h('p', { className: 'fm-artist' }, current?.track?.artist || (state.library?.total ? '让大肥鱼挑一首，或点播你想听的歌。' : '打开电台设置，连接网易云并导入音乐。'))),
      current && h('div', { className: 'fm-feedback-actions', 'aria-label': '当前歌曲推荐反馈' },
        ...[[1, '喜欢', '♥'], [-1, '少推荐', '↓']].map(([score, label, mark]) => h('button', {
          type: 'button', key: score, className: 'fm-button fm-feedback-button', 'aria-pressed': insights?.feedback?.current === score,
          disabled: disabled || insights?.feedback?.version !== 1,
          onClick: () => controller.command('setTrackFeedback', { track: current.track, playInstanceId: current.playInstanceId, value: insights.feedback.current === score ? 0 : score }),
        }, h('span', { 'aria-hidden': true }, mark), label))),
      current && (insights?.feedback?.version !== 1 || insights.feedback.current === 1 || insights.feedback.current === -1) &&
        h('p', { className: 'fm-feedback-note', role: 'status', 'data-current-feedback': insights?.feedback?.version === 1 }, insights?.feedback?.version !== 1 ? (insights ? '反馈功能需重新加载新版 Core。'
          : state.profileState === 'error' ? '偏好数据暂时不可用，播放不受影响。' : '正在读取偏好…')
          : insights.feedback.current === 1 ? '已喜欢，再次点击可撤销。' : '已少推荐，再次点击可撤销。'),
      current && replyCurrent && insights?.explanation && h('div', { className: 'fm-reply', key: `reply:${insights.reply?.decisionId || current.playInstanceId}` },
        h('p', { className: 'fm-label' }, '大肥鱼说'),
        h('p', { className: 'fm-reply-text' }, insights.reply?.variants?.[state.expression?.style ?? 'current'] || insights.reply?.text || insights.explanation.variants?.[state.expression?.style ?? 'current'] || insights.explanation.text),
        h('details', null, h('summary', null, '展开选歌依据'),
          h('p', null, `来源：${({ llm_recommendation: '大肥鱼推荐歌单', netease_similar: '与你常听的歌相似', netease_daily: '网易云每日推荐', netease_personal_fm: '网易云私人 FM', platform_recommendation: '平台推荐' })[current.origin?.source] ?? (current.selectedBy === 'user' ? '你点播' : '常听歌曲')}`),
          current.selectedBy === 'agent' && snapshot?.lastSelection?.detail && h('p', null, `排序得分 ${snapshot.lastSelection.score?.toFixed(3)}；近期已播 ${snapshot.lastSelection.detail.repeatPlays ?? 0} 次。`),
          h('p', null, '喜欢 / 少推荐只影响本机推荐；逐曲说明由已记录的决策生成，不新增模型请求。')))));
  const heroWithLyrics = h('div', { className: 'fm-now-layout' }, hero,
    h(Lyrics, { controller, snapshot, connected: state.connected, visible: view === 'listen', positionMs,
      motion: state.motion, transportPending: state.transportPending,
      accountContext: `${state.platforms?.[current?.track?.provider]?.account?.status ?? ''}:${state.platforms?.[current?.track?.provider]?.account?.accountId ?? ''}` }));
  return h('div', { className: 'fishfm', 'data-view': 'main', 'data-motion': state.motion || 'full' },
    h(DollLayer, { active: presentation.active && state.playbackEffects && state.features?.artwork?.gif, motion: state.motion, names: state.features?.artwork?.dolls }),
    h('div', { className: 'fm-wrap' },
      h('header', { className: 'fm-top' },
        h('div', { className: 'fm-heading' }, h('span', { className: 'fm-brand', 'aria-hidden': true }, h(Svg, { type: 'headphones' })),
          h('div', null, h('h1', null, '肥鱼电台', h('small', { className: 'fm-brand-latin' }, 'FeiyuFM')), h('p', { className: 'fm-subtitle' }, '你的音乐，大肥鱼的偏好。'))),
        h('div', { className: 'fm-top-actions' },
          h('button', { type: 'button', className: 'fm-button', onClick: back }, '返回对话'))),
      h('nav', { className: 'fm-page-nav', 'aria-label': '电台页面' },
        ...[['listen', '正在听'], ['discover', '发现记录'], ['taste', '偏好与反馈'], ['settings', '电台设置']].map(([id, label]) => h('button', {
          type: 'button', key: id, 'aria-pressed': view === id, 'aria-controls': `${rateId}-${id}`, onClick: () => selectView(id),
        }, label))),
      state.error && h('div', { className: 'fm-notice', 'data-error': true, role: 'alert' }, state.error,
        h('button', { className: 'fm-button', type: 'button', disabled: state.busy,
          onClick: state.errorCode === 'no_candidates' && ['llm', 'filtered'].includes(state.insights?.recommendationMode) ? () => controller.platformAction('discovery', 'netease') : controller.refresh },
        state.errorCode === 'no_candidates' && state.insights?.recommendationMode === 'filtered' ? '重新找歌' : state.errorCode === 'no_candidates' && state.insights?.recommendationMode === 'llm' ? '重新核对歌单' : state.connected ? '刷新状态' : '重新连接')),
      snapshot?.lastError && h('div', { className: 'fm-notice', role: 'status' }, playbackNotice(snapshot)),
      snapshot?.blockUntil > Date.now() && h('div', { className: 'fm-notice' }, '今天已停止自主听歌。到期后保持暂停，直到你主动恢复。',
        h('button', { className: 'fm-button', type: 'button', disabled: state.busy || !state.connected, onClick: () => controller.command('chooseSelf') }, '恢复自主听歌')),
      mountedViews.has('listen') && h('div', { className: 'fm-listen-page', id: `${rateId}-listen`, hidden: view !== 'listen' },
        h(UsageGuide, { state, onStep: guideStep, onClose: controller.closeGuide, rootRef: guideRef, titleId: `${rateId}-guide` }), heroWithLyrics,
        h(Persona, { key: 'pool', state, controller, selectedModel, onSelectModel: setSelectedModel })),
      mountedViews.has('discover') && h('div', { className: 'fm-discover-page', id: `${rateId}-discover`, hidden: view !== 'discover' }, h(Discoveries, { state, expanded: true })),
      mountedViews.has('taste') && h('div', { ref: feedbackRef, className: 'fm-taste-page', id: `${rateId}-taste`, hidden: view !== 'taste' }, preferencesColumn),
      mountedViews.has('settings') && h('div', { className: 'fm-settings-page', id: `${rateId}-settings`, hidden: view !== 'settings' }, settingsBody),
      dock()));
}
