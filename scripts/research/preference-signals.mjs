// Fixed synthetic counterfactuals over production functions, never a second model.
import {createHash} from 'node:crypto';
import {MusicStore} from '../../src/storage.mjs';
import {importSeedTracks} from '../../src/environment.mjs';
import {initializeAgentPreferences} from '../../src/taste.mjs';
import {setTrackFeedback, resetRecommendationTaste, undoRecommendationReset} from '../../src/feedback.mjs';
import {applyListenGrowth, GROWTH_PARAMETERS} from '../../src/growth.mjs';
import {SESSION_PARAMETERS} from '../../src/sessions.mjs';
import {factBundle} from '../../src/persona.mjs';
import {selectRecommendationSeeds} from '../../src/recommendation.mjs';
import {buildSelector} from '../../src/core-host.mjs';
import {createDiscoveryCache} from '../../src/discovery.mjs';
import {canonical, digest} from './quality.mjs';

const AT = 1792281600000;
const settings = {listening: true, humanPlayback: false, discovery: true, discoveryRate: .2, strategy: 'normal'};
export const signalCandidates = () => [1, 2, 3].map(i => ({provider: 'netease', providerTrackId: String(i), title: `Synthetic ${i}`,
  artist: `Artist ${i}`, durationMs: 100000, discovery: {source: 'netease_similar', llmRank: i}}));
function fixture() {
  const store = new MusicStore(), candidates = signalCandidates();
  importSeedTracks({store, provider: 'netease', source: 'playlist', sourceRef: 'synthetic', tracks: candidates, requested: 3, now: AT});
  initializeAgentPreferences({store, seed: 1, now: AT});
  for (const row of store.listPreferences()) store.setPreference({targetType: row.target_type, targetKey: row.target_key, affinity: .5, source: 'seed', updatedAt: AT});
  store.setSetting('recommendation_mode_v1', 'filtered');
  return {store, candidates};
}
const preferences = store => store.listPreferences({limit: 1000});
function view(store, candidates) {
  const bundle = factBundle(store, {settings, current: null}, 'discovery-filter', candidates);
  const next = buildSelector({store, now: () => AT + 1000, rng: () => 0, listDiscovery: () => candidates}).next({discoveryRate: .2});
  return {nextId: next.track?.providerTrackId ?? null, score: next.score ?? null, detail: next.detail ?? null,
    seeds: selectRecommendationSeeds({store, now: AT + 1000}).map(t => t.providerTrackId), facts: bundle.facts, factHash: bundle.factHash};
}
const entry = (track, id, patch = {}) => ({playInstanceId: id, track, selectedBy: 'agent', progressSource: 'audio',
  agentListening: true, audible: true, agentEffectiveMs: 100000, effectiveMs: 100000, durationMs: 100000,
  progressAccounting: 'effective-delta', startedAt: AT + 100, endedAt: AT + 100100, endReason: 'ended', ...patch});

