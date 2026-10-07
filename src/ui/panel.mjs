// What the control panel shows, and what it can ask for.
//
// This is deliberately pure: a snapshot (plus platform and bridge state) goes in,
// a view model and a list of available actions come out. The window shell is not
// built yet, so keeping the logic here is what makes the panel reviewable and
// testable now, and it means the shell later holds no product decisions.
//
// Semantics come from MVP section 3: two independent switches with four defined
// combinations, Off/Normal/Focus/Silent as shortcuts over them, and a track
// bubble that appears on a change and then fades. "上一首" is not a deliverable
// and is therefore absent from the action list.

/** How long the track bubble stays before fading (MVP: briefly, then fade). */
export const BUBBLE_VISIBLE_MS = 6000;

/** The four switch combinations, named so the UI can say which one is active. */
export const SWITCH_COMBINATIONS = Object.freeze({
  'on-on': { name: 'audible', label: '自主听歌并输出声音' },
  'on-off': { name: 'silent', label: '自主听歌（静音，Silent）' },
  'off-on': { name: 'manual-only', label: '仅手动点播（不更新 Agent 偏好）' },
  'off-off': { name: 'idle', label: '无自主听歌、无声音' },
});

/** The shortcut mode a set of settings corresponds to, when it matches one. */
export function deriveMode(settings) {
  const { listening, humanPlayback, strategy } = settings;
  if (!listening && !humanPlayback) return 'off';
  if (listening && !humanPlayback) return 'silent';
  if (listening && humanPlayback) return strategy === 'focus' ? 'focus' : 'normal';
  // listening off, playback on: manual use only, which no shortcut sets.
  return 'manual';
}

/**
 * Names the current switch pair. `key` is the pair itself (`on-off`) and `name`
 * is what it means (`silent`): keeping both avoids the two being confused, which
 * a test caught when `key` held the meaning instead.
 */
export function describeSwitches(settings) {
  const key = `${settings.listening ? 'on' : 'off'}-${settings.humanPlayback ? 'on' : 'off'}`;
  const combination = SWITCH_COMBINATIONS[key];
  return { key, name: combination.name, label: combination.label };
}

/**
 * Turns the panel's state into the actions it should offer.
 *
 * Each action carries the exact core command, so the shell never invents one.
 * Nothing unavailable is rendered as available: a signed-out platform offers
 * "sign in", not a disabled play button with no explanation.
 */
export function availableActions({ snapshot, platform = null } = {}) {
  const actions = [];
  const settings = snapshot?.settings ?? {};
  const hasTrack = Boolean(snapshot?.current);
  const paused = snapshot?.paused === true;

  // Playback control. An unavailable platform replaces these with sign-in.
  const platformReady = platform === null || platform.status === 'authorized';
  if (platformReady) {
    actions.push(paused
      ? { id: 'resume', label: '继续', command: { type: 'resume' }, kind: 'playback' }
      : { id: 'pause', label: '暂停', command: { type: 'pause' }, kind: 'playback', enabled: hasTrack });
    actions.push({ id: 'next', label: '下一首', command: { type: 'next' }, kind: 'playback', enabled: hasTrack });
  } else {
    actions.push({ id: 'sign-in', label: '登录平台', kind: 'account', reason: platform.reason ?? '需要登录' });
  }

  // The two switches, each independent (MVP section 3).
  actions.push({
    id: 'toggle-listening', label: settings.listening ? '关闭自主听歌' : '开启自主听歌',
    command: { type: 'setListening', value: !settings.listening }, kind: 'setting',
    description: '允许自主选歌、自动续播及 Agent 经历更新',
  });
  actions.push({
    id: 'toggle-human-playback', label: settings.humanPlayback ? '静音' : '打开声音',
    command: { type: 'setHumanPlayback', value: !settings.humanPlayback }, kind: 'setting',
    description: '允许电脑输出声音',
  });
  actions.push({
    id: 'toggle-discovery', label: settings.discovery ? '关闭探索' : '开启探索',
    command: { type: 'setDiscovery', value: !settings.discovery }, kind: 'setting',
    description: '允许从陌生候选中探索',
  });

  // Shortcuts over the same settings, never a second state machine.
  for (const mode of ['normal', 'focus', 'silent', 'off']) {
    actions.push({ id: `mode-${mode}`, label: MODE_LABELS[mode], command: { type: 'setMode', value: mode }, kind: 'mode' });
  }
  actions.push({ id: 'stop-for-today', label: '今天别听歌了', command: { type: 'stopForToday' }, kind: 'mode' });

  // Import is a platform action, offered when the platform is usable.
  if (platformReady) {
    actions.push({ id: 'import', label: '导入我的音乐', kind: 'account' });
  }
  return actions;
}

