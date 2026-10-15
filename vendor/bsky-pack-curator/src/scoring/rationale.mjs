/**
 * "Why included" rationale extractor.
 *
 * For each member, find the sentence(s) in their bio that triggered the bio-match.
 * Output a one-liner that can land in the roster markdown's `Why` column.
 *
 * Fallbacks:
 *   - if no sentence matches, use first non-empty bio line
 *   - if bio empty, use displayName + "active substack/scholar/etc. account"
 */

function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function extractRationale(profile, patterns) {
  const lowered = patterns.map(p => p.toLowerCase());
  const bio = profile.description || '';
  const sentences = splitSentences(bio);
  for (const s of sentences) {
    const sl = s.toLowerCase();
    if (lowered.some(p => sl.includes(p))) {
      return truncate(s, 160);
    }
  }
  // Fallback: first non-trivial sentence
  if (sentences.length > 0) return truncate(sentences[0], 160);
  return profile.displayName || profile.handle;
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

export function annotateWithRationale(profiles, patterns) {
  return profiles.map(p => ({
    ...p,
    rationale: extractRationale(p, patterns),
  }));
}
