import React from 'react';
import { h } from './shared.mjs';

export function NetworkProxySettings({ state, controller }) {
  const view = state.networkProxy;
  const [draft, setDraft] = React.useState(() => ({ mode: view?.mode ?? 'direct', url: view?.url ?? '' }));
  const [dirty, setDirty] = React.useState(false);
  const [baseRevision, setBaseRevision] = React.useState(view?.revision ?? 0);
  const editVersion = React.useRef(0);
  const readAfterConnection = React.useRef(true);
  const id = React.useId();
  React.useEffect(() => {
    if (!state.connected) { readAfterConnection.current = true; return; }
    if (readAfterConnection.current && !state.networkProxyBusy) {
      readAfterConnection.current = false;
      void controller.loadNetworkProxy();
    }
  }, [controller, state.connected, state.networkProxyBusy]);
  React.useEffect(() => {
    if (!dirty && view) { setDraft({ mode: view.mode, url: view.url }); setBaseRevision(view.revision); }
  }, [view?.mode, view?.url, view?.revision, dirty]);
  const conflict = (dirty && view && view.revision !== baseRevision) || state.networkProxyErrorCode === 'network_proxy_conflict';
  const unavailable = view?.version !== 1;
  const disabled = !state.connected || state.networkProxyBusy || unavailable;
  function change(field, value) {
    editVersion.current++;
    if (!dirty) setBaseRevision(view.revision);
    setDraft(previous => ({ ...previous, [field]: value }));
    setDirty(true);
    if (state.networkProxyErrorCode !== 'network_proxy_conflict') controller.clearNetworkProxyFeedback?.();
  }
  async function save(value = draft) {
    const version = editVersion.current;
    const result = await controller.saveNetworkProxy(value, dirty ? baseRevision : view.revision);
    if (result?.ok) {
      setBaseRevision(result.networkProxy.revision);
      if (version === editVersion.current) {
        setDraft({ mode: result.networkProxy.mode, url: result.networkProxy.url }); setDirty(false);
      }
    }
  }
  async function reload() {
    const version = editVersion.current;
    const result = await controller.loadNetworkProxy();
    if (result?.ok && version === editVersion.current) {
      setDraft({ mode: result.networkProxy.mode, url: result.networkProxy.url });
      setBaseRevision(result.networkProxy.revision); setDirty(false);
      controller.clearNetworkProxyFeedback?.();
    }
  }
  return h('section', { className: 'fm-network-section' },
    h('h2', null, '网络连接', h('small', null, 'NETWORK')),
    h('div', { className: 'fm-card fm-network-proxy' },
      h('div', { className: 'fm-motion-row' }, h('label', { htmlFor: `${id}-mode` }, '连接方式'),
        h('select', { id: `${id}-mode`, 'aria-label': '连接方式', value: draft.mode, disabled,
          onChange: event => change('mode', event.target.value) },
        h('option', { value: 'direct' }, '直连（默认）'), h('option', { value: 'proxy' }, '自定义代理'))),
      h('div', { className: 'fm-network-address' }, h('label', { htmlFor: `${id}-url` }, '代理地址'),
        h('input', { id: `${id}-url`, type: 'url', 'aria-label': '代理地址', 'aria-describedby': `${id}-format`,
          placeholder: 'http://127.0.0.1:7897', value: draft.url, disabled: disabled || draft.mode !== 'proxy',
          onChange: event => change('url', event.target.value), autoComplete: 'off', spellCheck: false })),
      h('p', { className: 'fm-note', id: `${id}-format` }, '支持 HTTP／HTTPS 无认证代理，地址使用主机和端口。'),
      h('p', { className: 'fm-note' }, 'TUN／VPN 的分流由外部管理。保存后对新发起的音乐平台请求和音频下载生效。'),
      unavailable && h('p', { className: 'fm-note', role: 'status' }, state.networkProxyBusy ? '正在读取网络设置…' : '网络设置尚未读取，请重新读取。'),
      conflict
        && h('p', { className: 'fm-note', role: 'status' }, '已保存设置发生变化，当前输入已保留，请先读取新设置。'),
      h('div', { className: 'fm-feedback-actions' },
        h('button', { type: 'button', className: 'fm-button', disabled: disabled || !dirty || conflict,
          onClick: () => save() }, state.networkProxyBusy ? '处理中…' : '保存网络设置'),
        h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: disabled || conflict || (!dirty && view?.mode === 'direct' && !view?.url),
          onClick: () => save({ mode: 'direct', url: '' }) }, '恢复默认直连'),
        h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: !state.connected || state.networkProxyBusy,
          onClick: reload }, '重新读取网络设置')),
      state.networkProxyError && h('p', { className: 'fm-note fm-expression-error', role: 'alert' }, state.networkProxyError),
      dirty && h('p', { className: 'fm-note', role: 'status' }, '当前输入尚未保存。'),
      !dirty && state.networkProxyNotice && h('p', { className: 'fm-note', role: 'status', 'aria-live': 'polite' }, state.networkProxyNotice)));
}