const MODE_LABELS = Object.freeze({
  normal: 'Normal', focus: 'Focus', silent: 'Silent', off: 'Off',
});

/**
 * The panel's visible state.
 *
 * @param {object} options
 * @param {object} options.snapshot      Core snapshot (may be null before the first one)
 * @param {object} [options.platform]    `{ status, reason }` for the active platform
 * @param {object} [options.bridge]      `{ status, revision }` from the UI bridge
 * @param {object} [options.bubble]      `{ trackKey, shownAt }` from the shell
 * @param {number} [options.now]
 */
export function describePanel({ snapshot = null, platform = null, bridge = null, bubble = null, now = Date.now() } = {}) {
  const settings = snapshot?.settings ?? null;
  const current = snapshot?.current ?? null;

  // The bubble appears when the track changes and fades on its own.
  let bubbleView = null;
  if (bubble?.shownAt && now - bubble.shownAt < BUBBLE_VISIBLE_MS && current) {
    bubbleView = {
      visible: true,
      title: current.track?.title || current.track?.providerTrackId || '',
      artist: current.track?.artist ?? '',
      remainingMs: BUBBLE_VISIBLE_MS - (now - bubble.shownAt),
      fading: now - bubble.shownAt > BUBBLE_VISIBLE_MS * 0.7,
    };
  }

  return {
    connection: describeConnection({ bridge, platform }),
    track: current
      ? {
        title: current.track?.title || current.track?.providerTrackId || '',
        artist: current.track?.artist ?? '',
        provider: current.track?.provider ?? null,
        positionMs: current.positionMs ?? 0,
        durationMs: current.track?.durationMs ?? null,
        // Who caused this listen matters to the user: their own pick is not the
        // agent's choice.
        selectedBy: current.selectedBy ?? null,
        isAgentChoice: current.selectedBy === 'agent',
        audible: current.audible === true,
      }
      : null,
    bubble: bubbleView,
    playback: {
      status: snapshot?.status ?? 'unknown',
      paused: snapshot?.paused === true,
      listening: settings?.listening ?? null,
      humanPlayback: settings?.humanPlayback ?? null,
      discovery: settings?.discovery ?? null,
      discoveryRate: settings?.discoveryRate ?? null,
      // A percentage is what a person reads; 0.2 is what the core stores.
      discoveryPercent: settings ? Math.round(settings.discoveryRate * 100) : null,
      strategy: settings?.strategy ?? null,
      mode: settings ? deriveMode(settings) : null,
      switches: settings ? describeSwitches(settings) : null,
    },
    notice: describeNotice({ snapshot, platform, bridge }),
    actions: availableActions({ snapshot, platform }),
  };
}

/**
 * One notice at a time, in priority order, and always with something the user can
 * do. "Offline" and "signed out" are different problems with different actions,
 * so they are never collapsed into a generic error.
 */
export function describeNotice({ snapshot = null, platform = null, bridge = null } = {}) {
  if (bridge && ['failed', 'incompatible'].includes(bridge.status)) {
    return {
      kind: 'ui-disconnected',
      severity: 'info',
      title: '控制面板未连接到音乐服务',
      detail: '音乐仍在后台运行，面板会在恢复后显示当前状态。',
      actionId: 'retry-connection',
    };
  }
  if (!snapshot) {
    return { kind: 'loading', severity: 'info', title: '正在读取音乐状态…', detail: '', actionId: null };
  }
  const error = snapshot.lastError;
  if (error) {
    if (snapshot.status === 'resolving' && snapshot.current?.recoveryAttempts > 0) {
      return { kind: 'playback-recovering', severity: 'info', title: '播放中断，正在恢复这首歌',
        detail: '正在重新获取音频并尝试从上次位置继续。', actionId: null };
    }
    const explanation = EXPLANATIONS[error.code] ?? {
      title: '播放出现问题', detail: error.message ?? '', actionId: null,
    };
    return { kind: error.code ?? 'error', severity: 'error', ...explanation, retryable: error.retryable === true };
  }
  if (platform && platform.status === 'login_required') {
    return {
      kind: 'login-required', severity: 'action',
      title: '还没有连接音乐平台',
      detail: '连接后才能导入你的音乐并播放。',
      actionId: 'sign-in',
    };
  }
  if (platform && platform.status === 'expired') {
    return {
      kind: 'login-expired', severity: 'action',
      title: '登录已过期',
      detail: '需要重新登录才能继续播放。',
      actionId: 'sign-in',
    };
  }
  if (platform && platform.status === 'error') {
    return {
      kind: 'platform-error', severity: 'error',
      title: '平台暂时不可用', detail: platform.reason ?? '', actionId: 'retry-platform',
    };
  }
  const seed = platform?.capabilities?.seed;
  if (seed && seed.status === 'degraded' && seed.source) {
    return {
      kind: 'seed-degraded', severity: 'info',
      title: `已改用${SOURCE_LABELS[seed.source] ?? seed.source}导入`,
      detail: seed.reason ?? '你要求的那一类来源暂时不可用。',
      actionId: null,
    };
  }
  if (seed && seed.status === 'unavailable') {
    return { kind: 'seed-unavailable', severity: 'info', title: '还没导入音乐', detail: seed.reason ?? '', actionId: 'import' };
  }
  if (snapshot.status === 'error' && !error) {
    return { kind: 'error', severity: 'error', title: '播放出现问题', detail: '', actionId: null };
  }
  return null;
}

