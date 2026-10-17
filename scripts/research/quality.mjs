// Research-only: replay a saved selection through the production parser in memory.
// No Core, provider, audio backend or model service is started here.
import {createHash} from 'node:crypto';
import {MusicStore} from '../../src/storage.mjs';
import {finishSummary, measuredUsage} from '../../src/persona.mjs';

export const fail = message => { throw new Error(message); };
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const ratio = (a, b) => b ? a / b : null;
export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const text = (value, max = 160) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) fail(`${label} 字段无效`);
}
const list = (value, max) => Array.isArray(value) && value.length <= max;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value);
const moment = value => Number.isSafeInteger(value) && value >= 0;
const truth = value => value === true || value === false || value === null;
const SOURCES = ['netease_similar', 'netease_daily', 'netease_personal_fm', 'platform_recommendation', 'unknown'];
const STATES = ['completed', 'failed', 'cancelled', 'interrupted', 'reserved', 'running'];
export const RATINGS = ['worth', 'try', 'not-worth', 'unknown'];
export const STAGES = ['platform', 'filter', 'preference', 'playback', 'interaction', 'unknown'];

export function validateSnapshot(s) {
  keys(s, ['version', 'kind', 'asOf', 'metadataMode', 'batch', 'candidates', 'references', 'recentIds', 'context', 'selection', 'calls'], 'snapshot');
  if (s.version !== 1 || !['synthetic', 'local-snapshot'].includes(s.kind) || !moment(s.asOf) || !['redacted', 'catalogue'].includes(s.metadataMode)) fail('snapshot 版本或来源无效');
  keys(s.batch, ['revision', 'owner'], 'batch');
  if (!id(s.batch.revision) || !id(s.batch.owner)) fail('batch 标识无效');
  if (!list(s.candidates, 40) || !list(s.references, 4) || !list(s.recentIds, 100)) fail('snapshot 输入数量越界');
  const seen = new Set();
  for (const c of s.candidates) {
    keys(c, ['id', 'title', 'artist', 'source', 'known', 'playable', 'banned', 'expiresAt'], 'candidate');
    if (!id(c.id) || seen.has(c.id) || !text(c.title) || !text(c.artist) || !SOURCES.includes(c.source)
      || !truth(c.known) || !truth(c.playable) || !truth(c.banned) || !(c.expiresAt === null || moment(c.expiresAt))) fail('candidate 内容无效或重复');
    seen.add(c.id);
  }
  for (const r of s.references) { keys(r, ['title', 'artist'], 'reference'); if (!text(r.title) || !text(r.artist)) fail('reference 无效'); }
  if (s.recentIds.some(k => !seen.has(k)) || new Set(s.recentIds).size !== s.recentIds.length) fail('recentIds 不属于本批候选或重复');
  keys(s.context, ['exploration', 'discoveryEnabled', 'historyScope'], 'context');
  if (!(s.context.exploration === null || Number.isFinite(s.context.exploration) && s.context.exploration >= 0 && s.context.exploration <= 100)
    || !truth(s.context.discoveryEnabled) || !['recorded-before-call', 'synthetic'].includes(s.context.historyScope)) fail('context 无效');
  keys(s.selection, ['revision', 'owner', 'status', 'response', 'reconstructed'], 'selection');
  if (!id(s.selection.revision) || !id(s.selection.owner) || !STATES.includes(s.selection.status) || typeof s.selection.reconstructed !== 'boolean') fail('selection 无效');
  if (s.selection.response !== null) {
    keys(s.selection.response, ['summary', 'picks'], 'response');
    if (!text(s.selection.response.summary, 240) || !list(s.selection.response.picks, 40)) fail('response 无效');
    for (const p of s.selection.response.picks) { keys(p, ['i', 'why'], 'pick'); if (!Number.isSafeInteger(p.i) || !text(p.why, 160)) fail('pick 无效'); }
  }
  if (!list(s.calls, 100)) fail('calls 数量越界');
  for (const c of s.calls) {
    keys(c, ['status', 'model', 'usage', 'reservedTokens', 'errorCode'], 'call');
    if (!STATES.includes(c.status) || !text(c.model, 100) || !moment(c.reservedTokens)
      || !(c.errorCode === null || typeof c.errorCode === 'string' && /^[\w-]{1,60}$/.test(c.errorCode))
      || !(c.usage === null || measuredUsage(c.usage) && canonical(measuredUsage(c.usage)) === canonical(c.usage))) fail('call 无效');
  }
  return s;
}

