/**
 * Author feed fetch — used to measure post recency and (cheaply) engagement.
 *
 * For activity-filter we only need the most recent post date.
 * For engagement-proxy we use the most recent N posts' like + repost counts.
 */

import { publicGet, concurrentMap } from './client.mjs';
import { DEFAULTS } from '../config.mjs';

export async function getAuthorFeed(actor, opts = {}) {
  const { limit = 20 } = opts;
  return publicGet('app.bsky.feed.getAuthorFeed', {
    actor,
    limit,
    filter: 'posts_no_replies',
  });
}

/**
 * For each candidate, fetch feed and compute:
 *  - lastPostAt: ISO date of most recent post
 *  - postsLast30d: count of own posts (not reposts) in last 30 days
 *  - avgLikes: mean like count over fetched window
 *  - avgReposts: mean repost count
 *
 * Returns parallel array aligned with `candidates` input. Errors degrade gracefully
 * to { error: msg } so the pipeline continues.
 */
export async function profileActivityStats(candidates, opts = {}) {
  const {
    activityDays = DEFAULTS.activityDays,
    concurrency = DEFAULTS.activityConcurrency,
  } = opts;
  const cutoffMs = Date.now() - activityDays * 24 * 60 * 60 * 1000;

  return concurrentMap(candidates, concurrency, async (c) => {
    try {
      const feed = await getAuthorFeed(c.did, { limit: 25 });
      const posts = (feed.feed || []).map(f => f.post).filter(Boolean);
      if (posts.length === 0) {
        return { did: c.did, lastPostAt: null, postsLast30d: 0, avgLikes: 0, avgReposts: 0 };
      }
      let recent = 0;
      let likes = 0, reposts = 0;
      let lastPostAt = null;
      for (const p of posts) {
        const ts = p.record?.createdAt || p.indexedAt;
        if (ts) {
          const t = new Date(ts).getTime();
          if (!lastPostAt || t > new Date(lastPostAt).getTime()) lastPostAt = ts;
          if (t >= cutoffMs) recent++;
        }
        likes += p.likeCount || 0;
        reposts += p.repostCount || 0;
      }
      return {
        did: c.did,
        lastPostAt,
        postsLast30d: recent,
        avgLikes: likes / posts.length,
        avgReposts: reposts / posts.length,
      };
    } catch (err) {
      return { did: c.did, error: err.message };
    }
  });
}
