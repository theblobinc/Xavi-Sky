/**
 * Compose all individual scores into one final ranking.
 *
 * Each per-component score is already normalized 0..1 (or close to it) by its module.
 * This module just applies the weights from src/config.mjs SCORING_WEIGHTS and sorts.
 *
 * Output: candidates with `.finalScore` and a `.scoreBreakdown` for debug + transparency.
 */

import { SCORING_WEIGHTS } from '../config.mjs';

export function composeFinalScores({
  profiles,
  multiSignal,
  reshareScores,
  networkScores,
  inverseSaturation,
}) {
  const ms = new Map(multiSignal.map(s => [s.did, s]));
  const rs = new Map(reshareScores.map(s => [s.did, s.reshareProbability]));
  const ns = networkScores;
  const is = new Map((inverseSaturation || []).map(s => [s.did, s]));

  const scored = profiles.map(p => {
    const m = ms.get(p.did);
    const reshare = rs.get(p.did) || 0;
    const net = ns.get(p.did) || { networkScore: 0, signals: {} };
    const sat = is.get(p.did) || { inverseSaturation: 0.5, existingPackCount: null };

    const finalScore =
      (m ? m.multiSignal : 0) +
      SCORING_WEIGHTS.reshareLikelihood * reshare +
      SCORING_WEIGHTS.network * net.networkScore +
      SCORING_WEIGHTS.inverseSaturation * sat.inverseSaturation;

    return {
      ...p,
      finalScore,
      scoreBreakdown: {
        multiSignal: m?.multiSignal || 0,
        components: m?.components || {},
        reshareProbability: reshare,
        networkScore: net.networkScore,
        networkSignals: net.signals,
        inverseSaturation: sat.inverseSaturation,
        existingPackCount: sat.existingPackCount,
      },
    };
  });

  return scored.sort((a, b) => b.finalScore - a.finalScore);
}
