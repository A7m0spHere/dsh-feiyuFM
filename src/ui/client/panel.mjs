import { playbackPresentation, playbackControls, discoveryPresentation, playbackNotice } from './presentation.mjs';
import React from 'react';
import { h, modes, sourceNames, stageNames, EXPRESSION_LABELS } from './shared.mjs';
import { Svg, StatusMark, PlaybackArtwork, VolumeControl, useSmoothProgress } from './components.mjs';
import { PlaybackTimeline } from './timeline.mjs';
import { Library } from './library.mjs';
import {Persona} from './persona.mjs';
import {FeedbackSettings} from './feedback.mjs';
import {Discoveries} from './discoveries.mjs';
import {ExpressionSettings} from './expression.mjs';
import { NetworkProxySettings } from './network.mjs';
import { DollLayer } from './dolls.mjs';
import { UsageGuide, guideReady } from './guide.mjs';
import { Lyrics } from './lyrics.mjs';
import { PlatformAccount } from './platforms.mjs';
export function Panel({ controller, back }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const snapshot = state.snapshot;
  const account = snapshot?.musicAccount;
  const pendingProvider = account && ['netease', 'qq'].find(id => state.platforms?.[id]?.account?.pending
    || ['waiting', 'scanned'].includes(state.platformStates[id]?.login?.status));
  const visiblePlatform = account?.provider ?? pendingProvider;
  const automaticSource = visiblePlatform ?? snapshot?.playbackSource?.provider ?? 'netease';
  const settings = snapshot?.settings || {};
  const [rate, setRate] = React.useState(20);
  const rateId = React.useId();
  const feedbackRef = React.useRef(null);
  const platformDetailsRef = React.useRef(null), neteaseRef = React.useRef(null);
  const guideRef = React.useRef(null), playRef = React.useRef(null);
  const boardRef = React.useRef(null), flipRectsRef = React.useRef(null), focusGripRef = React.useRef(null);
  const [platformExpanded, setPlatformExpanded] = React.useState(false);
  const [guideFocus, setGuideFocus] = React.useState(null);
  const [view, setView] = React.useState('listen');
  const [dragTile, setDragTile] = React.useState(null);
  const [dropTile, setDropTile] = React.useState(null);
  // Pages mount on first visit and stay mounted (hidden) afterwards, so the
  // first frame only renders the visible tab instead of all four.
  const [mountedViews, setMountedViews] = React.useState(() => new Set([view]));
  const settingsLayout = state.settingsLayout ?? {
    order: ['modes', 'library', 'preferences', 'model', 'network', 'interface'],
    sizes: { modes: 'compact', library: 'compact', preferences: 'compact', model: 'compact', network: 'compact', interface: 'compact' },
    autoFill: true,
  };
  const autoFill = settingsLayout.autoFill !== false;
  const captureTileRects = () => {
    const board = boardRef.current;
    if (!board?.querySelectorAll) return;
    const rects = new Map();
    board.querySelectorAll('[data-tile-id]').forEach(el => {
      if (el.getBoundingClientRect) rects.set(el.dataset.tileId, el.getBoundingClientRect());
    });
    flipRectsRef.current = rects;
  };
  const updateSettingsLayout = next => {
    captureTileRects();
    controller.setSettingsLayout?.(next);
  };
  const resetSettingsLayout = () => {
    captureTileRects();
    controller.resetSettingsLayout?.();
  };
  React.useEffect(() => {
    const focusId = focusGripRef.current;
    if (focusId) {
      focusGripRef.current = null;
      boardRef.current?.querySelector?.(`[data-tile-grip="${focusId}"]`)?.focus?.({ preventScroll: true });
    }
    const firstRects = flipRectsRef.current;
    flipRectsRef.current = null;
    const board = boardRef.current;
    if (!firstRects || !board?.querySelectorAll) return;
    const reduced = state.motion === 'off' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const duration = state.motion === 'reduced' ? 150 : 280;
    board.querySelectorAll('[data-tile-id]').forEach(el => {
      const first = firstRects.get(el.dataset.tileId);
      if (!first || !el.getBoundingClientRect) return;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.getBoundingClientRect();
      el.style.transition = `transform ${duration}ms var(--fm-ease)`;
      el.style.transform = '';
      const cleanup = () => { el.style.transition = ''; el.removeEventListener('transitionend', cleanup); };
      el.addEventListener('transitionend', cleanup);
      setTimeout(cleanup, duration + 60);
    });
  }, [settingsLayout, state.motion]);
  React.useEffect(() => {
    const board = boardRef.current;
    if (!board?.querySelectorAll) return undefined;
    const tiles = Array.from(board.querySelectorAll('[data-tile-id]'));
    if (!autoFill) {
      tiles.forEach(tile => { tile.style.gridRowEnd = ''; });
      return undefined;
    }
    const syncSpan = tile => {
      const frame = tile.querySelector?.('.fm-tile-frame');
      if (!frame) return;
      const height = Math.ceil(frame.offsetHeight || frame.getBoundingClientRect?.().height || 0);
      if (height > 0) tile.style.gridRowEnd = `span ${height + 14}`;
    };
    tiles.forEach(syncSpan);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const tile = entry.target.closest?.('[data-tile-id]');
        if (tile) syncSpan(tile);
      }
    });
    tiles.forEach(tile => {
      const frame = tile.querySelector?.('.fm-tile-frame');
      if (frame) observer.observe(frame);
    });
    return () => observer.disconnect();
  }, [autoFill, settingsLayout, view, mountedViews]);
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
  const accountHint = state.platformError ? '连接状态读取失败' : !state.connected ? '连接中断' : ({authorized:`${automaticSource === 'qq' ? 'QQ 音乐' : '网易云'}已登录`,expired:'登录已过期',signed_out:'未登录',login_required:'等待登录'}[state.platforms?.[automaticSource]?.account?.status] || '查看连接');
  const guideAccountHint = state.guideVisible && ['connect', 'import'].includes(state.guideStage);
  function toggle(title, description, field, command) {
    return h('div', { className: 'fm-row', key: field }, h('div', null, h('div', { className: 'fm-label' }, title), h('p', null, description)),
      h('button', { type: 'button', className: 'fm-toggle', role: 'switch', 'aria-label': title, 'aria-checked': Boolean(settings[field]), disabled,
        onClick: () => controller.command(command, !settings[field]) }, h('span')));
  }
  const button = (label, type, blocked = false, extra = {}) => h('button', { type: 'button', className: 'fm-button', disabled: disabled || blocked, onClick: () => controller.command(type), ...extra }, label);
  const platformSection = h('section', null,
    h('h2', null, '音乐平台', h('small', null, 'ACCOUNTS')),
    h('div', { className: 'fm-card' },
      ...[['netease', '网易云音乐'], ['qq', 'QQ 音乐']].filter(([id]) => !visiblePlatform || id === visiblePlatform).map(([id, title]) =>
        h(PlatformAccount, { key: `${id}:${account?.revision ?? ''}`, id, title, state, controller, regionRef: id === automaticSource ? neteaseRef : undefined })),
      state.platformError && h('p', { className: 'fm-note', role: 'alert' }, state.platformError,
        h('button', { type: 'button', className: 'fm-button', onClick: controller.refresh }, '重试连接状态')),
      guideAccountHint && h('p', { className: 'fm-note fm-guide-target-note', role: 'status' },
        account?.provider || state.platforms?.[automaticSource]?.account?.status === 'authorized'
          ? '选择曲库来源并导入参考歌曲。' : '任选一个音乐平台扫码，登录后导入参考歌曲。'),
      h('p', { className: 'fm-platform-note' }, '网易云可导入近期记录、喜欢或歌单。QQ 可导入喜欢或歌单，使用手机 QQ 扫码。登录材料保存在本机加密存储中。')));

  const preferencesColumn = h('div', {className:'fm-main-column'},
        h(FeedbackSettings,{state,controller}),
        insights&&h('section',null,h('h2',null,'听歌记录'),h('details',{className:'fm-card fm-profile-details',open:true},h('summary',null,'查看偏好与听歌记录'),
          h('p',{className:'fm-note'},'本地画像 · 来自已保存的独立偏好'),
          ...(insights.profile?.artists?.length?insights.profile.artists.slice(0,5).map(a=>h('div',{className:'fm-affinity-row',key:a.key},
            h('strong',null,a.name),h('span',{className:'fm-badge'},`权重 ${Math.round(a.affinity*100)}% · ${['listen','listen_silent'].includes(a.source)?'有效经历':a.source==='legacy_artist_link'?'旧偏好链接':'初始化/维护'}`),
            h('div',{className:'fm-affinity-bar','aria-hidden':true},h('i',{style:{width:`${Math.max(0,Math.min(100,Math.round(a.affinity*100)))}%`}})))):[h('p',{className:'fm-note'},'还没有足够的艺人偏好记录。')]),
          h('p',{className:'fm-note'},'流派/情绪特征尚未提供，不据歌名推断。'),
          Array.isArray(insights.profile?.tracks)&&h('details',null,h('summary',null,'查看歌曲偏好与最近变化'),
            ...(insights.profile?.tracks??[]).map(t=>h('p',{className:'fm-note',key:t.key},`${t.title} · 权重 ${Math.round(t.affinity*100)}% · ${['listen','listen_silent'].includes(t.source)?'有效经历':'初始化/维护'}`)),
            h('p',{className:'fm-label'},'最近有效更新'),
            ...(insights.recentChanges?.length?insights.recentChanges.slice(0,3).map(c=>h('p',{className:'fm-note',key:c.playInstanceId},`${c.title} · ${c.before.toFixed(3)} → ${c.after.toFixed(3)} · ${c.audible?'有声':'静音'}经历`)):[h('p',{className:'fm-note'},'此决策窗口还没有有效偏好更新。')])),
          h('details',null,h('summary',null,'查看选歌统计'),h('p',{className:'fm-note'},`最近保留 ${insights.statistics?.retainedDecisions??0} 次自主决策；探索尝试 ${insights.statistics?.explorationAttempts??0} 次，选中陌生候选 ${insights.statistics?.unfamiliarSelections??0} 次，已观测开始 ${insights.statistics?.observedStarts??0} 次，有效陌生经历 ${insights.statistics?.validUnfamiliarListens??0} 次。`),
            Number.isFinite(insights.statistics?.repeatedSelections)&&h('p',{className:'fm-note'},`其中 ${insights.statistics.repeatedSelections} 次选中歌曲在近期已有播放历史。`),
            ...(insights.decisions??[]).slice(0,3).map(d=>h('p',{className:'fm-note',key:d.decisionId},`${d.trackTitle??d.trackKey??'未选中歌曲'} · ${d.pool==='queue'?'队列':d.pool==='discovery'?'新歌':'常听歌曲'}${d.fellBack?'（回退）':''}${d.trackKey?'':' · 本次未开始播放'}`)),
            h('p',{className:'fm-note'},`${Number.isFinite(insights.statistics?.windowStart)?`窗口始于 ${new Date(insights.statistics.windowStart).toLocaleString()}。`:''}按已追踪的决策实例统计，历史覆盖不足时不视作全期比例。`)))));
  const modeMeta = modes.find(([id]) => id === mode) ?? ['manual', '手动', '仅手动点播：保留声音，不自动选歌'];
  const activeRoute = (state.summaryModels ?? []).find(item => JSON.stringify([item.provider, item.model]) === selectedModel)
    ?? state.persona?.recommendationRoute ?? state.persona?.lastModelRoute;
  const remainingTokens = state.persona?.ledger?.remainingTokens;
  const motionText = ({ full: '完整动效', reduced: '轻量动效', off: '关闭动效' })[state.motion || 'full'] || '完整动效';
  const exprText = EXPRESSION_LABELS[state.expression?.style ?? 'current'] || '保持当前';
  const setTileSize = (id, nextSize) => updateSettingsLayout({ ...settingsLayout, sizes: { ...settingsLayout.sizes, [id]: nextSize } });
  const setAllTileSizes = target => {
    const sizes = {};
    for (const id of settingsLayout.order) sizes[id] = target;
    updateSettingsLayout({ ...settingsLayout, sizes });
  };
  const moveTileOrder = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = settingsLayout.order.indexOf(fromId);
    const toIdx = settingsLayout.order.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = settingsLayout.order.filter(item => item !== fromId);
    const targetIdx = next.indexOf(toId);
    next.splice(fromIdx < toIdx ? targetIdx + 1 : targetIdx, 0, fromId);
    updateSettingsLayout({ ...settingsLayout, order: next });
  };
  const nudgeTile = (id, delta) => {
    const idx = settingsLayout.order.indexOf(id);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= settingsLayout.order.length) return;
    const next = [...settingsLayout.order];
    [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
    focusGripRef.current = id;
    updateSettingsLayout({ ...settingsLayout, order: next });
  };
  const settingsTileDefs = {
    modes: {
      title: '听歌方式',
      pill: modeMeta[1],
      pillTone: 'accent',
      sub: modeMeta[2],
      canWide: false,
      quick: h('div', { className: 'fm-tile-quick' }, modes.map(([id, title, desc]) =>
        h('button', { type: 'button', key: id, className: 'fm-quick-chip', 'aria-pressed': mode === id, disabled, title: desc,
          onClick: event => { event.stopPropagation(); controller.command('setMode', id); } }, title))),
      body: h(React.Fragment, null,
        h('div', { className: 'fm-modes' }, modes.map(([id, title, desc]) =>
          h('button', { type: 'button', key: id, className: 'fm-mode', 'data-selected': mode === id, 'aria-pressed': mode === id, disabled,
            title: desc, onClick: () => controller.command('setMode', id) }, h('strong', null, title), h('span', null, desc)))),
        mode === 'manual' && h('p', { className: 'fm-note' }, '仅手动点播：保留声音，不自动选歌。'),
        h('div', { className: 'fm-stop-wrap' },
          h('span', { className: 'fm-note' }, '暂停并禁止自主听歌至今日结束'),
          button('今天停止', 'stopForToday', Boolean(state.transportPending)))),
    },
    library: {
      title: '输入与连接',
      pill: `${accountHint} · ${state.library?.total ?? 0} 首`,
      pillTone: state.platforms?.[automaticSource]?.account?.status === 'authorized' ? 'ok' : 'neutral',
      sub: '管理音乐平台账号、导入参考歌单与搜索输入曲库',
      canWide: true,
      body: h('div', { className: 'fm-tile-wide-grid' },
        h('details', { className: 'fm-platform-details fm-input-library', ref: platformDetailsRef, open: platformExpanded,
          'data-guide-reveal': ['connect', 'import'].includes(guideFocus) || undefined,
          onToggle: event => setPlatformExpanded(event.currentTarget.open) },
          h('summary', null, '音乐平台', h('span', { className: 'fm-disclosure-meta' }, accountHint)), platformSection),
        h('details', { className: 'fm-input-library' },
          h('summary', null, `输入曲库 · ${state.library?.total ?? 0} 首（展开查看）`), h(Library, { state, controller }))),
    },
    preferences: {
      title: '听歌偏好',
      pill: `${settings.listening ? '自主开' : '自主关'} · ${settings.humanPlayback ? '有声' : '静音'} · 探索 ${rate}%`,
      pillTone: 'neutral',
      sub: '自主听歌、电脑输出声音与新歌探索比例',
      canWide: false,
      body: h('div', { className: 'fm-card' },
        toggle('DeepSeek 自主听歌', '自动选歌、续播并积累偏好。', 'listening', 'setListening'),
        toggle('电脑输出声音', '关闭只静音，不暂停听歌。', 'humanPlayback', 'setHumanPlayback'),
        toggle('探索新音乐', '从可播放的新歌候选中探索。', 'discovery', 'setDiscovery'),
        h('p', { className: 'fm-note', role: 'status', 'aria-live': 'polite' }, discoveryPresentation(snapshot)),
        snapshot?.lastSelection?.fellBack && h('p', { className: 'fm-note' },
          snapshot.lastSelection.fallbackReason?.includes('平台相似推荐')
            ? '最近一次手动回退：推荐歌单与输入曲库暂无未播曲目，改播平台相似推荐里已确认可播的新歌。'
            : '最近一次自主选择：没有合适的新歌，先播了常听歌曲。'),
        state.features?.discoveryRefresh && insights?.recommendationMode !== 'filtered' && h('button', { type: 'button', className: 'fm-button', disabled: disabled || state.platformBusy || !settings.discovery || settings.discoveryRate === 0 || state.platforms?.[automaticSource]?.account?.status !== 'authorized',
          onClick: () => controller.platformAction('discovery', automaticSource) }, '刷新新歌推荐'),
        h('div', { className: 'fm-rate' }, h('div', { className: 'fm-rate-head' }, h('label', { htmlFor: rateId }, '新歌探索率'), h('output', { htmlFor: rateId }, `${rate}%`)),
          h('input', { id: rateId, 'aria-label': '新歌探索率', type: 'range', min: 0, max: 100, step: 1, value: rate, disabled: disabled || !settings.discovery,
            onChange: e => setRate(Number(e.target.value)) }),
          h('div', { className: 'fm-save-line' }, h('span', { className: 'fm-save', role: 'status', 'aria-live': 'polite' }, state.notice || '开关即时保存；探索率需点击保存。'),
            h('button', { type: 'button', className: 'fm-button', disabled: disabled || !settings.discovery || rate === Math.round(settings.discoveryRate * 100),
              onClick: () => controller.command('setDiscoveryRate', rate / 100) }, '保存')))),
    },
    model: {
      title: '模型与推荐',
      pill: activeRoute?.model ? `${activeRoute.model}${Number.isFinite(remainingTokens) ? ` · 余 ${remainingTokens}` : ''}` : '查看模型与预算',
      pillTone: 'neutral',
      sub: '挑歌模型选择、每日共享 token 预算与用量诊断',
      canWide: false,
      body: h(Persona, { key: 'settings', state, controller, settingsOnly: true, selectedModel, onSelectModel: setSelectedModel }),
    },
    network: {
      title: '网络连接',
      pill: state.networkProxy?.mode === 'proxy' ? '自定义代理' : '直连（默认）',
      pillTone: state.networkProxy?.mode === 'proxy' ? 'accent' : 'ok',
      sub: '平台接口与音频下载路由，TUN／VPN 分流由外部管理',
      canWide: false,
      body: h(NetworkProxySettings, { state, controller }),
    },
    interface: {
      title: '界面与指南',
      pill: `${motionText} · 频谱${state.spectrumVisible ? '开' : '关'}`,
      pillTone: 'neutral',
      sub: `表达「${exprText}」 · 悬浮条${state.widgetVisible ? '显示' : '隐藏'} · 使用指南`,
      canWide: true,
      body: h('div', { className: 'fm-tile-wide-grid' },
        h('div', null,
          h(ExpressionSettings, { state, controller }),
          h('div', { className: 'fm-stop-wrap' },
            h('span', { className: 'fm-note' }, '选择音乐平台并导入参考歌曲，了解推荐反馈。'),
            h('button', { type: 'button', className: 'fm-button fm-guide-open', disabled: !guideReady(state), onClick: () => {
              controller.openGuide(); selectView('listen', false); setGuideFocus('guide');
            } }, '打开使用指南')),
          !guideReady(state) && h('p', { className: 'fm-note' }, '连接状态恢复后可打开指南。')),
        h('div', null,
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
              onClick: () => controller.setWidgetVisible(!state.widgetVisible) }, state.widgetVisible ? '隐藏' : '显示')))),
    },
  };
  const settingsBody = h('div', { className: 'fm-settings-body fm-settings-modular', 'aria-label': '电台设置' },
    h('div', { className: 'fm-settings-toolbar' },
      h('span', null, '拖动卡片左上手柄可自由排序 · 表单卡片固定单列防变形，宽内容支持跨列宽展'),
      h('div', { className: 'fm-settings-toolbar-actions' },
        h('button', { type: 'button', className: 'fm-button fm-autofill-toggle', role: 'switch',
          'aria-checked': autoFill, title: '展开组件时由其他卡片自动填补空位',
          onClick: () => updateSettingsLayout({ ...settingsLayout, autoFill: !autoFill }) },
        h('span', { className: 'fm-autofill-dot', 'aria-hidden': true }), '自动补齐空白'),
        h('button', { type: 'button', className: 'fm-button', onClick: () => setAllTileSizes('compact') }, '全部最简'),
        h('button', { type: 'button', className: 'fm-button', onClick: () => setAllTileSizes('standard') }, '全部展开'),
        h('button', { type: 'button', className: 'fm-button', onClick: resetSettingsLayout }, '恢复默认'))),
    h('div', { className: 'fm-settings-board', ref: boardRef, 'data-auto-fill': autoFill },
      settingsLayout.order.map(id => {
        const def = settingsTileDefs[id];
        const size = settingsLayout.sizes?.[id] || 'compact';
        const expanded = size !== 'compact';
        return h('section', {
          key: id, className: 'fm-setting-tile', 'data-tile-id': id, 'data-size': size,
          'data-dragging': dragTile === id || undefined, 'data-drop-target': dropTile === id && dragTile !== id || undefined,
          'data-guide-reveal': id === 'library' && ['connect', 'import'].includes(guideFocus) || undefined,
          onDragOver: event => {
            if (!dragTile || dragTile === id) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            if (dropTile !== id) setDropTile(id);
          },
          onDragLeave: event => {
            if (!event.currentTarget?.contains?.(event.relatedTarget) && dropTile === id) setDropTile(null);
          },
          onDrop: event => {
            event.preventDefault();
            const from = dragTile || event.dataTransfer?.getData?.('text/plain');
            setDragTile(null); setDropTile(null);
            if (from && from !== id) moveTileOrder(from, id);
          },
        },
        h('div', { className: 'fm-tile-frame' },
          h('div', { className: 'fm-tile-head', draggable: true,
            onDragStart: event => {
              if (event.target?.closest?.('button:not(.fm-tile-grip), input, select, textarea')) { event.preventDefault(); return; }
              setDragTile(id);
              event.dataTransfer?.setData?.('text/plain', id);
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                const tile = event.currentTarget?.closest?.('[data-tile-id]');
                if (tile && event.dataTransfer.setDragImage) {
                  const rect = tile.getBoundingClientRect?.();
                  event.dataTransfer.setDragImage(tile, rect ? Math.max(0, event.clientX - rect.left) : 20, rect ? Math.max(0, event.clientY - rect.top) : 20);
                }
              }
            },
            onDragEnd: () => { setDragTile(null); setDropTile(null); },
            onClick: event => { if (!event.target?.closest?.('button')) setTileSize(id, expanded ? 'compact' : 'standard'); } },
            h('button', { type: 'button', className: 'fm-tile-grip', 'data-tile-grip': id,
              'aria-label': `拖动调整「${def.title}」顺序；方向键上下移动`, title: '拖动调整顺序；方向键上下移动',
              onKeyDown: event => {
                if (event.key === 'ArrowUp') { event.preventDefault(); nudgeTile(id, -1); }
                else if (event.key === 'ArrowDown') { event.preventDefault(); nudgeTile(id, 1); }
              } }, h(Svg, { type: 'grip' })),
            h('div', { className: 'fm-tile-title-wrap' },
              h('div', { className: 'fm-tile-title-row' },
                h('span', { className: 'fm-tile-title' }, def.title),
                h('span', { className: 'fm-tile-pill', 'data-ok': def.pillTone === 'ok' || undefined, 'data-accent': def.pillTone === 'accent' || undefined }, def.pill)),
              h('div', { className: 'fm-tile-sub-wrap' }, h('span', { className: 'fm-tile-sub' }, def.sub))),
            h('div', { className: 'fm-tile-actions' },
              def.canWide
                ? h('button', { type: 'button', className: 'fm-tile-btn fm-tile-widen-btn', 'aria-pressed': size === 'wide', title: '切换单列 / 跨两列宽展',
                  onClick: event => { event.stopPropagation(); setTileSize(id, size === 'wide' ? 'standard' : 'wide'); } }, size === 'wide' ? '标准宽' : '宽展')
                : h('span', { className: 'fm-fixed-tag', title: '表单类组件固定舒适单列宽' }, '固定宽'),
              h('button', { type: 'button', className: 'fm-tile-btn', 'aria-expanded': expanded,
                'aria-label': `${expanded ? '收起' : '展开'}${def.title}`,
                onClick: event => { event.stopPropagation(); setTileSize(id, expanded ? 'compact' : 'standard'); } }, expanded ? '收起' : '展开'))),
          def.quick && h('div', { className: 'fm-tile-quick-wrap' }, h('div', { className: 'fm-tile-quick-inner' }, def.quick)),
          h('div', { className: 'fm-tile-collapse', ref: element => { if (element) element.inert = !expanded; } },
            h('div', { className: 'fm-tile-collapse-inner' }, h('div', { className: 'fm-tile-body' }, def.body)))));
      })));
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
    if (step !== 'listen') {
      setPlatformExpanded(true);
      if ((settingsLayout.sizes?.library || 'compact') === 'compact') {
        updateSettingsLayout({ ...settingsLayout, sizes: { ...settingsLayout.sizes, library: 'standard' } });
      }
    }
    setGuideFocus(step);
  };
  // 未配置推荐模型时，「重新找歌」不会产生有效筛选：改为引导到电台设置选择
  // 模型或补充可播放歌曲，避免用户反复点一个不会生效的按钮。
  const errorAction = (() => {
    if (state.errorCode !== 'no_candidates') return { label: state.connected ? '刷新状态' : '重新连接', onClick: controller.refresh };
    const mode = state.insights?.recommendationMode;
    if (mode !== 'llm' && state.persona && !state.persona.recommendationRoute?.model) {
      return { label: '去电台设置选择模型', onClick: () => selectView('settings') };
    }
    if (mode === 'llm') return { label: '重新核对歌单', onClick: () => controller.platformAction('discovery', automaticSource) };
    return { label: '重新找歌', onClick: () => controller.platformAction('discovery', automaticSource) };
  })();
  const dock = () => h('div', { className: 'fm-player-dock', 'aria-label': '播放控制' },
    h('div', { className: 'fm-dock-track' }, h('strong', null, current?.track?.title || '肥鱼电台'), h('span', null, (current?.track ? `${current.track.artist || '未知艺人'} · ${current.track.provider === 'qq' ? 'QQ 音乐' : '网易云音乐'}` : '') || '等待音乐')),
    h('div', { className: 'fm-dock-center' }, h('div', { className: 'fm-controls' },
      h('button', { type: 'button', className: 'fm-button fm-transport', disabled: transport.previousDisabled,
        'aria-busy': state.transportPending === 'previous', onClick: () => controller.command('previous') },
        h(Svg, { type: 'prev' }), transport.previousLabel),
      h('button', { type: 'button', className: 'fm-button fm-primary fm-transport', ref: playRef, disabled: transport.playDisabled,
        'aria-busy': state.transportPending === 'pause', onClick: () => transport.action === 'pause' ? controller.command('pause') : controller.playOrPause() },
        h(Svg, { type: transport.icon }), transport.label),
      h('button', { type: 'button', className: 'fm-button fm-transport', disabled: transport.nextDisabled,
        'aria-busy': state.transportPending === 'next', onClick: () => controller.command('next') }, h(Svg, { type: 'next' }), transport.nextLabel)),
      current && h(PlaybackTimeline, { key: current.playInstanceId, controller, state, positionMs })),
    h(VolumeControl, { controller, state }));


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
        h('p', { className: 'fm-artist' }, (current?.track ? `${current.track.artist || '未知艺人'} · ${current.track.provider === 'qq' ? 'QQ 音乐' : '网易云音乐'}` : '') || (state.library?.total ? '让大肥鱼挑一首，或点播你想听的歌。' : '打开电台设置，选择音乐平台并导入歌曲。'))),
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
          h('p', null, `来源：${({ llm_recommendation: '大肥鱼推荐歌单', netease_similar: '与你常听的歌相似', netease_daily: '网易云每日推荐', netease_personal_fm: '网易云私人 FM', qq_similar: '与你常听的歌相似', qq_daily: 'QQ 每日推荐', qq_personal_fm: 'QQ 私人 FM', platform_recommendation: '平台推荐' })[current.origin?.source] ?? (current.selectedBy === 'user' ? '你点播' : '常听歌曲')}`),
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
          onClick: errorAction.onClick }, errorAction.label)),
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
