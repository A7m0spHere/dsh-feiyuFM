import { filterLibrary } from './presentation.mjs';
import React from 'react';
import { h, minutes } from './shared.mjs';
import { Svg } from './components.mjs';

export function Library({ state, controller }) {
  const [localQuery, setQuery] = React.useState('');
  const [page, setPage] = React.useState(0);
  const library = state.library ?? { total: 0, tracks: [] };
  const paged = Number.isSafeInteger(library.matched);
  const query = paged ? state.libraryQuery ?? '' : localQuery;
  const tracks = paged ? library.tracks : filterLibrary(library.tracks, query);
  const matched = paged ? library.matched : tracks.length;
  const pages = Math.max(1, Math.ceil(matched / 12));
  const currentPage = paged ? Math.floor(library.offset / 12) : Math.min(page, pages - 1);
  const waiting = state.libraryBusy || (paged && library.query !== query.trim());
  const visible = waiting || state.libraryError ? [] : paged ? tracks : tracks.slice(currentPage * 12, (currentPage + 1) * 12);
  const changePage = next => paged ? controller.queryLibrary(query, next * 12) : setPage(next);
  const current = state.snapshot?.current;
  const blocked = state.busy || !state.connected || state.libraryBusy;
  return h('section', { className: 'fm-library', 'aria-label': '我的音乐库' },
    h('div', { className: 'fm-library-head' }, h('h2', null, '我的音乐', h('small', null, `${library.total} 首`)),
      h('input', { type: 'search', className: 'fm-library-search', 'aria-label': '搜索已导入曲目',
        placeholder: '搜索歌曲或艺人', value: query, maxLength: 200,
        onChange: event => { if (paged) void controller.queryLibrary(event.target.value); else { setQuery(event.target.value); setPage(0); } } })),
    state.libraryError && h('div', { className: 'fm-notice', role: 'alert' }, state.libraryError,
      h('button', { type: 'button', className: 'fm-button', disabled: state.libraryBusy, onClick: () => controller.queryLibrary(query) }, '重新查询')),
    h('div', { className: 'fm-library-list' }, visible.length ? visible.map((track, index) => {
      const isCurrent = current?.track.provider === track.provider && current?.track.providerTrackId === track.providerTrackId;
      return h('button', { type: 'button', className: 'fm-song', key: `${track.provider}:${track.providerTrackId}`,
        'data-current': isCurrent, 'aria-label': `播放 ${track.title || track.providerTrackId} · ${track.artist || '未知艺人'}`,
        'aria-current': isCurrent ? 'true' : undefined, disabled: blocked,
        onClick: () => controller.command('requestTrack', track) },
        h('span', { className: 'fm-song-index', 'aria-hidden': true }, isCurrent ? h(Svg, { type: state.snapshot?.paused ? 'pause' : 'headphones' }) : String(currentPage * 12 + index + 1).padStart(2, '0')),
        h('span', { className: 'fm-song-copy' }, h('span', { className: 'fm-song-title' }, track.title || track.providerTrackId),
          h('span', { className: 'fm-song-artist' }, `${track.artist || '未知艺人'} · ${track.provider === 'netease' ? '网易云音乐' : 'QQ 音乐'}`)),
        h('span', { className: 'fm-song-duration' }, track.durationMs ? minutes(track.durationMs) : '--:--'), h(Svg, { type: 'play' }));
    }) : h('div', { className: 'fm-library-empty', role: 'status' }, state.libraryError ? '曲库查询未完成，请重试。' : waiting ? '正在查询曲库…'
      : library.total ? '没有匹配的歌曲，试试其他关键词。' : '还没有导入音乐。连接网易云后，点击“导入我的音乐”。')),
    h('div', { className: 'fm-library-foot' }, h('span', { role: 'status', 'aria-live': 'polite' }, state.libraryError ? '未能取得查询结果' : waiting ? '正在查询曲库…'
      : query ? `${matched} 首匹配` : paged ? `共 ${library.total} 首 · 点击曲目即可播放` : `已载入 ${library.tracks.length} / ${library.total} 首 · 点击曲目即可播放`),
      !waiting && !state.libraryError && pages > 1 && h('div', { className: 'fm-library-pages' },
        h('button', { type: 'button', className: 'fm-button', 'aria-label': '上一页曲目', disabled: state.libraryBusy || currentPage === 0, onClick: () => changePage(currentPage - 1) }, '上一页'),
        h('span', null, `${currentPage + 1} / ${pages}`),
        h('button', { type: 'button', className: 'fm-button', 'aria-label': '下一页曲目', disabled: state.libraryBusy || currentPage === pages - 1, onClick: () => changePage(currentPage + 1) }, '下一页'))));
}
