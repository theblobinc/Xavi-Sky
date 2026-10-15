/**
 * Batched profile lookups. getProfiles accepts up to 25 actors per call and returns
 * the full profile view including followersCount, followsCount, postsCount —
 * fields that searchActors omits.
 */

import { publicGet } from './client.mjs';
import { DEFAULTS } from '../config.mjs';

export async function getProfilesBatched(dids, opts = {}) {
  const { batchSize = DEFAULTS.profileBatchSize } = opts;
  const out = [];
  for (let i = 0; i < dids.length; i += batchSize) {
    const slice = dids.slice(i, i + batchSize);
    const data = await publicGet('app.bsky.actor.getProfiles', { actors: slice });
    if (data.profiles) out.push(...data.profiles);
  }
  return out;
}

export async function getProfile(actor) {
  return publicGet('app.bsky.actor.getProfile', { actor });
}
