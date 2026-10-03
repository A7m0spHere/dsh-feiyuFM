import React from 'react';
import {h} from './shared.mjs';

export function FeedbackSettings({state,controller}) {
  const [confirm,setConfirm]=React.useState(false),[clearFeedback,setClearFeedback]=React.useState(false);
  const feedback=state.insights?.feedback,available=feedback?.version===1;
  const disabled=state.busy||state.summaryBusy||!state.connected||!available;
  return h('section',null,h('h2',null,'推荐反馈',h('small',null,'FEEDBACK')),
    h('div',{className:'fm-card'},
      available?h('p',{className:'fm-note'},`喜欢 ${feedback.liked} 首 · 少推荐 ${feedback.reduced} 首。手动反馈独立保存，不会被自动成长覆盖。`)
        :h('p',{className:'fm-note'},'当前 Core 尚未提供反馈功能，重新加载新版插件后可用。'),
      h('details',{className:'fm-disclosure'},h('summary',null,'偏好重置与恢复'),h('div',{className:'fm-disclosure-body'},
        h('p',{className:'fm-note'},'恢复为当前输入曲库的初始偏好。保留账号、曲库、历史和 token 账本；旧模型总结会移除。'),
        feedback?.resetAt&&h('p',{className:'fm-note'},`最近重置：${new Date(feedback.resetAt).toLocaleString()}`),
        confirm?h('div',{className:'fm-reset-confirm'},
          h('p',{className:'fm-label'},'重置积累的推荐偏好？'),
          h('label',{className:'fm-check-row'},h('input',{type:'checkbox',checked:clearFeedback,disabled,'aria-label':'同时清除喜欢和少推荐反馈',onChange:e=>setClearFeedback(e.target.checked)}),'同时清除喜欢 / 少推荐反馈'),
          h('div',{className:'fm-feedback-actions'},
            h('button',{type:'button',className:'fm-button',disabled,onClick:async()=>{await controller.command('resetTaste',{clearFeedback});setConfirm(false);}},'确认重置'),
            h('button',{type:'button',className:'fm-button',disabled:state.busy,onClick:()=>setConfirm(false)},'取消')))
          :h('div',{className:'fm-feedback-actions'},
            h('button',{type:'button',className:'fm-button',disabled,onClick:()=>{setClearFeedback(false);setConfirm(true);}},'重置推荐偏好'),
            feedback?.canUndoReset&&h('button',{type:'button',className:'fm-button',disabled,onClick:()=>controller.command('undoTasteReset')},'撤销最近一次重置')),
        h('p',{className:'fm-note'},'保留最近一次恢复点。撤销会恢复旧权重，覆盖重置后的成长；再次重置会替换恢复点。')))));
}
