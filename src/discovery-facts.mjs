// Shared factual vocabulary for the discovery UI and offline exploration research.
// A platform link is provenance, not a claim about audio distance or taste.
export function describeCandidateEvidence(candidate) {
  const facts = [];
  if (candidate.known === true) facts.push({kind: 'known-before-batch'});
  if (['liked', 'reduced'].includes(candidate.feedback)) facts.push({kind: 'explicit-feedback', value: candidate.feedback});
  if (['netease_similar', 'netease_daily', 'netease_personal_fm', 'platform_recommendation'].includes(candidate.source)) facts.push({kind: 'platform-source', value: candidate.source});
  if (candidate.source === 'netease_similar' && candidate.seedRelated === true) facts.push({kind: 'platform-seed-relation'});
  const familiar = candidate.known === true || candidate.feedback === 'liked';
  const adjacent = candidate.source === 'netease_similar' && candidate.seedRelated === true;
  return {id: candidate.id, category: familiar ? 'familiar' : adjacent ? 'adjacent' : 'unknown', facts,
    distance: 'unknown', genre: 'unknown', mood: 'unknown', reasonSupport: 'requires-human-review'};
}
