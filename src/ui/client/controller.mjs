import { sourceNames } from './shared.mjs';
const WIDGET_VISIBLE_KEY = 'fishfm.widget.visible.v1';
const WIDGET_POSITION_KEY = 'fishfm.widget.position.v1';
const MOTION_KEY = 'fishfm.motion.v1';
const readPreference = (key, fallback) => {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch { return fallback; }
};
const writePreference = (key, value) => {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage can be disabled */ }
};

export function createController(connection) {
  let state = {
    snapshot: null, platforms: {}, busy: false, connected: false, error: '', notice: '',
    login: null, imported: null, importAttempts: [], library: { total: 0, tracks: [] },
    widgetVisible: readPreference(WIDGET_VISIBLE_KEY, true) !== false,
    widgetPosition: readPreference(WIDGET_POSITION_KEY, null),
    motion: ['full', 'reduced', 'off'].includes(readPreference(MOTION_KEY, 'full')) ? readPreference(MOTION_KEY, 'full') : 'full',
  };
  let epoch = 0, timer, read, write,summaryWrite, disposed = false;
  const listeners = new Set();
  const emit = (patch) => { if (!disposed) {if(patch.persona?.generatedAt<state.persona?.generatedAt){patch={...patch};delete patch.persona;} state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const failure = error => `${error?.message || '音乐服务连接失败，请刷新重试。'}${error?.code ? ` (${error.code})` : ''}`;
  async function refresh() {
    if (disposed || state.busy || read) return;
    const version = ++epoch;
    const controller = new AbortController();
    read = controller;
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const result = await connection.rpc.call('/api', 'fishfm/state', {}, controller.signal);
      if (version !== epoch) return;
      if (!result.ok) throw result.error;
      const discovery = result.value.snapshot?.discovery;
      const finishedDiscovery = state.notice === '正在后台刷新推荐候选…' && discovery && !discovery.refreshing;
      emit({ ...result.value, connected: true, error: '', ...(finishedDiscovery ? {
        notice: discovery.state === 'disabled' ? '探索已关闭。' : discovery.reason && discovery.reason !== 'no-unfamiliar-candidates'
          ? '刷新未成功，请查看候选状态。' : '推荐候选已更新。',
      } : {}) });
    } catch (error) {
      if (version === epoch) emit({ connected: false, error: failure(error) });
    } finally {
      clearTimeout(timeout);
      if (read === controller) read = null;
    }
  }
  return {
    getSnapshot: () => state,
    setMotion(level) {
      if (!['full', 'reduced', 'off'].includes(level)) return;
      writePreference(MOTION_KEY, level);
      emit({ motion: level });
    },
    async playOrPause() {
      if (state.snapshot?.current) return this.command(state.snapshot.paused ? 'resume' : 'pause');
      // Manual mode stays manual: start one library song without enabling autonomy.
      if (!state.snapshot?.settings?.listening && state.library?.tracks?.[0]) {
        return this.command('requestTrack', state.library.tracks[0]);
      }
      return this.command('resume');
    },
    subscribe(fn) {
      listeners.add(fn);
      if (listeners.size === 1) { refresh(); timer = setInterval(() => { if (!document.hidden) refresh(); }, 2200); }
      return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); ++epoch; read?.abort(); read = null; } };
    },
    refresh,
    setWidgetVisible(visible) {
      const next = Boolean(visible);
      writePreference(WIDGET_VISIBLE_KEY, next);
      emit({ widgetVisible: next });
    },
    setWidgetPosition(position) {
      const next = position && ['left', 'right'].includes(position.edge) && Number.isFinite(position.top)
        ? { edge: position.edge, top: Math.round(position.top) } : null;
      writePreference(WIDGET_POSITION_KEY, next);
      emit({ widgetPosition: next });
    },
    async command(type, value) {
      if (disposed || state.busy || !state.connected) return;
      ++epoch; read?.abort(); read = null;
      emit({ busy: true, error: '', notice: ['pause', 'resume', 'next', 'requestTrack'].includes(type) ? '正在更新播放…' : '正在保存…' });
      write = new AbortController();
      const timeout = setTimeout(() => write?.abort(), 25000);
      try {
        const payload = type === 'requestTrack' ? {type,track:value} : type === 'setTrackFeedback' ? {type,...value} : {type,value};
        const result = await connection.rpc.call('/api', 'fishfm/command', payload, write.signal);
        if (!result.ok) throw result.error;
        const feedbackNotice = type==='setTrackFeedback' ? value.value===1?'已喜欢，将提高这首歌的排序权重':value.value===-1?'已降低这首歌的排序权重':'已撤销这首歌的反馈'
          :type==='resetTaste'?'已重置成长偏好，输入曲库保留':type==='resetLibrary'?'已清空输入曲库并重建偏好，可撤销':type==='undoTasteReset'?'已恢复最近一次重置前的数据':type==='setRecommendationMode'?'推荐来源已更新':null;
        emit({ ...result.value,...(['resetTaste','resetLibrary','undoTasteReset','setRecommendationMode'].includes(type)?{summaryNotice:'',summaryError:''}:{}),...(type==='resetLibrary'?{imported:null,importAttempts:[]}:{}), notice: feedbackNotice || (['pause', 'resume', 'next', 'requestTrack'].includes(type) ? '播放控制已更新' : '已保存到本机') });
      } catch (error) {
        const actionError = ['no_candidates', 'constraint_conflict', 'invalid_command', 'media_unavailable','stale_track','summary_busy','no_reset_backup','invalid_track'].includes(error?.code);
        emit({ connected: actionError ? state.connected : false, error: failure(error), notice: actionError ? '请调整曲目或设置后重试' : '未确认操作，请刷新核对' });
      }
      finally { clearTimeout(timeout); write = null; emit({ busy: false }); }
    },
    async platformAction(action, provider, options = {}) {
      if (disposed || state.busy || !state.connected) return;
      const endpoint = ({ begin: 'fishfm/login-start', poll: 'fishfm/login-poll', import: 'fishfm/import', logout: 'fishfm/logout', discovery: 'fishfm/discovery-refresh', playlists:'fishfm/playlists' })[action];
      if (!endpoint) return;
      ++epoch; read?.abort(); read = null;
      const progress = action === 'poll' ? '正在确认手机扫码…'
        : action === 'import' ? options.source ? `正在读取${sourceNames[options.source]||'指定来源'}…` : '正在读取近期记录；若不可用会继续尝试喜欢列表和用户歌单…'
          : action === 'begin' ? '正在向网易云申请二维码…' : '正在连接音乐平台…';
      emit({ busy: true, error: '', notice: progress, importAttempts: action === 'import' ? [] : state.importAttempts });
      write = new AbortController();
      const timeout = setTimeout(() => write?.abort(), action === 'import' ? 120000 : 45000);
      try {
        const result = await connection.rpc.call('/api', endpoint, { provider,
          ...(action==='import'?{source:options.source??null,playlistId:options.playlistId??null}:{}) }, write.signal);
        if (!result.ok) throw result.error;
        const value = result.value;
        const login = Object.hasOwn(value, 'login') ? value.login : state.login;
        if (action === 'poll' && login) login.qrImage = state.login?.qrImage;
        emit({ snapshot: value.snapshot, platforms: value.platforms ?? state.platforms, library: value.library ?? state.library, login,
          insights:value.insights??state.insights,
          playlists: value.playlists??state.playlists,
          imported: action === 'logout' ? null : Object.hasOwn(value, 'imported') ? value.imported : state.imported,
          importAttempts: action === 'import' ? value.attempts ?? [] : state.importAttempts,
          connected: true, error: '',
          notice: action === 'playlists' ? `已读取 ${value.playlists?.length??0} 个歌单，请选择后导入。`
            : action === 'discovery' ? (value.discovery?.refreshing ? '正在后台刷新推荐候选…' : '候选状态已更新；刷新间隔限制仍有效。')
            : action === 'logout' ? '已退出网易云账号，本机凭据已删除。'
            : action === 'import'
              ? `已读取${sourceNames[value.imported?.source] || '平台音乐'}：本次新增 ${value.imported?.imported ?? 0} 首，当前共 ${value.imported?.total ?? 0} 首${value.imported?.source !== 'recent' && !options.source ? '，使用备用来源' : ''}${value.imported?.total < value.imported?.requested ? '，返回数量不足目标，仍可播放' : ''}`
              : value.login?.identityError || (value.login?.status === 'authorized' ? '登录成功，可以导入音乐。'
                : value.login?.status === 'scanned' ? '已扫码，请在手机上确认登录。'
                  : value.login?.status === 'expired' ? '二维码已过期，请重新获取。'
                    : action === 'begin' ? '请用网易云音乐 App 扫描二维码。' : '等待手机确认…') });
      } catch (error) {
        const details = error?.details ?? {};
        let latest = {};
        try {
          const refreshed = await connection.rpc.call('/api', 'fishfm/state', {}, write.signal);
          if (refreshed?.ok) latest = refreshed.value;
        } catch { /* the periodic snapshot will retry */ }
        const accountStatus = latest.platforms?.[provider]?.account?.status;
        const login = action === 'begin' || action === 'poll'
          ? { ...(state.login ?? {}), provider, status: 'error', qrExpired: false, identityError: error.message,
            canRetryValidation: action === 'poll' && details.stage === 'login_status',
            canRetryCheck: action === 'poll' && details.stage === 'login_qr_check' }
          : accountStatus === 'login_required' ? null
          : accountStatus === 'expired' ? { provider, status: 'expired', qrExpired: false, identityError: error.message }
            : accountStatus === 'authorized' ? { ...(state.login ?? {}), provider, status: 'authorized' }
              : { ...(state.login ?? {}), provider, status: 'error' };
        emit({ ...latest, connected: true, error: failure(error), notice: action === 'import' ? '导入没有写入空批次，可检查失败阶段后重试。' : '登录步骤未完成，可重新扫码或刷新重试。',
          importAttempts: action === 'import' ? details.attempts ?? [] : state.importAttempts,
          login });
      } finally { clearTimeout(timeout); write = null; emit({ busy: false }); }
    },
    async personaAction(action,payload){
      if(disposed||state.summaryBusy||!state.connected)return;
      summaryWrite=new AbortController();const timeout=setTimeout(()=>summaryWrite?.abort(),65000);
      const endpoint={summary:'fishfm/persona-summary',recommendations:'fishfm/persona-recommendations',budget:'fishfm/persona-budget',output:'fishfm/persona-output',automatic:'fishfm/persona-automatic'}[action];
      const pending={summary:'正在总结聚合画像…',recommendations:'正在由模型生成具体推荐歌单…',budget:'正在保存总结预算…',output:'正在保存单次输出上限…',automatic:'正在保存自动总结设置…'}[action];
      emit({summaryBusy:true,summaryError:'',summaryNotice:pending});
      try{
        if(!endpoint)throw Object.assign(new Error('未知的画像操作。'),{code:'invalid_command'});
        const result=await connection.rpc.call('/api',endpoint,payload,summaryWrite.signal);
        if(!result.ok)throw result.error;
        // This operation never overwrites live playback with a late snapshot.
        const notice=['summary','recommendations'].includes(action)?(result.value.summaryResult?.cached?'已复用缓存，没有新增模型调用。':action==='recommendations'?'模型歌单已生成，正在核对平台歌曲。':'总结已更新。')
          :action==='automatic'?(payload?.value?'自动总结已开启，只在画像更新且预算允许时运行。':'自动总结已关闭。')
          :action==='output'?'单次输出上限已保存。':'总结预算已保存。';
        emit({persona:result.value.persona,summaryNotice:notice});
      }catch(error){emit({summaryError:failure(error),summaryNotice:'本地选歌和旧总结仍保留。'});}
      finally{clearTimeout(timeout);summaryWrite=null;emit({summaryBusy:false});}
    },
    dispose() { disposed = true; ++epoch; clearInterval(timer); read?.abort(); write?.abort();summaryWrite?.abort(); listeners.clear(); },
  };
}