export function runPreferenceSignals() {
  const checks = [], traces = {};
  const check = (name, passed, evidence) => { checks.push({name, passed: Boolean(passed), evidence}); };
  const use = fn => { const f = fixture(); try { fn(f); } finally { f.store.close(); } };
  use(({store, candidates}) => {
    const before = view(store, candidates), prefs = preferences(store);
    setTrackFeedback(store, candidates[0], -1, AT + 1); setTrackFeedback(store, candidates[1], 1, AT + 1);
    const first = view(store, candidates);
    setTrackFeedback(store, candidates[0], 1, AT + 2); setTrackFeedback(store, candidates[1], -1, AT + 2);
    const swapped = view(store, candidates);
    check('opposite-votes-reach-model', first.factHash !== swapped.factHash,
      {first: first.facts.candidates.map(c => c.feedback ?? null), swapped: swapped.facts.candidates.map(c => c.feedback ?? null)});
    check('explicit-votes-change-local-next', first.nextId === '2' && swapped.nextId === '1', {before: before.nextId, first: first.nextId, swapped: swapped.nextId});
    check('reduced-is-not-ban-but-not-seed', !first.seeds.includes('1') && first.nextId === '2', {seeds: first.seeds});
    check('votes-preserve-agent-preferences', canonical(preferences(store)) === canonical(prefs), {preferenceRows: prefs.length});
    setTrackFeedback(store, candidates[0], 0, AT + 3); setTrackFeedback(store, candidates[1], 0, AT + 3);
    const undone = view(store, candidates);
    check('neutral-removes-model-vote', undone.factHash === before.factHash && undone.nextId === before.nextId, {restored: undone.nextId});
    setTrackFeedback(store, candidates[0], 1, AT + 4);
    store.addConstraint({id: 'ban', kind: 'ban_track', track: candidates[0], createdAt: AT, summary: 'synthetic ban'});
    check('ban-overrides-like-and-model-rank', view(store, candidates).nextId !== '1', {next: view(store, candidates).nextId});
    store.removeConstraint('ban');
    setTrackFeedback(store, candidates[0], -1, AT + 5);
    const only = buildSelector({store, now: () => AT + 1000, rng: () => 0, listDiscovery: () => [candidates[0]]}).next({discoveryRate: .2});
    check('reduced-remains-playable', only.track?.providerTrackId === '1', {next: only.track?.providerTrackId ?? null});
    traces.feedback = {before, first, swapped, undone};
  });
  use(({store, candidates}) => {
    const before = preferences(store);
    const rejected = [
      entry(candidates[0], 'instant-skip', {endReason: 'skipped', effectiveMs: 0, agentEffectiveMs: 0}),
      entry(candidates[0], 'pause-only', {effectiveMs: 0, agentEffectiveMs: 0}),
      entry(candidates[0], 'failed', {endReason: 'error'}),
      entry(candidates[0], 'user-choice', {selectedBy: 'user'}),
      entry(candidates[0], 'agent-off', {agentListening: false}),
    ].map(e => applyListenGrowth({store, entry: e, now: AT + 100100, durationMs: e.durationMs}));
    check('skip-pause-failure-user-pick-no-negative-learning', rejected.every(r => !r.updated && r.delta === 0) && canonical(preferences(store)) === canonical(before),
      {reasons: rejected.map(r => r.reason)});
    const qualifiedSkip = applyListenGrowth({store, entry: entry(candidates[0], 'qualified-skip', {endReason: 'skipped'}), now: AT + 100100, durationMs: 100000});
    check('qualified-skip-is-weak-positive-not-dislike', qualifiedSkip.delta > 0 && qualifiedSkip.delta <= GROWTH_PARAMETERS.maxStep * GROWTH_PARAMETERS.skippedWeight + 1e-9,
      {delta: qualifiedSkip.delta});
  });
  use(({store, candidates}) => {
    const transient = {sessionId: 'synthetic-session', transient: true};
    const results = Array.from({length: SESSION_PARAMETERS.sessionListenCap + 1}, (_, i) => applyListenGrowth({store,
      entry: entry(candidates[1], `short-${i}`), now: AT + 100100 + i, durationMs: 100000, session: transient}));
    const repeated = applyListenGrowth({store, entry: entry(candidates[1], 'short-0'), now: AT + 100200, durationMs: 100000, session: transient});
    check('transient-session-bounded-and-capped', results.at(-1).sessionCapped && results.slice(0, -1).every(r => r.delta <= .015000001),
      {firstDelta: results[0].delta, accepted: results.filter(r => r.updated).length, cap: SESSION_PARAMETERS.sessionListenCap});
    check('duplicate-listen-not-relearned', !repeated.updated && repeated.reason === 'already-applied', {reason: repeated.reason});
    const earned = view(store, candidates);
    check('earned-preference-reaches-facts-and-local-next', earned.nextId === '2' && earned.facts.taste.artists.some(a => a.name === candidates[1].artist && a.weight > .5),
      {next: earned.nextId, artistWeight: earned.facts.taste.artists.find(a => a.name === candidates[1].artist)?.weight});
    const prefs = preferences(store);
    setTrackFeedback(store, candidates[1], 1, AT + 200000);
    resetRecommendationTaste(store, {settings, current: null}, {now: AT + 300000});
    const old = applyListenGrowth({store, entry: entry(candidates[1], 'old-after-reset'), now: AT + 400000, durationMs: 100000});
    check('reset-rejects-old-listen-and-keeps-vote', old.reason === 'preference-reset-boundary' && view(store, candidates).facts.candidates[1].feedback === 'liked', {reason: old.reason});
    undoRecommendationReset(store);
    check('undo-restores-checkpoint', canonical(preferences(store)) === canonical(prefs), {preferenceRows: prefs.length});
  });
  use(({store, candidates}) => {
    const silent = applyListenGrowth({store, entry: entry(candidates[0], 'silent', {audible: false}), now: AT + 100100, durationMs: 100000});
    check('silent-agent-experience-is-separate-and-weaker', silent.delta > 0 && silent.delta <= .018000001
      && store.getPreference('track', 'netease:1').source === 'listen_silent', {delta: silent.delta, audible: silent.audible});
  });
  use(({store, candidates}) => {
    let account = 'account-a';
    const owner = 'netease:authorized:account-a', candidateOwner = createHash('sha256').update(owner).digest('hex');
    store.setSetting('discovery_cache_v1', {owner, entries: candidates.map(t => ({...t, discovery: {...t.discovery, fetchedAt: AT, expiresAt: AT + 600000}})), candidateRevision: 'batch-a'});
    store.setSetting('discovery_filter_v1', {source: 'llm-discovery-filter', candidateRevision: 'batch-a', candidateOwner,
      picks: [{trackKey: 'netease:1', rank: 1, reason: 'synthetic'}], tracks: []});
    const cache = createDiscoveryCache({store, now: () => AT + 1000, registry: {providers: {netease: {getAccount: () => ({status: 'authorized', accountId: account})}}}});
    try {
      cache.setEnabled(true);
      const oldCount = cache.recommendations().length, prefs = preferences(store);
      account = 'account-b';
      check('account-switch-invalidates-old-filter-not-user-library', oldCount === 1 && cache.recommendations().length === 0
        && store.getSetting('discovery_filter_v1') === null && store.countEnvironment() === 3 && canonical(preferences(store)) === canonical(prefs),
      {oldCount, newCount: cache.recommendations().length, retainedEnvironment: store.countEnvironment()});
    } finally { cache.close(); }
  });
  return {version: 1, kind: 'synthetic-contract-audit', inputHash: digest({candidates: signalCandidates(), settings, at: AT}),
    checkCount: checks.length, passed: checks.filter(c => c.passed).length, checks, traces,
    newModelCalls: 0, productionDatabaseTouched: false, qualityGain: null,
    limitations: ['Fixed RNG and equal initial affinities test signal semantics, not recommendation quality.',
      'Model facts are observable; a real model response or a human preference gain was not measured.',
      'Account switching isolates cached discovery; local environment and feedback are shared within the same FishFM data directory.']};
}
export function signalsMarkdown(r) {
  return `# 偏好信号语义对照\n\n合成合同审计：${r.passed}/${r.checkCount}；固定输入：\`${r.inputHash}\`。\n\n| 检查 | 结果 | 证据 |\n|---|---|---|\n${r.checks.map(c => `| ${c.name} | ${c.passed ? '通过' : '失败'} | ${JSON.stringify(c.evidence).replaceAll('|', '\\|')} |`).join('\n')}\n\n模型请求 0；不访问生产数据库；质量收益未知。\n\n${r.limitations.map(s => `- ${s}`).join('\n')}\n`;
}
