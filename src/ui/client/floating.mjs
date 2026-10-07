import { playbackPresentation, popupPlacement, playbackNotice } from './presentation.mjs';
import React from 'react';
import { h, minutes, progressPercent, modes } from './shared.mjs';
import { Svg, SwipeHandle, usePresence, StatusMark, PlaybackArtwork, useSmoothProgress } from './components.mjs';
export function FloatingPlayer({ controller, layout, usePanelInfo }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activePanelId = typeof usePanelInfo === 'function' ? usePanelInfo(info => info.activePanelId) : null;
  const [expanded, setExpanded] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [dragPosition, setDragPosition] = React.useState(null);
  const [popup, setPopup] = React.useState({ side: 'above', maxHeight: 340 });
  const drawerPresence = usePresence(expanded, state.motion);
  const menuPresence = usePresence(menuOpen, state.motion);
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const priorFocus = React.useRef(null);
  const drag = React.useRef(null);
  // Slot entries may add a zero-size wrapper. Position against the shell's
  // actual overlay frame, which owns absolute positioning and edge docking.
  const frameRect = () => {
    const root = rootRef.current;
    return (root?.closest?.('[data-shell-overlay]') ?? root?.parentElement)?.getBoundingClientRect();
  };
  const snapshot = state.snapshot;
  const current = snapshot?.current;
  const playing = snapshot?.status === 'playing';
  const paused = snapshot?.paused === true;
  const settings = snapshot?.settings || {};
  const mode = !settings.listening ? (settings.humanPlayback ? 'manual' : 'off') : !settings.humanPlayback ? 'silent' : settings.strategy === 'focus' ? 'focus' : 'normal';
  const presentation = playbackPresentation(snapshot, state.connected);
  const positionMs = useSmoothProgress(current, presentation.active);
  const image = presentation.art;
  const blocked = !state.connected || state.busy;
  function openDrawer() { priorFocus.current = document.activeElement; setMenuOpen(false); setExpanded(true); }
  function openMenu() { priorFocus.current = document.activeElement; setExpanded(false); setMenuOpen(true); }
  function closeOverlay() { setExpanded(false); setMenuOpen(false); }
  React.useEffect(() => {
    if (!expanded && !menuOpen) { priorFocus.current?.focus?.(); return undefined; }
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeOverlay(); }
      if (menuOpen && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(rootRef.current?.querySelectorAll('.fm-float-menu button:not(:disabled)') ?? []);
        if (!items.length) return;
        event.preventDefault();
        const currentIndex = items.indexOf(document.activeElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (currentIndex + 1) % items.length : (currentIndex - 1 + items.length) % items.length;
        items[index]?.focus();
      }
    };
    const onOutside = event => { if (!rootRef.current?.contains(event.target)) closeOverlay(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onOutside, true);
    const focusTarget = rootRef.current?.querySelector(expanded ? '.fm-drawer-close' : '.fm-float-menu button');
    focusTarget?.focus?.();
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onOutside, true); };
  }, [expanded, menuOpen]);
  React.useEffect(() => {
    if (!expanded && !menuOpen) return undefined;
    const reposition = () => {
      const frame = frameRect(), rect = rootRef.current?.getBoundingClientRect();
      if (frame && rect) setPopup(popupPlacement(frame, rect, menuOpen ? 440 : 320));
    };
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [expanded, menuOpen, state.widgetPosition]);
  React.useEffect(() => {
    const keepInFrame = () => {
      const root = rootRef.current;
      const position = controller.getSnapshot().widgetPosition;
      const frame = frameRect();
      const rect = root?.getBoundingClientRect();
      if (!position || !frame || !rect || frame.height <= 0) return;
      const top = Math.max(4, Math.min(position.top, frame.height - rect.height - 4));
      if (top !== position.top) controller.setWidgetPosition({ edge: position.edge, top });
    };
    window.addEventListener('resize', keepInFrame);
    return () => window.removeEventListener('resize', keepInFrame);
  }, [controller, state.widgetPosition]);
  function dragStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const root = rootRef.current;
    const rect = root?.getBoundingClientRect();
    const frame = frameRect();
    if (!rect || !frame) return;
    drag.current = { startX: event.clientX, startY: event.clientY, left: rect.left - frame.left, top: rect.top - frame.top,
      width: rect.width, height: rect.height, frameWidth: frame.width, frameHeight: frame.height };
    closeOverlay();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* PointerCapture is optional */ }
    event.preventDefault();
  }
  function dragMove(event) {
    if (!drag.current) return;
    const next = drag.current;
    next.left = Math.max(4, Math.min(next.frameWidth - next.width - 4, next.left + event.clientX - next.startX));
    next.top = Math.max(4, Math.min(next.frameHeight - next.height - 4, next.top + event.clientY - next.startY));
    next.startX = event.clientX; next.startY = event.clientY;
    setDragPosition({ left: next.left, top: next.top });
  }
  function dragEnd() {
    if (!drag.current) return;
    const next = drag.current;
    const edge = next.left + next.width / 2 < next.frameWidth / 2 ? 'left' : 'right';
    controller.setWidgetPosition({ edge, top: Math.max(4, Math.min(next.top, next.frameHeight - next.height - 4)) });
    drag.current = null;
    setDragPosition(null);
  }
  function nudge(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const frame = frameRect();
    const rect = rootRef.current?.getBoundingClientRect();
    if (!frame || !rect) return;
    let edge = state.widgetPosition?.edge ?? 'right';
    let top = state.widgetPosition?.top ?? frame.height - rect.height - 18;
    if (event.key === 'ArrowLeft') edge = 'left';
    if (event.key === 'ArrowRight') edge = 'right';
    if (event.key === 'ArrowUp') top -= 16;
    if (event.key === 'ArrowDown') top += 16;
    if (event.key === 'Home') top = 4;
    if (event.key === 'End') top = frame.height - rect.height - 4;
    controller.setWidgetPosition({ edge, top: Math.max(4, Math.min(frame.height - rect.height - 4, top)) });
  }
  if (!state.widgetVisible || activePanelId === 'fishfm') return null;
  const position = state.widgetPosition;
  const style = dragPosition
    ? { left: `${dragPosition.left}px`, top: `${dragPosition.top}px`, right: 'auto', bottom: 'auto' }
    : position?.edge === 'left'
      ? { left: '16px', right: 'auto', top: `${position.top}px`, bottom: 'auto' }
      : position?.edge === 'right'
        ? { right: '16px', left: 'auto', top: `${position.top}px`, bottom: 'auto' }
        : { right: '16px', bottom: '16px', left: 'auto', top: 'auto' };
  return h('div', { ref: rootRef, className: 'fm-float', style: { ...style, '--fm-pop-max': `${popup.maxHeight}px` },
    'data-motion': state.motion || 'full', 'data-dragging': Boolean(dragPosition), 'data-pop-side': popup.side,
    'data-edge': dragPosition ? 'right' : position?.edge || 'right' },
    drawerPresence.mounted && h('div', { id: 'fishfm-quick-controls', className: 'fm-float-drawer', role: 'dialog',
      'data-phase': drawerPresence.phase, onAnimationEnd: drawerPresence.onAnimationEnd,
      'aria-hidden': expanded ? undefined : true, ref: element => { if (element) element.inert = !expanded; },
      'aria-label': '音乐快捷控制', 'aria-modal': false },
      h(SwipeHandle, { onClose: () => setExpanded(false) }),
      h('div', { className: 'fm-float-drawer-head' }, h('span', { className: 'fm-float-drawer-label' }, 'FISHFM / 快捷控制'),
        h('button', { type: 'button', className: 'fm-float-icon fm-drawer-close', 'aria-label': '收起快捷控制', onClick: closeOverlay }, h(Svg, { type: 'close' }))),
      h('div', { className: 'fm-float-drawer-body' },
        current ? h(React.Fragment, null,
          h('div', { className: 'fm-float-track' }, h('strong', null, current.track?.title || '正在播放'), h('span', null, current.track?.artist || '未知艺人')),
          h('div', { className: 'fm-progress' }, h('span', { style: { width: `${progressPercent({ ...current, positionMs })}%` } })),
          h('div', { className: 'fm-time' }, h('span', null, playing ? '正在播放' : paused ? '已暂停' : '等待音乐'),
            h('span', null, `${minutes(positionMs)} / ${current.track?.durationMs ? minutes(current.track.durationMs) : '--:--'}`)))
          : h('div', { className: 'fm-float-empty' }, snapshot ? '当前没有播放曲目。可以打开电台设置或导入音乐。' : state.connected ? '正在读取播放状态…' : '本地音乐服务暂时无法连接。'),
        state.error && h('div', { className: 'fm-notice', 'data-error': true, role: 'alert' }, state.error,
          ' ', h('button', { className: 'fm-button', type: 'button', disabled: state.busy,
            onClick: state.errorCode === 'no_candidates' && ['llm','filtered'].includes(state.insights?.recommendationMode) ? () => controller.platformAction('discovery', 'netease') : controller.refresh },
            state.errorCode === 'no_candidates' && state.insights?.recommendationMode === 'filtered' ? '重新找歌' : state.errorCode === 'no_candidates' && state.insights?.recommendationMode === 'llm' ? '重新核对歌单' : state.connected ? '刷新状态' : '重新连接')),
        snapshot?.lastError && h('div', { className: 'fm-notice', role: 'status' }, playbackNotice(snapshot)),
        h('div', { className: 'fm-float-controls' },
          h('button', { type: 'button', className: 'fm-button fm-primary', disabled: blocked || (!current && !state.library?.total && !snapshot?.queue?.length),
            'aria-label': !current ? '开始听歌' : paused ? '继续播放' : '暂停', onClick: () => controller.playOrPause() }, h(Svg, { type: !current || paused ? 'play' : 'pause' }), !current ? '开始听歌' : paused ? '继续播放' : '暂停'),
          h('button', { type: 'button', className: 'fm-button', disabled: blocked || (!current && !snapshot?.queue?.length && !state.library?.total),
            'aria-label': '播放下一首', onClick: () => controller.command('next') }, h(Svg, { type: 'next' }), '下一首')))),
    menuPresence.mounted && h('div', { className: 'fm-float-menu', role: 'menu', 'aria-label': '音乐快捷菜单',
      'data-phase': menuPresence.phase, onAnimationEnd: menuPresence.onAnimationEnd,
      'aria-hidden': menuOpen ? undefined : true, ref: element => { if (element) element.inert = !menuOpen; } },
      h('div', { className: 'fm-menu-section' }, '快捷模式'),
      modes.map(([id, title]) => h('button', { type: 'button', key: id, role: 'menuitemradio', 'aria-checked': mode === id, disabled: blocked,
        onClick: () => { closeOverlay(); controller.command('setMode', id); } }, h('span', null, title), mode === id && h('span', { className: 'fm-menu-check', 'aria-hidden': true }, '✓'))),
      h('div', { className: 'fm-menu-sep' }),
      h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': Boolean(settings.listening), disabled: blocked,
        onClick: () => controller.command('setListening', !settings.listening) }, h('span', null, 'DeepSeek 自主听歌'), h('span', { className: 'fm-menu-check' }, settings.listening ? '✓' : '')),
      h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': Boolean(settings.humanPlayback), disabled: blocked,
        onClick: () => controller.command('setHumanPlayback', !settings.humanPlayback) }, h('span', null, '电脑输出声音'), h('span', { className: 'fm-menu-check' }, settings.humanPlayback ? '✓' : '')),
      h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': Boolean(settings.discovery), disabled: blocked,
        onClick: () => controller.command('setDiscovery', !settings.discovery) }, h('span', null, '探索新音乐'), h('span', { className: 'fm-menu-check' }, settings.discovery ? '✓' : '')),
      h('div', { className: 'fm-menu-sep' }),
      h('button', { type: 'button', role: 'menuitem', onClick: () => { closeOverlay(); layout.selectPanel('fishfm'); } }, h('span', null, '打开肥鱼电台设置'), h(Svg, { type: 'arrow' })),
      h('button', { type: 'button', role: 'menuitem', onClick: () => { controller.setWidgetVisible(false); closeOverlay(); } }, h('span', null, '隐藏悬浮条'), h('span', null, '×')),
      h('div', { className: 'fm-float-hint' }, `当前模式：${modes.find(([id]) => id === mode)?.[1] || '手动点播'}`)),
    h('div', { className: 'fm-float-pill' },
      h('button', { type: 'button', className: 'fm-float-handle', 'aria-label': '拖动悬浮条；使用方向键移动并吸附边缘', title: '方向键移动；Home 顶部，End 底部',
        onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragEnd, onKeyDown: nudge }, h(Svg, { type: 'grip' })),
      h('button', { ref: triggerRef, type: 'button', className: 'fm-float-trigger', 'aria-expanded': expanded, 'aria-controls': 'fishfm-quick-controls',
        onClick: () => expanded ? closeOverlay() : openDrawer() },
          h('span', { className: 'fm-float-art', 'aria-hidden': true }, h(PlaybackArtwork, { art: image, active: presentation.active, motion: state.motion,
            effects: state.playbackEffects, available: state.features?.artwork?.gif })),
        h('span', { className: 'fm-float-copy' }, h('span', { className: 'fm-float-title' }, current?.track?.title || '肥鱼电台 · 待命'),
          h('span', { className: 'fm-float-artist' }, current?.track?.artist || (state.connected ? '点击展开快捷控制' : '连接本地音乐服务中')),
          h('span', { className: 'fm-float-status' }, h(StatusMark, { active: presentation.active }), presentation.label))),
      h('div', { className: 'fm-float-actions' }, h('button', { type: 'button', className: 'fm-float-icon fm-float-more', 'aria-label': '更多音乐设置',
        'aria-haspopup': 'menu', 'aria-expanded': menuOpen, onClick: () => menuOpen ? closeOverlay() : openMenu() }, h(Svg, { type: 'more' })))),
  );
}
