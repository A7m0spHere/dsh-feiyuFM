import React from 'react';import {h} from './shared.mjs';
export function Persona({state,controller}){
 const view=state.persona,[selected,setSelected]=React.useState(''),[budget,setBudget]=React.useState(4000);
 React.useEffect(()=>{if(view)setBudget(view.policy.dailyTokens);},[view?.policy?.dailyTokens]);
 if(!view)return null;
 const routes=state.summaryModels??[],key=r=>JSON.stringify([r.provider,r.model]),summary=view.summary,ledger=view.ledger;
 const cachedRoute=summary&&routes.find(r=>r.provider===summary.provider&&r.model===summary.model);
 const chosen=selected||(cachedRoute?key(cachedRoute):routes[0]?key(routes[0]):'');
 const route=routes.find(r=>key(r)===chosen);
 const usageText=u=>u?`输入 ${u.inputTokens} / 输出 ${u.outputTokens}${u.cacheReadTokens?` / 缓存读 ${u.cacheReadTokens}`:''}${u.cacheWriteTokens?` / 缓存写 ${u.cacheWriteTokens}`:''}${Number.isFinite(u.reasoningTokens)?` / 推理 ${u.reasoningTokens}（输出细分）`:''}`:'用量未知';
 return h('section',{'aria-label':'音乐人格与模型用量'},h('h2',null,'大肥鱼的音乐画像',h('small',null,'PERSONA')),
  h('div',{className:'fm-card'},
   h('p',{className:'fm-label'},'本地事实与推荐策略'),
   h('p',{className:'fm-note'},view.facts.artists.length?`目前较高权重的艺人：${view.facts.artists.map(a=>a.name).join('、')}。已追踪窗口中有 ${view.facts.validListens} 次有效自主经历。`:'尚未形成足够的艺人偏好，先导入或积累收听经历。'),
   h('p',{className:'fm-note'},`探索目标 ${view.facts.discoveryEnabled?view.facts.exploration:0}%；平台相似候选与账号推荐分别记录，本地偏好和重复限制参与选择。权重来自初始化或有效经历，不等同于心理人格；流派和情绪未知。`),
   h('div',{className:'fm-summary'},h('p',{className:'fm-label'},'LLM 总结 · 仅作展示'),
    summary?h(React.Fragment,null,h('p',{className:'fm-summary-text'},summary.text),h('p',{className:'fm-note'},`${summary.provider} / ${summary.model} · ${new Date(summary.generatedAt).toLocaleString()} · ${usageText(summary.usage)}${view.summaryStale?' · 画像已变化，可在预算和冷却允许时更新':''}`))
     :h('p',{className:'fm-note'},'还没有模型总结。默认手动生成，播放和逐曲回复不会自动调用模型。'),
    h('select',{'aria-label':'总结模型',value:chosen,disabled:state.summaryBusy||!routes.length,onChange:e=>setSelected(e.target.value)},
      ...(routes.length?routes.map(r=>h('option',{key:key(r),value:key(r)},r.label)):[h('option',{value:''},'DSH 模型列表尚不可用')])),
    h('button',{type:'button',className:'fm-button',disabled:state.summaryBusy||!state.connected||!state.features?.personaSummary||!route,
      onClick:()=>controller.personaAction('summary',{provider:route.provider,model:route.model})},state.summaryBusy?'正在处理…':'根据画像总结一次'),
    h('p',{className:'fm-note',role:'status','aria-live':'polite'},state.summaryError||state.summaryNotice||'只发送少量聚合事实，不发送整份曲库。相同画像和模型复用缓存；成功总结间隔至少 1 小时，已对账失败可手动重试，每日最多 3 次新尝试。')),
   h('details',null,h('summary',null,'插件 token 账本与预算'),
    h('p',{className:'fm-note'},`本地选歌 / 逐曲回复：${ledger.localDecisionRequests} 次模型调用。人格总结今日已知 ${ledger.today.knownTokens} tokens，累计已知 ${ledger.total.knownTokens} tokens；${ledger.total.attempts} 次已记录尝试，其中 ${ledger.total.unknownCalls} 次用量未知或仍进行中。`),
    h('p',{className:'fm-note'},`今日预算剩余 ${ledger.remainingTokens} tokens。未知用量按保守预留扣预算，不冒充真实用量；DSH 主任务和共享上下文成本未归因，不计入这里。`),
    ...(ledger.recent??[]).map(r=>h('p',{className:'fm-note',key:r.callId},`${new Date(r.startedAt).toLocaleString()} · ${r.model} · ${r.status} · ${usageText(r.usage)}`)),
    h('label',{className:'fm-label'},'每日总结预算',h('input',{type:'number','aria-label':'每日总结 token 预算',min:0,max:100000,step:100,value:budget,onChange:e=>setBudget(Number(e.target.value))})),
    h('button',{type:'button',className:'fm-button',disabled:state.summaryBusy||!Number.isSafeInteger(budget)||budget<0||budget>100000,onClick:()=>controller.personaAction('budget',{value:budget})},'保存预算'),
    h('p',{className:'fm-note'},'输出上限 256 tokens；输入有长度限制，预算预留包含保守余量，实际用量以模型返回为准。自动总结关闭。'))));
}
