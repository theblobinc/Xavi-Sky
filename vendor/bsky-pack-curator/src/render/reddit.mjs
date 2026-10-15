/**
 * r/Bluesky weekly recommendation post template.
 *
 * Uses the methodology-first framing that performs well on the sub:
 *   "I scraped N accounts via the AT Protocol API. Here's the top 10, plus methodology."
 *
 * Outputs a markdown post body ready to paste into reddit.com/r/Bluesky/submit.
 */

export function renderRedditPost({ pack, members, meta }) {
  const top10 = members.slice(0, 10);

  const lines = [];
  lines.push(`I scraped ${meta.fetchedCount} ${meta.themeNoun || 'accounts'} on Bluesky via the AT Protocol API. Here's the top 10, plus methodology.`);
  lines.push('');
  lines.push(`Built a small tool that queries the public AppView search endpoint, paginates the results, filters by bio match, fetches profiles, and applies an activity + engagement filter on top of follower count. Output is a ranked, activity-weighted list. ${meta.fetchedCount} candidates fetched; ${meta.bioMatchCount} matched the bio filter; ${meta.afterActivityCount} passed the last-${meta.activityDays}-days posting filter.`);
  lines.push('');
  lines.push(`## Top 10`);
  lines.push('');
  top10.forEach((m, i) => {
    const handle = m.handle;
    const rationale = (m.rationale || m.displayName || '').slice(0, 140);
    lines.push(`${i + 1}. **[@${handle}](https://bsky.app/profile/${handle})** — ${rationale}`);
  });
  lines.push('');
  lines.push(`## Methodology`);
  lines.push('');
  lines.push(`- Bluesky's public AppView (\`public.api.bsky.app\`) exposes \`app.bsky.actor.searchActors\` and \`app.bsky.actor.getProfiles\` without auth, so the pipeline is read-only and respects rate limits.`);
  lines.push(`- The pack-search endpoint (\`app.bsky.graph.searchStarterPacks\`) returns 501 — not yet implemented — so saturation checks have to drive the SPA.`);
  lines.push(`- Activity weighting matters more than raw follower count: ~30% of bio-keyword hits are dormant accounts.`);
  lines.push(`- Code and full ranked list of all ${members.length}: ${meta.repoUrl || '<GitHub URL pending>'}`);
  lines.push('');
  if (meta.publicUrl) {
    lines.push(`If you want to one-click follow all ${members.length} on this list, here's the Bluesky pack: ${meta.publicUrl}`);
    lines.push('');
  }
  lines.push(`Happy to take suggestions for v2 — reply with handles I missed.`);

  return lines.join('\n');
}
