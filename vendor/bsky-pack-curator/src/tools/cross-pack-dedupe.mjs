/**
 * Cross-pack deduplication.
 *
 * When you build multiple packs over time, you accumulate a record of who's in
 * which. This module:
 *
 *  - Scans `packs/` directory for prior `members.json` files
 *  - Returns a Map<did, [packSlugs]> of cross-membership
 *  - Optionally filters new candidate pool to exclude / boost previously included accounts
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export async function loadAllPriorMemberships(packsDir) {
  let entries = [];
  try {
    entries = await readdir(packsDir, { withFileTypes: true });
  } catch {
    return new Map();
  }
  const memberMap = new Map(); // did -> [slug]
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const path = join(packsDir, e.name, 'members.json');
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      for (const m of data.members || []) {
        const did = m.did;
        if (!did) continue;
        if (!memberMap.has(did)) memberMap.set(did, []);
        memberMap.get(did).push(e.name);
      }
    } catch {
      // pack dir missing members.json or unreadable — skip
    }
  }
  return memberMap;
}

export function annotateWithCrossMembership(candidates, memberMap) {
  return candidates.map(c => ({
    ...c,
    inPriorPacks: memberMap.get(c.did) || [],
  }));
}

export function filterOutPriorMembers(candidates, memberMap) {
  return candidates.filter(c => !memberMap.has(c.did));
}

/**
 * Compound members appearing in 3+ of your packs = relationship priority targets.
 * Output for outreach contact-list integration.
 */
export function compoundMembers(memberMap, threshold = 3) {
  const compound = [];
  for (const [did, slugs] of memberMap.entries()) {
    if (slugs.length >= threshold) compound.push({ did, packs: slugs });
  }
  return compound.sort((a, b) => b.packs.length - a.packs.length);
}
