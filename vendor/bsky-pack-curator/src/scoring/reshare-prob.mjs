/**
 * Reshare-likelihood score.
 *
 * Heuristic: smaller, niche-matched, active accounts amplify inclusion more aggressively
 * than mega-accounts. Megacelebs ignore being added to packs; mid-tier accounts amplify
 * to drive their own visibility.
 *
 * Score = (1 / log(followers + 10)) × keywordDensityInBio × activityFactor
 *
 * Normalized to [0, 1]. Used both for ranking boost AND for outputting a separate
 * "most likely to amplify" sub-roster for amplification choreography.
 */

function keywordDensity(bio, patterns) {
  if (!bio) return 0;
  const lc = bio.toLowerCase();
  let hits = 0;
  for (const p of patterns) {
    const occurrences = lc.split(p.toLowerCase()).length - 1;
    hits += occurrences;
  }
  // Normalize by bio length (per 200 chars)
  return Math.min(1.0, hits / Math.max(1, bio.length / 200));
}

export function computeReshareProbability(profiles, patterns, activityByDid) {
  return profiles.map(p => {
    const followers = p.followersCount || 0;
    const inverseFollowers = 1 / Math.log10(followers + 10);
    const density = keywordDensity(p.description || '', patterns);
    const a = activityByDid.get(p.did);
    const activityFactor = a && !a.error
      ? Math.min(1.0, (a.postsLast30d || 0) / 15)  // 15 posts/30d = saturated activity
      : 0.2;
    const raw = inverseFollowers * density * activityFactor;
    return { did: p.did, reshareProbability: raw };
  });
}

/**
 * Returns the top N candidates most likely to amplify on inclusion.
 * Used for the amplification choreography "tag these on launch" section.
 */
export function topReshareCandidates(profiles, reshareScores, n = 10) {
  const byDid = new Map(reshareScores.map(s => [s.did, s.reshareProbability]));
  return [...profiles]
    .sort((a, b) => (byDid.get(b.did) || 0) - (byDid.get(a.did) || 0))
    .slice(0, n);
}
