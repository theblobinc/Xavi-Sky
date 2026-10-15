/**
 * Social-graph helpers.
 *
 * Used by scoring/network.mjs to boost candidates who are:
 *  - followed by many of your existing follows (warm via second-degree)
 *  - already following you (will definitely notice an inclusion)
 *  - in your own follow list (mutual)
 */

import { publicGet, concurrentMap } from './client.mjs';
import { DEFAULTS } from '../config.mjs';

/**
 * Fetch the complete follow list for an actor. Paginates through cursor.
 */
export async function getAllFollows(actor, opts = {}) {
  const { limit = 100, maxPages = 50 } = opts;
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const params = { actor, limit };
    if (cursor) params.cursor = cursor;
    const data = await publicGet('app.bsky.graph.getFollows', params);
    if (!data.follows || data.follows.length === 0) break;
    out.push(...data.follows);
    if (!data.cursor) break;
    cursor = data.cursor;
  }
  return out;
}

/**
 * Fetch the complete follower list for an actor.
 */
export async function getAllFollowers(actor, opts = {}) {
  const { limit = 100, maxPages = 50 } = opts;
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const params = { actor, limit };
    if (cursor) params.cursor = cursor;
    const data = await publicGet('app.bsky.graph.getFollowers', params);
    if (!data.followers || data.followers.length === 0) break;
    out.push(...data.followers);
    if (!data.cursor) break;
    cursor = data.cursor;
  }
  return out;
}

/**
 * For each candidate, check the relationship versus a viewer actor.
 * Uses app.bsky.graph.getRelationships (batched up to 30 actors per call).
 *
 * Returns parallel array of { followedBy: bool, following: bool } shaped objects.
 */
export async function getRelationships(viewerDid, candidateDids) {
  const out = new Map();
  const batchSize = 30;
  for (let i = 0; i < candidateDids.length; i += batchSize) {
    const slice = candidateDids.slice(i, i + batchSize);
    const data = await publicGet('app.bsky.graph.getRelationships', {
      actor: viewerDid,
      others: slice,
    });
    for (const rel of data.relationships || []) {
      // rel.did is the "other" actor; following/followedBy URIs indicate the edge exists.
      out.set(rel.did, {
        following: !!rel.following,        // viewer follows candidate
        followedBy: !!rel.followedBy,      // candidate follows viewer
      });
    }
  }
  return out;
}
