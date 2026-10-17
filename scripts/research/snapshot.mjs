// Read-only, bounded projection of ONE recorded filter batch. Never open MusicStore
// on the source database: its constructor performs migrations.
import {DatabaseSync} from 'node:sqlite';
import {measuredUsage} from '../../src/persona.mjs';
import {fail, validateSnapshot} from './quality.mjs';

const safeText = (value, max = 160) => {
  const result = String(value ?? '').slice(0, max);
  return /https?:\/\/|cookie\s*[:=]|bearer\s|sk-(?:proj-|[a-z0-9]{12})|[\x00-\x1f]/i.test(result) ? '[已省略]' : result;
};
const sources = new Set(['netease_similar', 'netease_daily', 'netease_personal_fm', 'platform_recommendation']);
export function exportSnapshot(path, {metadata = false} = {}) {
  const db = new DatabaseSync(path, {readOnly: true, timeout: 2000});
  try {
    db.exec('BEGIN');
    const saved = db.prepare("SELECT value_json FROM settings WHERE key='discovery_filter_v1'").get();
    if (!saved) fail('没有已保存的筛选批次；请先在正常使用中完成一次挑歌');
    const filter = JSON.parse(saved.value_json);
    const call = db.prepare("SELECT * FROM music_model_calls WHERE call_id=? AND purpose='discovery-filter'").get(filter.callId);
    if (!call || call.status !== 'completed' || filter.source !== 'llm-discovery-filter') fail('已保存结果与调用账本不匹配');
    const facts = JSON.parse(call.facts_json ?? 'null');
    if (!facts || !Array.isArray(facts.candidates) || !facts.candidateRevision || !facts.candidateOwner
      || facts.candidateRevision !== filter.candidateRevision || facts.candidateOwner !== filter.candidateOwner) fail('候选批次或账号不匹配；拒绝拼接不同快照');
    if (!Array.isArray(filter.picks) || facts.candidates.length > 40 || facts.candidates.some(c => typeof c.key !== 'string')
      || new Set(facts.candidates.map(c => c.key)).size !== facts.candidates.length) fail('保存的候选或选择不完整');
    const asOf = call.finished_at;
    if (!Number.isSafeInteger(asOf) || asOf < call.started_at) fail('账本没有有效完成时间');
    const rawKeys = new Map(facts.candidates.map((c, i) => [c.key, `c${String(i + 1).padStart(3, '0')}`]));
    const artistNames = new Map();
    const artist = value => {
      if (!value) return '';
      if (metadata) return safeText(value);
      if (!artistNames.has(value)) artistNames.set(value, `艺人 ${artistNames.size + 1}`);
      return artistNames.get(value);
    };
    const before = db.prepare('SELECT track_key FROM listen_history WHERE ended_at<=? AND effective_ms>0 ORDER BY ended_at DESC LIMIT 100').all(asOf);
    const known = new Set(before.map(r => r.track_key));
    const recent = db.prepare('SELECT track_key FROM listen_history WHERE ended_at<=? AND ended_at>? ORDER BY ended_at DESC LIMIT 50').all(asOf, asOf - 30 * 60_000);
    const originals = Array.isArray(facts.localCandidates) ? facts.localCandidates : [];
    const candidates = facts.candidates.map((c, i) => {
      const track = originals.find(t => `${t.provider}:${t.providerTrackId}` === c.key);
      const reference = (facts.references ?? []).some(r => r[0] === c.title && r[1] === c.artist);
      return {id: rawKeys.get(c.key), title: metadata ? safeText(c.title) : `歌曲 ${i + 1}`, artist: artist(c.artist),
        source: sources.has(track?.discovery?.source) ? track.discovery.source : 'unknown',
        known: reference || known.has(c.key) ? true : null, playable: null, banned: null,
        expiresAt: Number.isSafeInteger(track?.discovery?.expiresAt) ? track.discovery.expiresAt : null};
    });
    const references = (facts.references ?? []).slice(0, 4).map((r, i) => ({title: metadata ? safeText(r[0]) : `参考曲 ${i + 1}`, artist: artist(r[1])}));
    const picks = [...filter.picks].sort((a, b) => a.rank - b.rank).map(p => {
      const i = facts.candidates.findIndex(c => c.key === p.trackKey);
      if (i < 0) fail('筛选结果包含本批次以外的歌曲');
      return {i, why: metadata ? safeText(p.reason, 40) : '[原理由仅留在本机原记录]'};
    });
    const rows = db.prepare("SELECT status,model,usage_json,reserved_tokens,error_code FROM music_model_calls WHERE purpose='discovery-filter' AND fact_hash=? AND started_at<=? ORDER BY started_at,call_id LIMIT 101").all(call.fact_hash, asOf);
    if (rows.length > 100) fail('同批次账本超过 100 条，需先缩小研究样本');
    const calls = rows.map(r => ({status: r.status, model: safeText(r.model, 100),
      usage: r.usage_json ? measuredUsage(JSON.parse(r.usage_json)) : null,
      reservedTokens: r.reserved_tokens, errorCode: /^[\w-]{1,60}$/.test(r.error_code ?? '') ? r.error_code : null}));
    const result = validateSnapshot({version: 1, kind: 'local-snapshot', asOf, metadataMode: metadata ? 'catalogue' : 'redacted',
      batch: {revision: 'batch-1', owner: 'account-1'}, candidates, references,
      recentIds: [...new Set(recent.map(r => rawKeys.get(r.track_key)).filter(Boolean))],
      context: {exploration: Number.isFinite(facts.taste?.exploration) ? facts.taste.exploration : null,
        discoveryEnabled: null, historyScope: 'recorded-before-call'},
      selection: {revision: 'batch-1', owner: 'account-1', status: 'completed', reconstructed: true,
        response: {summary: metadata ? safeText(filter.summary ?? filter.text, 60) : '已保存筛选结果', picks}}, calls});
    db.exec('COMMIT');
    return result;
  } finally { db.close(); }
}
