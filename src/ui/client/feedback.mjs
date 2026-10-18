import React from 'react';
import {h} from './shared.mjs';

function FeedbackManager({state,controller}) {
  const [query,setQuery]=React.useState(''),[filter,setFilter]=React.useState('all');
  const page=state.feedbackPage,waiting=state.feedbackListBusy,blocked=waiting||state.feedbackClearBusy||!state.connected;
  const pages=page?Math.max(1,Math.ceil(page.matched/page.limit)):1,currentPage=page?Math.floor(page.offset/page.limit):0;
  return h('details',{className:'fm-disclosure fm-feedback-manager',onToggle:event=>controller.setFeedbackOpen(event.currentTarget.open)},
    h('summary',null,'管理反馈'),h('div',{className:'fm-disclosure-body'},
      h('div',{className:'fm-feedback-filters'},
        h('input',{type:'search',className:'fm-library-search',value:query,maxLength:200,'aria-label':'搜索推荐反馈',
          placeholder:'搜索歌曲、艺人或 ID',onChange:event=>{setQuery(event.target.value);void controller.queryFeedback(event.target.value,filter,0);}}),
        h('select',{value:filter,'aria-label':'筛选推荐反馈',onChange:event=>{setFilter(event.target.value);void controller.queryFeedback(query,event.target.value,0);}},
          h('option',{value:'all'},'全部反馈'),h('option',{value:'liked'},'喜欢'),h('option',{value:'reduced'},'少推荐'))),
      state.feedbackError&&h('div',{className:'fm-notice',role:'alert'},state.feedbackError,
        h('button',{type:'button',className:'fm-button',disabled:waiting||state.feedbackClearBusy,onClick:()=>controller.queryFeedback(query,filter,page?.offset??0)},'重新查询')),
      state.feedbackNotice&&h('p',{className:'fm-note',role:'status','aria-live':'polite'},state.feedbackNotice),
      waiting||!page||state.feedbackError?h('p',{className:'fm-note',role:'status'},state.feedbackError?'反馈列表未确认，请重新查询。':'正在读取反馈…')
        :!page.items.length?h('p',{className:'fm-note',role:'status'},page.total?'没有匹配的反馈，试试其他条件。':'还没有喜欢或少推荐的歌曲。')
        :h('ul',{className:'fm-feedback-records'},...page.items.map(item=>h('li',{key:item.key,className:'fm-feedback-record'},
          h('div',{className:'fm-feedback-record-copy'},h('strong',null,item.track.title||item.track.providerTrackId),
            h('span',{className:'fm-note'},`${item.track.artist||'未知艺人'} · ${item.track.provider==='netease'?'网易云音乐':'QQ 音乐'}`),
            h('span',{className:'fm-note'},`${item.score===1?'喜欢':'少推荐'} · ${new Date(item.updatedAt).toLocaleString()}`)),
          h('button',{type:'button',className:'fm-button',disabled:blocked,'aria-label':`撤销 ${item.track.title||item.track.providerTrackId} 的推荐反馈`,onClick:()=>controller.clearFeedback(item)},'撤销反馈')))),
      h('div',{className:'fm-library-foot'},h('span',{className:'fm-note',role:'status'},page&&!waiting?`${page.matched} 条匹配 · 共 ${page.total} 条反馈`:''),
        page&&!waiting&&!state.feedbackError&&pages>1&&h('div',{className:'fm-library-pages'},
          h('button',{type:'button',className:'fm-button',disabled:blocked||currentPage===0,'aria-label':'上一页反馈',onClick:()=>controller.queryFeedback(query,filter,page.offset-page.limit)},'上一页'),
          h('span',null,`${currentPage+1} / ${pages}`),
          h('button',{type:'button',className:'fm-button',disabled:blocked||currentPage===pages-1,'aria-label':'下一页反馈',onClick:()=>controller.queryFeedback(query,filter,page.offset+page.limit)},'下一页'))),
      h('p',{className:'fm-note'},'只管理肥鱼电台内的明确反馈；撤销不影响播放、禁播或已积累的成长。')));
}

export function FeedbackSettings({state,controller}) {
  const [confirm,setConfirm]=React.useState(null),[clearFeedback,setClearFeedback]=React.useState(false);
  const feedback=state.insights?.feedback,available=feedback?.version===1;
  const disabled=state.busy||state.platformBusy||state.summaryBusy||!state.connected||!available;
  return h('section',null,h('h2',null,'推荐反馈',h('small',null,'FEEDBACK')),
    h('div',{className:'fm-card'},
      available?h('p',{className:'fm-note'},`输入曲库 ${state.library?.total??0} 首 · 喜欢 ${feedback.liked} 首 · 少推荐 ${feedback.reduced} 首。`)
        :h('p',{className:'fm-note'},'当前 Core 尚未提供反馈功能，重新加载新版插件后可用。'),
      feedback?.managementVersion===1&&h(FeedbackManager,{state,controller}),
      h('details',{className:'fm-disclosure'},h('summary',null,'偏好重置与恢复'),h('div',{className:'fm-disclosure-body'},
        h('p',{className:'fm-note'},'清空曲库会移除输入名单和积累偏好；仅重置成长会保留输入歌曲。账号、播放历史和 token 账本保留。'),
        feedback?.resetAt&&h('p',{className:'fm-note'},`最近重置：${new Date(feedback.resetAt).toLocaleString()}`),
        confirm?h('div',{className:'fm-reset-confirm'},
          h('p',{className:'fm-label'},confirm==='library'?`清空 ${state.library?.total??0} 首输入歌曲并重建偏好？`:'仅重置成长偏好，保留输入曲库？'),
          h('label',{className:'fm-check-row'},h('input',{type:'checkbox',checked:clearFeedback,disabled,'aria-label':'同时清除喜欢和少推荐反馈',onChange:e=>setClearFeedback(e.target.checked)}),'同时清除喜欢 / 少推荐反馈'),
          h('div',{className:'fm-feedback-actions'},
            h('button',{type:'button',className:'fm-button',disabled,onClick:async()=>{await controller.command(confirm==='library'?'resetLibrary':'resetTaste',{clearFeedback});setConfirm(null);}},confirm==='library'?'确认清空输入曲库':'确认重置'),
            h('button',{type:'button',className:'fm-button',disabled:state.busy,onClick:()=>setConfirm(null)},'取消')))
          :h('div',{className:'fm-feedback-actions'},
            h('button',{type:'button',className:'fm-button',disabled:disabled||!state.insights?.libraryResetSupported,onClick:()=>{setClearFeedback(false);setConfirm('library');}},'清空输入曲库并重建偏好'),
            h('button',{type:'button',className:'fm-button',disabled,onClick:()=>{setClearFeedback(false);setConfirm('taste');}},'仅重置成长偏好'),
            feedback?.canUndoReset&&h('button',{type:'button',className:'fm-button',disabled,onClick:()=>controller.command('undoTasteReset')},'撤销最近一次重置')),
        h('p',{className:'fm-note'},'清空后可重新导入参考歌曲。保留最近一次恢复点；撤销会覆盖重置之后的导入和成长。')))));
}
