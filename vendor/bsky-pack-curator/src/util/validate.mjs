/**
 * Input validation helpers. Run these BEFORE expensive pipeline operations
 * (network calls, large in-memory builds) to fail-fast on bad inputs.
 */

/**
 * Windows reserves these directory names — creating them anywhere on the
 * filesystem fails with confusing errors. Reject them up front.
 */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * A safe pack slug is a directory name we trust to live inside packs/.
 * Disallow: path separators, parent-dir refs, leading dots, control chars,
 * Windows reserved names.
 */
export function validateSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new Error('slug is required.');
  }
  if (slug.length > 80) {
    throw new Error(`slug too long: ${slug.length} chars (max 80).`);
  }
  if (/[\\/]/.test(slug)) {
    throw new Error(`slug must not contain slashes: "${slug}".`);
  }
  if (slug.startsWith('.')) {
    throw new Error(`slug must not start with a dot: "${slug}".`);
  }
  if (slug.includes('..')) {
    throw new Error(`slug must not contain "..": "${slug}".`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f<>:"|?*]/.test(slug)) {
    throw new Error(`slug contains invalid characters: "${slug}".`);
  }
  const base = slug.split('.')[0].toLowerCase();
  if (WINDOWS_RESERVED.has(base)) {
    throw new Error(`slug is a Windows reserved name: "${slug}". Pick a different name.`);
  }
  return slug;
}

/**
 * Bluesky starter packs cap at 150 members. Validate the user's --limit value
 * BEFORE running the pipeline so we don't waste time discovering they wanted 200.
 */
export function validateLimit(rawLimit) {
  if (rawLimit === undefined || rawLimit === null) return 150;
  const n = Number(rawLimit);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`--limit must be a positive integer. Got: "${rawLimit}"`);
  }
  if (n < 1) {
    throw new Error(`--limit must be at least 1. Got: ${n}`);
  }
  if (n > 150) {
    throw new Error(`--limit cannot exceed 150 (Bluesky starter-pack cap). Got: ${n}`);
  }
  return n;
}

/**
 * Activity-days must be non-negative. 0 means "don't filter."
 */
export function validateActivityDays(raw) {
  if (raw === undefined || raw === null) return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`--activity-days must be a non-negative integer. Got: "${raw}"`);
  }
  if (n < 0) {
    throw new Error(`--activity-days must be non-negative (0 to disable). Got: ${n}`);
  }
  return n;
}

/**
 * A Bluesky handle is roughly a domain name. Reject obvious garbage early so we don't
 * waste an entire pipeline run before discovering the viewer doesn't exist.
 */
export function validateHandleShape(handle) {
  if (typeof handle !== 'string') return false;
  if (!handle.includes('.')) return false;
  if (handle.length < 4 || handle.length > 253) return false;
  if (!/^[a-zA-Z0-9._-]+$/.test(handle)) return false;
  return true;
}

/**
 * Pre-flight a Bluesky handle by actually resolving it via the public API.
 * Throws a clean error if the handle doesn't exist, BEFORE the pipeline spends
 * 30+ seconds fetching profiles and activity stats.
 */
export async function preflightHandle(handle) {
  if (!validateHandleShape(handle)) {
    throw new Error(
      `--viewer must look like a Bluesky handle (e.g. yourhandle.bsky.social). Got: "${handle}"`,
    );
  }
  const { publicGet } = await import('../api/client.mjs');
  try {
    const r = await publicGet('com.atproto.identity.resolveHandle', { handle });
    return r.did;
  } catch (err) {
    throw new Error(
      `--viewer handle "${handle}" could not be resolved. ` +
      `Check spelling, including the .bsky.social suffix (or custom domain).`,
    );
  }
}