export function feedbackTemplate(s) {
  validateSnapshot(s);
  return {version: 1, inputHash: digest(s), reviewer: 'participant-01', confirmedHuman: false,
    ratings: s.candidates.map(c => ({candidateId: c.id, rating: 'unknown', heardBefore: null, reasonSupported: null, playback: 'unknown'}))};
}
export function validateFeedback(f, s) {
  keys(f, ['version', 'inputHash', 'reviewer', 'confirmedHuman', 'ratings'], 'feedback');
  if (f.version !== 1 || f.inputHash !== digest(s) || !id(f.reviewer) || typeof f.confirmedHuman !== 'boolean' || !list(f.ratings, 40)) fail('feedback 的版本、批次或评价者无效');
  const seen = new Set(), valid = new Set(s.candidates.map(c => c.id));
  for (const r of f.ratings) {
    keys(r, ['candidateId', 'rating', 'heardBefore', 'reasonSupported', 'playback'], 'rating');
    if (!valid.has(r.candidateId) || seen.has(r.candidateId) || !RATINGS.includes(r.rating) || !truth(r.heardBefore)
      || !truth(r.reasonSupported) || !['played', 'unavailable', 'unknown'].includes(r.playback)) fail('rating 无效或重复');
    if (!f.confirmedHuman && (r.rating !== 'unknown' || r.heardBefore !== null || r.reasonSupported !== null || r.playback !== 'unknown')) fail('填写评价后需由真人确认 confirmedHuman');
    seen.add(r.candidateId);
  }
  return f;
}