const SOURCE_LABELS = Object.freeze({
  recent: '近期播放', liked: '我喜欢', playlist: '用户歌单', plugin_history: '插件历史',
});

/**
 * The panel's wording for the failures the core actually reports.
 * Each says what happened and what the user can do about it: a code with no
 * remedy is not actionable, and an invented remedy is worse than none.
 */
const EXPLANATIONS = Object.freeze({
  provider_unavailable: { title: '还没有配置任何音乐平台', detail: '这个构建没有安装平台适配器，因此无法播放。', actionId: null },
  login_required: { title: '登录已失效', detail: '需要重新登录平台才能继续播放。', actionId: 'sign-in' },
  media_unavailable: { title: '这首歌暂时无法播放', detail: '平台没有给出可播放的地址，可能需要会员或受地区限制。', actionId: null },
  media_failed: { title: '播放中断了', detail: '音频无法继续，可能已失效。', actionId: 'retry-track' },
  media_stalled: { title: '播放卡住了', detail: '音频长时间没有继续，自动恢复未成功，可以重试这首歌。', actionId: 'retry-track' },
  playback_host_lost: { title: '播放服务中断了', detail: '自动恢复未成功，可以重试这首歌。', actionId: 'retry-track' },
  resource_expired: { title: '播放地址已过期，正在重新获取', detail: '这类地址有时效，正在自动重试。', actionId: null },
  rate_limited: { title: '平台请求过于频繁', detail: '稍后会自动重试。', actionId: null },
  provider_failure: { title: '平台请求失败', detail: '可能是网络问题，稍后会重试。', actionId: 'retry-track' },
  no_candidates: { title: '没有可播放的曲目', detail: '导入音乐或调整探索设置后再试。', actionId: 'import' },
  constraint_conflict: { title: '这首歌被你禁播了', detail: '需要先解除禁播才能播放。', actionId: null },
  credential_store_unavailable: { title: '无法保存登录信息', detail: '这台设备上的凭据存储不可用。', actionId: null },
});

export function describeConnection({ bridge = null, platform = null } = {}) {
  if (!bridge) return { status: platform ? 'platform-only' : 'unknown', label: '未知', revision: null };
  const labels = {
    connected: '已连接', connecting: '正在连接', reconnecting: '正在重连',
    failed: '未连接（音乐继续在后台运行）', incompatible: '版本不匹配', closed: '已关闭', idle: '未连接',
  };
  return {
    status: bridge.status,
    label: labels[bridge.status] ?? bridge.status,
    revision: bridge.revision ?? null,
    // A UI problem is never a music problem, and the wording must not imply it is.
    musicUnaffected: ['failed', 'incompatible', 'closed', 'idle', 'reconnecting'].includes(bridge.status),
  };
}

/**
 * Tracks which track the bubble belongs to, so a change starts a fresh bubble and
 * an unchanged poll does not restart it.
 */
export function updateBubble({ previous = null, snapshot = null, now = Date.now() } = {}) {
  const trackKey = snapshot?.current?.track
    ? `${snapshot.current.track.provider}:${snapshot.current.track.providerTrackId}`
    : null;
  if (!trackKey) return { bubble: null, changed: Boolean(previous) };
  if (previous?.trackKey === trackKey) return { bubble: previous, changed: false };
  return { bubble: { trackKey, shownAt: now, playInstanceId: snapshot.current.playInstanceId ?? null }, changed: true };
}

/** The controls a panel must not offer, kept explicit so nothing sneaks in. */
export const NOT_DELIVERED = Object.freeze(['previous-track']);
