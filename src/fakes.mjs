import { MusicError, trackId } from './contracts.mjs';

export class FakeClock {
  constructor(now = Date.now()) { this.time = now; this.waits = []; }
  now() { return this.time; }
  sleep(ms, signal) {
    return new Promise((resolve) => {
      const timer = { at: this.time + ms, resolve, signal };
      this.waits.push(timer);
      if (signal) signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
  advance(ms) {
    this.time += ms;
    for (const wait of this.waits.filter((value) => value.at <= this.time)) wait.resolve();
    this.waits = this.waits.filter((value) => value.at > this.time);
  }
}

export class FakeProvider {
  /**
   * @param {string|null} providerName When set, this instance stands in for one
   *   platform the way a real adapter does, so getAccount()/getCapabilities()
   *   work without being told which platform they are: the registry calls them
   *   with no argument. Leave null to drive several platforms explicitly.
   */
  constructor(providerName = null) {
    this.providerName = providerName;
    this.resources = new Map(); this.pending = new Map(); this.failures = new Map(); this.calls = [];
    this.accounts = { netease: { status: 'login_required' }, qq: { status: 'login_required' } };
    this.capabilities = { netease: {}, qq: {} };
  }
  getAccount(provider = this.providerName) { return structuredClone(this.accounts[provider]); }
  getCapabilities(provider = this.providerName) { return structuredClone(this.capabilities[provider]); }
  setAccount(provider, account) { this.accounts[provider] = structuredClone(account); }
  setCapability(provider, name, capability) { this.capabilities[provider][name] = structuredClone(capability); }
  set(track, handle = `fake:${trackId(track)}`) { this.resources.set(trackId(track), { handle }); }
  defer(track) { this.pending.set(trackId(track), true); }
  failNext(track, count = 1, retryable = true) { this.failures.set(trackId(track), { count, retryable }); }
  async resolve(track, { signal, version }) {
    const key = trackId(track);
    this.calls.push({ key, version, signal });
    const failure = this.failures.get(key);
    if (failure?.count > 0) {
      failure.count -= 1;
      throw new MusicError('provider_failure', 'Simulated provider failure', { retryable: failure.retryable });
    }
    if (this.pending.has(key)) return new Promise((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
    });
    return this.resources.get(key) ?? { handle: `fake:${key}` };
  }
  release(track, resource = { handle: `fake:${trackId(track)}` }) {
    const pending = this.pending.get(trackId(track));
    if (!pending) throw new Error('No pending resolve');
    this.pending.delete(trackId(track));
    pending.resolve(resource);
  }
}

export class FakePlayback {
  constructor() {
    this.version = -1; this.calls = []; this.loaded = null; this.muted = false;
    this.playing = false; this.eventSink = null; this.loadFailure = null; this.supportsSeek = true;
    this.controlFailures = new Map(); this.stopGate = null;
  }
  onEvent(sink) { this.eventSink = sink; }
  emit(event, times = 1) {
    for (let index = 0; index < times; index += 1) this.eventSink?.({ version: this.version, ...event });
  }
  failNextLoad(error = new MusicError('playback_failure', 'Simulated playback failure')) { this.loadFailure = error; }
  failNextControl(method, error = new MusicError('playback_control_failure', `Simulated ${method} failure`)) {
    this.controlFailures.set(method, error);
  }
  deferNextStop() {
    this.stopGate = {};
    this.stopGate.promise = new Promise((resolve) => { this.stopGate.resolve = resolve; });
  }
  releaseStop() { this.stopGate?.resolve(); }
  _fail(method) {
    const error = this.controlFailures.get(method);
    if (error) { this.controlFailures.delete(method); throw error; }
  }
  _accept(version) { if (version < this.version) return false; this.version = version; return true; }
  stop({ version }) {
    this.calls.push({ type: 'stop', version });
    const apply = () => {
      this._fail('stop');
      if (this._accept(version)) { this.playing = false; this.loaded = null; }
    };
    if (this.stopGate) {
      const gate = this.stopGate;
      this.stopGate = null;
      return gate.promise.then(apply);
    }
    return apply();
  }
  pause({ version }) {
    this.calls.push({ type: 'pause', version });
    this._fail('pause');
    if (this._accept(version)) this.playing = false;
  }
  async load({ resource, playInstanceId, startPositionMs, version }) {
    this.calls.push({ type: 'load', playInstanceId, version });
    if (this.loadFailure) { const error = this.loadFailure; this.loadFailure = null; throw error; }
    const positionMs = this.supportsSeek ? startPositionMs : 0;
    if (this._accept(version)) this.loaded = { resource, playInstanceId, positionMs };
    return { positionMs };
  }
  async setMuted({ muted, version }) {
    this.calls.push({ type: 'setMuted', muted, version });
    this._fail('setMuted');
    if (this._accept(version)) this.muted = muted;
  }
  async play({ playInstanceId, version }) {
    this.calls.push({ type: 'play', playInstanceId, version });
    if (this._accept(version) && this.loaded?.playInstanceId === playInstanceId) {
      this.playing = true;
      this.emit({ type: 'started', playInstanceId, version });
    }
  }
}
