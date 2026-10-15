/**
 * Paginated searchActors across one or more queries, deduped by DID.
 *
 * Bluesky's public search endpoint is full-text-ish across handle / displayName /
 * description, with relevance-ranked results. We paginate up to N pages per query
 * and union the results.
 */

import { publicGet } from './client.mjs';
import { DEFAULTS } from '../config.mjs';

export async function searchActorsPaginated(query, opts = {}) {
  const {
    limit = DEFAULTS.searchPageLimit,
    maxPages = DEFAULTS.searchPagesPerQuery,
  } = opts;

  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const params = { q: query, limit };
    if (cursor) params.cursor = cursor;
    const data = await publicGet('app.bsky.actor.searchActors', params);
    if (!data.actors || data.actors.length === 0) break;
    out.push(...data.actors);
    if (!data.cursor) break;
    cursor = data.cursor;
  }
  return out;
}

/**
 * Run searchActorsPaginated across an array of queries, dedupe by DID.
 * Returns the merged pool with original `description` preserved (bulk-search responses
 * include description but not followersCount — that's why we need getProfiles next).
 */
export async function searchAcrossQueries(queries, opts = {}) {
  const seen = new Map();
  for (const q of queries) {
    const results = await searchActorsPaginated(q, opts);
    for (const a of results) {
      if (!seen.has(a.did)) seen.set(a.did, a);
    }
  }
  return [...seen.values()];
}

/**
 * Simple bio filter — keep candidates whose description matches any of the patterns
 * (case-insensitive substring match). Also matches by handle suffix for newsletter-y
 * custom domains like *.substack.com.
 */
export function filterByBio(candidates, patterns, handleSuffixes = []) {
  const lowered = patterns.map(p => p.toLowerCase());
  return candidates.filter(a => {
    const desc = (a.description || '').toLowerCase();
    const handle = (a.handle || '').toLowerCase();
    if (lowered.some(p => desc.includes(p))) return true;
    if (handleSuffixes.some(s => handle.endsWith(s.toLowerCase()))) return true;
    return false;
  });
}
