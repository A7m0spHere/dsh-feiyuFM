import React from 'react';
import {h} from './shared.mjs';

const discoverySources = {netease_similar: '网易云相似推荐', netease_daily: '网易云每日推荐', netease_personal_fm: '网易云私人 FM', platform_recommendation: '平台推荐'};
export function Discoveries({state}) {
  const journal = state.persona?.discoveryJournal;
  if (!journal) return null;
  const ready = state.connected && journal.status === 'ready';
  const items = ready ? journal.items ?? [] : [];
  const message = !state.connected ? '暂时无法读取发现记录，连接恢复后再更新。'
    : journal.status === 'unavailable' ? '当前模式暂未提供发现记录。'
    : journal.reason === 'no-input' ? '导入参考歌曲后，这里会留下有依据的发现记录。'
    : '还没有当前有效歌单的发现记录，找一批歌后再来看看。';
  return h('section', {className: 'fm-discoveries'},
    h('details', {className: 'fm-card fm-discoveries-card'},
      h('summary', null, h('span', {className: 'fm-label'}, '近期发现'), h('span', {className: 'fm-note'}, items.length ? `${items.length} 首 · 当前歌单` : '只记录有依据的发现')),
      !items.length ? h('p', {className: 'fm-note fm-discoveries-empty'}, message)
      : h(React.Fragment, null,
        h('p', {className: 'fm-note fm-discoveries-note'}, journal.retained ? '新一批尚未就绪，以下保留仍有效的上一批记录。' : '来自当前有效歌单；已推荐与实际收听分别记录。'),
        h('ol', {className: 'fm-discoveries-list'}, ...items.map(item => {
          const source = item.evidence?.find(f => f.kind === 'platform-source')?.value;
          const seed = item.evidence?.some(f => f.kind === 'platform-seed-relation');
          const vote = item.evidence?.find(f => f.kind === 'explicit-feedback')?.value;
          return h('li', {className: 'fm-discovery-item', key: item.key},
            h('div', {className: 'fm-discovery-heading'}, h('div', {className: 'fm-discovery-copy'}, h('strong', null, item.title), h('span', {className: 'fm-note'}, item.artist)),
              h('div', {className: 'fm-discovery-badges'}, h('span', {className: 'fm-badge'}, '已推荐'),
                item.userRequested && h('span', {className: 'fm-badge'}, '本机点播'),
                item.audibleHeard ? h('span', {className: 'fm-badge', 'data-ok': true}, '有效听过')
                  : item.silentExperienced ? h('span', {className: 'fm-badge'}, '静音有效经历')
                    : item.agentExperienced ? h('span', {className: 'fm-badge'}, '有效经历') : null)),
            h('p', {className: 'fm-note fm-discovery-source'}, `${discoverySources[source] ?? '来源未确认'}${seed ? ' · 已记录平台种子关系' : ''}${vote === 'liked' ? ' · 筛选前已标记喜欢' : vote === 'reduced' ? ' · 筛选前已标记少推荐' : ''}`));
        })),
        h('p', {className: 'fm-note fm-discoveries-note'}, `只展示本批推荐后的可核对记录，不是完整听歌历史。静音经历不算有声听过。${journal.historyLimited ? '近期收听窗口有限，更早状态未确认。' : ''}`))));
}
