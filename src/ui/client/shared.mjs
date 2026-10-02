import React from 'react';
export const h = React.createElement;
export const minutes = ms => { const seconds = Math.floor(Math.max(0, ms || 0) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
export const progressPercent = current => {
  const duration = current?.track?.durationMs;
  return Number.isFinite(duration) && duration > 0
    ? Math.min(100, 100 * Math.max(0, current.positionMs || 0) / duration) : 0;
};
export const modes = [['normal', '日常', '自主选歌 · 保留声音'], ['focus', '专注', '减少中途切换'], ['silent', '静听', '自主播放 · 电脑静音'], ['off', '关闭', '暂停并停止自动听歌']];
export const sourceNames = { recent: '近期记录', liked: '喜欢列表', playlist: '用户歌单' };
export const stageNames = { login_status: '读取登录状态', user_record: '请求近期记录', likelist: '读取喜欢列表', user_playlist: '读取用户歌单', playlist_detail: '读取歌单详情', song_detail: '读取歌曲详情', accountInfo: '读取登录状态', recentTracks: '请求近期记录', likedTracks: '读取喜欢列表', playlists: '读取用户歌单', playlistTracks: '读取歌单详情', songDetails: '读取歌曲详情' };
