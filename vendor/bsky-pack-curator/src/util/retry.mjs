/**
 * Tiny retry-with-backoff wrapper for transient network failures.
 *
 * Retries on:
 *   - HTTP 429 (rate limit)
 *   - HTTP 5xx (server-side)
 *   - Network errors (ECONNRESET, ETIMEDOUT, etc)
 *
 * Does NOT retry on:
 *   - 4xx other than 429 (caller's mistake, won't change)
 *   - Auth errors
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

function isRetryable(err) {
  if (!err) return false;
  if (RETRYABLE_CODES.has(err.code)) return true;
  const msg = err.message || '';
  for (const s of RETRYABLE_STATUS) {
    if (msg.includes(` ${s}:`)) return true;
  }
  if (msg.includes('fetch failed')) return true;
  return false;
}

export async function withRetry(fn, opts = {}) {
  const { attempts = 3, baseDelayMs = 500 } = opts;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (!isRetryable(err)) break;
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
