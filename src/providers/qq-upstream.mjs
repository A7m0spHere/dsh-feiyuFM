import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { MusicError } from '../contracts.mjs';

export function createQQUpstream({ workerUrl = new URL('./qq-worker.mjs', import.meta.url), onLog = () => {} } = {}) {
  let worker = null;
  let starting = null;
  let closed = false;
  const pending = new Map();
  function failWorker(instance) {
    if (worker !== instance) return;
    worker = null;
    for (const entry of pending.values()) entry.reject(new MusicError('provider_failure', 'QQ 音乐运行时已退出，请重试。', { retryable: true }));
    pending.clear();
  }
  async function start() {
    if (closed) throw new MusicError('cancelled', 'QQ 音乐运行时已关闭。');
    if (starting) return starting;
    if (worker) return worker;
    const instance = new Worker(workerUrl, { stdout: true, stderr: true });
    worker = instance;
    instance.stdout.resume();
    instance.stderr.resume();
    instance.on('error', () => failWorker(instance));
    instance.on('exit', () => failWorker(instance));
    instance.on('message', message => {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new MusicError(message.error, 'QQ 音乐请求未完成。', { retryable: message.error !== 'cancelled' }));
      else entry.resolve({ status: message.status, body: message.body });
    });
    starting = new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        instance.removeListener('message', ready);
        instance.removeListener('error', failed);
        instance.removeListener('exit', failed);
        if (error) { failWorker(instance); void instance.terminate(); reject(error); }
        else resolve(instance);
      };
      const ready = message => { if (message.type === 'ready') finish(); };
      const failed = () => finish(new MusicError('provider_failure', 'QQ 音乐运行时启动失败。', { retryable: true }));
      const timer = setTimeout(failed, 15_000);
      instance.on('message', ready);
      instance.once('error', failed);
      instance.once('exit', failed);
    }).finally(() => { starting = null; });
    return starting;
  }
  return {
    async request(input, { signal = null, timeoutMs = 30_000 } = {}) {
      signal?.throwIfAborted();
      const instance = await start();
      signal?.throwIfAborted();
      if (closed || worker !== instance) throw new MusicError('cancelled', 'QQ 音乐请求已取消。');
      const id = randomUUID();
      let timer;
      let abort;
      try {
        return await new Promise((resolve, reject) => {
          abort = () => {
            pending.delete(id);
            instance.postMessage({ type: 'cancel', id });
            reject(new MusicError('cancelled', 'QQ 音乐请求已取消。'));
          };
          pending.set(id, { resolve, reject });
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => {
            pending.delete(id);
            instance.postMessage({ type: 'cancel', id });
            reject(new MusicError('provider_timeout', 'QQ 音乐请求超时。', { retryable: true }));
          }, timeoutMs);
          instance.postMessage({ ...input, type: 'request', id });
          onLog({ type: 'platform-request', provider: 'qq', role: input.role });
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        pending.delete(id);
      }
    },
    async close() {
      closed = true;
      const instance = worker;
      if (instance) { failWorker(instance); await instance.terminate(); }
      await starting?.catch(() => {});
    },
  };
}
