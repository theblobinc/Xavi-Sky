/**
 * Multi-signal quality score. Replaces pure-follower-count ranking.
 *
 * Components (each normalized 0..1 across the candidate pool):
 *   - followerScore: log(followersCount + 1) — diminishing returns above ~10k
 *   - activityScore: postsLast30d / 30 (clamped to 1.0)
 *   - engagementScore: avgLikes / followersCount (with floor)
 *
 * Final = weighted sum per src/config.mjs SCORING_WEIGHTS.
 */

import { SCORING_WEIGHTS } from '../config.mjs';

function normalize(values) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => (v - min) / range);
}

export function computeMultiSignal(profiles, activityByDid) {
  if (profiles.length === 0) return [];
  const followers = profiles.map(p => Math.log10((p.followersCount || 0) + 1));
  const activity = profiles.map(p => {
    const a = activityByDid.get(p.did);
    if (!a || a.error) return 0;
    return Math.min(1.0, (a.postsLast30d || 0) / 30);
  });
  const engagement = profiles.map(p => {
    const a = activityByDid.get(p.did);
    if (!a || a.error) return 0;
    const followers = p.followersCount || 1;
    return Math.min(0.2, (a.avgLikes || 0) / followers); // cap at 20% rate (huge for any account)
  });

  const fN = normalize(followers);
  const aN = normalize(activity);
  const eN = normalize(engagement);

  return profiles.map((p, i) => ({
    did: p.did,
    multiSignal:
      SCORING_WEIGHTS.followers * fN[i] +
      SCORING_WEIGHTS.activity * aN[i] +
      SCORING_WEIGHTS.engagement * eN[i],
    components: {
      followerNorm: fN[i],
      activityNorm: aN[i],
      engagementNorm: eN[i],
    },
  }));
}
