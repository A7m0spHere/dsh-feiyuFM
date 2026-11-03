// 播放进度平滑显示：状态每 ~2.2 秒轮询一次，直接渲染会在界面上"跳格"。
// 以最近一次服务端进度为锚点，播放中按本地时钟插值推进；暂停、切歌或
// 收到新快照时重新锚定。首次渲染与无锚点时返回服务端原值。
export function recommendationActionState(availability,now){
 let reason=availability?.reason;
 const seconds=Math.max(0,Math.ceil(((availability?.retryAt??now)-now)/1000));
 if(reason==='summary_cooldown'&&seconds===0)reason=null;
 if(reason==='summary_retry_limit'&&now>=availability.resetAt)reason=null;
 const messages={summary_cooldown:'刚挑过一批，稍后可再换；已有歌曲仍可点播。',
  summary_busy:'模型任务正在进行，完成后可再挑歌。',
  summary_retry_limit:'今天的挑歌次数已用完，明天可再换；已有歌曲仍可点播。',
  budget_exhausted:'模型预算不足，可在推荐设置中调整；已有歌曲仍可点播。'};
 return{reason,disabled:Boolean(reason),message:messages[reason]??'',
  label:reason==='summary_cooldown'?'稍后再试':reason==='summary_busy'?'模型处理中':reason==='summary_retry_limit'?'明天再换':reason==='budget_exhausted'?'预算不足':null};
}

export function recommendationFeedback(error){
 const messages={summary_cooldown:'刚挑过一批，稍后可再换；现有歌单仍可播放。',
  summary_busy:'已有模型任务正在进行，稍后再试。',
  summary_retry_limit:'今天的挑歌次数已用完，明天可再换。',
  budget_exhausted:'模型预算不足，请在推荐设置中调整后再试。',
  no_candidates:'网易云暂时没有合适的候选，可补充参考歌曲或稍后重试。'};
 return{expected:Boolean(messages[error?.code]),message:messages[error?.code]||error?.message||'这次挑歌没有完成，请稍后重试。',code:error?.code||'model_failed'};
}

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

// Pending acknowledges a request, never claims that audio has started.
export function playbackControls(state) {
  const snapshot = state.snapshot, pending = state.transportPending;
  const current = snapshot?.current;
  const preparing = !snapshot?.paused && ['resolving', 'selecting'].includes(snapshot?.status);
  const canPause = (pending && !['pause', 'stopForToday'].includes(pending))
    || (current && !snapshot.paused) || preparing;
  const hasMusic = current || state.library?.total || snapshot?.queue?.length
    || state.persona?.recommendationPipeline?.playbackPool?.available
    || state.persona?.recommendationPipeline?.tracks?.length || state.persona?.recommendations?.verified?.length;
  return {
    action: canPause ? 'pause' : current ? 'resume' : 'start',
    label: pending === 'pause' ? '暂停中…' : pending === 'stopForToday' ? '停止中…'
      : canPause ? '暂停' : current ? '继续播放' : '开始听歌',
    icon: canPause ? 'pause' : 'play',
    playDisabled: !state.connected || pending === 'pause' || pending === 'stopForToday'
      || (!canPause && (state.busy || !hasMusic)),
    // 没有更早的可播记录时由 Core 的 navigation.previous 明确告知，按钮据此禁用。
    previousDisabled: !state.connected || state.busy || Boolean(pending) || !snapshot?.navigation?.previous,
    previousLabel: pending === 'previous' ? '返回中…' : '上一首',
    nextDisabled: !state.connected || state.busy || Boolean(pending) || !hasMusic,
    nextLabel: pending === 'next' ? '切换中…' : '下一首',
    message: ({ pause: '正在暂停…', resume: '正在继续播放…', next: '正在切换下一首…', previous: '正在返回上一首…',
      requestTrack: '正在准备歌曲…', stopForToday: '正在停止…' })[pending] ?? '',
  };
}

export function playbackNotice(snapshot) {
  if (!snapshot?.lastError) return null;
  if (snapshot.status === 'resolving' && snapshot.current?.recoveryAttempts > 0) {
    return '播放中断，正在尝试从上次位置恢复这首歌…';
  }
  if (snapshot.lastError.code === 'media_stalled') return '播放长时间卡住，自动恢复未成功。可以重新点播或换一首。';
  if (snapshot.lastError.code === 'playback_host_lost') return '播放服务中断，自动恢复未成功。可以重新点播。';
  return '播放尚未成功，请核对平台连接和曲目权限。';
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
