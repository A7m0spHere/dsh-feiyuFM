import React from 'react';
import { h } from './shared.mjs';

const BLOCKED = {
  disabled: '自动总结已关闭。', busy: '已有总结正在进行。', no_facts: '还没有可总结的画像事实。',
  no_model: '先手动生成一份总结，自动更新会沿用其模型。', input_size: '聚合事实超出输入上限。',
  current: '总结已是最新，无需更新。', cooldown: '距上次总结不足 1 小时。', budget: '今日预算不足以再预留一次总结。',
  attempt_limit: '今日总结尝试次数已达上限。', interval: '距上次成功总结不足 24 小时。',
};
const TRIGGER = { automatic: '自动', manual: '手动' };

export function Persona({ state, controller }) {
  const view = state.persona;
  const [selected, setSelected] = React.useState(''), [budget, setBudget] = React.useState(4000), [output, setOutput] = React.useState(256);
  React.useEffect(() => {
    if (view) { setBudget(view.policy.dailyTokens); setOutput(view.policy.maxOutputTokens); }
  }, [view?.policy?.dailyTokens, view?.policy?.maxOutputTokens]);
  if (!view) return null;
  const routes = state.summaryModels ?? [], key = r => JSON.stringify([r.provider, r.model]);
  const { summary, ledger, policy, facts } = view;
  const recommendations=view.recommendations,baseline=recommendations??summary??view.lastModelRoute;
  const cachedRoute = baseline && routes.find(r => r.provider === baseline.provider && r.model === baseline.model);
  const chosen = selected || (cachedRoute ? key(cachedRoute) : routes[0] ? key(routes[0]) : '');
  const route = routes.find(r => key(r) === chosen);
  const busy = Boolean(state.summaryBusy), disabled = busy || !state.connected;
  const usageText = u => u ? `输入 ${u.inputTokens} / 输出 ${u.outputTokens}${u.cacheReadTokens ? ` / 缓存读 ${u.cacheReadTokens}` : ''}${u.cacheWriteTokens ? ` / 缓存写 ${u.cacheWriteTokens}` : ''}${Number.isFinite(u.reasoningTokens) ? ` / 推理 ${u.reasoningTokens}（输出细分）` : ''}` : '用量未知';
  const blocked = policy.automaticBlockedBy === 'not_enough_new_listens'
    ? `新增有效经历 ${policy.automaticNewListens} 次，未达 ${policy.autoMinNewListens} 次。`
    : BLOCKED[policy.automaticBlockedBy] ?? '';
  const automaticAvailable = Number.isFinite(policy.autoMinNewListens);
  const outputAvailable = Number.isFinite(policy.minOutputTokens);
  return h('section', { 'aria-label': '音乐人格与模型用量' },
    h('h2', null, '大肥鱼的音乐画像', h('small', null, 'PERSONA')),
    h('div', { className: 'fm-card fm-persona-card' },
      h('div', { className: 'fm-section-head' }, h('p', { className: 'fm-label' }, '本地事实与推荐策略'), h('span', { className: 'fm-badge' }, '规则选歌')),
      h('div', { className: 'fm-facts' },
        ...facts.artists.map(a => h('span', { className: 'fm-fact', key: a.key ?? a.name }, a.name)),
        h('span', { className: 'fm-fact' }, `有效经历 ${facts.validListens} 次`),
        h('span', { className: 'fm-fact' }, `探索目标 ${facts.discoveryEnabled ? facts.exploration : 0}%`)),
      !facts.artists.length && h('p', { className: 'fm-note' }, '尚未形成足够的艺人偏好，先导入或积累收听经历。'),
      h('p', { className: 'fm-note' }, state.insights?.recommendationMode==='llm'?'模型决定推荐哪些歌，本地只执行顺序、手动反馈与重复限制。以下画像是已追踪的本地记录；流派和情绪未知。':'兼容模式按本地偏好与平台候选选歌。以下画像只覆盖已追踪窗口；流派和情绪未知。'),
      h('div', { className: 'fm-summary' },
        h('div', { className: 'fm-section-head' }, h('p', { className: 'fm-label' }, 'LLM 推荐歌单'), h('span', { className: 'fm-badge' }, recommendations ? `已核对 ${recommendations.verified.length} / ${recommendations.songs.length} 首${view.recommendationsStale?' · 参考已变化':''}` : '未生成')),
        h('div',{className:'fm-motion-row'},h('label',null,'推荐来源'),h('select',{'aria-label':'推荐来源',value:state.insights?.recommendationMode??'platform',disabled:disabled||!view.recommendationsSupported,onChange:e=>controller.command('setRecommendationMode',e.target.value)},h('option',{value:'llm'},'LLM 歌单'),h('option',{value:'platform'},'网易云推荐（兼容模式）'))),
        recommendations&&h('p',{className:'fm-summary-text'},recommendations.text),
        recommendations&&h('div',{className:'fm-model-playlist'},...recommendations.songs.map((song,index)=>h('div',{key:index,className:'fm-model-song'},h('div',null,h('strong',null,song.title),h('span',null,song.artist)),h('span',{className:'fm-badge'},({matched:'已核对',ambiguous:'版本不唯一','not-found':'未找到','login-required':'需要登录','lookup-failed':'核对失败'})[recommendations.attempts.find(a=>a.index===index)?.status]??'待核对')))),
        h('p',{className:'fm-note'},`模型参考 ${view.referenceCoverage?.sampled??0} / ${view.referenceCoverage?.total??state.library?.total??0} 首代表输入歌曲及手动反馈，低频给出具体歌单；网易云负责搜索核对与播放。`),
        h('div',{className:'fm-summary-actions'},
          h('select',{'aria-label':'推荐模型',value:chosen,disabled:disabled||!routes.length,onChange:e=>setSelected(e.target.value)},...(routes.length?routes.map(r=>h('option',{key:key(r),value:key(r)},r.label)):[h('option',{value:''},'DSH 模型列表尚不可用')])),
          h('button',{type:'button',className:'fm-button fm-primary',disabled:disabled||!route||!state.features?.personaSummary||!view.recommendationsSupported||policy.maxOutputTokens<128||!(view.referenceCoverage?.sampled||state.insights?.feedback?.liked),onClick:()=>controller.personaAction('recommendations',{provider:route.provider,model:route.model})},busy?'正在处理…':'根据歌曲推荐一批')),
        h('p',{className:'fm-note',role:'status','aria-live':'polite'},state.summaryError||state.summaryNotice||(!view.recommendationsSupported?'新版模型推荐功能尚未加载。':!(view.referenceCoverage?.sampled||state.insights?.feedback?.liked)?'请先导入参考歌曲，或标记喜欢；空曲库不会发送模型请求。':policy.maxOutputTokens<128?'请在预算设置中将输出上限调到至少 128 tokens。':'相同参考数据复用缓存，不逐曲调用模型。新生成受冷却、每日尝试次数与 token 预算限制。')),
        h('details',{className:'fm-disclosure'},h('summary',null,'画像总结（仅展示）'),
        summary ? h(React.Fragment, null,
          h('p', { className: 'fm-summary-text' }, summary.text),
          h('p', { className: 'fm-note fm-summary-meta' }, `${summary.provider} / ${summary.model} · ${new Date(summary.generatedAt).toLocaleString()} · ${TRIGGER[summary.trigger] ?? '手动'}触发`))
          : h('p', { className: 'fm-note' }, '还没有模型总结。播放和逐曲回复不会自动调用模型。'),
        h('div', { className: 'fm-summary-actions' },
          h('select', { 'aria-label': '总结模型', value: chosen, disabled: disabled || !routes.length, onChange: e => setSelected(e.target.value) },
            ...(routes.length ? routes.map(r => h('option', { key: key(r), value: key(r) }, r.label)) : [h('option', { value: '' }, 'DSH 模型列表尚不可用')])),
          h('button', { type: 'button', className: 'fm-button', disabled: disabled || !state.features?.personaSummary || !route,
            onClick: () => controller.personaAction('summary', { provider: route.provider, model: route.model }) }, busy ? '正在处理…' : '根据画像总结一次')),
        h('p', { className: 'fm-note' }, '这段旧画像总结只作展示；上方模型歌单才提供具体推荐歌曲。'))),
      h('div', { className: 'fm-token-strip', 'aria-label': '插件模型用量' },
        h('div', null, h('span', null, '今日已知用量'), h('strong', null, ledger.today.knownTokens, h('small', null, ' tokens'))),
        h('div', null, h('span', null, '累计已知用量'), h('strong', null, ledger.total.knownTokens, h('small', null, ' tokens'))),
        h('p', null, `共 ${ledger.total.attempts} 次尝试 · ${ledger.total.unknownCalls} 次用量未知或进行中`)),
      h('details', { className: 'fm-disclosure' },
        h('summary', null, '低频自动更新', h('span', { className: 'fm-disclosure-meta' }, policy.automatic ? '已开启' : '默认关闭')),
        h('div', { className: 'fm-disclosure-body' },
          h('label', { className: 'fm-check-row' }, h('input', { type: 'checkbox', checked: policy.automatic === true, disabled: disabled || !automaticAvailable,
            'aria-label': '开启自动总结', onChange: e => controller.personaAction('automatic', { value: e.target.checked }) }), '开启低频自动更新'),
          h('p', { className: 'fm-note', role: 'status', 'aria-live': 'polite' }, policy.automatic
            ? policy.automaticDue ? '条件已满足，下一次检查会运行一次总结。' : blocked || '尚未满足自动总结条件。'
            : '关闭时不会自动产生模型请求。'),
          h('p', { className: 'fm-note' }, automaticAvailable
            ? `更新对象：${policy.automaticPurpose==='model-recommendations'?'模型推荐歌单':'画像总结'}。沿用上次成功生成的模型；新增有效经历 ${policy.autoMinNewListens} 次、距上次至少 24 小时、冷却 1 小时，每日最多 3 次尝试，且参考数据与预算允许。`
            : '当前 Core 尚未提供自动总结设置。'))),
      h('details', { className: 'fm-disclosure' }, h('summary', null, '插件 token 账本与预算', h('span', { className: 'fm-disclosure-meta' }, `今日剩余 ${ledger.remainingTokens}`)),
        h('div', { className: 'fm-disclosure-body' },
          h('p', { className: 'fm-note' }, `本地选歌 / 逐曲回复：${ledger.localDecisionRequests} 次模型调用。未知用量按保守预留扣预算；DSH 主任务和共享上下文成本未归因，不计入这里。`),
          summary && h('p', { className: 'fm-note' }, `当前总结：${usageText(summary.usage)}`),
          h('div', { className: 'fm-budget-row' },
            h('label', { className: 'fm-label' }, '每日总结预算', h('input', { type: 'number', 'aria-label': '每日总结 token 预算', min: 0, max: 100000, step: 100, value: budget, onChange: e => setBudget(Number(e.target.value)) })),
            h('button', { type: 'button', className: 'fm-button', disabled: disabled || !Number.isSafeInteger(budget) || budget < 0 || budget > 100000, onClick: () => controller.personaAction('budget', { value: budget }) }, '保存预算')),
          h('div', { className: 'fm-budget-row' },
            h('label', { className: 'fm-label' }, '单次输出上限', h('input', { type: 'number', 'aria-label': '单次输出 token 上限', min: policy.minOutputTokens ?? 64, max: policy.outputMaximumTokens ?? 256, step: 32, value: output, disabled: !outputAvailable, onChange: e => setOutput(Number(e.target.value)) })),
            h('button', { type: 'button', className: 'fm-button', disabled: disabled || !outputAvailable || !Number.isSafeInteger(output) || output < policy.minOutputTokens || output > (policy.outputMaximumTokens ?? 256), onClick: () => controller.personaAction('output', { value: output }) }, '保存上限')),
          !outputAvailable && h('p', { className: 'fm-note' }, '当前 Core 尚未提供输出上限设置。'),
          h('details', { className: 'fm-call-history' }, h('summary', null, '最近调用明细'),
            ...(ledger.recent ?? []).map(r => h('div', { className: 'fm-call', key: r.callId },
              h('p', { className: 'fm-label' }, `${r.purpose==='model-recommendations'?'推荐歌单':'画像总结'} · ${r.model} · ${r.status}`),
              h('p', { className: 'fm-note' }, `${new Date(r.startedAt).toLocaleString()} · ${usageText(r.usage)}`))),
            !(ledger.recent?.length) && h('p', { className: 'fm-note' }, '暂无调用记录。')),
          h('p', { className: 'fm-note' }, `聚合事实 ${policy.factsBytes} / ${policy.maxPromptBytes} 字节（UTF-8，不是精确 token 数）。实际用量以模型返回为准。`)))));
}
