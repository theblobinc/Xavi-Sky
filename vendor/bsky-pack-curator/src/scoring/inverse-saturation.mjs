/**
 * Inverse-saturation bonus.
 *
 * Members appearing in MANY existing packs in this theme are saturated — adding them
 * to yours adds less marginal value, and they're less likely to reshare yet another
 * inclusion notification.
 *
 * Members appearing in FEW or ZERO existing packs are under-represented — they're
 * a fresher addition and more likely to amplify.
 *
 * Requires saturation scrape data from tools/saturation-scrape.mjs.
 */

export function computeInverseSaturation(profiles, packMembershipByDid) {
  return profiles.map(p => {
    const count = packMembershipByDid.get(p.did) || 0;
    // Score: 1 if in 0 existing packs, 0.5 at 3 packs, ~0.1 at 10+
    const inverseScore = 1 / (1 + count * 0.5);
    return { did: p.did, inverseSaturation: inverseScore, existingPackCount: count };
  });
}
