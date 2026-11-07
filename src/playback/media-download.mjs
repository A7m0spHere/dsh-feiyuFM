// Playback-owned anonymous staging. The WPF host only receives completed local media.
import { mkdtemp, open, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MusicError } from '../contracts.mjs';
import { createNetworkClient } from '../network.mjs';

const MAX_BYTES = 64 * 1024 * 1024;
const EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma', '.mp4']);
export const isRemoteMedia = handle => typeof handle === 'string' && /^https?:\/\//i.test(handle);

export class MediaDownloads {
  constructor({ onLog = () => {}, network = createNetworkClient() } = {}) {
    this.onLog = onLog;
    this.network = network;
    this.entries = new Set();
    this.directory = null;
    this.closed = false;
  }

  async stage(handle, { signal, timeoutMs = 12000 } = {}) {
    if (this.closed || signal?.aborted) throw new MusicError('cancelled', 'Media staging was cancelled', { details: { stage: 'download' } });
    const entry = { controller: new AbortController(), created: false, completed: false, released: false,
      traceId: randomUUID(), started: performance.now(), receivedBytes: 0, protocol: null, httpStatus: null, declaredBytes: null };
    this.entries.add(entry);
    let expired = false;
    const abort = () => entry.controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { expired = true; abort(); }, Math.max(1, timeoutMs));
    entry.done = this._download(entry, handle).then(() => {
      this._log(entry, 'complete');
    }).catch(() => {
      entry.released = true;
      if (signal?.aborted || this.closed) {
        this._log(entry, 'cancelled', 'cancelled');
        throw new MusicError('cancelled', 'Media staging was cancelled', { details: { stage: 'download' } });
      }
      const code = expired ? 'media_open_timeout' : 'media_download_failed';
      this._log(entry, 'error', code);
      throw new MusicError(code,
        expired ? 'Media preparation timed out' : 'Anonymous media download failed', { retryable: true, details: { stage: 'download' } });
    }).finally(async () => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      entry.completed = true;
      if (entry.released) await this._cleanup(entry);
    });
    await entry.done;
    return { handle: entry.path, release: async () => { entry.released = true; await this._cleanup(entry); } };
  }

  _log(entry, phase, code) {
    // Only fixed phases and bounded metadata leave Playback. Diagnostics cannot
    // make a completed download fail or prevent cancellation and file cleanup.
    try {
      this.onLog({ type: 'media-download', phase, traceId: entry.traceId,
        ...(entry.protocol ? { protocol: entry.protocol } : {}),
        ...(entry.httpStatus !== null ? { httpStatus: entry.httpStatus } : {}),
        ...(entry.declaredBytes !== null ? { declaredBytes: entry.declaredBytes } : {}),
        receivedBytes: entry.receivedBytes, durationMs: Math.round(performance.now() - entry.started),
        ...(code ? { code } : {}),
      });
    } catch { /* evidence collection is advisory */ }
  }

  _request(url, signal) {
    return this.network.request(url, { signal, headers: { accept: '*/*' } });
  }

  async _download(entry, handle) {
    let url = new URL(handle);
    const signal = entry.controller.signal;
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted();
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid-source');
      entry.protocol = url.protocol.slice(0, -1);
      entry.httpStatus = null;
      entry.declaredBytes = null;
      const response = await this._request(url, signal);
      let file;
      try {
        entry.httpStatus = Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : null;
        const header = response.headers['content-length'];
        const declared = header === undefined ? null : Number(header);
        entry.declaredBytes = Number.isSafeInteger(declared) && declared >= 0 ? declared : null;
        this._log(entry, 'headers');
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          if (hop >= 5 || !response.headers.location) throw new Error('redirect-limit');
          const next = new URL(response.headers.location, url);
          if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('downgrade');
          url = next;
          continue;
        }
        if (response.statusCode !== 200) throw new Error('http-failure');
        if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BYTES)) throw new Error('size-limit');
        this.directory ??= mkdtemp(join(tmpdir(), 'fishfm-media-'));
        const directory = await this.directory;
        signal.throwIfAborted();
        const extension = extname(url.pathname).toLowerCase();
        entry.path = join(directory, randomUUID() + (EXTENSIONS.has(extension) ? extension : '.mp3'));
        file = await open(entry.path, 'wx', 0o600); entry.created = true;
        for await (const chunk of response) {
          signal.throwIfAborted(); entry.receivedBytes += chunk.length;
          if (entry.receivedBytes > MAX_BYTES) throw new Error('size-limit');
          await file.writeFile(chunk);
        }
        signal.throwIfAborted();
        if (!entry.receivedBytes || (declared !== null && entry.receivedBytes !== declared)) throw new Error('incomplete');
        return;
      } finally { response.destroy(); await file?.close(); }
    }
  }

  async _cleanup(entry) {
    if (!entry.released || !entry.completed) return;
    try {
      if (entry.created) await rm(entry.path, { force: true });
      this.entries.delete(entry);
    } catch { /* A player can still hold the old file until its control reply arrives. */ }
  }

  async cleanup() {
    await Promise.all([...this.entries].map(entry => this._cleanup(entry)));
  }

  async close() {
    this.closed = true;
    for (const entry of this.entries) { entry.released = true; entry.controller.abort(); }
    await Promise.allSettled([...this.entries].map(entry => entry.done));
    await this.cleanup();
    if (this.directory) {
      try { await rmdir(await this.directory); }
      catch (error) { if (error.code !== 'ENOENT') { try { this.onLog({ type: 'media-cleanup-failed', count: this.entries.size }); } catch {} } }
    }
  }
}
