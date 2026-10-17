// Offline hypotheses over the same saved LLM picks, never a production selector.
import {digest, evaluate, fail, qualityMetrics, ratio, validateSnapshot, validateFeedback} from './quality.mjs';
import {describeCandidateEvidence} from '../../src/discovery-facts.mjs';
export {describeCandidateEvidence};

export const EXPLORATION_PROFILES = ['recorded-rank', 'familiar-first', 'related-diverse'];
const familiar = c => describeCandidateEvidence(c).category === 'familiar';
function diversify(rows, alreadyPlaced = []) {
  const seen = new Set(alreadyPlaced.map(c => c.artist).filter(Boolean)), first = [], rest = [];
  for (const c of rows) {
    if (c.artist && !seen.has(c.artist)) { seen.add(c.artist); first.push(c); } else rest.push(c);
  }
  return [...first, ...rest];
}
function reorder(rows, profile) {
  if (profile === 'recorded-rank') return rows;
  const liked = rows.filter(c => c.feedback === 'liked');
  const rest = rows.filter(c => c.feedback !== 'liked' && c.feedback !== 'reduced');
  const reduced = rows.filter(c => c.feedback === 'reduced');
  const known = rest.filter(familiar), adjacent = rest.filter(c => describeCandidateEvidence(c).category === 'adjacent');
  const unknown = rest.filter(c => describeCandidateEvidence(c).category === 'unknown');
  return [...liked, ...(profile === 'familiar-first' ? [...known, ...adjacent] : diversify([...known, ...adjacent], liked)), ...unknown, ...reduced];
}
function recordedCalls(calls) {
  const terminal = calls.filter(c => ['completed', 'failed', 'cancelled', 'interrupted'].includes(c.status));
  const elapsed = terminal.filter(c => Number.isSafeInteger(c.elapsedMs)).map(c => c.elapsedMs).sort((a, b) => a - b);
  return {terminalAttempts: terminal.length, completed: terminal.filter(c => c.status === 'completed').length,
    completionRate: ratio(terminal.filter(c => c.status === 'completed').length, terminal.length),
    elapsedKnownCount: elapsed.length, elapsedUnknownCount: terminal.length - elapsed.length,
    meanRecordedElapsedMs: elapsed.length ? elapsed.reduce((sum, t) => sum + t, 0) / elapsed.length : null,
    maxRecordedElapsedMs: elapsed.length ? elapsed.at(-1) : null,
    scope: 'original ledger elapsed, not HTTP latency; shared by every replay profile'};
}
const counts = rows => Object.fromEntries(['familiar', 'adjacent', 'unknown'].map(category => [category,
  rows.filter(c => describeCandidateEvidence(c).category === category).length]));
function humanRatings(rows, feedback) {
  const ratings = new Map((feedback?.confirmedHuman ? feedback.ratings : []).map(r => [r.candidateId, r.rating]));
  return Object.fromEntries(['worth', 'try', 'not-worth', 'unknown-or-unrated'].map(rating => [rating,
    rows.filter(c => (ratings.get(c.id) && ratings.get(c.id) !== 'unknown' ? ratings.get(c.id) : 'unknown-or-unrated') === rating).length]));
}

