import { Lrc } from 'lrc-kit';
import { MusicError, trackId, trackKey } from './contracts.mjs';

const MAX_TEXT = 256_000;
const MAX_LINES = 5000;

function parseTimed(text) {
  if (typeof text !== 'string') return [];
  if (text.length > MAX_TEXT) throw new MusicError('lyrics_too_large', '歌词内容过长，暂时无法显示。');
  const parsed = Lrc.parse(text);
  const offset = Number(parsed.info.offset ?? 0);
  const shift = Number.isFinite(offset) && Math.abs(offset) <= 300_000 ? offset : 0;
  if (parsed.lyrics.length > MAX_LINES) throw new MusicError('lyrics_too_large', '歌词行数过多，暂时无法显示。');
  const groups = new Map();
  for (const row of parsed.lyrics) {
    const startMs = Math.round(row.timestamp * 1000 - shift);
    if (!Number.isSafeInteger(startMs) || startMs < -300_000 || startMs > 86_400_000) continue;
    const at = Math.max(0, startMs);
    const value = row.content.trim().slice(0, 2000);
    const existing = groups.get(at);
    if (existing === undefined) groups.set(at, value);
    else if (value && !existing.split('\n').includes(value)) groups.set(at, existing ? `${existing}\n${value}` : value);
  }
  return [...groups].map(([startMs, text]) => ({ startMs, text })).sort((a, b) => a.startMs - b.startMs);
}

function aligned(rows, at) {
  let low = 0, high = rows.length;
  while (low < high) { const mid = (low + high) >>> 1; if (rows[mid].startMs < at) low = mid + 1; else high = mid; }
  const nearest = [rows[low - 1], rows[low]].filter(Boolean).sort((a, b) => Math.abs(a.startMs - at) - Math.abs(b.startMs - at))[0];
  return nearest && Math.abs(nearest.startMs - at) <= 250 ? nearest.text : '';
}

/** Platform text stays outside playback snapshots, storage and model input. */
export function normalizeNetEaseLyrics(body, track) {
  const base = { track: trackKey(track), source: 'netease', format: 'lrc', lines: [], text: '' };
  const raw = typeof body?.lrc?.lyric === 'string' ? body.lrc.lyric : '';
  const lines = parseTimed(raw);
  if (body?.nolyric === true || body?.pureMusic === true
    || (lines.length === 1 && /^纯音乐[，,]?请欣赏[。.]?$/.test(lines[0].text.replace(/\s/g, '')))) {
    return { ...base, status: 'instrumental' };
  }
  if (!lines.some(line => line.text)) {
    const text = raw.replace(/^\[(?:ar|ti|al|by|offset|re|ve|length):[^\]]*\]\s*$/gmi, '').trim();
    return { ...base, status: text ? 'unsynced' : 'unavailable', format: text ? 'plain' : 'lrc', text };
  }
  const translated = parseTimed(body?.tlyric?.lyric);
  const romanized = parseTimed(body?.romalrc?.lyric);
  return { ...base, status: 'synced', lines: lines.map((line, index) => ({
    id: `${line.startMs}:${index}`, ...line,
    endMs: lines[index + 1]?.startMs ?? (track.durationMs > line.startMs ? track.durationMs : null),
    translation: aligned(translated, line.startMs), romanization: aligned(romanized, line.startMs),
  })) };
}

/** Bounded, account-generation-scoped cache. Failures never become missing lyrics. */
export function createLyricsService({ providerFor, now = () => Date.now(), maxEntries = 100, timeoutMs = 12_000 }) {
  const cache = new Map(), pending = new Map();
  const controllers = new Set();
  let closed = false;
  return {
    async get(track) {
      if (closed) throw new MusicError('cancelled', '歌词服务已关闭。');
      const id = trackId(track);
      const adapter = providerFor(track.provider);
      if (typeof adapter?.lyrics !== 'function' || adapter.supportsLyrics?.() === false) return { track: trackKey(track), status: 'unsupported', lines: [], text: '' };
      const context = adapter.lyricsContext?.() ?? '';
      const key = `${id}|${context}`;
      const entry = cache.get(key);
      if (entry?.expiresAt > now()) { cache.delete(key); cache.set(key, entry); return structuredClone(entry.value); }
      cache.delete(key);
      if (pending.has(key)) return structuredClone(await pending.get(key));
      if (pending.size >= 4) throw new MusicError('lyrics_busy', '正在读取歌词，请稍后重试。');
      const controller = new AbortController();
      controllers.add(controller);
      let timer;
      const task = Promise.race([
        Promise.resolve().then(() => adapter.lyrics(track, { signal: controller.signal })),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new MusicError('cancelled', '歌词请求已取消。')), { once: true })),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(new MusicError('lyrics_timeout', '歌词读取超时，请重试。')); controller.abort(); }, timeoutMs); }),
      ]).then(value => {
        if ((adapter.lyricsContext?.() ?? '') !== context) throw new MusicError('cancelled', '账号状态已变化，请重新读取歌词。');
        cache.set(key, { value, expiresAt: now() + (['unavailable', 'instrumental'].includes(value.status) ? 600_000 : 86_400_000) });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return value;
      }).finally(() => { clearTimeout(timer); pending.delete(key); controllers.delete(controller); });
      pending.set(key, task);
      return structuredClone(await task);
    },
    close() { closed = true; cache.clear(); controllers.forEach(controller => controller.abort()); },
  };
}
