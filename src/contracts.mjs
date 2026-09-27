export const PROVIDERS = Object.freeze(['netease', 'qq']);
export const MODES = Object.freeze(['normal', 'focus', 'silent', 'off']);

export class MusicError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'MusicError';
    this.code = code;
    this.retryable = retryable;
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
  };
}

export function assertCommand(command) {
  if (!command || typeof command !== 'object' || typeof command.commandId !== 'string' || !command.commandId.trim()) {
    throw new MusicError('invalid_command', 'commandId is required');
  }
  const types = ['pause', 'resume', 'next', 'requestTrack', 'setListening', 'setHumanPlayback',
    'setDiscovery', 'setDiscoveryRate', 'setMode', 'stopForToday', 'chooseSelf', 'banTrack', 'unbanTrack'];
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
  return command;
}

export function accountCapability({ status = 'unavailable', source = null, reason = null } = {}) {
  if (!['available', 'unavailable', 'expired', 'login_required'].includes(status)) {
    throw new MusicError('invalid_capability', 'Unknown capability status');
  }
  return { status, source, reason };
}
