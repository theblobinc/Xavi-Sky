/**
 * Pre-launch tiered contact list generator.
 *
 * For a finalized pack roster, output three tiers of accounts to engage with
 * during the amplification choreography:
 *
 *   tier1 (tag on launch): 5 mid-tier accounts with high reshare probability
 *                          who carry credibility weight in the theme.
 *   tier2 (DM day 1): 10 niche-density accounts with strong reshare scores
 *                     but lower follower count — they'll respond to a DM.
 *   tier3 (reply-thank to resharers): everyone else; generated on the fly
 *                                     by monitoring inbox for resharers post-launch.
 *
 * Output is a JSON + a pasteable markdown block.
 */

export function generateContactList(rankedMembers, reshareScores, { tier1 = 5, tier2 = 10 } = {}) {
  const reshareMap = new Map(reshareScores.map(s => [s.did, s.reshareProbability]));

  // Tier 1: top of pack (high credibility) with above-median reshare score
  const sortedByReshare = [...rankedMembers].sort(
    (a, b) => (reshareMap.get(b.did) || 0) - (reshareMap.get(a.did) || 0),
  );
  const median = sortedByReshare[Math.floor(sortedByReshare.length / 2)];
  const medianScore = reshareMap.get(median.did) || 0;

  const t1 = rankedMembers
    .slice(0, 30)  // top 30 by overall score
    .filter(m => (reshareMap.get(m.did) || 0) >= medianScore)
    .slice(0, tier1);

  // Tier 2: best reshare-likelihood candidates outside the top 30
  const top30Dids = new Set(rankedMembers.slice(0, 30).map(m => m.did));
  const t2 = sortedByReshare
    .filter(m => !top30Dids.has(m.did))
    .slice(0, tier2);

  return {
    tier1: t1.map(m => ({ handle: m.handle, name: m.displayName, followers: m.followersCount })),
    tier2: t2.map(m => ({ handle: m.handle, name: m.displayName, followers: m.followersCount })),
    notes: [
      'Tier 1: tag in the launch quote-post body.',
      'Tier 2: warm DM within 24h of pack publish with a one-liner referencing the inclusion.',
      'Tier 3: reply-thank every reshare; generate dynamically by monitoring notifications.',
    ],
  };
}

export function renderContactMarkdown(contactList) {
  const lines = ['## Pre-launch contact list', ''];
  lines.push('### Tier 1 — tag on launch (in quote-post body)');
  for (const m of contactList.tier1) {
    lines.push(`- @${m.handle} — ${m.name} (${m.followers.toLocaleString()} followers)`);
  }
  lines.push('');
  lines.push('### Tier 2 — DM within 24h of publish');
  for (const m of contactList.tier2) {
    lines.push(`- @${m.handle} — ${m.name} (${m.followers.toLocaleString()} followers)`);
  }
  lines.push('');
  lines.push('### Notes');
  for (const n of contactList.notes) lines.push(`- ${n}`);
  return lines.join('\n');
}
