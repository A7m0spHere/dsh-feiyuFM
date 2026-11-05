import React from 'react';
import { h, minutes } from './shared.mjs';

export function lyricLineIndex(lines, positionMs) {
  let low = 0, high = lines.length;
  while (low < high) { const mid = (low + high) >>> 1; if (lines[mid].startMs <= positionMs) low = mid + 1; else high = mid; }
  return low - 1;
}

export function Lyrics({ controller, snapshot, connected, visible, positionMs, motion, transportPending, accountContext = '' }) {
  const track = snapshot?.current?.track;
  const key = track ? `${track.provider}:${track.providerTrackId}|${accountContext}` : '';
  const [loaded, setLoaded] = React.useState(null);
  const [retry, setRetry] = React.useState(0);
  const [translation, setTranslation] = React.useState(false);
  const [romanization, setRomanization] = React.useState(false);
  const [following, setFollowing] = React.useState(true);
  const [pageVisible, setPageVisible] = React.useState(!document.hidden);
  const viewport = React.useRef(null);
  React.useEffect(() => {
    const change = () => setPageVisible(!document.hidden);
    document.addEventListener?.('visibilitychange', change);
    return () => document.removeEventListener?.('visibilitychange', change);
  }, []);
  React.useEffect(() => { setFollowing(true); }, [key, snapshot?.current?.playInstanceId]);
  React.useEffect(() => {
    if (!key || !visible || !pageVisible || !connected) return undefined;
    let cancelled = false;
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 17_000);
    setLoaded(value => value?.key === key && value.data ? value : { key, status: 'loading' });
    controller.readLyrics(track, request.signal).then(data => {
      if (!cancelled && !request.signal.aborted) setLoaded({ key, data });
    }).catch(error => {
      if (!cancelled) setLoaded({ key, status: 'error', message: error?.message || '歌词读取失败，请重试。' });
    }).finally(() => clearTimeout(timeout));
    return () => { cancelled = true; clearTimeout(timeout); request.abort(); };
  }, [key, connected, visible, pageVisible, retry, controller]);
  const value = loaded?.key === key ? loaded : null;
  const data = value?.data;
  const lines = data?.lines ?? [];
  const index = lyricLineIndex(lines, positionMs);
  React.useEffect(() => {
    if (!following || !visible || !pageVisible || index < 0) return;
    const root = viewport.current;
    const row = root?.querySelector(`[data-lyric-index="${index}"]`);
    if (!row) return;
    const reduced = motion === 'off' || motion === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    root.scrollTo?.({ top: Math.max(0, row.offsetTop - root.clientHeight * .34), behavior: reduced ? 'instant' : 'smooth' });
  }, [index, following, visible, pageVisible, translation, romanization, data, motion]);
  const canSeek = connected && snapshot?.playbackCapabilities?.seek && track?.durationMs > 0
    && (!transportPending || transportPending === 'seek');
  const option = (label, enabled, active, change) => h('button', { type: 'button', className: 'fm-lyric-option',
    disabled: !enabled, 'aria-pressed': active, onClick: () => change(!active) }, label);
  let content;
  if (!key) content = h('p', { className: 'fm-lyrics-empty' }, '播放歌曲后，歌词会显示在这里');
  else if (!connected && !data) content = h('p', { className: 'fm-lyrics-empty' }, '连接恢复后读取歌词');
  else if (!value || value.status === 'loading') content = h('p', { className: 'fm-lyrics-empty' }, '正在读取歌词…');
  else if (value.status === 'error') content = h('div', { className: 'fm-lyrics-empty' }, h('p', null, value.message),
    h('button', { type: 'button', className: 'fm-button', disabled: !connected, onClick: () => setRetry(count => count + 1) }, '重试'));
  else if (data?.status === 'synced') content = lines.map((line, i) => h('button', {
    type: 'button', key: line.id, className: 'fm-lyric-line', 'data-lyric-index': i,
    'data-active': i === index, 'aria-current': i === index ? 'true' : undefined,
    disabled: !canSeek || line.startMs >= track.durationMs || !line.text,
    'aria-label': line.text ? `跳转到 ${minutes(line.startMs)} ${line.text}` : '间奏',
    onClick: () => { setFollowing(true); void controller.command('seek', { positionMs: line.startMs, playInstanceId: snapshot.current.playInstanceId }); },
  }, h('span', { className: line.text ? 'fm-lyric-original' : 'fm-lyric-interlude' }, line.text || '···'),
  translation && line.translation && h('span', { className: 'fm-lyric-secondary' }, line.translation),
  romanization && line.romanization && h('span', { className: 'fm-lyric-secondary' }, line.romanization)));
  else if (data?.status === 'unsynced') content = h('div', { className: 'fm-lyrics-plain' },
    h('p', { className: 'fm-lyric-hint' }, '此歌词暂无时间信息'), h('p', null, data.text));
  else content = h('p', { className: 'fm-lyrics-empty' }, ({ instrumental: '纯音乐，请欣赏', unsupported: '此平台暂不支持歌词' })[data?.status] || '暂时没有这首歌的歌词');
  return h('section', { className: 'fm-lyrics', 'aria-label': '当前歌曲歌词' },
    h('div', { className: 'fm-lyrics-heading' }, h('span', null, '歌词'), h('div', { className: 'fm-lyric-options' },
      option('翻译', lines.some(line => line.translation), translation, setTranslation),
      option('音译', lines.some(line => line.romanization), romanization, setRomanization))),
    h('div', { className: 'fm-lyrics-scroll', ref: viewport, tabIndex: 0, 'aria-label': '歌词内容',
      onWheel: () => setFollowing(false), onTouchStart: () => setFollowing(false),
      onPointerDown: event => { if (event.target === viewport.current) setFollowing(false); },
      onKeyDown: event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setFollowing(false); } }, content),
    h('div', { className: 'fm-lyrics-footer' }, !following && lines.length > 0
      ? h('button', { type: 'button', className: 'fm-lyric-return', onClick: () => setFollowing(true) }, '回到当前句')
      : h('span', { className: 'fm-lyric-hint' }, snapshot?.seekPending ? '正在跳转…' : data?.status === 'synced' && canSeek ? '点击歌词，跳到这一句' : ''),
    snapshot?.seekError && h('span', { className: 'fm-lyric-error', role: 'status' }, snapshot.seekError.message)));
}
