import {isRecommendationSource} from './playback-source.mjs';
// Shared factual vocabulary for the discovery UI and offline exploration research.
// A platform link is provenance, not a claim about audio distance or taste.
export function describeCandidateEvidence(candidate) {
  const facts = [];
  const provider = candidate.provider ?? (candidate.source?.startsWith('qq_') ? 'qq' : 'netease');
  if (candidate.known === true) facts.push({kind: 'known-before-batch'});
  if (['liked', 'reduced'].includes(candidate.feedback)) facts.push({kind: 'explicit-feedback', value: candidate.feedback});
  if (isRecommendationSource(candidate.source, provider)) facts.push({kind: 'platform-source', value: candidate.source});
  if (candidate.source === `${provider}_similar` && candidate.seedRelated === true) facts.push({kind: 'platform-seed-relation'});
  const familiar = candidate.known === true || candidate.feedback === 'liked';
  const adjacent = candidate.source === `${provider}_similar` && candidate.seedRelated === true;
  return {id: candidate.id, category: familiar ? 'familiar' : adjacent ? 'adjacent' : 'unknown', facts,
    distance: 'unknown', genre: 'unknown', mood: 'unknown', reasonSupport: 'requires-human-review'};
}
