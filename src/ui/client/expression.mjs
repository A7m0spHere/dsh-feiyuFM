import React from 'react';
import {h,EXPRESSION_LABELS} from './shared.mjs';

export function ExpressionSettings({state,controller}) {
  const view=state.expression;
  const [draft,setDraft]=React.useState(view?.style??'current');
  const [dirty,setDirty]=React.useState(false),[baseRevision,setBaseRevision]=React.useState(view?.revision??0);
  const id=React.useId();
  React.useEffect(()=>{if(!dirty&&view){setDraft(view.style);setBaseRevision(view.revision);}},[view?.style,view?.revision,dirty]);
  const conflict=dirty&&view?.revision!==baseRevision;
  const unavailable=view?.version!==1||view.available!==true;
  const disabled=!state.connected||state.expressionBusy||unavailable;
  async function save(style){
    const result=await controller.saveExpression(style,dirty?baseRevision:view.revision);
    if(result?.ok){setDraft(result.expression.style);setBaseRevision(result.expression.revision);setDirty(false);}
  }
  return h('div',{className:'fm-expression-settings'},
    h('div',{className:'fm-motion-row'},h('label',{htmlFor:id},'表达风格'),
      h('select',{id,'aria-label':'表达风格',value:draft,disabled,onChange:e=>{if(!dirty)setBaseRevision(view.revision);setDraft(e.target.value);setDirty(true);}},
        ...Object.entries(EXPRESSION_LABELS).map(([value,label])=>h('option',{key:value,value},label)))),
    h('p',{className:'fm-note'},'只调整本地说明文字，音乐偏好、反馈和听歌控制独立保存。'),
    unavailable?h('p',{className:'fm-note'},'当前 Core 暂未提供可编辑的表达设置。')
      :h('p',{className:'fm-expression-example'},h('span',{className:'fm-note'},'固定示例'),h('span',null,view.examples?.[draft]??'示例暂未提供。')),
    (conflict||state.expressionErrorCode==='expression_conflict')&&h('p',{className:'fm-note',role:'status'},'已保存设置发生变化，当前选择保留；请先读取新设置。'),
    h('div',{className:'fm-feedback-actions'},
      h('button',{type:'button',className:'fm-button',disabled:disabled||!dirty||conflict,onClick:()=>save(draft)},state.expressionBusy?'保存中…':'保存表达方式'),
      h('button',{type:'button',className:'fm-button fm-subtle',disabled:disabled||conflict||(view?.style==='current'&&!dirty),onClick:()=>save('current')},'恢复默认表达'),
      (dirty||state.expressionErrorCode==='expression_conflict')&&h('button',{type:'button',className:'fm-button fm-subtle',disabled:state.expressionBusy,onClick:async()=>{
        await controller.refresh();const latest=controller.getSnapshot().expression;if(latest){setDraft(latest.style);setBaseRevision(latest.revision);setDirty(false);controller.clearExpressionFeedback();}
      }},'读取已保存设置')),
    state.expressionError&&h('p',{className:'fm-note fm-expression-error',role:'alert'},state.expressionError),
    dirty&&h('p',{className:'fm-note',role:'status'},'当前选择尚未保存。'),
    !dirty&&state.expressionNotice&&h('p',{className:'fm-note',role:'status'},state.expressionNotice));
}