export function compareExploration(snapshot, {feedback = null, topK = 6, rates = [0, 20, 70, 100]} = {}) {
  validateSnapshot(snapshot);
  if (feedback) validateFeedback(feedback, snapshot);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 12) fail('topK 必须为 1–12 的整数');
  if (!Array.isArray(rates) || rates.length < 1 || rates.length > 8 || new Set(rates).size !== rates.length
    || rates.some(r => !Number.isFinite(r) || r < 0 || r > 100)) fail('rates 需为 1–8 个不重复的 0–100 数值');
  const base = evaluate(snapshot, {feedback, topK: 12});
  const byId = new Map(snapshot.candidates.map(c => [c.id, c]));
  const selected = base.baseline.ids.map(id => byId.get(id));
  const blocking = snapshot.context.listening === false ? 'autonomy-disabled' : snapshot.context.paused === true ? 'user-paused' : null;
  const controlsUnknown = ['listening', 'paused'].filter(k => snapshot.context[k] === undefined || snapshot.context[k] === null);
  const scenarios = rates.map(rate => {
    const explorationAllowed = rate > 0 && snapshot.context.discoveryEnabled !== false && snapshot.context.exploration !== 0;
    const eligible = blocking ? [] : explorationAllowed ? selected : selected.filter(familiar);
    const rejection = blocking ?? base.selectionCode ?? (!snapshot.candidates.length ? 'no-platform-candidates' : !selected.length ? 'no-eligible-model-picks'
      : !eligible.length ? 'no-confirmed-familiar-picks' : null);
    return {requestedRate: rate, explorationAllowed, capturedOffRespected: snapshot.context.discoveryEnabled === false || snapshot.context.exploration === 0,
      controlsUnknown, rejection, filteredByExplorationOff: blocking ? 0 : selected.length - eligible.length,
      profiles: EXPLORATION_PROFILES.map(profile => {
        const rows = reorder(eligible, profile).slice(0, topK);
        return {profile, ids: rows.map(c => c.id), categories: counts(rows), metrics: qualityMetrics(rows, snapshot, feedback), humanRatings: humanRatings(rows, feedback),
          evidence: rows.map(describeCandidateEvidence)};
      })};
  });
  return {version: 1, kind: snapshot.kind, inputHash: digest(snapshot), asOf: snapshot.asOf, topK,
    comparison: 'saved filtered ranking prefixes; same model response, history and original costs',
    candidateCount: snapshot.candidates.length, platformCategories: counts(snapshot.candidates), selectedCategories: counts(selected),
    evidence: snapshot.candidates.map(describeCandidateEvidence), selectionCode: base.selectionCode, sharedExclusions: base.exclusions,
    sharedCosts: {...base.costs, recorded: recordedCalls(snapshot.calls)}, scenarios,
    evidenceStatus: snapshot.kind === 'synthetic' ? 'synthetic-only' : base.humanFeedback.confirmed && base.humanFeedback.judgedCandidates > 0 ? 'manual-review-required' : 'awaiting-human-feedback',
    decision: 'keep-current-production-policy', productionChange: false, newModelCalls: 0,
    limitations: ['只重排同一批已入选歌曲，不是 Core 全部决策或真实模型再次推理',
      '正探索率在冻结模型输出的回放中不映射固定陌生比例；实际模型结果可能随输入变化',
      '种子关系证明来源关联，不证明音乐距离、跨风格相似或用户一定喜欢',
      '意外发现是人工评价的结果，不用缺少关系证据的候选冒充远距发现',
      '缺失控制/权限/历史仍未知，本报告从不启动或授权自动播放',
      '质量与成本须跨样本人工复核，合成结果不构成上线收益证据']};
}

export function explorationMarkdown(r) {
  const show = value => value === null ? '未知' : Number.isFinite(value) ? String(Number(value.toFixed(4))) : String(value);
  const rows = r.scenarios.flatMap(s => s.profiles.map(p => `| ${s.requestedRate} | ${p.profile} | ${p.ids.join(', ') || '无'} | ${show(p.metrics.artistDiversity)} | ${show(p.metrics.repeatRate)} | ${show(p.metrics.unfamiliarRate)} | ${show(p.metrics.worthRate)} | ${show(p.metrics.newDiscoveryRate)} | ${Object.values(p.humanRatings).join('/')} |`));
  return `# #10 可控探索离线对照\n\n输入：\`${r.inputHash}\`；样本：${r.kind}；证据状态：${r.evidenceStatus}。\n\n来源分类：\`${JSON.stringify(r.platformCategories)}\`。所有距离/流派/心情保持未知，分类不使用人工评价来调序。\n\n| 假设探索率 | 方案 | 前缀候选 | 艺人多样性 | 重复率 | 陌生比例 | 愿再听比例 | 新发现比例 | 愿再听/一般/不喜欢/未判 |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n原账本完成率 ${show(r.sharedCosts.recorded.completionRate)}，记录耗时均值 ${show(r.sharedCosts.recorded.meanRecordedElapsedMs)} ms（非 HTTP 延迟）；未知耗时 ${r.sharedCosts.recorded.elapsedUnknownCount} 条。原始 token 字段只报告一次，不按方案重复累加；回放新模型调用 0。\n\n回退/阻断：\`${JSON.stringify(r.scenarios.map(s => ({rate: s.requestedRate, reason: s.rejection, controlsUnknown: s.controlsUnknown})))}\`。无合适已入选歌曲则等待，不从未入选歌曲补齐。\n\n决策：${r.decision}。未知/合成或少量人工评价均不自动授权生产变更。\n\n${r.limitations.map(s => `- ${s}`).join('\n')}\n`;
}
