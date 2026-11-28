import React from 'react';
import { canSeekPlayback } from './presentation.mjs';
import { h, minutes } from './shared.mjs';

export function PlaybackTimeline({ controller, state, positionMs, playbackLabel }) {
  const { snapshot, connected, transportPending } = state;
  const { playInstanceId, track } = snapshot.current;
  const duration = track?.durationMs;
  const knownDuration = Number.isSafeInteger(duration) && duration > 0;
  const canSeek = canSeekPlayback(snapshot, connected, transportPending);
  const maxTarget = knownDuration ? duration - 1 : 0;
  const clampTarget = ms => Math.max(0, Math.min(maxTarget, Math.round(ms)));
  const [hover, setHover] = React.useState(null);
  const [drag, setDrag] = React.useState(null);
  const [submitted, setSubmitted] = React.useState(null);
  const slider = React.useRef(null);
  const pointer = React.useRef(null);
  const trackRect = React.useRef(null);

  React.useEffect(() => {
    if (canSeek) return;
    pointer.current = null;
    trackRect.current = null;
    setDrag(null);
    setHover(null);
  }, [canSeek]);

  const pending = snapshot.seekPending?.playInstanceId === playInstanceId ? snapshot.seekPending?.positionMs ?? null : null;
  const requested = (transportPending === 'seek' ? submitted?.positionMs : null) ?? pending;
  const preview = canSeek ? drag ?? hover ?? requested : null;
  const displayMs = clampTarget(drag ?? requested ?? positionMs);
  const value = displayMs;
  const ratio = knownDuration ? Math.max(0, Math.min(1, displayMs / duration)) : 0;
  const percent = ms => knownDuration ? `${100 * Math.max(0, Math.min(duration, ms)) / duration}%` : '0%';

  function seek(ms) {
    if (!canSeek || pointer.current !== null) return;
    const target = { playInstanceId, positionMs: clampTarget(ms) };
    setSubmitted(target);
    void controller.command('seek', target).finally(() => {
      setSubmitted(previous => previous === target ? null : previous);
    });
  }

  function pointerTarget(event, cachedRect = null) {
    const { left, width } = cachedRect ?? event.currentTarget.getBoundingClientRect();
    return clampTarget(duration * (event.clientX - left) / Math.max(1, width));
  }

  function startDrag(event) {
    if (!canSeek || pointer.current !== null || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    slider.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = event.pointerId;
    const rect = event.currentTarget.getBoundingClientRect();
    trackRect.current = rect;
    setDrag(pointerTarget(event, rect));
  }

  function movePointer(event) {
    if (!canSeek || !event.isPrimary) return;
    if (pointer.current === event.pointerId) setDrag(pointerTarget(event, trackRect.current));
    else if (event.pointerType !== 'touch') setHover(pointerTarget(event));
  }

  function cancelDrag(event) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    trackRect.current = null;
    setDrag(null);
    setHover(null);
  }

  function finishDrag(event) {
    if (pointer.current !== event.pointerId) return;
    const target = pointerTarget(event, trackRect.current);
    cancelDrag(event);
    if (event.pointerType !== 'touch' && event.currentTarget.matches(':hover')) setHover(target);
    seek(target);
  }

  function adjustWithKey(event) {
    if (!canSeek) return;
    const base = requested ?? value;
    const targets = { ArrowLeft: base - 5000, ArrowDown: base - 5000,
      ArrowRight: base + 5000, ArrowUp: base + 5000, Home: 0, End: maxTarget };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    if (pointer.current !== null) return;
    setHover(null);
    seek(targets[event.key]);
  }

  const seeking = pending !== null || transportPending === 'seek';
  const bar = h('div', { className: 'fm-seek', 'data-enabled': canSeek, 'data-preview': preview !== null,
    'data-dragging': drag !== null, 'data-seeking': seeking,
    onPointerDown: startDrag, onPointerEnter: movePointer, onPointerMove: movePointer, onPointerUp: finishDrag,
    onPointerCancel: cancelDrag, onLostPointerCapture: cancelDrag, onPointerLeave: () => setHover(null),
    style: { '--fm-seek-position': percent(displayMs), '--fm-seek-ratio': String(ratio), '--fm-seek-preview': percent(preview ?? value) } },
    h('input', { ref: slider, className: 'fm-seek-input', type: 'range', min: 0, max: maxTarget, step: 1,
      value, disabled: !canSeek, 'aria-label': '播放进度',
      'aria-valuetext': `${minutes(displayMs)} / ${knownDuration ? minutes(duration) : '未知时长'}`,
      onChange: event => seek(event.currentTarget.valueAsNumber), onKeyDown: adjustWithKey }),
    h('div', { className: 'fm-seek-rail', 'aria-hidden': true },
      h('span', { className: 'fm-seek-fill' }), h('span', { className: 'fm-seek-thumb' }),
      h('span', { className: 'fm-seek-marker' })),
    canSeek && h('span', { className: 'fm-seek-tooltip', 'aria-hidden': true }, minutes(preview ?? value)));
  const total = knownDuration ? minutes(duration) : '--:--';
  const error = snapshot.seekError?.message;
  return h('div', { className: 'fm-playback-timeline' },
    playbackLabel
      ? h(React.Fragment, null, bar, h('div', { className: 'fm-time' },
        h('span', null, playbackLabel), h('span', null, `${minutes(displayMs)} / ${total}`)))
      : h('div', { className: 'fm-dock-timeline' }, h('span', null, minutes(displayMs)), bar, h('span', null, total)),
    h('div', { className: 'fm-seek-status', role: 'status', 'data-pending': seeking, 'data-error': !seeking && Boolean(error) },
      seeking ? '正在跳转…' : error));
}
