import { filterLibrary } from './presentation.mjs';
import React from 'react';
import { h, minutes } from './shared.mjs';
import { Svg } from './components.mjs';

export function Library({ state, controller }) {
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(0);
  const library = state.library ?? { total: 0, tracks: [] };
  const tracks = filterLibrary(library.tracks, query);
  const pages = Math.max(1, Math.ceil(tracks.length / 12));
  const currentPage = Math.min(page, pages - 1);
  const visible = tracks.slice(currentPage * 12, (currentPage + 1) * 12);
  const current = state.snapshot?.current;
  const blocked = state.busy || !state.connected;
  return h('section', { className: 'fm-library', 'aria-label': '我的音乐库' },
    h('div', { className: 'fm-library-head' }, h('h2', null, '我的音乐', h('small', null, `${library.total} 首`)),
      h('input', { type: 'search', className: 'fm-library-search', 'aria-label': '搜索已导入曲目',
        placeholder: '搜索歌曲或艺人', value: query,
        onChange: event => { setQuery(event.target.value); setPage(0); } })),
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
    }) : h('div', { className: 'fm-library-empty', role: 'status' }, library.total ? '没有匹配的歌曲，试试其他关键词。' : '还没有导入音乐。连接网易云后，点击“导入我的音乐”。')),
    h('div', { className: 'fm-library-foot' }, h('span', { role: 'status', 'aria-live': 'polite' }, query ? `${tracks.length} 首匹配` : `已载入 ${library.tracks.length} / ${library.total} 首 · 点击曲目即可播放`),
      pages > 1 && h('div', { className: 'fm-library-pages' },
        h('button', { type: 'button', className: 'fm-button', 'aria-label': '上一页曲目', disabled: currentPage === 0, onClick: () => setPage(currentPage - 1) }, '上一页'),
        h('span', null, `${currentPage + 1} / ${pages}`),
        h('button', { type: 'button', className: 'fm-button', 'aria-label': '下一页曲目', disabled: currentPage === pages - 1, onClick: () => setPage(currentPage + 1) }, '下一页'))));
}
