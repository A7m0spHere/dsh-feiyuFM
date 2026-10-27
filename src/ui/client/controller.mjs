import { sourceNames, EXPRESSION_LABELS } from './shared.mjs';
import { recommendationFeedback } from './presentation.mjs';
const WIDGET_VISIBLE_KEY = 'fishfm.widget.visible.v1';
const WIDGET_POSITION_KEY = 'fishfm.widget.position.v1';
const MOTION_KEY = 'fishfm.motion.v1';
const PLAYBACK_EFFECTS_KEY = 'fishfm.playback.effects.v1';
const SPECTRUM_VISIBLE_KEY = 'fishfm.spectrum.visible.v1';
const SPECTRUM_LEFT_KEY = 'fishfm.spectrum.left.v1';
const readPreference = (key, fallback) => {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch { return fallback; }
};
const writePreference = (key, value) => {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage can be disabled */ }
};
const normalizeSpectrumLeft = value => value && Number.isFinite(value.left)
  ? { left: Math.round(Math.max(0, Math.min(4096, value.left))) } : null;

export function createController(connection) {
  let state = {
    snapshot: null, platforms: {}, busy: false, platformBusy: false, connected: false, error: '', notice: '',
    libraryBusy: false, libraryError: '', libraryQuery: '',
    expression: null, expressionBusy: false, expressionError: '', expressionNotice: '',
    feedbackPage: null, feedbackListBusy: false, feedbackClearBusy: false, feedbackError: '', feedbackNotice: '',
    login: null, imported: null, importAttempts: [], library: { total: 0, tracks: [] },
    widgetVisible: readPreference(WIDGET_VISIBLE_KEY, true) !== false,
    widgetPosition: readPreference(WIDGET_POSITION_KEY, null),
    playbackEffects: readPreference(PLAYBACK_EFFECTS_KEY, false) === true,
    spectrumVisible: readPreference(SPECTRUM_VISIBLE_KEY, true) !== false,
    spectrumLeft: normalizeSpectrumLeft(readPreference(SPECTRUM_LEFT_KEY, null)),
    motion: ['full', 'reduced', 'off'].includes(readPreference(MOTION_KEY, 'full')) ? readPreference(MOTION_KEY, 'full') : 'full',
  };
  let epoch = 0, playbackEpoch = 0, libraryEpoch = 0, timer, read, write, platformWrite, libraryRead,summaryWrite,expressionWrite, disposed = false;
  let libraryOptions = { query: '', offset: 0, limit: 12 };
  let feedbackOptions = { query: '', filter: 'all', offset: 0, limit: 12 };
  let feedbackOpen = false, feedbackEpoch = 0, feedbackRead, feedbackWrite, feedbackRetry;
  let feedbackRevision = -1, feedbackRequestedRevision = -1, feedbackRefreshQueued = false;
  const listeners = new Set();
  const emit = (patch) => { if (!disposed) {
    if (patch.insights?.feedback) {
      patch = { ...patch, insights: { ...patch.insights } };
      let feedback = patch.insights.feedback;
      if (Number.isSafeInteger(feedback.revision)) {
        if (feedback.revision < feedbackRevision) feedback = state.insights?.feedback ?? feedback;
        else feedbackRevision = feedback.revision;
      }
      const instance = (patch.snapshot ?? state.snapshot)?.current?.playInstanceId ?? null;
      if (feedback.playInstanceId !== undefined && feedback.playInstanceId !== instance) {
        feedback = { ...feedback, playInstanceId: instance,
          current: state.insights?.feedback?.playInstanceId === instance ? state.insights.feedback.current : 0 };
      }
      patch.insights.feedback = feedback;
    }
    if (Object.hasOwn(patch,'expression') || patch.insights?.expression) {
      const value=patch.expression??patch.insights?.expression;
      patch={...patch};delete patch.expression;
      if(value?.version===1&&Object.hasOwn(EXPRESSION_LABELS,value.style)&&Number.isSafeInteger(value.revision)&&value.revision>=0
        &&(!state.expression||value.revision>=state.expression.revision))patch.expression=value;
    }
    if(patch.persona?.generatedAt<state.persona?.generatedAt){patch={...patch};delete patch.persona;}
    if(patch.error==='')patch={...patch,errorCode:null};state = { ...state, ...patch }; listeners.forEach(fn => fn());
    if (feedbackOpen && state.insights?.feedback?.managementVersion === 1 && !state.feedbackListBusy
      && !state.feedbackClearBusy && feedbackRequestedRevision < feedbackRevision && !feedbackRefreshQueued) {
      feedbackRefreshQueued = true;
      Promise.resolve().then(() => { feedbackRefreshQueued = false;
        if (!disposed && feedbackOpen && !state.feedbackListBusy && !state.feedbackClearBusy) void queryFeedback(); });
    }
  } };
  const syncPlaybackEffects = event => {
    if (event.key !== PLAYBACK_EFFECTS_KEY && event.key !== null) return;
    try { if (event.storageArea !== window.localStorage) return; } catch { return; }
    const value = readPreference(PLAYBACK_EFFECTS_KEY, false) === true;
    if (value !== state.playbackEffects) emit({ playbackEffects: value });
  };
  window.addEventListener?.('storage', syncPlaybackEffects);
  const failure = error => `${error?.message || '音乐服务连接失败，请刷新重试。'}${error?.code ? ` (${error.code})` : ''}`;
  const unreachable = error => !error?.code || error.code === 'core_unavailable';
  const project = (value, libraryVersion, playbackVersion = null) => {
    const patch = { ...value };
    if (libraryVersion !== libraryEpoch) delete patch.library;
    else if (patch.library?.offset !== undefined) libraryOptions = { ...libraryOptions, offset: patch.library.offset };
    const incoming = patch.snapshot, current = state.snapshot;
    // Startup retains revision but advances commandVersion and restores pause.
    // Apply ordering to every entrance, including polling and command replies.
    const older = incoming && current && (incoming.revision < current.revision
      || (incoming.revision === current.revision && incoming.commandVersion < current.commandVersion));
    if ((older || libraryVersion !== libraryEpoch) && patch.persona?.discoveryJournal) {
      patch.persona = {...patch.persona, discoveryJournal: state.persona?.discoveryJournal};
    }
    if (older || (playbackVersion !== null && playbackVersion !== playbackEpoch)) delete patch.snapshot;
    return patch;
  };
  function applyFeedbackPage(page, version) {
    if (version !== feedbackEpoch || page?.version !== 1 || !Number.isSafeInteger(page.revision)) return;
    if (page.revision < feedbackRevision) { feedbackRequestedRevision = page.revision; return; }
    feedbackRevision = page.revision;
    feedbackRequestedRevision = page.revision;
    feedbackOptions = { ...feedbackOptions, offset: page.offset };
    emit({ feedbackPage: page });
  }
  async function queryFeedback(query = feedbackOptions.query, filter = feedbackOptions.filter, offset = feedbackOptions.offset) {
    if (disposed || state.insights?.feedback?.managementVersion !== 1) return;
    const version = ++feedbackEpoch;
    feedbackOptions = { query, filter, offset, limit: 12 };
    feedbackRead?.abort();
    const request = new AbortController(); feedbackRead = request;
    const timeout = setTimeout(() => request.abort(), 18000);
    feedbackRequestedRevision = feedbackRevision;
    emit({ feedbackListBusy: true, feedbackError: '' });
    try {
      const result = await connection.rpc.call('/api', 'fishfm/feedback-list', feedbackOptions, request.signal);
      if (version !== feedbackEpoch) return;
      if (!result.ok) throw result.error;
      if (result.value?.feedbackPage?.version !== 1) throw { message: '反馈列表应答未就绪，请重试。' };
      applyFeedbackPage(result.value.feedbackPage, version);
    } catch (error) {
      if (version === feedbackEpoch) emit({ feedbackError: error?.message || '反馈列表未能读取，请重试。' });
    } finally {
      clearTimeout(timeout);
      if (feedbackRead === request) { feedbackRead = null; emit({ feedbackListBusy: false }); }
    }
  }
  async function refresh() {
    if (disposed || state.busy || read) return;
    const version = ++epoch;
    const libraryVersion = libraryEpoch;
    const playbackVersion = playbackEpoch;
    const controller = new AbortController();
    read = controller;
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const result = await connection.rpc.call('/api', 'fishfm/state', { library: libraryOptions }, controller.signal);
      if (version !== epoch) return;
      if (!result.ok) throw result.error;
      const projected = project(result.value, libraryVersion, playbackVersion);
      const discovery = projected.snapshot?.discovery;
      const finishedDiscovery = state.notice === '正在找新歌…' && discovery && !discovery.refreshing;
      emit({ ...projected, ...(libraryVersion === libraryEpoch ? { libraryError: '' } : {}), connected: true, error: '', ...(finishedDiscovery ? {
        notice: discovery.state === 'disabled' ? '探索已关闭。' : discovery.reason && discovery.reason !== 'no-unfamiliar-candidates'
          ? '新歌没找成功，请查看状态。' : '新歌列表已更新。',
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
    setPlaybackEffects(value) {
      writePreference(PLAYBACK_EFFECTS_KEY, value === true);
      emit({ playbackEffects: value === true });
    },
    setMotion(level) {
      if (!['full', 'reduced', 'off'].includes(level)) return;
      writePreference(MOTION_KEY, level);
      emit({ motion: level });
    },
    async playOrPause() {
      if (state.snapshot?.current) return this.command(state.snapshot.paused ? 'resume' : 'pause');
      // Manual mode stays manual: start one library song without enabling autonomy.
      const firstTrack = state.library?.firstTrack ?? state.library?.tracks?.[0];
      if (!state.snapshot?.settings?.listening && firstTrack) {
        return this.command('requestTrack', firstTrack);
      }
      return this.command('resume');
    },
    subscribe(fn) {
      listeners.add(fn);
      if (listeners.size === 1) { refresh(); timer = setInterval(() => { if (!document.hidden) refresh(); }, 2200); }
      return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); ++epoch; read?.abort(); read = null; } };
    },
    refresh,
    setFeedbackOpen(open) {
      feedbackOpen = Boolean(open);
      if (feedbackOpen) void queryFeedback();
      else { ++feedbackEpoch; feedbackRead?.abort(); feedbackRead = null; emit({ feedbackListBusy: false }); }
    },
    queryFeedback,
    async clearFeedback(item) {
      if (disposed || !state.connected || state.feedbackListBusy || state.feedbackClearBusy
        || state.insights?.feedback?.managementVersion !== 1 || !state.feedbackPage) return;
      const version = ++feedbackEpoch;
      feedbackRead?.abort(); feedbackRead = null;
      const operation = feedbackRetry?.key === item.key ? feedbackRetry : { key: item.key,
        commandId: `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`, expectedRevision: state.feedbackPage.revision };
      feedbackRetry = operation;
      const request = new AbortController(); feedbackWrite = request;
      const timeout = setTimeout(() => request.abort(), 18000);
      emit({ feedbackClearBusy: true, feedbackError: '', feedbackNotice: '' });
      try {
        const result = await connection.rpc.call('/api', 'fishfm/feedback-clear', {
          track: { provider: item.track.provider, providerTrackId: item.track.providerTrackId },
          commandId: operation.commandId, expectedRevision: operation.expectedRevision, view: feedbackOptions,
        }, request.signal);
        if (!result.ok) throw result.error;
        feedbackRetry = null;
        const summary = result.value?.feedback;
        if (summary) emit({ insights: { ...state.insights, feedback: summary } });
        applyFeedbackPage(result.value?.feedbackPage, version);
        emit({ feedbackNotice: '已撤销这首歌的推荐反馈。' });
      } catch (error) {
        if (error?.code) feedbackRetry = null;
        emit({ feedbackError: error?.message || '撤销结果未确认，请刷新核对或重试。' });
        if (error?.code === 'feedback_conflict') {
          await queryFeedback();
          emit({ feedbackNotice: '反馈已更新，请核对最新列表后重新操作。' });
        }
      } finally {
        clearTimeout(timeout); feedbackWrite = null;
        emit({ feedbackClearBusy: false });
      }
    },
    async queryLibrary(query = libraryOptions.query, offset = 0) {
      if (disposed) return;
      const version = ++libraryEpoch;
      libraryOptions = { query, offset, limit: 12 };
      libraryRead?.abort();
      const controller = new AbortController();
      libraryRead = controller;
      const timeout = setTimeout(() => controller.abort(), 18000);
      emit({ libraryQuery: query, libraryBusy: true, libraryError: '' });
      try {
        const result = await connection.rpc.call('/api', 'fishfm/library', libraryOptions, controller.signal);
        if (version !== libraryEpoch) return;
        if (!result.ok) throw result.error;
        emit(project(result.value, version));
      } catch (error) {
        if (version === libraryEpoch) emit({ libraryError: failure(error) });
      } finally {
        clearTimeout(timeout);
        if (libraryRead === controller) { libraryRead = null; emit({ libraryBusy: false }); }
      }
    },
    setWidgetVisible(visible) {
      const next = Boolean(visible);
      writePreference(WIDGET_VISIBLE_KEY, next);
      emit({ widgetVisible: next });
    },
    setSpectrumVisible(visible) {
      const next = Boolean(visible);
      writePreference(SPECTRUM_VISIBLE_KEY, next);
      emit({ spectrumVisible: next });
    },
    setSpectrumLeft(left) {
      const next = normalizeSpectrumLeft({ left });
      writePreference(SPECTRUM_LEFT_KEY, next);
      emit({ spectrumLeft: next });
    },
    setWidgetPosition(position) {
      const next = position && ['left', 'right'].includes(position.edge) && Number.isFinite(position.top)
        ? { edge: position.edge, top: Math.round(position.top) } : null;
      writePreference(WIDGET_POSITION_KEY, next);
      emit({ widgetPosition: next });
    },
    async command(type, value) {
      if (disposed || state.busy || !state.connected) return;
      if (state.platformBusy && ['resetTaste', 'resetLibrary', 'undoTasteReset'].includes(type)) return;
      ++playbackEpoch;
      const libraryVersion = libraryEpoch;
      ++epoch; read?.abort(); read = null;
      emit({ busy: true, error: '', notice: ['pause', 'resume', 'next', 'requestTrack'].includes(type) ? '正在更新播放…' : '正在保存…' });
      write = new AbortController();
      const timeout = setTimeout(() => write?.abort(), 25000);
      try {
        const payload = type === 'requestTrack' ? {type,track:value} : type === 'setTrackFeedback' ? {type,...value} : {type,value};
        const result = await connection.rpc.call('/api', 'fishfm/command',
          ['setTrackFeedback','resetTaste','resetLibrary','undoTasteReset','setRecommendationMode'].includes(type) ? { ...payload, library: libraryOptions } : payload, write.signal);
        if (!result.ok) throw result.error;
        const feedbackNotice = type==='setTrackFeedback' ? value.value===1?'已喜欢，将提高这首歌的排序权重':value.value===-1?'已降低这首歌的排序权重':'已撤销这首歌的反馈'
          :type==='resetTaste'?'已重置成长偏好，输入曲库保留':type==='resetLibrary'?'已清空输入曲库并重建偏好，可撤销':type==='undoTasteReset'?'已恢复最近一次重置前的数据':type==='setRecommendationMode'?'推荐来源已更新':null;
        emit({ ...project(result.value, libraryVersion),...(['resetTaste','resetLibrary','undoTasteReset','setRecommendationMode'].includes(type)?{summaryNotice:'',summaryError:''}:{}),...(type==='resetLibrary'?{imported:null,importAttempts:[]}:{}), notice: feedbackNotice || (['pause', 'resume', 'next', 'requestTrack'].includes(type) ? '播放控制已更新' : '已保存到本机') });
      } catch (error) {
        const actionError = ['no_candidates', 'autonomy_blocked', 'constraint_conflict', 'invalid_command', 'media_unavailable','stale_track','summary_busy','no_reset_backup','invalid_track'].includes(error?.code);
        // 连接语义只看"Core 是否可达"：RPC 有应答（带 code 的业务/内部错误）
        // 说明服务在线，不得把未知错误码误报成连接中断；仅传输层失败或
        // core_unavailable 才断开。
        const coreUnreachable = unreachable(error);
        emit({ connected: coreUnreachable ? false : true, error: failure(error), errorCode:error?.code??null, notice: actionError ? '请调整曲目或设置后重试' : coreUnreachable ? '未确认操作，请刷新核对' : '操作没有生效，请重试或展开详情' });
      }
      finally { clearTimeout(timeout); write = null; emit({ busy: false }); }
    },
    async platformAction(action, provider, options = {}) {
      if (disposed || state.busy || state.platformBusy || !state.connected) return;
      const endpoint = ({ begin: 'fishfm/login-start', poll: 'fishfm/login-poll', import: 'fishfm/import', logout: 'fishfm/logout', discovery: 'fishfm/discovery-refresh', playlists:'fishfm/playlists' })[action];
      if (!endpoint) return;
      const playbackVersion = playbackEpoch, libraryVersion = libraryEpoch;
      const progress = action === 'poll' ? '正在确认手机扫码…'
        : action === 'import' ? options.source ? `正在读取${sourceNames[options.source]||'指定来源'}…` : '正在读取近期记录；若不可用会继续尝试喜欢列表和用户歌单…'
          : action === 'begin' ? '正在向网易云申请二维码…' : '正在连接音乐平台…';
      emit({ platformBusy: true, error: '', notice: progress, importAttempts: action === 'import' ? [] : state.importAttempts });
      const controller = new AbortController();
      platformWrite = controller;
      const timeout = setTimeout(() => controller.abort(), action === 'import' ? 120000 : 45000);
      try {
        const result = await connection.rpc.call('/api', endpoint, { provider, library: libraryOptions,
          ...(action==='import'?{source:options.source??null,playlistId:options.playlistId??null}:{}) }, controller.signal);
        if (!result.ok) throw result.error;
        const value = result.value;
        const login = Object.hasOwn(value, 'login') ? value.login : state.login;
        if (action === 'poll' && login) login.qrImage = state.login?.qrImage;
        emit({ ...project({ snapshot: value.snapshot, library: value.library ?? state.library, persona: value.persona ?? state.persona }, libraryVersion, playbackVersion), platforms: value.platforms ?? state.platforms, login,
          insights:value.insights??state.insights,
          playlists: value.playlists??state.playlists,
          imported: action === 'logout' ? null : Object.hasOwn(value, 'imported') ? value.imported : state.imported,
          importAttempts: action === 'import' ? value.attempts ?? [] : state.importAttempts,
          connected: true, error: '',
          notice: action === 'playlists' ? `已读取 ${value.playlists?.length??0} 个歌单，请选择后导入。`
            : action === 'discovery' ? (value.discovery?.refreshing ? '正在找新歌…' : '新歌状态已更新。')
            : action === 'logout' ? '已退出网易云账号，本机凭据已删除。'
            : action === 'import'
              ? `已读取${sourceNames[value.imported?.source] || '平台音乐'}：本次新增 ${value.imported?.imported ?? 0} 首，当前共 ${value.imported?.total ?? 0} 首${value.imported?.source !== 'recent' && !options.source ? '，使用备用来源' : ''}${value.imported?.total < value.imported?.requested ? '，返回数量不足目标，仍可播放' : ''}`
              : value.login?.identityError || (value.login?.status === 'authorized' ? '登录成功，可以导入音乐。'
                : value.login?.status === 'scanned' ? '已扫码，请在手机上确认登录。'
                  : value.login?.status === 'expired' ? '二维码已过期，请重新获取。'
                    : action === 'begin' ? '请用网易云音乐 App 扫描二维码。' : '等待手机确认…') });
      } catch (error) {
        const details = error?.details ?? {};
        let latest = {}, connected = !unreachable(error);
        try {
          const recoveryLibraryVersion = libraryEpoch;
          const refreshed = await connection.rpc.call('/api', 'fishfm/state', { library: libraryOptions }, controller.signal);
          if (refreshed?.ok) { latest = project(refreshed.value, recoveryLibraryVersion, playbackVersion); connected = true; }
          else connected = !unreachable(refreshed?.error);
        } catch (recoveryError) { connected = !unreachable(recoveryError); }
        const accountStatus = latest.platforms?.[provider]?.account?.status;
        const login = action === 'begin' || action === 'poll'
          ? { ...(state.login ?? {}), provider, status: 'error', qrExpired: false, identityError: error.message,
            canRetryValidation: action === 'poll' && details.stage === 'login_status',
            canRetryCheck: action === 'poll' && details.stage === 'login_qr_check' }
          : accountStatus === 'login_required' ? null
          : accountStatus === 'expired' ? { provider, status: 'expired', qrExpired: false, identityError: error.message }
            : accountStatus === 'authorized' ? { ...(state.login ?? {}), provider, status: 'authorized' }
              : state.login;
        const notices = { import: '导入未确认完成，请核对曲库后重试。', playlists: '读取歌单失败，请稍后重试。',
          discovery: '刷新推荐失败，请稍后重试。', logout: error?.code === 'credential_cleanup_failed'
            ? '账号已退出，本机凭据清理失败，请重试清理。' : '退出登录未确认，请刷新核对账号状态。',
          begin: '获取二维码失败，请重试。', poll: '登录步骤未完成，可重新扫码或刷新重试。' };
        emit({ ...latest, connected, error: failure(error), errorCode: error?.code ?? null, notice: notices[action],
          ...(action === 'logout' && error?.code === 'credential_cleanup_failed' ? { login: null, imported: null } : { login }),
          importAttempts: action === 'import' ? details.attempts ?? [] : state.importAttempts,
        });
      } finally { clearTimeout(timeout); platformWrite = null; emit({ platformBusy: false }); }
    },
    clearExpressionFeedback(){emit({expressionError:'',expressionErrorCode:null,expressionNotice:''});},
    async saveExpression(style,expectedRevision){
      if(disposed||state.expressionBusy||!state.connected)return {ok:false};
      expressionWrite=new AbortController();const timeout=setTimeout(()=>expressionWrite?.abort(),15000);
      emit({expressionBusy:true,expressionError:'',expressionErrorCode:null,expressionNotice:''});
      try{
        const result=await connection.rpc.call('/api','fishfm/expression-style',{style,expectedRevision},expressionWrite.signal);
        if(!result.ok)throw result.error;
        const expression=result.value?.expression;
        if(expression?.version!==1||!Object.hasOwn(EXPRESSION_LABELS,expression.style)||!Number.isSafeInteger(expression.revision))throw {code:'invalid_expression',message:'表达设置应答未就绪，请刷新后核对。'};
        emit({expression,expressionNotice:style==='current'?'已恢复默认表达。':'表达方式已保存。'});
        return {ok:true,expression};
      }catch(error){
        emit({expressionError:error?.message||'表达方式未能保存，请重试。',expressionErrorCode:error?.code??null,...(unreachable(error)?{connected:false}:{})});
        if(error?.code==='expression_conflict')await refresh();
        return {ok:false};
      }finally{clearTimeout(timeout);expressionWrite=null;emit({expressionBusy:false});}
    },
    async personaAction(action,payload){
      if(disposed||state.summaryBusy||!state.connected)return;
      summaryWrite=new AbortController();const timeout=setTimeout(()=>summaryWrite?.abort(),action==='recommendations'?120000:65000);
      const endpoint={summary:'fishfm/persona-summary',recommendations:'fishfm/persona-recommendations',budget:'fishfm/persona-budget',output:'fishfm/persona-output',automatic:'fishfm/persona-automatic'}[action];
      const pending={summary:'正在总结聚合画像…',recommendations:'正在从网易云找歌，再挑一批…',budget:'正在保存模型预算…',output:'正在保存单次输出上限…',automatic:'正在保存自动总结设置…'}[action];
      emit({summaryBusy:true,summaryError:'',summaryErrorCode:null,summaryNotice:pending,summaryLimit:null});
      try{
        if(!endpoint)throw Object.assign(new Error('未知的画像操作。'),{code:'invalid_command'});
        const result=await connection.rpc.call('/api',endpoint,payload,summaryWrite.signal);
        if(!result.ok)throw result.error;
        // This operation never overwrites live playback with a late snapshot.
        const notice=['summary','recommendations'].includes(action)?(result.value.summaryResult?.cached?'这批歌已经挑好，可以继续听。':action==='recommendations'?'挑好了，歌单已经更新。':'总结已更新。')
          :action==='automatic'?(payload?.value?'自动总结已开启，只在画像更新且预算允许时运行。':'自动总结已关闭。')
          :action==='output'?'单次输出上限已保存。':'总结预算已保存。';
        emit({persona:result.value.persona,summaryNotice:notice});
      }catch(error){
        if(action==='recommendations'){
          const feedback=recommendationFeedback(error);
          emit(feedback.expected?{summaryError:'',summaryNotice:feedback.message,summaryLimit:{code:feedback.code,details:error.details,
            remainingTokens:state.persona?.ledger?.remainingTokens}}:{summaryError:feedback.message,summaryErrorCode:feedback.code,summaryNotice:''});
          await refresh();
        }else emit({summaryError:failure(error),summaryNotice:'已有的歌单和播放状态保持。'});
      }
      finally{clearTimeout(timeout);summaryWrite=null;emit({summaryBusy:false});}
    },
    dispose() { disposed = true; ++epoch; ++libraryEpoch; ++feedbackEpoch; feedbackRead?.abort(); feedbackWrite?.abort(); clearInterval(timer); read?.abort(); write?.abort(); platformWrite?.abort(); libraryRead?.abort();summaryWrite?.abort();expressionWrite?.abort(); listeners.clear();
      window.removeEventListener?.('storage', syncPlaybackEffects); },
  };
}
