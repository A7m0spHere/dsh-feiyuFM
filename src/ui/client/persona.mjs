import React from 'react';
import { h } from './shared.mjs';

export function Persona({ state, controller }) {
  const view = state.persona;
  const [selected, setSelected] = React.useState('');
  const [budget, setBudget] = React.useState(4000), [output, setOutput] = React.useState(256);
  React.useEffect(() => {
    if (view) { setBudget(view.policy.dailyTokens); setOutput(view.policy.maxOutputTokens); }
  }, [view?.policy?.dailyTokens, view?.policy?.maxOutputTokens]);
  if (!view) return null;
  const { ledger, policy } = view;
  const pipeline = view.recommendationPipeline ?? state.snapshot?.discovery ?? {};
  const tracks = pipeline.pipeline === 'platform-filter' ? pipeline.tracks ?? [] : [];
  const routes = state.summaryModels ?? [], key = route => JSON.stringify([route.provider, route.model]);
  const saved = view.recommendationRoute ?? view.lastModelRoute;
  const previous = saved && routes.find(route => route.provider === saved.provider && route.model === saved.model);
  const chosen = selected || (previous ? key(previous) : routes[0] ? key(routes[0]) : '');
  const route = routes.find(item => key(item) === chosen);
  const referenceCount = pipeline.referenceCount ?? state.library?.total ?? 0;
  const busy = state.summaryBusy || pipeline.filtering || pipeline.refreshing;
  const disabled = state.summaryBusy || state.busy || !state.connected;
  const status = !state.connected ? '正在连接电台…'
    : !referenceCount ? '先导入你常听的歌曲，我会沿着它们去找歌。'
    : pipeline.refreshing ? '我正在网易云找一些相近的歌…'
    : state.summaryBusy || pipeline.filtering ? '歌找到了，我再挑一挑…'
    : tracks.length ? !state.snapshot?.settings.discovery||state.snapshot?.settings.discoveryRate===0
      ? `这批挑了 ${tracks.length} 首，关闭探索时可以手动点播。` : `这批挑了 ${tracks.length} 首，可以点播或让我接着听。`
    : pipeline.selectionComplete ? '这批没有挑到合适的歌，可以换一批或先点播参考歌曲。'
    : pipeline.state === 'login_required' ? '先连接网易云，我才能找歌。'
    : !routes.length ? '先在 DSH 配好模型，我才能帮你挑歌。'
    : pipeline.lastError === 'budget_exhausted' ? '今天的模型预算不足，可在推荐设置中调整。'
    : pipeline.lastError === 'summary_cooldown' ? '刚刚挑过一批，稍后再换。'
    : pipeline.lastError ? '这次没挑好，可以再试，也可以先点播参考歌曲。'
    : '参考歌曲准备好了，找一批歌让我挑挑看。';
  const song = (track, index) => h('button', { type: 'button', className: 'fm-pick', key: `${track.provider}:${track.providerTrackId}`,
    disabled: state.busy || !state.connected, 'aria-label': `播放 ${track.title} · ${track.artist || '未知艺人'}`,
    onClick: () => controller.command('requestTrack', track) },
    h('span', { className: 'fm-pick-index', 'aria-hidden': true }, index + 1),
    h('span', { className: 'fm-pick-copy' }, h('strong', null, track.title), h('span', null, track.artist || '未知艺人'),
      track.discovery?.llmReason && h('span', { className: 'fm-pick-reason' }, track.discovery.llmReason)),
    h('span', { className: 'fm-pick-play', 'aria-hidden': true }, '▶'));
  return h('section', { 'aria-label': '大肥鱼的歌单' },
    h('h2', null, '大肥鱼的歌单'),
    h('div', { className: 'fm-card fm-persona-card' },
      h('div', { className: 'fm-picks-head' }, h('p', { className: 'fm-note', role: 'status', 'aria-live': 'polite' }, status),
        h('button', { type: 'button', className: 'fm-button fm-primary', disabled: disabled || busy || !route || !referenceCount || !state.features?.personaSummary,
          onClick: () => controller.personaAction('recommendations', { provider: route.provider, model: route.model }) }, busy ? '正在挑歌…' : tracks.length ? '换一批' : '找一批歌')),
      pipeline.summary && h('p', { className: 'fm-summary-text' }, pipeline.summary),
      tracks.length > 0 && h('div', { className: 'fm-picks' }, tracks.slice(0, 6).map(song)),
      tracks.length > 6 && h('details', { className: 'fm-disclosure' }, h('summary', null, `还有 ${tracks.length - 6} 首`),
        h('div', { className: 'fm-picks' }, tracks.slice(6).map((track, index) => song(track, index + 6)))),
      state.summaryError && h('p', { className: 'fm-notice', 'data-error': true, role: 'alert' }, state.summaryError),
      !state.summaryError && state.summaryNotice && !busy && h('p', { className: 'fm-note', role: 'status' }, state.summaryNotice),
      h('details', { className: 'fm-disclosure fm-recommendation-settings' }, h('summary', null, '推荐设置'),
        h('div', { className: 'fm-disclosure-body' },
          h('label', { className: 'fm-label' }, '帮我挑歌的模型'),
          h('div', { className: 'fm-summary-actions' }, h('select', { 'aria-label': '推荐模型', value: chosen, disabled: disabled || !routes.length,
            onChange: event => setSelected(event.target.value) }, ...(routes.length ? routes.map(item => h('option', { key: key(item), value: key(item) }, item.label))
              : [h('option', { value: '' }, 'DSH 模型暂不可用')]))),
          h('p', { className: 'fm-note' }, '先从网易云找歌，再用这个模型挑选。开始挑歌后会记住模型，之后按需自动补充；换曲不会调用模型。'),
          h('details', { className: 'fm-disclosure' }, h('summary', null, '用量与预算'),
            h('div', { className: 'fm-token-strip', 'aria-label': '插件模型用量' },
              h('div', null, h('span', null, '今日已知用量'), h('strong', null, ledger.today.knownTokens, h('small', null, ' tokens'))),
              h('div', null, h('span', null, '累计已知用量'), h('strong', null, ledger.total.knownTokens, h('small', null, ' tokens'))),
              h('p', null, `共 ${ledger.total.attempts} 次尝试 · 今日剩余 ${ledger.remainingTokens}`)),
            h('div', { className: 'fm-budget-row' }, h('label', { className: 'fm-label' }, '每日模型预算',
              h('input', { type: 'number', 'aria-label': '每日总结 token 预算', min: 0, max: 100000, step: 100, value: budget, onChange: event => setBudget(Number(event.target.value)) })),
              h('button', { type: 'button', className: 'fm-button', disabled: disabled || !Number.isSafeInteger(budget) || budget < 0 || budget > 100000,
                onClick: () => controller.personaAction('budget', { value: budget }) }, '保存预算')),
            h('div', { className: 'fm-budget-row' }, h('label', { className: 'fm-label' }, '单次输出上限',
              h('input', { type: 'number', 'aria-label': '单次输出 token 上限', min: policy.minOutputTokens ?? 64, max: policy.outputMaximumTokens ?? 256, step: 32, value: output,
                onChange: event => setOutput(Number(event.target.value)) })),
              h('button', { type: 'button', className: 'fm-button', disabled: disabled || !Number.isSafeInteger(output) || output < (policy.minOutputTokens ?? 64) || output > (policy.outputMaximumTokens ?? 256),
                onClick: () => controller.personaAction('output', { value: output }) }, '保存上限')),
            h('details', { className: 'fm-call-history' }, h('summary', null, '最近调用'), ...(ledger.recent ?? []).map(call => h('p', { className: 'fm-note', key: call.callId },
              `${call.purpose === 'discovery-filter' ? '挑歌' : call.purpose === 'model-recommendations' ? '旧版歌单' : '旧版总结'} · ${call.model} · ${call.status}`))))))));
}
