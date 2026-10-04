import { playbackPresentation, discoveryPresentation } from './presentation.mjs';
import React from 'react';
import { h, minutes, progressPercent, modes, sourceNames, stageNames } from './shared.mjs';
import { Svg, StatusMark, CharacterArt } from './components.mjs';
import { Library } from './library.mjs';
import {Persona} from './persona.mjs';
import {FeedbackSettings} from './feedback.mjs';
export function Panel({ controller, back, close }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const snapshot = state.snapshot;
  const settings = snapshot?.settings || {};
  const [rate, setRate] = React.useState(20);
  const [importSource,setImportSource]=React.useState('auto');
  const [playlistId,setPlaylistId]=React.useState('');
  const rateId = React.useId();
  React.useEffect(() => { if (snapshot) setRate(Math.round(settings.discoveryRate * 100)); }, [settings.discoveryRate]);
  React.useEffect(() => {
    if (!['waiting', 'scanned'].includes(state.login?.status)) return undefined;
    const poll = setInterval(() => controller.platformAction('poll', state.login.provider), 2500);
    return () => clearInterval(poll);
  }, [state.login?.status, state.login?.provider, controller]);
  const disabled = state.busy || !state.connected || !snapshot;
  const mode = !settings.listening ? (!settings.humanPlayback ? 'off' : 'manual') : !settings.humanPlayback ? 'silent' : settings.strategy === 'focus' ? 'focus' : 'normal';
  const current = snapshot?.current;
  const playing = snapshot?.status === 'playing';
  const presentation = playbackPresentation(snapshot, state.connected);
  const insights=state.insights;
  const art = presentation.art;
  const accountHint = !state.connected ? '连接中断' : ({authorized:'网易云已登录',expired:'登录已过期',signed_out:'未登录',login_required:'等待登录'}[state.platforms?.netease?.account?.status] || '查看连接');
  function toggle(title, description, field, command) {
    return h('div', { className: 'fm-row', key: field }, h('div', null, h('div', { className: 'fm-label' }, title), h('p', null, description)),
      h('button', { type: 'button', className: 'fm-toggle', role: 'switch', 'aria-label': title, 'aria-checked': Boolean(settings[field]), disabled,
        onClick: () => controller.command(command, !settings[field]) }, h('span')));
  }
  const button = (label, type, blocked = false, extra = {}) => h('button', { type: 'button', className: 'fm-button', disabled: disabled || blocked, onClick: () => controller.command(type), ...extra }, label);
  const platformRows = [['netease', '网易云音乐', '网'], ['qq', 'QQ 音乐', 'Q']].map(([id, title, mark]) => {
    const platform = state.platforms?.[id];
    const label = !snapshot ? '读取中' : !platform?.installed ? '接口尚未接入' : ({
      authorized: '已登录', expired: '登录已过期', signed_out: '未登录',
      login_required: platform.account?.pending ? '等待扫码' : '未登录',
    }[platform.account?.status] || '未连接');
    const available = id === 'netease' && platform?.installed;
    const selectedPlaylist=playlistId||state.playlists?.[0]?.id||'';
    const action = platform?.account?.status === 'authorized'
      ? h(React.Fragment, null,
        state.features?.importSources&&h('select',{ 'aria-label':'导入来源',value:importSource,disabled:state.busy||!state.connected,
          onChange:e=>{setImportSource(e.target.value);if(e.target.value==='playlist')controller.platformAction('playlists',id);} },
          h('option',{value:'auto'},'自动来源'),h('option',{value:'recent'},'近期播放'),h('option',{value:'liked'},'我喜欢'),h('option',{value:'playlist'},'指定歌单')),
        state.features?.importSources&&importSource==='playlist'&&h('select',{'aria-label':'输入歌单',value:selectedPlaylist,disabled:state.busy||!state.playlists?.length,
          onChange:e=>setPlaylistId(e.target.value)},...(state.playlists?.length?state.playlists.map(p=>h('option',{key:p.id,value:p.id},p.title)):[h('option',{value:''},'读取歌单…')])),
        h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected || (importSource==='playlist'&&!selectedPlaylist),
          onClick: () => controller.platformAction('import', id,{source:importSource==='auto'?null:importSource,playlistId:importSource==='playlist'?selectedPlaylist:null}) }, '导入我的音乐'),
        h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: state.busy || !state.connected,
          onClick: () => controller.platformAction('logout', id) }, '退出'))
      : available && !state.login && h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected,
        onClick: () => controller.platformAction('begin', id) }, '扫码登录');
    return h('div', { className: 'fm-platform', key: id },
      h('div', { className: 'fm-platform-name' }, h('span', { className: 'fm-platform-mark', 'aria-hidden': true }, mark), title),
      h('div', { className: 'fm-platform-actions' }, h('span', { className: 'fm-badge', 'data-ok': platform?.account?.status === 'authorized' || undefined }, label), action));
  });
  const loginPanel = state.login?.provider === 'netease'
    ? h('div', { className: 'fm-login' },
      h('div', { className: 'fm-label' }, state.login.status === 'authorized' ? '网易云音乐已连接'
        : state.login.status === 'scanned' ? '已扫码，请在手机上确认'
          : state.login.status === 'expired' ? state.login.qrExpired === false ? '登录已失效' : '二维码已过期'
            : state.login.status === 'error' ? state.login.canRetryValidation ? '登录校验未通过' : '登录未完成' : '使用网易云音乐 App 扫描'),
      state.login.qrImage && !['authorized', 'expired', 'error'].includes(state.login.status)
        && h('img', { src: state.login.qrImage, width: 172, height: 172, alt: '网易云音乐登录二维码' }),
      h('p', { role: 'status', 'aria-live': 'polite' }, state.login.identityError || (state.login.status === 'authorized'
        ? state.login.accountId ? `账号已连接（ID ${state.login.accountId}），可以导入音乐。` : '账号已连接；导入前会自动补读账号 ID。'
        : state.login.status === 'expired' ? '请重新获取二维码后再试。' : '手机确认后会自动读取账号状态，随后即可导入音乐。')),
      (state.login.canRetryValidation || state.login.canRetryCheck) && state.login.status === 'error'
        && h('button', { type: 'button', className: 'fm-button', disabled: state.busy || !state.connected,
          onClick: () => controller.platformAction('poll', 'netease') }, state.login.canRetryValidation ? '重试登录校验' : '重试扫码检测'),
      ['expired', 'error'].includes(state.login.status)
        && h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected,
          onClick: () => controller.platformAction('begin', 'netease') }, '重新获取二维码'))
    : null;
  const importNotice = state.imported
    ? h('div', { className: 'fm-import', role: 'status', 'aria-live': 'polite' },
      h('strong', null, `最近导入：${sourceNames[state.imported.source] || state.imported.source || '平台音乐'}`),
      ` · 新增 ${state.imported.imported ?? 0} 首，当前共 ${state.imported.total ?? 0} 首`,
      state.imported.degraded && state.imported.reason ? h('span', null, ` · ${state.imported.reason}`) : null)
    : null;
  const attempts = Array.isArray(state.importAttempts) && state.importAttempts.length
    ? h('div', { className: 'fm-attempts' }, h('div', { className: 'fm-attempts-title' }, '本次来源尝试'),
      state.importAttempts.map((row, index) => h('div', { className: 'fm-attempt', key: `${row.source}-${index}` },
        h('div', null, h('strong', null, sourceNames[row.source] || row.source),
          h('span', { className: 'fm-attempt-note' }, row.ok
            ? `可用 · ${row.count} 首`
            : `${stageNames[row.stage] || '请求'}失败${row.code ? ` · ${row.code}` : ''}${row.httpStatus ? ` · HTTP ${row.httpStatus}` : ''}${row.platformCode ? ` · 接口码 ${row.platformCode}` : ''}${row.reason ? ` · ${row.reason}` : ''}`)),
        h('span', { className: 'fm-badge', 'data-ok': row.ok || undefined }, row.ok ? `${row.count} 首` : '失败'))))
    : null;
  const platformSection = h('section', null,
    h('h2', null, '音乐平台', h('small', null, 'ACCOUNTS')),
    h('div', { className: 'fm-card' }, platformRows, loginPanel, importNotice, attempts,
      h('p', { className: 'fm-platform-note' }, '近期记录优先，读取失败时尝试喜欢列表和用户歌单。QQ 接入暂缓。登录材料仅保存在本机。')));

  const preferencesColumn = h('div', {className:'fm-main-column'},
        h(Persona,{state,controller}),
        insights&&h('section',null,h('h2',null,'偏好与经历',h('small',null,'LOCAL PROFILE')),h('details',{className:'fm-card fm-profile-details'},h('summary',null,'查看偏好权重与选歌记录'),
          h('p',{className:'fm-note'},'本地画像 · 来自已保存的独立偏好'),
          ...(insights.profile?.artists?.length?insights.profile.artists.slice(0,5).map(a=>h('div',{className:'fm-row',key:a.key},
            h('span',null,a.name),h('span',{className:'fm-badge'},`权重 ${Math.round(a.affinity*100)}% · ${['listen','listen_silent'].includes(a.source)?'有效经历':a.source==='legacy_artist_link'?'旧偏好链接':'初始化/维护'}`))):[h('p',{className:'fm-note'},'还没有足够的艺人偏好记录。')]),
          h('p',{className:'fm-note'},'流派/情绪特征尚未提供，不据歌名推断。'),
          Array.isArray(insights.profile?.tracks)&&h('details',null,h('summary',null,'查看歌曲偏好与最近变化'),
            ...(insights.profile?.tracks??[]).map(t=>h('p',{className:'fm-note',key:t.key},`${t.title} · 权重 ${Math.round(t.affinity*100)}% · ${['listen','listen_silent'].includes(t.source)?'有效经历':'初始化/维护'}`)),
            h('p',{className:'fm-label'},'最近有效更新'),
            ...(insights.recentChanges?.length?insights.recentChanges.slice(0,3).map(c=>h('p',{className:'fm-note',key:c.playInstanceId},`${c.title} · ${c.before.toFixed(3)} → ${c.after.toFixed(3)} · ${c.audible?'有声':'静音'}经历`)):[h('p',{className:'fm-note'},'此决策窗口还没有有效偏好更新。')])),
          h('details',null,h('summary',null,'查看选歌统计'),h('p',{className:'fm-note'},`最近保留 ${insights.statistics?.retainedDecisions??0} 次自主决策；探索尝试 ${insights.statistics?.explorationAttempts??0} 次，选中陌生候选 ${insights.statistics?.unfamiliarSelections??0} 次，已观测开始 ${insights.statistics?.observedStarts??0} 次，有效陌生经历 ${insights.statistics?.validUnfamiliarListens??0} 次。`),
            Number.isFinite(insights.statistics?.repeatedSelections)&&h('p',{className:'fm-note'},`其中 ${insights.statistics.repeatedSelections} 次选中歌曲在近期已有播放历史。`),
            ...(insights.decisions??[]).slice(0,3).map(d=>h('p',{className:'fm-note',key:d.decisionId},`${d.trackTitle??d.trackKey??'未选中歌曲'} · ${d.pool==='discovery'?'陌生池':d.fellBack?'熟悉池回退':'熟悉池'}${d.trackKey?'':' · 本次未开始播放'}`)),
            h('p',{className:'fm-note'},`${Number.isFinite(insights.statistics?.windowStart)?`窗口始于 ${new Date(insights.statistics.windowStart).toLocaleString()}。`:''}按已追踪的决策实例统计，历史覆盖不足时不视作全期比例。`)))));
  const controlsColumn = h('aside', {className:'fm-controls-column','aria-label':'电台设置'},
        h('section', null, h('h2', null, '听歌方式', h('small', null, 'MODES')), h('div', { className: 'fm-modes' }, modes.map(([id, title, desc]) =>
          h('button', { type: 'button', key: id, className: 'fm-mode', 'data-selected': mode === id, 'aria-pressed': mode === id, disabled,
            onClick: () => controller.command('setMode', id) }, h('strong', null, title), h('span', null, desc)))),
          mode === 'manual' && h('p', { className: 'fm-note' }, '仅手动点播：保留声音，不自动选歌。')),
        h('section', null, h('h2', null, '听歌偏好', h('small', null, 'PREFERENCES')), h('div', { className: 'fm-card' },
          toggle('DeepSeek 自主听歌', '允许自动选歌、续播，并从实际收听中成长。', 'listening', 'setListening'),
          toggle('电脑输出声音', '关闭后仍记录播放进度，但不会让电脑发声。', 'humanPlayback', 'setHumanPlayback'),
          toggle('探索新音乐', '有可用候选时尝试发现陌生歌曲。', 'discovery', 'setDiscovery'),
          h('p', { className: 'fm-note', role: 'status', 'aria-live': 'polite' }, discoveryPresentation(snapshot)),
          snapshot?.lastSelection?.fellBack && h('p', { className: 'fm-note' }, '最近一次自主选择：发现池无可用候选，已回退熟悉歌曲。'),
          state.features?.discoveryRefresh && h('button', { type: 'button', className: 'fm-button', disabled: disabled || !settings.discovery || settings.discoveryRate === 0 || state.platforms?.netease?.account?.status !== 'authorized',
            onClick: () => controller.platformAction('discovery', 'netease') }, '刷新推荐候选'),
          h('div', { className: 'fm-rate' }, h('div', { className: 'fm-rate-head' }, h('label', { htmlFor: rateId }, '新歌探索率'), h('output', { htmlFor: rateId }, `${rate}%`)),
            h('input', { id: rateId, 'aria-label': '新歌探索率', type: 'range', min: 0, max: 100, step: 1, value: rate, disabled: disabled || !settings.discovery,
              onChange: e => setRate(Number(e.target.value)) }),
            h('div', { className: 'fm-save-line' }, h('span', { className: 'fm-save', role: 'status', 'aria-live': 'polite' }, state.notice || '开关即时保存；探索率需点击保存。'),
              h('button', { type: 'button', className: 'fm-button', disabled: disabled || !settings.discovery || rate === Math.round(settings.discoveryRate * 100),
                onClick: () => controller.command('setDiscoveryRate', rate / 100) }, '保存'))))),
        h('section', null, h('h2', null, '输入与连接',h('small',null,'LIBRARY')),
          h('details',{className:'fm-input-library'},h('summary',null,close?'输入音乐 · 查看和点播':`输入曲库 · ${state.library?.total??0} 首（展开查看）`),h(Library,{state,controller})),
          h('details',{className:'fm-platform-details fm-input-library'},h('summary',null,'音乐平台',h('span',{className:'fm-disclosure-meta'},accountHint)),platformSection)),
        h(FeedbackSettings,{state,controller}),
        h('section', null, h('details', { className: 'fm-card fm-interface-details' }, h('summary',null,'界面与悬浮条'),
          h('div', { className: 'fm-motion-row' }, h('label', { htmlFor: `${rateId}-motion` }, '动态效果'),
            h('select', { id: `${rateId}-motion`, 'aria-label': '动态效果', value: state.motion || 'full', onChange: event => controller.setMotion(event.target.value) },
              h('option', { value: 'full' }, '完整'), h('option', { value: 'reduced' }, '轻量'), h('option', { value: 'off' }, '关闭'))),
          h('p', { className: 'fm-note' }, '同时遵循系统的减少动态效果设置。'),
          h('div', { className: 'fm-widget-note' }, h(Svg, { type: 'grip' }),
            h('span', null, state.widgetVisible ? '离开面板后显示，可拖动吸附。' : '悬浮条已隐藏，可随时显示。')))));
  const grid = h('div', { className: 'fm-grid' }, ...(close?[controlsColumn,preferencesColumn]:[preferencesColumn,controlsColumn]));

  return h('div', { className: 'fishfm', 'data-view':close?'settings':'main', 'data-motion': state.motion || 'full' }, h('div', { className: 'fm-wrap' },
    h('header', { className: 'fm-top' },
      h('div', { className: 'fm-heading' }, h('span', { className: 'fm-brand', 'aria-hidden': true }, h(Svg, { type: 'headphones' })),
        h('div', null, h('h1', null, '肥鱼电台'), h('p', { className: 'fm-subtitle' }, '你的音乐环境，DeepSeek 的听歌偏好。'))),
      h('div', { className: 'fm-top-actions' }, h('button', { type: 'button', className: 'fm-button fm-widget-pref',
        'aria-pressed': state.widgetVisible, 'aria-label': '显示或隐藏悬浮条', onClick: () => controller.setWidgetVisible(!state.widgetVisible) }, state.widgetVisible ? '悬浮条已显示' : '显示悬浮条'),
      h('button', { type: 'button', className: 'fm-button', onClick: close || back }, close ? '关闭设置' : '返回对话'))),
    h('section', { className: 'fm-hero', 'aria-label': '当前播放' },
      h('div', { className: 'fm-art' }, h(CharacterArt, { art, active: presentation.active, motion: state.motion })),
      h('div', { className: 'fm-hero-copy' },
        h('div', { className: 'fm-live', role: 'status' }, h(StatusMark, { active: presentation.active }), presentation.label),
        h('div', { className: 'fm-track-swap', key: current?.playInstanceId || 'empty' },
          h('div', { className: 'fm-track' }, current?.track?.title || '今天，从哪一首开始？'),
          h('p', { className: 'fm-artist' }, current?.track?.artist || (state.library?.total ? '从音乐库点播，或让电台为你选一首。' : '连接网易云，导入常听的音乐。'))),
        current&&h('p',{className:'fm-note'},current.selectionTrigger==='legacy-unknown'?'旧版选曲 · 来源未区分':current.selectedBy==='user'?'你点播的歌曲':current.selectionTrigger==='user-next'?'你触发换曲 · 大肥鱼推荐':'大肥鱼自主选择'),
        current && h(React.Fragment, null,
          h('div', { className: 'fm-progress', 'aria-label': '播放进度' }, h('span', { style: { width: `${progressPercent(current)}%` } })),
          h('div', { className: 'fm-time' }, h('span', null, minutes(current.positionMs)), h('span', null, current.track.durationMs ? minutes(current.track.durationMs) : '--:--'))),
        h('div', { className: 'fm-controls' }, button(!current ? '开始听歌' : snapshot?.paused ? '继续播放' : '暂停', 'resume', !current && !state.library?.total && !snapshot?.queue?.length && !state.persona?.recommendations?.verified?.length,
          { className: 'fm-button fm-primary', onClick: () => controller.playOrPause() }),
          button('下一首', 'next', !current && !snapshot?.queue?.length && !state.library?.total && !state.persona?.recommendations?.verified?.length), button('今天停止', 'stopForToday'))),
        current&&h('div',{className:'fm-track-feedback','aria-label':'当前歌曲推荐反馈'},
          h('div',{className:'fm-feedback-actions'},
            ...[[1,'喜欢','♥'],[-1,'少推荐','↓']].map(([score,label,mark])=>h('button',{type:'button',key:score,className:'fm-button fm-feedback-button','aria-pressed':insights?.feedback?.current===score,
              disabled:disabled||insights?.feedback?.version!==1,onClick:()=>controller.command('setTrackFeedback',{track:current.track,playInstanceId:current.playInstanceId,value:insights.feedback.current===score?0:score})},h('span',{'aria-hidden':true},mark),label))),
          h('p',{className:'fm-note',role:'status','aria-live':'polite'},insights?.feedback?.version!==1?'反馈功能需重新加载新版 Core。'
            :insights.feedback.current===1?'已喜欢：提高这首歌的排序权重。再次点击可撤销。'
            :insights.feedback.current===-1?'已少推荐：降低权重，不再作为相似推荐种子。再次点击可撤销。'
            :'仅影响肥鱼电台推荐；重复点击可撤销。')),
        insights?.explanation&&h('div',{className:'fm-reply',role:'status',key:insights.reply?.decisionId},h('p',{className:'fm-label'},'大肥鱼说'),h('p',{className:'fm-reply-text'},insights.reply?.text||insights.explanation.text),
          h('details',null,h('summary',null,'展开选歌依据'),h('p',null,`来源：${({llm_recommendation:'LLM 生成的推荐歌单',netease_similar:'种子相似关系',netease_daily:'网易云每日推荐',netease_personal_fm:'网易云私人 FM'})[current?.origin?.source]??(current?.selectedBy==='user'?'用户指定':'熟悉歌曲')}`),
            current?.selectedBy==='agent'&&snapshot?.lastSelection?.detail&&h('p',null,`本地评分 ${snapshot.lastSelection.score?.toFixed(3)}；关系项 ${(snapshot.lastSelection.detail.relationship??0).toFixed(3)}；重复次数 ${snapshot.lastSelection.detail.repeatPlays??0}；艺人集中惩罚 ${(snapshot.lastSelection.detail.diversityPenalty??0).toFixed(3)}。`),
            Number.isFinite(snapshot?.lastSelection?.detail?.feedback)&&h('p',null,`本次决策的手动反馈评分项：${snapshot.lastSelection.detail.feedback>0?'+':''}${snapshot.lastSelection.detail.feedback.toFixed(2)}。之后的反馈从下一次决策生效。`),
            h('p',null,'解释由实际决策记录生成，逐曲不新增模型请求。')))),
    state.error && h('div', { className: 'fm-notice', 'data-error': true, role: 'alert' }, state.error,
      ' ', h('button', { className: 'fm-button', type: 'button', disabled: state.busy, onClick: controller.refresh }, '重新连接')),
    snapshot?.lastError && h('div', { className: 'fm-notice', role: 'status' }, `播放尚未成功：${snapshot.lastError.code || 'playback_failed'}。请核对平台连接和曲目权限。`),
    snapshot?.blockUntil > Date.now() && h('div', { className: 'fm-notice' }, '今天已停止自主听歌。到期后仍会保持暂停，直到你主动恢复。'),
    grid,
    h('footer', { className: 'fm-foot' }, h('span', null, '设置和登录材料保存在本机 · 关闭面板不会结束音乐服务'), h('span', null, '逐曲回复由本地规则生成 · 模型总结按需调用'))));
}
