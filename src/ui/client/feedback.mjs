import React from 'react';
import {h} from './shared.mjs';

export function FeedbackSettings({state,controller}) {
  const [confirm,setConfirm]=React.useState(null),[clearFeedback,setClearFeedback]=React.useState(false);
  const feedback=state.insights?.feedback,available=feedback?.version===1;
  const disabled=state.busy||state.platformBusy||state.summaryBusy||!state.connected||!available;
  return h('section',null,h('h2',null,'推荐反馈',h('small',null,'FEEDBACK')),
    h('div',{className:'fm-card'},
      available?h('p',{className:'fm-note'},`输入曲库 ${state.library?.total??0} 首 · 喜欢 ${feedback.liked} 首 · 少推荐 ${feedback.reduced} 首。`)
        :h('p',{className:'fm-note'},'当前 Core 尚未提供反馈功能，重新加载新版插件后可用。'),
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
