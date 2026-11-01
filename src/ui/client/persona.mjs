import React from 'react';
import { h } from './shared.mjs';
import { recommendationActionState } from './presentation.mjs';

export function Persona({state,controller,settingsOnly=false,selectedModel='',onSelectModel}) {
  const view=state.persona;
  const [budget,setBudget]=React.useState(100000),[output,setOutput]=React.useState(256);
  const [localNow,setLocalNow]=React.useState(()=>Date.now());
  const clock=React.useRef({view,receivedAt:Date.now()});
  if(clock.current.view!==view)clock.current={view,receivedAt:Date.now()};
  React.useEffect(()=>{
    const gate=view?.recommendationAvailability,deadline=gate?.reason==='summary_retry_limit'?gate.resetAt:gate?.retryAt;
    if(!deadline)return undefined;
    const timer=setTimeout(()=>setLocalNow(Date.now()),Math.max(0,deadline-(gate.serverNow??Date.now())));
    return()=>clearTimeout(timer);
  },[view?.recommendationAvailability]);
  React.useEffect(()=>{if(view){setBudget(view.policy.dailyTokens);setOutput(view.policy.maxOutputTokens);}},[view?.policy?.dailyTokens,view?.policy?.maxOutputTokens]);
  if(!view)return null;
  const {ledger,policy}=view;
  const pipeline=view.recommendationPipeline??state.snapshot?.discovery??{},playbackPool=pipeline.playbackPool;
  const poolAvailable=Array.isArray(playbackPool?.tracks);
  const tracks=poolAvailable?playbackPool.tracks:pipeline.pipeline==='platform-filter'?pipeline.tracks??[]:[];
  const routes=state.summaryModels??[],key=route=>JSON.stringify([route.provider,route.model]);
  const saved=view.recommendationRoute??view.lastModelRoute;
  const previous=saved&&routes.find(route=>route.provider===saved.provider&&route.model===saved.model);
  const chosen=routes.some(item=>key(item)===selectedModel)?selectedModel:(previous?key(previous):routes[0]?key(routes[0]):'');
  const route=routes.find(item=>key(item)===chosen),referenceCount=pipeline.referenceCount??state.library?.total??0;
  const serverNow=(view.generatedAt??localNow)+Math.max(0,localNow-clock.current.receivedAt);
  const autonomous=state.snapshot?.settings?.listening===true&&!(state.snapshot?.blockUntil>serverNow);
  const availability=view.recommendationAvailability,limit=state.summaryLimit;
  const budgetBlocked=limit?.code==='budget_exhausted'&&limit.remainingTokens===ledger.remainingTokens;
  const action=recommendationActionState(budgetBlocked?{...availability,reason:'budget_exhausted'}:availability,serverNow);
  const staleLimit=availability&&!action.reason&&['summary_cooldown','summary_busy','summary_retry_limit'].includes(limit?.code);
  const filtering=pipeline.filtering||availability?.runningPurpose==='discovery-filter';
  const busy=state.summaryBusy||filtering||pipeline.refreshing,disabled=state.summaryBusy||state.busy||!state.connected;
  if(settingsOnly)return h('section',{'aria-label':'推荐设置'},h('h2',null,'模型与推荐'),h('div',{className:'fm-card fm-recommendation-settings'},
    h('label',{className:'fm-label'},'帮我挑歌的模型'),
    h('div',{className:'fm-summary-actions'},h('select',{'aria-label':'推荐模型',value:chosen,disabled:disabled||!routes.length,
      onChange:event=>onSelectModel?.(event.target.value)},...(routes.length?routes.map(item=>h('option',{key:key(item),value:key(item)},item.label)):[h('option',{value:''},'DSH 模型暂不可用')]))),
    h('p',{className:'fm-note'},'模型选择在下次手动挑歌时应用并记住；播放和换曲不会调用模型。'),
    h('div',{className:'fm-budget-row'},h('label',{className:'fm-label'},'每日共享预算',h('input',{type:'number','aria-label':'每日共享 token 预算',min:0,max:100000,step:100,value:budget,onChange:event=>setBudget(Number(event.target.value))})),
      h('button',{type:'button',className:'fm-button',disabled:disabled||!Number.isSafeInteger(budget)||budget<0||budget>100000,onClick:()=>controller.personaAction('budget',{value:budget})},'保存预算')),
    h('div',{className:'fm-budget-row'},h('label',{className:'fm-label'},'单次输出上限',h('input',{type:'number','aria-label':'单次输出 token 上限',min:policy.minOutputTokens??64,max:policy.outputMaximumTokens??256,step:32,value:output,onChange:event=>setOutput(Number(event.target.value))})),
      h('button',{type:'button',className:'fm-button',disabled:disabled||!Number.isSafeInteger(output)||output<(policy.minOutputTokens??64)||output>(policy.outputMaximumTokens??256),onClick:()=>controller.personaAction('output',{value:output})},'保存上限')),
    state.summaryNotice&&h('p',{className:'fm-note',role:'status'},state.summaryNotice),state.summaryError&&h('p',{className:'fm-note',role:'alert'},state.summaryError),
    h('details',{className:'fm-disclosure'},h('summary',null,'用量与诊断'),
      h('p',{className:'fm-note'},`今日已知用量 ${ledger.today.knownTokens} tokens · 今日剩余 ${ledger.remainingTokens}`),
      h('p',{className:'fm-note'},`累计已知用量 ${ledger.total.knownTokens} tokens · 共 ${ledger.total.attempts} 次尝试`),
      state.connected&&playbackPool&&h('p',{className:'fm-note'},`入选池 ${playbackPool.total} 首 · 当前可选 ${playbackPool.available} 首 · 近 50 次已播 ${playbackPool.recentBlocked} 首`),
      pipeline.summary&&h('p',{className:'fm-note'},pipeline.summary),
      ...(ledger.recent??[]).map(call=>h('p',{className:'fm-note',key:call.callId},`${call.purpose==='discovery-filter'?'挑歌':'旧版总结'} · ${call.model} · ${call.status}`)))));
  const repeatWaiting=!state.snapshot?.current&&state.snapshot?.lastSelection?.reason==='recent-window-exhausted';
  const status=!state.connected?'正在连接电台…':!referenceCount?'先在电台设置中导入参考歌曲。'
    :pipeline.refreshing?'正在网易云寻找新歌，现有歌曲仍可点播。':filtering?'正在挑选新歌，播放控制仍可使用。'
    :state.summaryBusy?'正在准备新一批歌曲…':tracks.length?poolAvailable?autonomous?'不同批次的入选歌曲，由大肥鱼自主选择下一首。':'不同批次的入选歌曲，可以手动点播。':'当前宿主展示最新批次的歌曲。'
    :repeatWaiting?'最近 50 首暂不重复，正在等待窗口外的新歌。':pipeline.state==='login_required'?'先在电台设置中连接网易云。'
    :!routes.length?'先在 DSH 配置模型，再到电台设置中选择。':pipeline.selectionComplete?'暂无新的可选歌曲，可以补充歌单或手动点播输入曲库。':'参考歌曲已准备好，可以找一批歌。';
  const song=(track,index)=>h('button',{type:'button',className:'fm-pick',key:`${track.provider}:${track.providerTrackId}`,disabled:state.busy||!state.connected,
    'aria-label':`播放 ${track.title} · ${track.artist||'未知艺人'}`,onClick:()=>controller.command('requestTrack',track)},
    h('span',{className:'fm-pick-index','aria-hidden':true},index+1),h('span',{className:'fm-pick-copy'},h('strong',null,track.title),h('span',null,track.artist||'未知艺人'),track.discovery?.llmReason&&h('span',{className:'fm-pick-reason'},track.discovery.llmReason)),h('span',{className:'fm-pick-play','aria-hidden':true},'▶'));
  return h('section',{className:'fm-pool-section','aria-label':'大肥鱼可选的歌'},h('div',{className:'fm-card fm-persona-card','aria-busy':Boolean(busy)},
    h('div',{className:'fm-pool-heading'},h('h2',null,'大肥鱼可选的歌'),state.connected&&h('span',{className:'fm-pool-count'},poolAvailable?`${playbackPool.available} 首可选`:`${tracks.length} 首 · 当前批次`)),
    h('p',{className:'fm-pool-status',role:'status','aria-live':'polite'},status),
    tracks.length>0&&h('div',{className:'fm-picks'},tracks.slice(0,3).map(song)),
    tracks.length>3&&h('details',{className:'fm-disclosure fm-all-picks'},h('summary',null,`查看其余 ${tracks.length-3} 首`),h('div',{className:'fm-picks'},tracks.slice(3).map((track,index)=>song(track,index+3)))),
    action.message&&h('p',{className:'fm-recommendation-status',role:'status'},action.message),
    state.summaryError&&h('div',{className:'fm-notice','data-error':true,role:'alert'},state.summaryError,h('p',null,tracks.length?'已有入选歌曲保留，可以继续点播。':'可先点播输入曲库，或稍后重试。'),
      state.summaryErrorCode&&h('details',{className:'fm-error-details'},h('summary',null,'技术详情'),h('code',null,state.summaryErrorCode))),
    !state.summaryError&&state.summaryNotice&&!busy&&!action.message&&!staleLimit&&h('p',{className:'fm-note',role:'status'},state.summaryNotice),
    h('div',{className:'fm-pool-footer'},h('span',null,autonomous?'余量不足时会按预算自动补充':'自主听歌已停止，仍可手动补充'),h('button',{type:'button',className:'fm-button',disabled:disabled||busy||action.disabled||!route||!referenceCount||!state.features?.personaSummary,
      onClick:()=>controller.personaAction('recommendations',{provider:route.provider,model:route.model})},busy?filtering?'正在挑歌…':'正在找歌…':action.label||(state.summaryError?'再试一次':tracks.length?'补充歌单':'找一批歌')))));
}
