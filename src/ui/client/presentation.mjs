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
  const model=data?.sources?.includes('llm_recommendation');
  if (!snapshot?.settings?.discovery || snapshot.settings.discoveryRate === 0) return model?'探索已关闭；续播只使用模型歌单中的已知歌曲。':'探索已关闭；自主选择使用熟悉歌曲。';
  if (!data) return '推荐候选状态尚未读取。';
  const names = {llm_recommendation:'模型推荐歌单', netease_daily: '网易云每日推荐', netease_personal_fm: '网易云私人 FM', netease_similar:'种子相似歌曲', platform_recommendation: '平台推荐' };
  const sources = (data.sources ?? []).map(source => names[source] || '平台推荐').join('、');
  if (data.refreshing) return `正在后台刷新；现有陌生候选 ${data.count ?? 0} 首。`;
  if(data.reason==='model-playlist-needed')return '等待模型生成推荐歌单；网易云只用于搜歌与播放。';
  if(model&&data.state==='login-required')return '模型已给出歌单，需要登录网易云后核对歌曲。';
  if(model&&!data.count)return data.verified?'模型歌单暂无陌生曲目，按已核对的已知歌曲与冷却规则选择。':'暂无通过核对的模型歌曲，请生成或重新核对歌单。';
  if (data.count > 0) return `陌生候选 ${data.count} 首${sources ? ` · ${sources}` : ''}${data.reason ? '；刷新暂未成功，保留有效缓存。' : ''}`;
  if (data.state === 'idle') return '等待后台获取推荐候选。';
  if (data.reason === 'login-required') return '推荐需要有效登录；暂从熟悉歌曲选择。';
  if (data.state === 'empty') return '暂时没有可用陌生候选；自主选择会回退熟悉歌曲。';
  return '推荐暂不可用；自主选择会回退熟悉歌曲。';
}

export function popupPlacement(frame, bar, requestedHeight = 340) {
  const above = Math.max(0, bar.top - frame.top - 12);
  const below = Math.max(0, frame.bottom - bar.bottom - 12);
  const side = above >= requestedHeight || above >= below ? 'above' : 'below';
  return { side, maxHeight: Math.max(0, Math.min(requestedHeight, side === 'above' ? above : below)) };
}
