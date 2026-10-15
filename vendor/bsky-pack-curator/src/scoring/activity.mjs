/**
 * Activity-recency filter. Drops candidates with no posts in the last N days.
 *
 * Configurable via --activity-days (default 30). Set to 0 to disable.
 */

export function filterByActivity(profiles, activityByDid, activityDays) {
  if (!activityDays || activityDays <= 0) return profiles;
  const cutoffMs = Date.now() - activityDays * 24 * 60 * 60 * 1000;
  return profiles.filter(p => {
    const a = activityByDid.get(p.did);
    if (!a || a.error) return false;     // no activity data = drop (likely API error or empty)
    if (!a.lastPostAt) return false;     // no posts ever
    return new Date(a.lastPostAt).getTime() >= cutoffMs;
  });
}
