export const PROVIDERS = Object.freeze(['netease', 'qq']);
export const MODES = Object.freeze(['normal', 'focus', 'silent', 'off']);

export class MusicError extends Error {
  constructor(code, message, { retryable = false, details = null, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MusicError';
    this.code = code;
    this.retryable = retryable;
    // Structured context for callers that must explain what happened (which
    // sources were tried, which capabilities were missing, and so on).
    if (details !== null) this.details = details;
  }
}

export function trackKey(value) {
  if (!value || !PROVIDERS.includes(value.provider) ||
      typeof value.providerTrackId !== 'string' || !value.providerTrackId.trim()) {
    throw new MusicError('invalid_track', 'Track requires provider and providerTrackId');
  }
  return { provider: value.provider, providerTrackId: value.providerTrackId };
}

export function trackId(key) {
  const valid = trackKey(key);
  return `${valid.provider}:${valid.providerTrackId}`;
}

export function normalizeTrack(value) {
  const key = trackKey(value);
  return {
    ...key,
    title: typeof value.title === 'string' ? value.title : '',
    artist: typeof value.artist === 'string' ? value.artist : '',
    durationMs: Number.isSafeInteger(value.durationMs) && value.durationMs > 0 ? value.durationMs : null,
    ...(Array.isArray(value.artists) && value.artists.length ? { artists: value.artists.slice(0, 16)
      .filter(a => a && String(a.id) !== '0' && /^[\w-]{1,80}$/.test(String(a.id ?? '')) && typeof a.name === 'string' && a.name.trim())
      .map(a => ({ id: String(a.id), name: a.name.trim().slice(0, 160) })) } : {}),
    ...(typeof value.metadataSource === 'string' && /^[\w-]{1,60}$/.test(value.metadataSource) ? { metadataSource: value.metadataSource } : {}),
  };
}

export function assertCommand(command) {
  if (!command || typeof command !== 'object' || typeof command.commandId !== 'string' || !command.commandId.trim()) {
    throw new MusicError('invalid_command', 'commandId is required');
  }
  const types = ['pause', 'resume', 'next', 'requestTrack', 'setListening', 'setHumanPlayback',
    'setDiscovery', 'setDiscoveryRate', 'setMode', 'stopForToday', 'chooseSelf', 'banTrack', 'unbanTrack', 'setTrackFeedback', 'resetTaste', 'resetLibrary', 'undoTasteReset','setRecommendationMode'];
  if (!types.includes(command.type)) throw new MusicError('invalid_command', `Unknown command: ${command.type}`);
  if (['setListening', 'setHumanPlayback', 'setDiscovery'].includes(command.type) && typeof command.value !== 'boolean') {
    throw new MusicError('invalid_command', 'Boolean value required');
  }
  if (command.type === 'setDiscoveryRate' &&
      (typeof command.value !== 'number' || command.value < 0 || command.value > 1)) {
    throw new MusicError('invalid_command', 'Discovery rate must be between 0 and 1');
  }
  if (command.type === 'setMode' && !MODES.includes(command.value)) {
    throw new MusicError('invalid_command', 'Unknown mode');
  }
  if (['requestTrack', 'banTrack', 'unbanTrack'].includes(command.type)) trackKey(command.track);
  if (command.type === 'setTrackFeedback') {
    trackKey(command.track);
    if (![-1,0,1].includes(command.value) || typeof command.playInstanceId !== 'string' || !command.playInstanceId) throw new MusicError('invalid_command', '歌曲反馈需要有效分值与播放实例。');
  }
  if (['resetTaste','resetLibrary'].includes(command.type) && (!command.value || typeof command.value.clearFeedback !== 'boolean')) throw new MusicError('invalid_command', '请明确是否同时清除手动反馈。');
  if(command.type==='setRecommendationMode'&&!['llm','platform','filtered'].includes(command.value))throw new MusicError('invalid_command','未知的推荐来源。');
  return command;
}

export function accountCapability({ status = 'unavailable', source = null, reason = null } = {}) {
  if (!['available', 'unavailable', 'expired', 'login_required'].includes(status)) {
    throw new MusicError('invalid_capability', 'Unknown capability status');
  }
  return { status, source, reason };
}
