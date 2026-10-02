export function playbackPresentation(snapshot, connected) {
  if (!connected) return { label: snapshot ? '连接中断 · 保留上次状态' : '正在连接电台', art: 'whale-idle', active: false };
  if (snapshot?.status === 'resolving' || snapshot?.status === 'selecting') return { label: '正在准备音乐', art: 'whale-dj', active: false };
  if (snapshot?.lastError) return { label: '播放未成功', art: 'whale-idle', active: false };
  if (snapshot?.paused) return { label: '已暂停 · 不会自动恢复', art: 'whale-idle', active: false };
  if (snapshot?.status === 'playing') return { label: snapshot.settings?.humanPlayback ? '正在播放' : '静音播放', art: 'whale-listening', active: true };
  return { label: '电台待命', art: 'whale-idle', active: false };
}

export function filterLibrary(tracks, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  return (tracks ?? []).filter(track => !needle || `${track.title || ''} ${track.artist || ''} ${track.providerTrackId || ''}`.toLocaleLowerCase().includes(needle));
}

export function popupPlacement(frame, bar, requestedHeight = 340) {
  const above = Math.max(0, bar.top - frame.top - 12);
  const below = Math.max(0, frame.bottom - bar.bottom - 12);
  const side = above >= requestedHeight || above >= below ? 'above' : 'below';
  return { side, maxHeight: Math.max(0, Math.min(requestedHeight, side === 'above' ? above : below)) };
}
