// 播放进度平滑显示：状态每 ~2.2 秒轮询一次，直接渲染会在界面上"跳格"。
// 以最近一次服务端进度为锚点，播放中按本地时钟插值推进；暂停、切歌或
// 收到新快照时重新锚定。首次渲染与无锚点时返回服务端原值。
export function interpolatedPosition({ anchor, playInstanceId, positionMs, durationMs, now, active }) {
  if (!active || !anchor || anchor.id !== playInstanceId) return positionMs;
  const advanced = anchor.ms + Math.max(0, now - anchor.at);
  return Number.isFinite(durationMs) && durationMs > 0 ? Math.min(advanced, durationMs) : advanced;
}

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

export function discoveryPresentation(snapshot) {
  const data = snapshot?.discovery;
  if (!snapshot?.settings?.discovery || snapshot.settings.discoveryRate === 0) return '探索已关闭：只从你常听和喜欢的歌里选。';
  if (!data) return '正在了解你的音乐库。';
  if (data.refreshing) return '正在找新歌…';
  if (data.filtering) return `找到 ${data.count ?? 0} 首候选新歌，大肥鱼正在试听挑选…`;
  if (data.picked > 0) return `大肥鱼从 ${data.count} 首候选里挑了 ${data.picked} 首合口味的。`;
  if (data.count > 0) return data.playlist ? `有 ${data.count} 首新歌可以播；大肥鱼稍后再挑一轮。` : `找到 ${data.count} 首新歌。`;
  if (data.reason === 'login-required' || data.state === 'login_required') return '需要先登录网易云才能找新歌；暂时只播常听的歌曲。';
  if (data.state === 'idle') return '稍后会自动找新歌。';
  if (data.state === 'empty') return '暂时没找到合适的新歌；先播常听的歌曲。';
  return '新歌推荐暂时不可用；先播常听的歌曲。';
}

export function popupPlacement(frame, bar, requestedHeight = 340) {
  const above = Math.max(0, bar.top - frame.top - 12);
  const below = Math.max(0, frame.bottom - bar.bottom - 12);
  const side = above >= requestedHeight || above >= below ? 'above' : 'below';
  return { side, maxHeight: Math.max(0, Math.min(requestedHeight, side === 'above' ? above : below)) };
}