function parsedSelection(s) {
  if (s.batch.owner !== s.selection.owner) return {code: 'account_mismatch', picks: []};
  if (s.batch.revision !== s.selection.revision) return {code: 'stale_candidates', picks: []};
  if (s.selection.status !== 'completed') return {code: s.selection.status, picks: []};
  const store = new MusicStore();
  try {
    const facts = {candidateRevision: s.batch.revision, candidateOwner: s.batch.owner,
      candidates: s.candidates.map(c => ({key: c.id}))};
    store.db.prepare(`INSERT INTO music_model_calls (call_id,day,provider,model,fact_hash,status,reserved_tokens,started_at,purpose,facts_json)
      VALUES ('replay','2000-01-01','offline','saved','fixed','running',0,0,'discovery-filter',?)`).run(JSON.stringify(facts));
    const result = finishSummary({store, callId: 'replay', status: 'completed',
      text: s.selection.response === null ? '' : JSON.stringify(s.selection.response), now: s.asOf, candidateRevision: s.batch.revision});
    return {code: result.success ? null : result.code ?? 'missing_response', picks: store.getSetting('discovery_filter_v1', {}).picks ?? []};
  } finally { store.close(); }
}
function metrics(rows, s, feedback) {
  const ratings = new Map((feedback?.confirmedHuman ? feedback.ratings : []).map(r => [r.candidateId, r]));
  const votes = rows.map(c => ratings.get(c.id)).filter(Boolean);
  const judged = votes.filter(r => r.rating !== 'unknown');
  const heard = judged.filter(r => r.heardBefore !== null);
  const reasons = votes.filter(r => r.reasonSupported !== null);
  const playback = votes.filter(r => r.playback !== 'unknown');
  const familiarity = rows.filter(c => c.known !== null);
  return {count: rows.length, distinctArtists: new Set(rows.filter(c => c.artist).map(c => c.artist)).size,
    artistDiversity: ratio(new Set(rows.filter(c => c.artist).map(c => c.artist)).size, rows.filter(c => c.artist).length),
    artistCoverage: ratio(rows.filter(c => c.artist).length, rows.length),
    repeatRate: ratio(rows.filter(c => s.recentIds.includes(c.id)).length, rows.length),
    knownStatusCount: familiarity.length, unfamiliarRate: ratio(familiarity.filter(c => !c.known).length, familiarity.length),
    playbackKnownCount: rows.filter(c => c.playable !== null).length,
    unavailableRate: ratio(rows.filter(c => c.playable === false).length, rows.filter(c => c.playable !== null).length),
    humanJudged: judged.length, humanCoverage: ratio(judged.length, rows.length),
    worthRate: ratio(judged.filter(r => r.rating === 'worth').length, judged.length),
    newDiscoveryCount: heard.length ? heard.filter(r => r.heardBefore === false && r.rating === 'worth').length : null,
    newDiscoveryRate: ratio(heard.filter(r => r.heardBefore === false && r.rating === 'worth').length, heard.length),
    reasonJudged: reasons.length, reasonSupportRate: ratio(reasons.filter(r => r.reasonSupported).length, reasons.length),
    humanPlaybackJudged: playback.length, humanUnavailableRate: ratio(playback.filter(r => r.playback === 'unavailable').length, playback.length)};
}
export function evaluate(s, {feedback = null, topK = 6} = {}) {
  validateSnapshot(s);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 12) fail('topK 必须为 1–12 的整数');
  if (feedback) validateFeedback(feedback, s);
  const selection = parsedSelection(s), candidates = new Map(s.candidates.map(c => [c.id, c]));
  const exclusions = {banned: 0, unavailable: 0, expired: 0, explorationDisabled: 0};
  const eligible = selection.picks.map(p => ({...candidates.get(p.trackKey), reason: p.reason})).filter(c => {
    const why = c.banned ? 'banned' : c.playable === false ? 'unavailable' : c.expiresAt !== null && c.expiresAt <= s.asOf ? 'expired'
      : (s.context.discoveryEnabled === false || s.context.exploration === 0) && c.known !== true ? 'explorationDisabled' : null;
    if (why) exclusions[why]++;
    return !why;
  });
  // Only reorder the already selected batch; this is not a new recommender.
  const used = new Set(), first = [], rest = [];
  for (const c of eligible) { if (!c.artist || used.has(c.artist)) rest.push(c); else { used.add(c.artist); first.push(c); } }
  const baseline = eligible.slice(0, topK), variant = [...first, ...rest].slice(0, topK);
  const sums = {inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0};
  let unknownUsageCalls = 0, reservedForUnknown = 0;
  for (const c of s.calls) {
    if (!c.usage) { unknownUsageCalls++; reservedForUnknown += c.reservedTokens; }
    else for (const k of Object.keys(sums)) sums[k] += c.usage[k] ?? 0;
  }
  return {version: 1, inputHash: digest(s), kind: s.kind, asOf: s.asOf, topK,
    scope: 'saved-filter-ranking-prefix; not Core playback or new model inference',
    reconstructedResponse: s.selection.reconstructed, historicalOnly: true, candidateCount: s.candidates.length,
    invalidPickCount: Math.max(0, (s.selection.response?.picks.length ?? 0) - selection.picks.length),
    selectionCode: selection.code, exclusions,
    platformPool: {metrics: metrics(s.candidates, s, feedback)},
    baseline: {ids: baseline.map(c => c.id), metrics: metrics(baseline, s, feedback)},
    variant: {name: 'distinct-artist-first', ids: variant.map(c => c.id), metrics: metrics(variant, s, feedback)},
    costs: {recordedCalls: s.calls.length, failedCalls: s.calls.filter(c => c.status !== 'completed').length,
      knownUsage: sums, unknownUsageCalls, reservedForUnknown, replayNewCalls: 0, replayNewTokens: 0},
    humanFeedback: {confirmed: feedback?.confirmedHuman === true, judgedCandidates: feedback?.confirmedHuman ? feedback.ratings.filter(r => r.rating !== 'unknown').length : 0},
    decision: s.kind === 'synthetic' ? 'synthetic_only' : feedback?.confirmedHuman && feedback.ratings.some(r => r.rating !== 'unknown') ? 'review_required' : 'awaiting_human_feedback',
    productionChange: false};
}
const show = value => value === null ? '未知' : typeof value === 'number' ? String(Number(value.toFixed(4))) : String(value);
export function qualityMarkdown(r) {
  const metrics = ['count', 'artistDiversity', 'artistCoverage', 'repeatRate', 'unfamiliarRate', 'unavailableRate', 'humanJudged', 'worthRate', 'newDiscoveryRate', 'reasonSupportRate'];
  return `# 推荐质量离线回放\n\n输入摘要：\`${r.inputHash}\`。样本：${r.kind}；固定时间：${new Date(r.asOf).toISOString()}。\n\n比较平台原始候选、已保存筛选名单前 ${r.topK} 首与 distinct-artist-first 重排。平台列包含原批次的不可播等项，筛选列共同排除；这不是同等可播集合的因果比较，也不代表 Core 自动播放顺序或模型重新推理。\n\n| 指标 | 平台原始候选 | 原筛选排名 | 研究变体 |\n|---|---|---|---|\n${metrics.map(k => `| ${k} | ${show(r.platformPool.metrics[k])} | ${show(r.baseline.metrics[k])} | ${show(r.variant.metrics[k])} |`).join('\n')}\n\n筛选状态：${r.selectionCode ?? '已解析'}；排除项：\`${JSON.stringify(r.exclusions)}\`。\n\n历史调用 ${r.costs.recordedCalls} 次，其中非完成 ${r.costs.failedCalls} 次、用量未知 ${r.costs.unknownUsageCalls} 次；实际用量字段见 report.json。预留值不当作实际消耗，不推算价格。回放新增模型调用与 tokens 均为 0。\n\n结论状态：${r.decision}。没有人工评价时质量指标保留未知；合成样本只验证工具。保留生产策略，不据此上线算法或主动分享。\n`;
}
