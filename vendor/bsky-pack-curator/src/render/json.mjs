/**
 * Raw JSON dataset output. Two shapes:
 *   - members.json — for versioning / diff next run; minimal per-member fields
 *   - dataset.json — full dump including scores, rationales, network signals
 *
 * The minimal shape is intentionally stable so diff comparisons don't churn.
 */

export function renderMembersJson({ pack, members, meta }) {
  return {
    pack: { name: pack.name, description: pack.description, slug: meta.slug },
    builtAt: meta.builtAt,
    members: members.map(m => ({
      did: m.did,
      handle: m.handle,
      displayName: m.displayName,
      followersCount: m.followersCount,
    })),
  };
}

export function renderFullDataset({ pack, members, meta, saturationResult, diff }) {
  return {
    pack,
    meta,
    members: members.map(m => ({
      did: m.did,
      handle: m.handle,
      displayName: m.displayName,
      description: m.description,
      followersCount: m.followersCount,
      followsCount: m.followsCount,
      postsCount: m.postsCount,
      finalScore: m.finalScore,
      scoreBreakdown: m.scoreBreakdown,
      rationale: m.rationale,
      inPriorPacks: m.inPriorPacks || [],
    })),
    saturationResult: saturationResult || null,
    diff: diff || null,
  };
}
