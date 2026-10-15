/**
 * Versioning + diff between successive runs of the same pack query.
 *
 * Each pack dir gets a members.json snapshot per run. When you re-run, this
 * module diffs the new pool vs the prior one and reports:
 *   - added: new members (didn't exist or didn't match last time)
 *   - dropped: previously-included now missing (inactive, deleted, lost bio match)
 *   - grew: prior members whose followers grew >= 2x since last run
 *   - shrank: prior members who lost > 30% followers
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export async function loadPriorSnapshot(packDir) {
  try {
    const data = JSON.parse(await readFile(join(packDir, 'members.json'), 'utf8'));
    return data;
  } catch {
    return null;
  }
}

export async function saveSnapshot(packDir, payload) {
  await mkdir(packDir, { recursive: true });
  await writeFile(
    join(packDir, 'members.json'),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

export function diffSnapshots(prior, current) {
  if (!prior) {
    return {
      isFirstRun: true,
      added: current.members.length,
      dropped: 0,
      grew: [],
      shrank: [],
    };
  }
  const priorByDid = new Map(prior.members.map(m => [m.did, m]));
  const currentByDid = new Map(current.members.map(m => [m.did, m]));

  const added = current.members.filter(m => !priorByDid.has(m.did));
  const dropped = prior.members.filter(m => !currentByDid.has(m.did));

  const grew = [];
  const shrank = [];
  for (const [did, c] of currentByDid.entries()) {
    const p = priorByDid.get(did);
    if (!p) continue;
    const oldF = p.followersCount || 0;
    const newF = c.followersCount || 0;
    if (oldF > 0) {
      const ratio = newF / oldF;
      if (ratio >= 2) grew.push({ did, handle: c.handle, from: oldF, to: newF, ratio: ratio.toFixed(2) });
      else if (ratio <= 0.7) shrank.push({ did, handle: c.handle, from: oldF, to: newF, ratio: ratio.toFixed(2) });
    }
  }

  return {
    isFirstRun: false,
    addedCount: added.length,
    droppedCount: dropped.length,
    added,
    dropped,
    grew,
    shrank,
  };
}
