/**
 * Network-graph augmentation. Personalizes the score to the curator.
 *
 * Three signals:
 *   - mutualBoost: candidate already follows you AND you follow them (highest reshare odds)
 *   - followsYouBoost: candidate follows you (they'll definitely notice inclusion)
 *   - secondDegreeBoost: candidate is followed by many of YOUR follows (warm)
 *
 * Returns { did -> { networkScore, signals } } map.
 */

import { getAllFollows, getRelationships } from '../api/graph.mjs';

export async function computeNetworkScores(viewerHandle, candidates) {
  if (!viewerHandle) {
    return new Map(candidates.map(c => [c.did, { networkScore: 0, signals: {} }]));
  }

  const viewerDid = await resolveDid(viewerHandle);

  // Get the relationships you have with each candidate (direct follow / follow-back).
  const candidateDids = candidates.map(c => c.did);
  const rels = await getRelationships(viewerDid, candidateDids);

  // Get your full follow list (for second-degree counting).
  let myFollows = [];
  try {
    myFollows = await getAllFollows(viewerDid, { maxPages: 10 });
  } catch (err) {
    // Non-fatal — fall through with empty graph
    myFollows = [];
  }
  const myFollowDids = new Set(myFollows.map(f => f.did));

  // For each candidate, count how many of YOUR follows ALSO follow them.
  // Cheap proxy: check if candidate is in your follows directly. The true second-degree
  // count would require fetching each of your follows' follow lists — expensive.
  // We approximate by saying: if candidate is in your follows, +1; if your follow count is high
  // and candidate has any overlap, that's a warm signal.
  //
  // For now we use direct membership as the second-degree proxy. Upgrade-ready hook
  // for when we want to spend the calls.
  const result = new Map();
  for (const c of candidates) {
    const rel = rels.get(c.did) || { following: false, followedBy: false };
    const inMyFollows = myFollowDids.has(c.did);

    let score = 0;
    const signals = {};
    if (rel.following && rel.followedBy) {
      score += 1.0;
      signals.mutual = true;
    } else if (rel.followedBy) {
      score += 0.7;
      signals.followsYou = true;
    } else if (inMyFollows || rel.following) {
      score += 0.4;
      signals.youFollow = true;
    }

    result.set(c.did, { networkScore: score, signals });
  }
  return result;
}

async function resolveDid(handle) {
  if (handle.startsWith('did:')) return handle;
  const { publicGet } = await import('../api/client.mjs');
  const r = await publicGet('com.atproto.identity.resolveHandle', { handle });
  return r.did;
}
